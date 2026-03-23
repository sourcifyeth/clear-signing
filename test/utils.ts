import type {
  ExternalDataProvider,
  FormatOptions,
  RegistryIndex,
} from "../src/types";

type DescriptorFileEntry = { chainId: number; address: string; file: string };

/**
 * Build FormatOptions for an embedded descriptor resolver.
 * Useful for spec test cases where descriptor JSON files live alongside the test.
 */
export function buildEmbeddedResolverOpts(
  descriptorDirectory: string,
  files: {
    calldataDescriptorFiles?: DescriptorFileEntry[];
    eip712DescriptorFiles?: DescriptorFileEntry[];
  },
  externalDataProvider?: ExternalDataProvider,
): FormatOptions {
  const index: RegistryIndex = {
    calldataIndex: {},
    typedDataIndex: {},
  };

  for (const { chainId, address, file } of files.calldataDescriptorFiles ??
    []) {
    index.calldataIndex[`eip155:${chainId}:${address.toLowerCase()}`] = file;
  }

  for (const { chainId, address, file } of files.eip712DescriptorFiles ?? []) {
    index.typedDataIndex[`eip155:${chainId}:${address.toLowerCase()}`] = file;
  }

  return {
    descriptorResolverOptions: {
      type: "embedded",
      index,
      descriptorDirectory,
    },
    externalDataProvider,
  };
}
