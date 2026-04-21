/**
 * Ethereum clear signing library for human-readable transaction previews.
 *
 * @example
 * ```typescript
 * import { format, formatTypedData } from '@sourcifyeth/clear-signing';
 *
 * // Format a transaction
 * const result = await format({ chainId: 1, to: '0xdAC17F958D2ee523a2206206994597C13D831ec7', data: '0x095ea7b3...' });
 * console.log(result.intent);
 * console.log(result.fields);
 *
 * // Format EIP-712 typed data
 * const result2 = await formatTypedData({ account: '0x...', domain: { ... }, types: { ... }, primaryType: '...', message: { ... } });
 * console.log(result2.intent);
 * ```
 */

import { DescriptorResolver } from "./resolver";
import { formatCalldata, rawPreviewFromCalldata } from "./calldata";
import { formatEip712 } from "./eip712";
import { hexToBytes, extractSelector, warn } from "./utils";
import type {
  DisplayModel,
  FormatOptions,
  FormatCalldata,
  Transaction,
  TypedData,
} from "./types";

// Re-export types
export type * from "./types";

export { createGitHubRegistryIndex } from "./github-registry-index";
export { isFieldGroup } from "./utils";

/**
 * Resolves the descriptor for a transaction and returns a DisplayModel
 * with human-readable information.
 */
export async function format(
  tx: Transaction,
  opts?: FormatOptions,
): Promise<DisplayModel> {
  try {
    const descriptor = await new DescriptorResolver(
      opts?.descriptorResolverOptions,
    ).resolveCalldataDescriptor(tx.chainId, tx.to);

    if (!descriptor) {
      const calldata = hexToBytes(tx.data);
      const selector = extractSelector(calldata);
      return {
        rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
        warnings: [
          warn(
            "NO_DESCRIPTOR",
            `No descriptor found for chain ${tx.chainId} and address ${tx.to}`,
          ),
        ],
      };
    }

    const formatEmbeddedCalldata: FormatCalldata = (innerTx) =>
      format(innerTx, opts);

    return formatCalldata(
      tx,
      descriptor,
      opts?.externalDataProvider,
      formatEmbeddedCalldata,
    );
  } catch (error) {
    return unexpectedError(error);
  }
}

/**
 * Resolves the descriptor for an EIP-712 message and returns a DisplayModel
 * with human-readable information.
 */
export async function formatTypedData(
  typedData: TypedData,
  opts?: FormatOptions,
): Promise<DisplayModel> {
  try {
    const { chainId, verifyingContract } = typedData.domain;

    if (!chainId || !verifyingContract) {
      throw new Error(
        "Currently only works on EIP-712 messages with chainId and verifyingContract in the domain",
      );
    }

    const descriptor = await new DescriptorResolver(
      opts?.descriptorResolverOptions,
    ).resolveTypedDataDescriptor(chainId, verifyingContract);

    if (!descriptor) {
      return {
        warnings: [
          warn(
            "NO_DESCRIPTOR",
            `No descriptor found for chain ${chainId} and address ${verifyingContract}`,
          ),
        ],
      };
    }

    const formatEmbeddedCalldata: FormatCalldata = (innerTx) =>
      format(innerTx, opts);

    return formatEip712(
      typedData,
      descriptor,
      opts?.externalDataProvider,
      formatEmbeddedCalldata,
    );
  } catch (error) {
    return unexpectedError(error);
  }
}

function unexpectedError(error: unknown): DisplayModel {
  return {
    warnings: [
      warn(
        "UNEXPECTED_LIB_ERROR",
        `Encountered an unexpected error in @sourcifyeth/clear-signing. Please report to the maintainers: ${String(error)}`,
      ),
    ],
  };
}
