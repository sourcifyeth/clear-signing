import type { GitHubSource, RegistryIndex } from "./types.js";
import {
  DEFAULT_REPO,
  DEFAULT_REF,
  fetchRegistryFilePaths,
  fetchRegistryFile,
} from "./github-registry-client.js";
import { extractPrimaryType } from "./eip712.js";
import {
  asciiToBytes,
  bytesToHex,
  keccak256,
  normalizeAddress,
} from "./utils.js";

/** File names of the prebuilt indexes published in the registry root. */
const CALLDATA_INDEX_FILE = "index.calldata.json";
const EIP712_INDEX_FILE = "index.eip712.json";

/**
 * Fetches the {@link RegistryIndex} from the registry's prebuilt index files
 * (`index.calldata.json` and `index.eip712.json`). Assumes both files live
 * at the repo root.
 *
 * No caching — call this once at startup and pass the result to `format()` /
 * `formatTypedData()` via `descriptorResolverOptions.index` to reuse it
 * across calls.
 */
export async function fetchPrebuiltRegistryIndex(
  source?: Partial<GitHubSource>,
): Promise<RegistryIndex> {
  const gitHubSource: GitHubSource = {
    repo: source?.repo ?? DEFAULT_REPO,
    ref: source?.ref ?? DEFAULT_REF,
  };
  const [calldataIndex, typedDataIndex] = await Promise.all([
    fetchRegistryFile(CALLDATA_INDEX_FILE, gitHubSource),
    fetchRegistryFile(EIP712_INDEX_FILE, gitHubSource),
  ]);
  return {
    calldataIndex: calldataIndex as RegistryIndex["calldataIndex"],
    typedDataIndex: typedDataIndex as RegistryIndex["typedDataIndex"],
  };
}

/**
 * Indexes a single descriptor into `index`.
 *
 * For EIP-712 descriptors, groups `display.formats` keys (full `encodeType`
 * strings) by primary type and stores each entry with its keccak256
 * `encodeType` hashes so callers can disambiguate when multiple descriptors
 * share the same (chainId, verifyingContract, primaryType) triple.
 */
function indexDescriptor(
  descriptor: Record<string, unknown>,
  path: string,
  index: RegistryIndex,
): void {
  const context = descriptor.context as Record<string, unknown> | undefined;
  if (!context) return;

  // Calldata descriptor
  const contract = context.contract as Record<string, unknown> | undefined;
  if (contract) {
    const deployments = contract.deployments as
      | Array<Record<string, unknown>>
      | undefined;
    if (deployments) {
      for (const dep of deployments) {
        const chainId = dep.chainId as number | undefined;
        const address = dep.address as string | undefined;
        if (chainId !== undefined && address) {
          const key = `eip155:${chainId}:${normalizeAddress(address)}`;
          if (!index.calldataIndex[key]) {
            index.calldataIndex[key] = path;
          }
        }
      }
    }
    return;
  }

  // EIP-712 descriptor
  const eip712 = context.eip712 as Record<string, unknown> | undefined;
  if (!eip712) return;
  const deployments = eip712.deployments as
    | Array<Record<string, unknown>>
    | undefined;
  if (!deployments?.length) return;

  const display = descriptor.display as Record<string, unknown> | undefined;
  const formats = display?.formats as Record<string, unknown> | undefined;
  if (!formats) return;

  // Group encodeType hashes by primary type — a descriptor file may declare
  // multiple format keys that share the same primary type.
  const hashesByPrimaryType = new Map<string, string[]>();
  for (const encodeTypeStr of Object.keys(formats)) {
    const primaryType = extractPrimaryType(encodeTypeStr);
    if (!primaryType) continue;
    const hash = bytesToHex(keccak256(asciiToBytes(encodeTypeStr)));
    const list = hashesByPrimaryType.get(primaryType) ?? [];
    list.push(hash);
    hashesByPrimaryType.set(primaryType, list);
  }
  if (hashesByPrimaryType.size === 0) return;

  for (const dep of deployments) {
    const chainId = dep.chainId as number | undefined;
    const address = dep.address as string | undefined;
    if (chainId === undefined || !address) continue;

    const caip = `eip155:${chainId}:${normalizeAddress(address)}`;
    const byPrimaryType = (index.typedDataIndex[caip] ??= {});
    for (const [primaryType, encodeTypeHashes] of hashesByPrimaryType) {
      const entries = (byPrimaryType[primaryType] ??= []);
      entries.push({ path, encodeTypeHashes });
    }
  }
}

/**
 * Builds a {@link RegistryIndex} by walking every descriptor file in the
 * GitHub registry and indexing it.
 *
 * Useful when the registry's prebuilt indexes are out of date or missing
 * descriptors, or when pointing at a fork that doesn't publish index files.
 * Prefer the prebuilt indexes for normal use — they're much cheaper to fetch.
 */
export async function createGitHubRegistryIndex(
  source?: Partial<GitHubSource>,
): Promise<RegistryIndex> {
  const gitHubSource = {
    repo: source?.repo ?? DEFAULT_REPO,
    ref: source?.ref ?? DEFAULT_REF,
  };

  const paths = await fetchRegistryFilePaths(gitHubSource);

  const index: RegistryIndex = {
    calldataIndex: {},
    typedDataIndex: {},
  };
  const concurrency = 25;
  const maxRetries = 3;
  for (let i = 0; i < paths.length; i += concurrency) {
    const batch = paths.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (path) => {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const descriptor = (await fetchRegistryFile(
              path,
              gitHubSource,
            )) as Record<string, unknown>;
            indexDescriptor(descriptor, path, index);
            return;
          } catch {
            if (attempt < maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
            }
          }
        }
      }),
    );
  }
  return index;
}
