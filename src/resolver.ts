import { fetchRegistryFile } from "./github-registry-client";
import type {
  EmbeddedResolverOptions,
  GitHubResolverOptions,
  GitHubSource,
  RegistryIndex,
} from "./types";
import { normalizeAddress } from "./utils";

export const DEFAULT_REPO = "LedgerHQ/clear-signing-erc7730-registry";
export const DEFAULT_REF = "master";

/**
 * Uses the index to resolve a descriptor path, then fetches and returns the
 * descriptor content depending on the resolver type.
 * Automatically resolves "includes" properties in the descriptor file.
 */
export class DescriptorResolver {
  readonly index: RegistryIndex;

  private pathResolver: PathResolver;

  constructor(options: GitHubResolverOptions | EmbeddedResolverOptions) {
    switch (options.type) {
      case "github":
        if (options.index) {
          this.index = options.index;
        } else {
          // TODO replace this with prebuilt index
          this.index = {
            calldataIndex: {},
            typedDataIndex: {},
          };
        }
        this.pathResolver = new GitHubPathResolver(options.githubSource);
        return;
      case "embedded":
        this.index = options.index;
        this.pathResolver = new EmbeddedPathResolver(
          options.descriptorDirectory,
        );
        return;
    }
  }

  async resolveCalldataDescriptor(
    chainId: number,
    to: string,
  ): Promise<Record<string, unknown> | undefined> {
    const path =
      this.index.calldataIndex[`eip155:${chainId}:${normalizeAddress(to)}`];
    if (!path) return undefined;
    return this.pathResolver.resolvePath(path);
  }

  async resolveTypedDataDescriptor(
    chainId: number,
    verifyingContract: string,
  ): Promise<Record<string, unknown> | undefined> {
    const path =
      this.index.typedDataIndex[
        `eip155:${chainId}:${normalizeAddress(verifyingContract)}`
      ];
    if (!path) return undefined;
    return this.pathResolver.resolvePath(path);
  }
}

interface PathResolver {
  resolvePath(path: string): Promise<Record<string, unknown>>;
}

class GitHubPathResolver implements PathResolver {
  readonly source: GitHubSource;

  constructor(source?: Partial<GitHubSource>) {
    this.source = {
      repo: source?.repo ?? DEFAULT_REPO,
      ref: source?.ref ?? DEFAULT_REF,
    };
  }

  async resolvePath(path: string): Promise<Record<string, unknown>> {
    const descriptor = (await fetchRegistryFile(path, this.source)) as Record<
      string,
      unknown
    >;
    return descriptor;
  }
}

class EmbeddedPathResolver implements PathResolver {
  readonly descriptorDirectory: string;

  constructor(descriptorDirectory: string) {
    this.descriptorDirectory = descriptorDirectory || "./descriptors";
  }

  async resolvePath(path: string): Promise<Record<string, unknown>> {
    const fullPath = `${this.descriptorDirectory}/${path}`;
    const descriptor = (await import(fullPath)) as Record<string, unknown>;
    return descriptor;
  }
}
