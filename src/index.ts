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
 * const result = await format(1, '0xdAC17F958D2ee523a2206206994597C13D831ec7', calldata);
 * console.log(result.intent);
 * console.log(result.items);
 *
 * // Format EIP-712 typed data
 * const typedData = { ... };
 * const result2 = await formatTypedData(typedData);
 * console.log(result2.intent);
 * ```
 */

// Re-export types
export type * from "./types";

// Re-export errors
export * from "./errors";

// Re-export lower-level engine API
export { formatWithResolvedCall } from "./engine";

// TODO: instead of calldata + value, we should use full transaction objects as parameter for extensibility.

// NOTE: format(), formatWithValue(), and formatTypedData() are commented out
// because the engine and eip712 layers are not yet async-aware. Use resolveCall()
// + formatWithResolvedCall() directly, or await the resolver functions.
//
// export async function format(
//   chainId: number,
//   to: string,
//   calldata: Uint8Array,
//   opts?: ResolverOptions,
// ): Promise<DisplayModel> {
//   return formatWithValue(chainId, to, undefined, calldata, opts);
// }
//
// export async function formatWithValue(
//   chainId: number,
//   to: string,
//   value: Uint8Array | undefined,
//   calldata: Uint8Array,
//   opts?: ResolverOptions,
// ): Promise<DisplayModel> {
//   try {
//     const resolved = await resolveCall(chainId, to, calldata, value, opts);
//     return formatWithResolvedCall(resolved, chainId, to, value, calldata);
//   } catch (e) {
//     if (e instanceof ResolverError) throw e;
//     if (e instanceof EngineError) throw e;
//     throw EngineError.internal(String(e));
//   }
// }
//
// export async function formatTypedData(
//   data: TypedData,
//   opts?: ResolverOptions,
// ): Promise<DisplayModel> {
//   return formatTypedDataInternal(data, opts);
// }
