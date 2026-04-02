import type { GitHubSource, RegistryIndex } from "./types";
import {
  DEFAULT_REPO,
  DEFAULT_REF,
  fetchRegistryFilePaths,
  fetchRegistryFile,
} from "./github-registry-client";
import { normalizeAddress } from "./utils";

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
