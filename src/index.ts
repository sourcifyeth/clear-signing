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
import type {
  DisplayModel,
  FormatOptions,
  Transaction,
  TypedData,
} from "./types";

// Re-export types
export type * from "./types";

// Re-export errors
export * from "./errors";

/**
 * Resolves the descriptor for a transaction and returns a DisplayModel
 * with human-readable information.
 */
export async function format(
  tx: Transaction,
  opts?: FormatOptions,
): Promise<DisplayModel> {
  const descriptor = await new DescriptorResolver(
    opts?.descriptorResolverOptions,
  ).resolveCalldataDescriptor(tx.chainId, tx.to);
  throw new Error("Not implemented");
}

/**
 * Resolves the descriptor for an EIP-712 message and returns a DisplayModel
 * with human-readable information.
 */
export async function formatTypedData(
  typedData: TypedData,
  opts?: FormatOptions,
): Promise<DisplayModel> {
  if (!typedData.domain.chainId || !typedData.domain.verifyingContract) {
    throw new Error(
      "Currently only works on EIP-712 messages with chainId and verifyingContract in the domain",
    );
  }
  const descriptor = await new DescriptorResolver(
    opts?.descriptorResolverOptions,
  ).resolveTypedDataDescriptor(
    typedData.domain.chainId,
    typedData.domain.verifyingContract,
  );
  throw new Error("Not implemented");
}
