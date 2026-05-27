import {
  DEFAULT_REPO,
  DEFAULT_REF,
  fetchRegistryFile,
} from "./github-registry-client.js";
import { computeEncodeType } from "./eip712.js";
import { fetchPrebuiltRegistryIndex } from "./github-registry-index.js";
import type {
  Descriptor,
  EmbeddedResolverOptions,
  GitHubResolverOptions,
  GitHubSource,
  RegistryIndex,
  TypedData,
} from "./types.js";
import {
  asciiToBytes,
  bytesToHex,
  keccak256,
  normalizeAddress,
} from "./utils.js";

/**
 * Internal: an index for path lookup plus a closure that fetches and parses
 * a single descriptor file by repo-relative path. Built by
 * {@link createResolver} and consumed by the resolve functions.
 */
interface Resolver {
  index: RegistryIndex;
  fetchDescriptor: (path: string) => Promise<Descriptor>;
}

/**
 * Builds a {@link Resolver} for the given source. For `"github"` without an
 * explicit `options.index`, fetches the prebuilt registry index up front
 * (no caching — recreating the resolver triggers another fetch).
 */
async function createResolver(
  options: GitHubResolverOptions | EmbeddedResolverOptions = {
    type: "github",
  },
): Promise<Resolver> {
  switch (options.type) {
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
    case "embedded": {
      return {
        index: options.index,
        fetchDescriptor: async (path) => {
          const mod = await import(`${options.descriptorDirectory}/${path}`, {
            with: { type: "json" },
          });
          return (mod.default ?? mod) as Descriptor;
        },
      };
    }
  }
}

/** Resolves a calldata descriptor by `(chainId, contractAddress)`. */
export async function resolveCalldataDescriptor(
  chainId: number,
  to: string,
  options?: GitHubResolverOptions | EmbeddedResolverOptions,
): Promise<Descriptor | undefined> {
  const resolver = await createResolver(options);
  const path =
    resolver.index.calldataIndex[`eip155:${chainId}:${normalizeAddress(to)}`];
  if (!path) return undefined;
  return resolveWithIncludes(resolver, path);
}

/**
 * Resolves a typed-data descriptor for the given EIP-712 message.
 *
 * Looks up candidates by `(chainId, verifyingContract, primaryType)`, then
 * picks the entry whose `encodeTypeHashes` contain the keccak256 hash of
 * the message's EIP-712 `encodeType` string. Returns `undefined` when no
 * candidate matches the computed hash.
 */
export async function resolveTypedDataDescriptor(
  typedData: TypedData,
  options?: GitHubResolverOptions | EmbeddedResolverOptions,
): Promise<Descriptor | undefined> {
  const { chainId, verifyingContract } = typedData.domain;
  if (chainId === undefined || !verifyingContract) return undefined;

  const resolver = await createResolver(options);
  const byPrimaryType =
    resolver.index.typedDataIndex[
      `eip155:${chainId}:${normalizeAddress(verifyingContract)}`
    ];
  const entries = byPrimaryType?.[typedData.primaryType];
  if (!entries?.length) return undefined;

  const encodeTypeStr = computeEncodeType(
    typedData.primaryType,
    typedData.types,
  );
  if (!encodeTypeStr) return undefined;
  const hash = bytesToHex(keccak256(asciiToBytes(encodeTypeStr)));

  const match = entries.find((e) => e.encodeTypeHashes.includes(hash));
  if (!match) return undefined;
  return resolveWithIncludes(resolver, match.path);
}

async function resolveWithIncludes(
  resolver: Resolver,
  path: string,
): Promise<Descriptor> {
  const descriptor = await resolver.fetchDescriptor(path);
  const includes =
    typeof descriptor.includes === "string" ? descriptor.includes : undefined;
  if (!includes) return descriptor;

  const includesPath = new URL(includes, `https://x/${path}`).pathname.slice(1);
  const included = await resolver.fetchDescriptor(includesPath);
  return mergeDescriptors(descriptor, included);
}

/**
 * Merges an including ERC-7730 descriptor with the descriptor it includes.
 *
 * Implements the EIP-7730 merge algorithm:
 * - The including descriptor takes priority over the included descriptor for all unique keys.
 * - `fields` arrays within display format entries are merged by path value:
 *   fields from the including descriptor override matching fields in the included descriptor,
 *   and new fields are appended.
 * - The `includes` key itself is not carried over to the merged result.
 */
function mergeDescriptors(
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
