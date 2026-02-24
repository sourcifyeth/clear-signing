/**
 * In-memory index for the GitHub descriptor registry.
 *
 * Builds and caches a map of CAIP-10 identifiers -> descriptor URL
 * by eagerly fetching all calldata-* and eip712-* files from the GitHub tree.
 *
 * This module is intentionally separate from the I/O client (github-registry-client.ts)
 * and the resolution logic (resolver.ts) so that the index strategy can evolve
 * independently.
 */

import type { GitHubRegistrySource } from "./types";
import {
  fetchRegistryFilePaths,
  fetchRegistryFile,
  descriptorUrl,
  type GithubSource,
} from "./github-registry-client";
import { normalizeAddress } from "./utils";

export const DEFAULT_REPO = "LedgerHQ/clear-signing-erc7730-registry";
export const DEFAULT_REF = "master";

export class GitHubRegistryIndex {
  private readonly source: GithubSource;

  /** Maps CAIP-10 identifiers ("eip155:{chainId}:{address}") -> absolute raw URL of the descriptor file. */
  private calldataIndexCache = new Map<string, string>();
  private eip712IndexCache = new Map<string, string>();

  /** Whether the index has been populated for this source. */
  private built = false;

  constructor(source?: GitHubRegistrySource) {
    this.source = {
      repo: source?.repo ?? DEFAULT_REPO,
      ref: source?.ref ?? DEFAULT_REF,
    };
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /** Returns the absolute raw URL for a calldata descriptor matching the given chainId and address. */
  async lookupCalldataDescriptorUrl(
    chainId: number,
    address: string,
  ): Promise<string | undefined> {
    await this.init();
    return this.calldataIndexCache.get(
      `eip155:${chainId}:${normalizeAddress(address)}`,
    );
  }

  /** Returns the absolute raw URL for an EIP-712 descriptor matching the given chainId and address. */
  async lookupEip712DescriptorUrl(
    chainId: number,
    address: string,
  ): Promise<string | undefined> {
    await this.init();
    return this.eip712IndexCache.get(
      `eip155:${chainId}:${normalizeAddress(address)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Index building
  // ---------------------------------------------------------------------------

  /**
   * Populates the index for this instance's source.
   * Fetches the full file tree and all descriptor files in parallel.
   * Subsequent calls are no-ops.
   */
  async init(): Promise<void> {
    if (this.built) return;

    const paths = await fetchRegistryFilePaths(this.source);

    await Promise.all(
      paths.map(async (path) => {
        try {
          const descriptor = (await fetchRegistryFile(
            path,
            this.source,
          )) as Record<string, unknown>;
          const url = descriptorUrl(path, this.source);
          this.indexDescriptor(descriptor, url);
        } catch {
          // Skip malformed or inaccessible descriptors
        }
      }),
    );

    this.built = true;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private indexDescriptor(
    descriptor: Record<string, unknown>,
    url: string,
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
            if (!this.calldataIndexCache.has(key)) {
              this.calldataIndexCache.set(key, url);
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
            if (!this.eip712IndexCache.has(key)) {
              this.eip712IndexCache.set(key, url);
            }
          }
        }
      }
    }
  }
}
