import { computeEncodeType, extractPrimaryType } from "../src/eip712";
import type {
  ExternalDataProvider,
  FormatOptions,
  RegistryIndex,
  TypeMember,
} from "../src/types";
import { asciiToBytes, bytesToHex, keccak256 } from "../src/utils";

/**
 * Compute the EIP-712 `encodeType` string for a primary type, throwing if
 * the primary type isn't declared in `types`.
 */
export function computeEncodeTypeOrThrow(
  primaryType: string,
  types: Record<string, TypeMember[]>,
): string {
  const encodeType = computeEncodeType(primaryType, types);
  if (!encodeType) {
    throw new Error(`Could not compute encodeType for ${primaryType}`);
  }
  return encodeType;
}

type CalldataDescriptorFileEntry = {
  chainId: number;
  address: string;
  file: string;
};

type Eip712DescriptorFileEntry = CalldataDescriptorFileEntry & {
  /**
   * EIP-712 `encodeType` strings the descriptor supports — these are the
   * keys of `display.formats` in the descriptor file. The helper extracts
   * each primary type and hashes the string to build the typed-data index.
   */
  encodeTypes: string[];
};

/**
 * Build FormatOptions for an embedded descriptor resolver.
 * Useful for spec test cases where descriptor JSON files live alongside the test.
 */
export function buildEmbeddedResolverOpts(
  descriptorDirectory: string,
  files: {
    calldataDescriptorFiles?: CalldataDescriptorFileEntry[];
    eip712DescriptorFiles?: Eip712DescriptorFileEntry[];
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

  for (const {
    chainId,
    address,
    file,
    encodeTypes,
  } of files.eip712DescriptorFiles ?? []) {
    const caip = `eip155:${chainId}:${address.toLowerCase()}`;
    const byPrimaryType = (index.typedDataIndex[caip] ??= {});

    // Group encodeType hashes by primary type — a descriptor may declare
    // multiple format keys that share the same primary type.
    const hashesByPrimaryType = new Map<string, string[]>();
    for (const encodeTypeStr of encodeTypes) {
      const primaryType = extractPrimaryType(encodeTypeStr);
      if (!primaryType) continue;
      const hash = bytesToHex(keccak256(asciiToBytes(encodeTypeStr)));
      const list = hashesByPrimaryType.get(primaryType) ?? [];
      list.push(hash);
      hashesByPrimaryType.set(primaryType, list);
    }

    for (const [primaryType, encodeTypeHashes] of hashesByPrimaryType) {
      const entries = (byPrimaryType[primaryType] ??= []);
      entries.push({ path: file, encodeTypeHashes });
    }
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
