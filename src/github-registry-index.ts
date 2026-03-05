import type { GitHubSource, RegistryIndex } from "./types";
import {
  fetchRegistryFilePaths,
  fetchRegistryFile,
} from "./github-registry-client";
import { normalizeAddress } from "./utils";

export const DEFAULT_REPO = "LedgerHQ/clear-signing-erc7730-registry";
export const DEFAULT_REF = "master";

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
  if (eip712) {
    const deployments = eip712.deployments as
      | Array<Record<string, unknown>>
      | undefined;
    if (deployments) {
      for (const dep of deployments) {
        const chainId = dep.chainId as number | undefined;
        const address = dep.address as string | undefined;
        if (chainId !== undefined && address) {
          const key = `eip155:${chainId}:${normalizeAddress(address)}`;
          if (!index.typedDataIndex[key]) {
            index.typedDataIndex[key] = path;
          }
        }
      }
    }
  }
}

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
  await Promise.all(
    paths.map(async (path) => {
      try {
        const descriptor = (await fetchRegistryFile(
          path,
          gitHubSource,
        )) as Record<string, unknown>;
        indexDescriptor(descriptor, path, index);
      } catch {
        // Skip malformed or inaccessible descriptors
      }
    }),
  );
  return index;
}
