import {
  DEFAULT_REPO,
  DEFAULT_REF,
  fetchRegistryFile,
} from "./github-registry-client.js";
import { computeEncodeType } from "./eip712.js";
import { fetchPrebuiltRegistryIndex } from "./github-registry-index.js";
import type {
  CustomResolverOptions,
  Descriptor,
  DescriptorResolver,
  GitHubResolverOptions,
  GitHubSource,
  TokenStandard,
  TrustedTokens,
  TypedData,
  Warning,
} from "./types.js";
import { buildBundledTokenDescriptor } from "./bundled-descriptors.js";
import {
  asciiToBytes,
  bytesToHex,
  hexToBytes,
  keccak256,
  normalizeAddress,
  toChecksumAddress,
  warn,
} from "./utils.js";

type ResolveDescriptorResult =
  | { descriptor: Descriptor }
  | { warning: Warning };

/**
 * Builds a {@link DescriptorResolver} from the supplied options. For
 * `{ type: "github" }` without an explicit `options.index`, fetches the
 * prebuilt registry index up front (no caching — recreating the resolver
 * triggers another fetch). For `{ type: "custom" }`, returns the user-built
 * resolver unchanged.
 */
async function createResolver(
  options: GitHubResolverOptions | CustomResolverOptions = {
    type: "github",
  },
): Promise<DescriptorResolver> {
  switch (options.type) {
    case "custom":
      return options.resolver;
    case "github": {
      const source: GitHubSource = {
        repo: options.githubSource?.repo ?? DEFAULT_REPO,
        ref: options.githubSource?.ref ?? DEFAULT_REF,
      };
      const index = options.index ?? (await fetchPrebuiltRegistryIndex(source));
      return {
        index,
        fetchDescriptor: async (path) =>
          (await fetchRegistryFile(path, source)) as Descriptor,
      };
    }
  }
}

/**
 * Resolves a calldata descriptor by `(chainId, contractAddress)`. Returns
 * a `{ descriptor }` envelope on success, or a `{ warning }` envelope when
 * resolution fails — `NO_DESCRIPTOR` when nothing is indexed for the pair,
 * `CYCLIC_INCLUDES` when the `includes` chain self-references.
 *
 * If no descriptor is indexed for the chain and address, the method also checks
 * the optional `options.trustedTokens` list for a matching trusted token. In case
 * of a matching trusted token, a token descriptor is generated on the fly.
 */
export async function resolveCalldataDescriptor(
  chainId: number,
  to: string,
  options?: GitHubResolverOptions | CustomResolverOptions,
): Promise<ResolveDescriptorResult> {
  const resolver = await createResolver(options);
  const path =
    resolver.index.calldataIndex[`eip155:${chainId}:${normalizeAddress(to)}`];
  if (path) return resolveWithIncludes(resolver, path);

  // No registry descriptor. Check if a trusted token matches.
  const standard = lookupTrustedToken(options?.trustedTokens, chainId, to);
  if (standard) {
    return { descriptor: buildBundledTokenDescriptor(standard, chainId, to) };
  }

  return noDescriptorWarning(chainId, to);
}

/**
 * Look up a token standard in the trusted-token list, accepting either a
 * lowercase or an EIP-55 checksummed address key.
 */
function lookupTrustedToken(
  trustedTokens: TrustedTokens | undefined,
  chainId: number,
  address: string,
): TokenStandard | undefined {
  const tokens = trustedTokens?.[chainId];
  if (!tokens) return undefined;

  const lowercaseResult = tokens[normalizeAddress(address)];
  if (lowercaseResult !== undefined) return lowercaseResult;

  try {
    return tokens[toChecksumAddress(hexToBytes(address))];
  } catch {
    return undefined;
  }
}

/**
 * Resolves a typed-data descriptor for the given EIP-712 message.
 *
 * Looks up candidates by `(chainId, verifyingContract, primaryType)`, then
 * picks the entry whose `encodeTypeHashes` contain the keccak256 hash of
 * the message's EIP-712 `encodeType` string. Returns `NO_DESCRIPTOR` if no
 * candidate matches, `CYCLIC_INCLUDES` if the `includes` chain self-references,
 * or `{ descriptor }` on success.
 */
export async function resolveTypedDataDescriptor(
  typedData: TypedData,
  options?: GitHubResolverOptions | CustomResolverOptions,
): Promise<ResolveDescriptorResult> {
  const { chainId, verifyingContract } = typedData.domain;
  if (chainId === undefined || !verifyingContract) {
    return noDescriptorWarning(chainId, verifyingContract);
  }

  const resolver = await createResolver(options);
  const byPrimaryType =
    resolver.index.typedDataIndex[
      `eip155:${chainId}:${normalizeAddress(verifyingContract)}`
    ];
  const entries = byPrimaryType?.[typedData.primaryType];
  if (!entries?.length) return noDescriptorWarning(chainId, verifyingContract);

  const encodeTypeStr = computeEncodeType(
    typedData.primaryType,
    typedData.types,
  );
  if (!encodeTypeStr) return noDescriptorWarning(chainId, verifyingContract);
  const hash = bytesToHex(keccak256(asciiToBytes(encodeTypeStr)));

  const match = entries.find((e) => e.encodeTypeHashes.includes(hash));
  if (!match) return noDescriptorWarning(chainId, verifyingContract);
  return resolveWithIncludes(resolver, match.path);
}

function noDescriptorWarning(
  chainId: number | undefined,
  address: string | undefined,
): ResolveDescriptorResult {
  return {
    warning: warn(
      "NO_DESCRIPTOR",
      `No descriptor found for chain ${chainId} and address ${address}`,
    ),
  };
}

async function resolveWithIncludes(
  resolver: DescriptorResolver,
  path: string,
  visited: Set<string> = new Set(),
): Promise<ResolveDescriptorResult> {
  if (visited.has(path)) {
    return {
      warning: warn(
        "CYCLIC_INCLUDES",
        `Cyclic includes detected for descriptor path '${path}'`,
      ),
    };
  }
  visited.add(path);

  const descriptor = await resolver.fetchDescriptor(path);
  const includes =
    typeof descriptor.includes === "string" ? descriptor.includes : undefined;
  if (!includes) return { descriptor };

  const includesPath = resolveIncludePath(path, includes);
  const included = await resolveWithIncludes(resolver, includesPath, visited);
  if ("warning" in included) return included;
  return { descriptor: mergeDescriptors(descriptor, included.descriptor) };
}

/**
 * Resolve `includes` (a relative path declared inside a descriptor) against the
 * directory of `base` (the path the including descriptor was fetched at).
 *
 * `base` is treated as absolute (anchored at "/") so `..` segments collapse
 * cleanly when they overshoot the root: extra `..` are silently dropped rather
 * than producing a result that escapes the descriptor root. Callers MUST index
 * descriptors by their full path relative to `descriptorDirectory` (or the repo
 * root, for the GitHub source), so that `..` segments inside an `includes` are
 * absorbed against real leading segments instead of being dropped at the root.
 */
function resolveIncludePath(base: string, includes: string): string {
  const baseSegments = ("/" + base).split("/").slice(0, -1);
  const out: string[] = [];
  for (const seg of [...baseSegments, ...includes.split("/")]) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

/**
 * Merges an including ERC-7730 descriptor with the descriptor it includes.
 *
 * May be useful for creating indexes, and correctly resolving an includes chain.
 *
 * Implements the EIP-7730 merge algorithm:
 * - The including descriptor takes priority over the included descriptor for all unique keys.
 * - `fields` arrays within display format entries are merged by path value:
 *   fields from the including descriptor override matching fields in the included descriptor,
 *   and new fields are appended.
 * - The `includes` key itself is not carried over to the merged result.
 */
export function mergeDescriptors(
  including: Descriptor,
  included: Descriptor,
): Descriptor {
  const result: Descriptor = { ...included };

  for (const [key, value] of Object.entries(including)) {
    if (key === "includes") continue;

    if (key === "display" && isObject(value) && isObject(included.display)) {
      result.display = mergeDisplaySection(
        value as Record<string, unknown>,
        included.display as Record<string, unknown>,
      );
    } else {
      result[key] =
        isObject(value) && isObject(result[key])
          ? deepMerge(value, result[key] as Record<string, unknown>)
          : value;
    }
  }

  return result;
}

function mergeDisplaySection(
  including: Record<string, unknown>,
  included: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...included };

  for (const [key, value] of Object.entries(including)) {
    if (key === "formats" && isObject(value) && isObject(included.formats)) {
      result.formats = mergeFormats(
        value as Record<string, unknown>,
        included.formats as Record<string, unknown>,
      );
    } else {
      result[key] =
        isObject(value) && isObject(result[key])
          ? deepMerge(value, result[key] as Record<string, unknown>)
          : value;
    }
  }

  return result;
}

function mergeFormats(
  including: Record<string, unknown>,
  included: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...included };

  for (const [selector, format] of Object.entries(including)) {
    const includedFormat = included[selector];
    if (isObject(format) && isObject(includedFormat)) {
      result[selector] = mergeFormatEntry(
        format as Record<string, unknown>,
        includedFormat as Record<string, unknown>,
      );
    } else {
      result[selector] = format;
    }
  }

  return result;
}

function mergeFormatEntry(
  including: Record<string, unknown>,
  included: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...included };

  for (const [key, value] of Object.entries(including)) {
    if (
      key === "fields" &&
      Array.isArray(value) &&
      Array.isArray(included.fields)
    ) {
      result.fields = mergeFields(
        value as Record<string, unknown>[],
        included.fields as Record<string, unknown>[],
      );
    } else {
      result[key] =
        isObject(value) && isObject(result[key])
          ? deepMerge(value, result[key] as Record<string, unknown>)
          : value;
    }
  }

  return result;
}

function deepMerge(
  including: Record<string, unknown>,
  included: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...included };
  for (const [key, value] of Object.entries(including)) {
    result[key] =
      isObject(value) && isObject(result[key])
        ? deepMerge(value, result[key] as Record<string, unknown>)
        : value;
  }
  return result;
}

function mergeFields(
  including: Record<string, unknown>[],
  included: Record<string, unknown>[],
): Record<string, unknown>[] {
  const result = [...included];

  for (const field of including) {
    const existingIndex = result.findIndex((f) => f.path === field.path);
    if (existingIndex >= 0) {
      result[existingIndex] = deepMerge(field, result[existingIndex]);
    } else {
      result.push(field);
    }
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
