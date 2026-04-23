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
  BatchDisplayModel,
  Eip5792Batch,
} from "./types";

// Re-export types
export type * from "./types";

export { createGitHubRegistryIndex } from "./github-registry-index";
export { isFieldGroup } from "./utils";

/**
 * Formats a single transaction's calldata into a human-readable {@link DisplayModel}.
 *
 * Resolves an ERC-7730 descriptor for the transaction's chain and contract address,
 * decodes the calldata according to the matched function signature, and renders
 * each field using the descriptor's display format rules. When no descriptor is
 * found, returns a {@link RawCalldataFallback} with the selector and raw ABI words.
 *
 * External data (token metadata, address names, etc.) is resolved via
 * {@link FormatOptions.externalDataProvider} when provided.
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
 * Formats an EIP-5792 batch of calls into a {@link BatchDisplayModel}.
 *
 * Each call is formatted independently via {@link format}. Calls without
 * `data` (native value transfers) or without `to` (contract creations) cannot
 * be formatted and produce a per-call warning instead.
 *
 * The batch-level `interpolatedIntent` joins all individual intents with
 * " and " as specified by ERC-7730. When any call lacks an
 * `interpolatedIntent`, the batch-level intent is omitted and a
 * `BATCH_INTERPOLATION_INCOMPLETE` warning is emitted.
 *
 * The returned `callDisplays` array preserves the same order as `batch.calls`.
 */
export async function formatEip5792Batch(
  batch: Eip5792Batch,
  opts?: FormatOptions,
): Promise<BatchDisplayModel> {
  if (batch.calls.length === 0) {
    return {
      callDisplays: [],
      warnings: [warn("BATCH_EMPTY", "Batch contains no calls")],
    };
  }

  const callDisplays: DisplayModel[] = [];

  for (const call of batch.calls) {
    if (!call.data) {
      callDisplays.push({
        warnings: [
          warn(
            "BATCH_VALUE_TRANSFER",
            "Call has no data field — native value transfer cannot be formatted",
          ),
        ],
      });
      continue;
    }

    if (!call.to) {
      callDisplays.push({
        warnings: [
          warn(
            "BATCH_CONTRACT_CREATION",
            "Call has no to field — contract creation cannot be formatted",
          ),
        ],
      });
      continue;
    }

    const tx: Transaction = {
      chainId: batch.chainId,
      to: call.to,
      data: call.data,
      value: call.value,
      from: batch.from,
    };

    callDisplays.push(await format(tx, opts));
  }

  const intents = callDisplays.map((d) => d.interpolatedIntent);
  if (intents.every((i): i is string => !!i)) {
    return { interpolatedIntent: intents.join(" and "), callDisplays };
  }

  return {
    callDisplays,
    warnings: [
      warn(
        "BATCH_INTERPOLATION_INCOMPLETE",
        "Batch interpolatedIntent is not available because one or more calls could not be interpolated",
      ),
    ],
  };
}

/**
 * Formats an EIP-712 typed data message into a human-readable {@link DisplayModel}.
 *
 * Resolves an ERC-7730 descriptor for the domain's chain and verifying contract,
 * matches the message's primary type against `display.formats` keys via `encodeType`,
 * and renders each field using the descriptor's display format rules. When no
 * descriptor is found, returns a `NO_DESCRIPTOR` warning.
 *
 * Currently requires both `chainId` and `verifyingContract` in the typed data domain.
 *
 * External data (token metadata, address names, etc.) is resolved via
 * {@link FormatOptions.externalDataProvider} when provided.
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
