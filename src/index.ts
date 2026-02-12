/**
 * Ethereum clear signing library for human-readable transaction previews.
 *
 * This library provides functionality to decode and format Ethereum transactions
 * and EIP-712 typed data into human-readable display models for clear signing.
 *
 * @example
 * ```typescript
 * import { format, formatTypedData, hexToBytes } from '@sourcifyeth/clear-signing';
 *
 * // Format a transaction
 * const calldata = hexToBytes('0x095ea7b3...');
 * const result = format(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', calldata);
 * console.log(result.intent); // "Approve USDT spending"
 * console.log(result.items);  // [{ label: "Spender", value: "0x..." }, ...]
 *
 * // Format EIP-712 typed data
 * const typedData = { ... };
 * const result2 = formatTypedData(typedData);
 * console.log(result2.intent);
 * ```
 */

import { EngineError, ResolverError } from "./errors";
import type { DisplayModel } from "./types";
import { resolveCall } from "./resolver";
import { formatWithResolvedCall } from "./engine";
import { formatTypedData as formatTypedDataInternal } from "./eip712";

// Re-export types
export type {
  DisplayItem,
  DisplayModel,
  RawPreview,
  TokenMeta,
  TypedData,
  TypeMember,
} from "./types";

// Re-export errors
export {
  ClearSigningError,
  DescriptorError,
  EngineError,
  Eip712Error,
  ResolverError,
  TokenLookupError,
} from "./errors";

// Re-export utilities
export { hexToBytes, bytesToHex, toChecksumAddress } from "./utils";

/**
 * Formats a clear signing preview for a transaction.
 *
 * @param chainId - The EIP-155 chain ID (e.g., 1 for Ethereum mainnet)
 * @param to - The target contract address
 * @param calldata - The transaction calldata as bytes
 * @returns A display model with intent, items, and any warnings
 * @throws {ResolverError} If no descriptor is found for the contract
 * @throws {EngineError} If calldata decoding or formatting fails
 *
 * @example
 * ```typescript
 * const calldata = hexToBytes('0x095ea7b3...');
 * const result = format(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', calldata);
 * ```
 */
export function format(
  chainId: number,
  to: string,
  calldata: Uint8Array,
): DisplayModel {
  return formatWithValue(chainId, to, undefined, calldata);
}

/**
 * Formats a clear signing preview for a transaction including an optional native value.
 *
 * @param chainId - The EIP-155 chain ID (e.g., 1 for Ethereum mainnet)
 * @param to - The target contract address
 * @param value - Optional native token value being sent (in wei, as bytes)
 * @param calldata - The transaction calldata as bytes
 * @returns A display model with intent, items, and any warnings
 * @throws {ResolverError} If no descriptor is found for the contract
 * @throws {EngineError} If calldata decoding or formatting fails
 *
 * @example
 * ```typescript
 * const calldata = hexToBytes('0x...');
 * const value = hexToBytes('0x0de0b6b3a7640000'); // 1 ETH
 * const result = formatWithValue(1, '0x...', value, calldata);
 * ```
 */
export function formatWithValue(
  chainId: number,
  to: string,
  value: Uint8Array | undefined,
  calldata: Uint8Array,
): DisplayModel {
  try {
    const resolved = resolveCall(chainId, to, calldata, value);
    return formatWithResolvedCall(resolved, chainId, to, value, calldata);
  } catch (e) {
    if (e instanceof ResolverError) {
      throw e;
    }
    if (e instanceof EngineError) {
      throw e;
    }
    throw EngineError.internal(String(e));
  }
}

/**
 * Formats a clear signing preview for EIP-712 typed data.
 *
 * @param data - The EIP-712 typed data structure
 * @returns A display model with intent, items, and any warnings
 * @throws {Eip712Error} If the typed data is invalid or no descriptor is found
 *
 * @example
 * ```typescript
 * const typedData = {
 *   types: { ... },
 *   primaryType: 'Permit',
 *   domain: { chainId: 1, verifyingContract: '0x...' },
 *   message: { ... }
 * };
 * const result = formatTypedData(typedData);
 * ```
 */
export { formatTypedDataInternal as formatTypedData };

/**
 * Lower-level function to resolve a descriptor and format with pre-resolved data.
 * Useful when you need more control over the resolution process.
 */
export { resolveCall } from "./resolver";
export { formatWithResolvedCall } from "./engine";
