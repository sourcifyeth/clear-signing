/**
 * Descriptor lookup and token metadata resolution for clear signing.
 *
 * Descriptors are fetched on demand from a configurable source (GitHub registry
 * or user-provided inline objects). Results are cached in module-level maps.
 *
 * Descriptor JSON is typed as `Record<string, unknown>` rather than a strict
 * schema type. Descriptors come from an external registry we don't control, so
 * we access only the fields we need via optional chaining and silently skip
 * anything missing or unexpected. Stricter structural validation happens in the
 * engine layer once a descriptor is actually used for rendering.
 */

import { ResolverError, EngineError } from "./errors";
import type {
  ResolvedCall,
  ResolvedDescriptor,
  ResolvedTypedDescriptor,
  TokenMeta,
  ResolverOptions,
  GitHubRegistrySource,
} from "./types";
import {
  buildDescriptor,
  decodeArguments,
  determineTokenKey,
  getFormatMap,
  getFunctionDescriptors,
  resolveEffectiveField,
} from "./descriptor";
import { lookupTokenByCaip19 } from "./token-registry";
import { bytesEqual, normalizeAddress, nativeTokenKey } from "./utils";
import { fetchAbsoluteUrl, resolveIncludeUrl } from "./github-registry-client";
import { GitHubRegistryIndex } from "./github-registry-index";

// ---------------------------------------------------------------------------
// Module-level caches
// ---------------------------------------------------------------------------

/** Maps absolute descriptor URL -> { descriptorJson, includes } */
const resolvedDescriptorCache = new Map<string, ResolvedDescriptor>();

/** One GitHubRegistryIndex instance per unique source config (keyed by "repo:ref"). */
const indexInstances = new Map<string, GitHubRegistryIndex>();

/** Returns the cached index instance for the given source, creating one if needed. */
function getIndex(
  source: GitHubRegistrySource | undefined,
): GitHubRegistryIndex {
  const key = `${source?.repo ?? ""}:${source?.ref ?? ""}`;
  let index = indexInstances.get(key);
  if (!index) {
    index = new GitHubRegistryIndex(source);
    indexInstances.set(key, index);
  }
  return index;
}

/** Clears all caches. Useful in tests. */
export function clearCache(): void {
  indexInstances.clear();
  resolvedDescriptorCache.clear();
}

// ---------------------------------------------------------------------------
// Inline descriptor helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Include resolution
// ---------------------------------------------------------------------------

/**
 * Fetches and resolves includes for a descriptor loaded from a URL.
 * Relative include paths are resolved against the descriptor's URL.
 */
async function fetchIncludes(
  descriptor: Record<string, unknown>,
  descriptorAbsUrl: string,
): Promise<string[]> {
  const includesValue = descriptor.includes;
  if (!includesValue) return [];

  const includePaths: string[] =
    typeof includesValue === "string"
      ? [includesValue]
      : Array.isArray(includesValue)
        ? (includesValue as string[])
        : [];

  const results: string[] = [];
  for (const p of includePaths) {
    if (typeof p !== "string") {
      throw ResolverError.parse("includes entries must be strings");
    }
    const url = resolveIncludeUrl(descriptorAbsUrl, p);
    const content = await fetchAbsoluteUrl(url);
    results.push(JSON.stringify(content));
  }
  return results;
}

/**
 * Extracts includes from an inline source's pre-resolved includes map.
 * Looks up the path declared in `descriptor.includes` against the caller-supplied map.
 */
function extractInlineIncludes(
  descriptor: Record<string, unknown>,
  includesMap: { [path: string]: Record<string, unknown> } | undefined,
): string[] {
  const includePath = descriptor.includes;
  if (typeof includePath !== "string" || !includesMap) return [];
  const content = includesMap[includePath];
  if (!content) return [];
  return [JSON.stringify(content)];
}

// ---------------------------------------------------------------------------
// Core resolve functions
// ---------------------------------------------------------------------------

/**
 * Resolves a descriptor bundle for the given chain and address.
 */
export async function resolve(
  chainId: number,
  to: string,
  opts?: ResolverOptions,
): Promise<ResolvedDescriptor> {
  const source = opts?.source;
  const key = `eip155:${chainId}:${normalizeAddress(to)}`;

  // Inline source: use the provided descriptor directly, no index or cache
  if (source?.type === "inline") {
    return {
      descriptorJson: JSON.stringify(source.descriptor),
      includes: extractInlineIncludes(source.descriptor, source.includes),
    };
  }

  // GitHub source: build index on demand, look up by CAIP-10 key
  const githubSource = source as GitHubRegistrySource | undefined;
  const location = await getIndex(githubSource).lookupCalldataDescriptorUrl(
    chainId,
    to,
  );
  if (!location) {
    throw ResolverError.notFound(key);
  }

  // Check resolved descriptor cache
  const cached = resolvedDescriptorCache.get(location);
  if (cached) return cached;

  const descriptor = (await fetchAbsoluteUrl(location)) as Record<
    string,
    unknown
  >;
  const descriptorJson = JSON.stringify(descriptor);
  const includes = await fetchIncludes(descriptor, location);

  const result: ResolvedDescriptor = { descriptorJson, includes };
  resolvedDescriptorCache.set(location, result);
  return result;
}

/**
 * Resolves a descriptor and fetches token metadata required for rendering.
 */
export async function resolveCall(
  chainId: number,
  to: string,
  calldata: Uint8Array,
  value?: Uint8Array,
  opts?: ResolverOptions,
): Promise<ResolvedCall> {
  const resolved = await resolve(chainId, to, opts);
  const descriptor = buildDescriptor(resolved);

  const selector = calldata.slice(0, 4);
  const functions = getFunctionDescriptors(descriptor);

  const tokenMetadata = new Map<string, TokenMeta>();
  const fn = functions.find((f) => bytesEqual(f.selector, selector));

  if (fn) {
    const decoded = decodeArguments(fn, calldata).withValue(value);
    const formatMap = getFormatMap(descriptor);
    const format = formatMap.get(fn.typedSignature);

    if (format) {
      const warnings: string[] = [];
      const definitions = descriptor.display.definitions || {};

      for (const field of format.fields) {
        const effective = resolveEffectiveField(field, definitions, warnings);
        if (!effective) continue;

        if (effective.format === "tokenAmount") {
          try {
            const tokenKey = determineTokenKey(effective, decoded, chainId, to);
            const meta = lookupTokenByCaip19(tokenKey);
            if (meta) {
              tokenMetadata.set(tokenKey, meta);
            } else {
              throw EngineError.tokenRegistry(
                `token registry missing entry for ${tokenKey}`,
              );
            }
          } catch (e) {
            if (e instanceof EngineError) throw e;
            // Skip token lookup errors during resolution
          }
        } else if (effective.format === "amount") {
          const tokenKey = nativeTokenKey(chainId);
          if (tokenKey) {
            const meta = lookupTokenByCaip19(tokenKey);
            if (meta) {
              tokenMetadata.set(tokenKey, meta);
            }
          }
        }
      }
    }
  }

  const descriptorAddressBook = getDescriptorAddressBook(descriptor);
  // No hardcoded registry address book anymore

  const addressBookMap = new Map<string, string>();
  for (const [addr, label] of Object.entries(descriptorAddressBook)) {
    addressBookMap.set(addr, label);
  }

  return {
    descriptor: resolved,
    tokenMetadata,
    addressBook: addressBookMap,
  };
}

/**
 * Resolves an EIP-712 descriptor for the given chain and verifying contract.
 */
export async function resolveTyped(
  chainId: number,
  verifyingContract: string,
  opts?: ResolverOptions,
): Promise<ResolvedTypedDescriptor> {
  const source = opts?.source;
  const key = `eip155:${chainId}:${normalizeAddress(verifyingContract)}`;

  let descriptor: Record<string, unknown>;
  let descriptorJson: string;
  let includes: string[];

  // Inline source: use the provided descriptor directly, no index or cache
  if (source?.type === "inline") {
    descriptor = source.descriptor;
    descriptorJson = JSON.stringify(source.descriptor);
    includes = extractInlineIncludes(source.descriptor, source.includes);
  } else {
    // GitHub source: build index on demand, look up by CAIP-10 key
    const githubSource = source as GitHubRegistrySource | undefined;
    const location = await getIndex(githubSource).lookupEip712DescriptorUrl(
      chainId,
      verifyingContract,
    );
    if (!location) {
      throw ResolverError.notFound(key);
    }

    const cached = resolvedDescriptorCache.get(location);
    if (cached) {
      descriptorJson = cached.descriptorJson;
      includes = cached.includes;
      descriptor = JSON.parse(descriptorJson) as Record<string, unknown>;
    } else {
      descriptor = (await fetchAbsoluteUrl(location)) as Record<
        string,
        unknown
      >;
      descriptorJson = JSON.stringify(descriptor);
      includes = await fetchIncludes(descriptor, location);
      resolvedDescriptorCache.set(location, { descriptorJson, includes });
    }
  }

  // Build address book from descriptor metadata
  const addressBookMap = new Map<string, string>();

  const metadata = descriptor.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const label = getMetadataLabel(metadata);
    if (label) {
      const context = descriptor.context as Record<string, unknown> | undefined;
      const eip712 = context?.eip712 as Record<string, unknown> | undefined;
      const deployments = eip712?.deployments as
        | Array<Record<string, unknown>>
        | undefined;

      if (deployments) {
        for (const deployment of deployments) {
          const addr = deployment.address as string | undefined;
          if (addr) {
            addressBookMap.set(normalizeAddress(addr), label);
          }
        }
      }
      addressBookMap.set(normalizeAddress(verifyingContract), label);
    }

    mergeAddressBookEntries(addressBookMap, metadata.addressBook);
  }

  return {
    descriptorJson,
    includes,
    addressBook: addressBookMap,
  };
}

/**
 * Merge descriptor JSON with includes.
 */
export function mergedDescriptorValue(
  descriptorJson: string,
  includes: string[],
): Record<string, unknown> {
  const descriptorValue = JSON.parse(descriptorJson) as Record<string, unknown>;

  for (const includeJson of includes) {
    const includeValue = JSON.parse(includeJson) as Record<string, unknown>;
    mergeIncludeValue(descriptorValue, includeValue);
  }

  delete descriptorValue.includes;
  return descriptorValue;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function mergeIncludeValue(
  target: Record<string, unknown>,
  include: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(include)) {
    if (target[key] === undefined) {
      target[key] = value;
    } else if (
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key]) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      mergeIncludeValue(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    }
  }
}

function getDescriptorAddressBook(
  descriptor: ReturnType<typeof buildDescriptor>,
): Record<string, string> {
  const map: Record<string, string> = {};

  const label = getDescriptorFriendlyLabel(descriptor);
  if (label) {
    for (const deployment of descriptor.context.contract.deployments) {
      map[normalizeAddress(deployment.address)] = label;
    }
  }

  mergeAddressBookEntries(
    new Map(Object.entries(map)),
    descriptor.metadata.addressBook,
  );
  return map;
}

function getDescriptorFriendlyLabel(
  descriptor: ReturnType<typeof buildDescriptor>,
): string | undefined {
  return getMetadataLabel(descriptor.metadata) ?? descriptor.context.$id;
}

function getMetadataLabel(
  metadata: Record<string, unknown>,
): string | undefined {
  const token = metadata.token as Record<string, unknown> | undefined;
  if (token) {
    const name = token.name as string | undefined;
    const symbol = token.symbol as string | undefined;
    if (name && symbol) {
      return name.toLowerCase() === symbol.toLowerCase()
        ? name
        : `${name} (${symbol})`;
    }
    return name ?? symbol;
  }

  const info = metadata.info as Record<string, unknown> | undefined;
  if (info) {
    const legalName = info.legalName as string | undefined;
    if (legalName) return legalName;
    const name = info.name as string | undefined;
    if (name) return name;
  }

  const owner = metadata.owner as string | undefined;
  if (owner) return owner;

  return undefined;
}

function mergeAddressBookEntries(
  map: Map<string, string>,
  value: unknown,
): void {
  if (!value || typeof value !== "object") return;

  const entries = value as Record<string, unknown>;
  for (const [key, labelValue] of Object.entries(entries)) {
    if (typeof labelValue === "string") {
      if (!map.has(normalizeAddress(key))) {
        map.set(normalizeAddress(key), labelValue);
      }
    } else if (typeof labelValue === "object" && labelValue !== null) {
      const nested = labelValue as Record<string, unknown>;
      for (const [innerKey, innerLabelValue] of Object.entries(nested)) {
        if (typeof innerLabelValue === "string") {
          if (!map.has(normalizeAddress(innerKey))) {
            map.set(normalizeAddress(innerKey), innerLabelValue);
          }
        }
      }
    }
  }
}
