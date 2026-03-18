/**
 * Shared field formatting logic used by both engine.ts (calldata) and eip712.ts (typed data).
 */

import type {
  DescriptorMetadata,
  ExternalDataProvider,
  TokenResult,
  Warning,
} from "./types";
import type { ResolvedField } from "./descriptor";
import { resolveMetadataValue } from "./descriptor";
import { formatAmountWithDecimals, parseBigInt, warn } from "./utils";

/**
 * Format a Unix timestamp (seconds) as a UTC date string.
 */
export function formatTimestamp(seconds: bigint): string {
  const date = new Date(Number(seconds) * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const secs = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${secs} UTC`;
}

/**
 * Render a token amount with symbol, applying a threshold message if configured.
 */
export function renderTokenAmount(
  amount: bigint,
  token: TokenResult,
  field: ResolvedField,
  metadata: DescriptorMetadata | undefined,
): string {
  const msg = tokenAmountMessage(field, amount, metadata);
  if (msg) return `${msg} ${token.symbol}`;
  return `${formatAmountWithDecimals(amount, token.decimals)} ${token.symbol}`;
}

/**
 * Check whether a token amount meets or exceeds a threshold and return the
 * configured message string if so.
 */
function tokenAmountMessage(
  field: ResolvedField,
  amount: bigint,
  metadata: DescriptorMetadata | undefined,
): string | undefined {
  const thresholdSpec = field.params.threshold;
  const message = field.params.message;
  if (typeof thresholdSpec !== "string" || typeof message !== "string") {
    return undefined;
  }

  let threshold: bigint | undefined;
  if (thresholdSpec.startsWith("$.")) {
    const value = resolveMetadataValue(metadata, thresholdSpec);
    if (typeof value === "string") threshold = parseBigInt(value);
    else if (typeof value === "number") threshold = BigInt(value);
  } else {
    threshold = parseBigInt(thresholdSpec);
  }

  return threshold !== undefined && amount >= threshold ? message : undefined;
}

/**
 * Resolve an address name using the address book, local wallet names, and ENS.
 * Falls back to the checksum address with a warning when all resolution fails.
 */
export async function formatAddressName(
  checksumAddress: string,
  field: ResolvedField,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  const normalized = checksumAddress.toLowerCase();

  const types = field.params.types;
  const sources = field.params.sources;
  const expectedType = types?.[0] ?? "";

  const tryLocal = !sources || sources.includes("local");
  const tryEns = !sources || sources.includes("ens");

  // Try local wallet names
  if (tryLocal && externalDataProvider?.resolveLocalName) {
    const result = await externalDataProvider.resolveLocalName(normalized, expectedType);
    if (result) {
      return {
        rendered: result.name,
        warning: result.typeMatch
          ? undefined
          : warn("ADDRESS_TYPE_MISMATCH", `Resolved address type does not match expected type '${expectedType}'`),
      };
    }
  }

  // Try ENS
  if (tryEns && externalDataProvider?.resolveEnsName) {
    const result = await externalDataProvider.resolveEnsName(normalized, expectedType);
    if (result) {
      return {
        rendered: result.name,
        warning: result.typeMatch
          ? undefined
          : warn("ADDRESS_TYPE_MISMATCH", `Resolved address type does not match expected type '${expectedType}'`),
      };
    }
  }

  // Raw address fallback — resolution was expected but failed
  return {
    rendered: checksumAddress,
    warning: warn("UNKNOWN_ADDRESS", "Address name could not be resolved"),
  };
}

/**
 * Resolve an enum label from a metadata map using a string key.
 * Returns undefined when the reference or map can't be resolved.
 */
export function resolveEnumLabel(
  field: ResolvedField,
  key: string,
  metadata: DescriptorMetadata | undefined,
): string | undefined {
  const reference = field.params.$ref;
  if (typeof reference !== "string") return undefined;

  const enumMap = resolveMetadataValue(metadata, reference);
  if (!enumMap || typeof enumMap !== "object") return undefined;

  const label = (enumMap as Record<string, unknown>)[key];
  return typeof label === "string" ? label : undefined;
}
