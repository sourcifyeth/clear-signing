import { fetchRegistryFile } from "./github-registry-client";
import type {
  Descriptor,
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

  constructor(
    options: GitHubResolverOptions | EmbeddedResolverOptions = {
      type: "github",
    },
  ) {
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
  ): Promise<Descriptor | undefined> {
    const path =
      this.index.calldataIndex[`eip155:${chainId}:${normalizeAddress(to)}`];
    if (!path) return undefined;
    return this.resolveWithIncludes(path);
  }

  async resolveTypedDataDescriptor(
    chainId: number,
    verifyingContract: string,
  ): Promise<Descriptor | undefined> {
    const path =
      this.index.typedDataIndex[
        `eip155:${chainId}:${normalizeAddress(verifyingContract)}`
      ];
    if (!path) return undefined;
    return this.resolveWithIncludes(path);
  }

  private async resolveWithIncludes(path: string): Promise<Descriptor> {
    const descriptor = await this.pathResolver.resolvePath(path);
    const includes =
      typeof descriptor.includes === "string" ? descriptor.includes : undefined;
    if (!includes) return descriptor;

    const includesPath = new URL(includes, `https://x/${path}`).pathname.slice(
      1,
    );
    const included = await this.pathResolver.resolvePath(includesPath);
    return mergeDescriptors(descriptor, included);
  }
}

interface PathResolver {
  resolvePath(path: string): Promise<Descriptor>;
}

class GitHubPathResolver implements PathResolver {
  readonly source: GitHubSource;

  constructor(source?: Partial<GitHubSource>) {
    this.source = {
      repo: source?.repo ?? DEFAULT_REPO,
      ref: source?.ref ?? DEFAULT_REF,
    };
  }

  async resolvePath(path: string): Promise<Descriptor> {
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

  async resolvePath(path: string): Promise<Descriptor> {
    const fullPath = `${this.descriptorDirectory}/${path}`;
    const mod = await import(fullPath);
    return (mod.default ?? mod) as Descriptor;
  }
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
      result[existingIndex] = { ...result[existingIndex], ...field };
    } else {
      result.push(field);
    }
  }

  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
