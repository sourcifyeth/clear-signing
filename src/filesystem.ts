/// <reference types="node" />

/**
 * Node-only entry point for loading ERC-7730 descriptors from a local
 * filesystem directory of JSON files.
 *
 * @example
 * ```typescript
 * import { format } from "@ethereum-sourcify/clear-signing";
 * import { createFilesystemResolver } from "@ethereum-sourcify/clear-signing/filesystem";
 *
 * const resolver = createFilesystemResolver({
 *   index,
 *   descriptorDirectory: "./descriptors",
 * });
 *
 * const result = await format(tx, { descriptorResolverOptions: resolver });
 * ```
 *
 * Lives in a separate entry point so the main bundle stays isomorphic —
 * consumers that only use the GitHub resolver never pull `node:fs/promises`
 * into their browser bundle.
 */

import { readFile } from "node:fs/promises";
import type { Descriptor, DescriptorResolver, RegistryIndex } from "./types.js";

export type { DescriptorResolver };

/**
 * Input to {@link createFilesystemResolver}. Describes a directory of
 * descriptor JSON files plus the matching {@link RegistryIndex}.
 */
export type FilesystemResolverOptions = {
  index: RegistryIndex;
  /**
   * Filesystem root that descriptor paths in `index` are resolved against.
   * The filesystem resolver reads `${descriptorDirectory}/${path}` from disk.
   * If a descriptor's `includes` chain reaches outside its own directory
   * (e.g. `../../ercs/shared.json`), the index entries must be stored with
   * enough leading directory segments to absorb the `..` traversal — see
   * the contract on {@link RegistryIndex.calldataIndex}.
   */
  descriptorDirectory: string;
};

/**
 * Build a {@link DescriptorResolver} that reads descriptor JSON files from a
 * local filesystem directory. The returned resolver is passed to
 * `FormatOptions.descriptorResolverOptions`.
 */
export function createFilesystemResolver(
  options: FilesystemResolverOptions,
): DescriptorResolver {
  return {
    index: options.index,
    fetchDescriptor: async (path) => {
      const filePath = `${options.descriptorDirectory}/${path}`;
      const content = await readFile(filePath, "utf-8");
      return JSON.parse(content) as Descriptor;
    },
  };
}
