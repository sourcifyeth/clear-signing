/**
 * Shared field formatting logic used by both engine.ts (calldata) and eip712.ts (typed data).
 */

import type {
  DescriptorFieldFormat,
  DescriptorFieldFormatType,
  DescriptorMetadata,
  ExternalDataProvider,
  TokenResult,
  Warning,
} from "./types";
import type { ArgumentValue, ResolvePath } from "./descriptor";
import { resolveMetadataValue } from "./descriptor";
import {
  addThousandSeparators,
  bytesToHex,
  formatAmountWithDecimals,
  hexToBytes,
  parseBigInt,
  toChecksumAddress,
  warn,
} from "./utils";

export type FieldFormatOptions = Pick<
  DescriptorFieldFormat,
  "params" | "visible" | "separator" | "encryption"
>;

export type RenderFieldResult = {
  rendered: string;
  warning?: Warning;
  tokenAddress?: string;
};

/**
 * Unified field renderer for both calldata and EIP-712 typed data.
 *
 * Dispatches on `field.format` and uses `resolvePath` to resolve secondary
 * paths (e.g. `tokenPath` for tokenAmount fields).
 */
export async function renderField(
  value: ArgumentValue,
  format: DescriptorFieldFormatType,
  fieldOptions: FieldFormatOptions,
  resolvePath: ResolvePath,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  switch (format) {
    case "raw":
      return formatRaw(value);
    case "amount":
      return formatNativeAmount(value);
    case "tokenAmount":
      return await formatTokenAmount(
        fieldOptions,
        value,
        resolvePath,
        chainId,
        metadata,
        externalDataProvider,
      );
    case "date":
      return formatDate(value, fieldOptions);
    case "enum":
      return formatEnum(fieldOptions, value, metadata);
    case "unit":
      return formatUnit(value, fieldOptions);
    case "duration":
      return formatDuration(value);
    case "addressName":
      return await formatAddressNameField(
        value,
        fieldOptions,
        externalDataProvider,
      );
    default:
      return formatRaw(value);
  }
}

// ---------------------------------------------------------------------------
// raw format
// ---------------------------------------------------------------------------

export function formatRaw(value: ArgumentValue): RenderFieldResult {
  return { rendered: renderRaw(value) };
}

export function renderRaw(value: ArgumentValue): string {
  switch (value.type) {
    case "address":
      return toChecksumAddress(value.bytes);
    case "uint":
    case "int":
      return addThousandSeparators(value.value.toString());
    case "bool":
      return value.value.toString();
    case "string":
      return value.value;
    case "bytes":
      return bytesToHex(value.bytes);
  }
}

// ---------------------------------------------------------------------------
// amount format
// ---------------------------------------------------------------------------

export function formatNativeAmount(value: ArgumentValue): RenderFieldResult {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "amount");
  }

  const formatted = formatAmountWithDecimals(value.value, 18);
  return { rendered: `${formatted} ETH` };
}

// ---------------------------------------------------------------------------
// tokenAmount format
// ---------------------------------------------------------------------------

export async function formatTokenAmount(
  field: FieldFormatOptions,
  value: ArgumentValue,
  resolvePath: ResolvePath,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "tokenAmount");
  }

  if (chainId === undefined) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "CONTAINER_MISSING_CHAIN_ID",
        "Cannot format tokenAmount without a chainId on the container",
      ),
    };
  }

  const amount = value.value;
  const tokenAddress = resolveTokenAddress(field, resolvePath, metadata);
  if (!tokenAddress) {
    return formatRaw(value);
  }

  const checksumTokenAddress = toChecksumAddress(hexToBytes(tokenAddress));

  let token: TokenResult | null;
  try {
    token =
      (await externalDataProvider?.resolveToken?.(chainId, tokenAddress)) ??
      null;
  } catch {
    token = null;
  }
  if (!token) {
    return {
      rendered: renderRaw(value),
      tokenAddress: checksumTokenAddress,
      warning: warn("UNKNOWN_TOKEN", "Token could not be resolved"),
    };
  }

  return {
    rendered: renderTokenAmount(amount, token, field, metadata),
    tokenAddress: checksumTokenAddress,
  };
}

/**
 * Render a token amount with symbol, applying a threshold message if configured.
 */
export function renderTokenAmount(
  amount: bigint,
  token: TokenResult,
  field: FieldFormatOptions,
  metadata: DescriptorMetadata | undefined,
): string {
  const msg = tokenAmountMessage(field, amount, metadata);
  if (msg) return `${msg} ${token.symbol}`;
  return `${formatAmountWithDecimals(amount, token.decimals)} ${token.symbol}`;
}

export function tokenAmountMessage(
  field: FieldFormatOptions,
  amount: bigint,
  metadata: DescriptorMetadata | undefined,
): string | undefined {
  const params = field.params ?? {};
  const thresholdSpec = params.threshold;
  const message =
    typeof params.message === "string" ? params.message : "Unlimited";
  if (typeof thresholdSpec !== "string") {
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
 * Resolve the ERC-20 token address for a tokenAmount field.
 *
 * Per the spec, `token` takes priority over `tokenPath`. Both can be either
 * a constant address or a path reference.
 */
export function resolveTokenAddress(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
  metadata: DescriptorMetadata | undefined,
): string | undefined {
  const params = field.params ?? {};
  const token = params.token ?? params.tokenPath;
  if (!token) return undefined;

  // Constant address
  if (token.startsWith("0x") && token.length === 42) {
    return token.toLowerCase();
  }

  // $.metadata.* path
  if (token.startsWith("$.")) {
    const metaValue = resolveMetadataValue(metadata, token);
    if (
      typeof metaValue === "string" &&
      metaValue.startsWith("0x") &&
      metaValue.length === 42
    ) {
      return metaValue.toLowerCase();
    }
    return undefined;
  }

  // @. or bare/# path — resolve via the caller's closure
  const resolved = resolvePath(token);
  if (resolved?.type === "address") {
    return bytesToHex(resolved.bytes).toLowerCase();
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// date format
// ---------------------------------------------------------------------------

export function formatDate(
  value: ArgumentValue,
  fieldOptions: FieldFormatOptions,
): RenderFieldResult {
  if (value.type !== "uint" && value.type !== "int")
    return typeMismatch(value, "uint or int", "date");
  const encoding = fieldOptions.params?.encoding;
  if (encoding !== "timestamp") return formatRaw(value);
  try {
    return formatTimestamp(value.value);
  } catch {
    return formatRaw(value);
  }
}

/**
 * Format a Unix timestamp (seconds) as a UTC date string.
 */
export function formatTimestamp(seconds: bigint): RenderFieldResult {
  const date = new Date(Number(seconds) * 1000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const secs = String(date.getUTCSeconds()).padStart(2, "0");
  return {
    rendered: `${year}-${month}-${day} ${hours}:${minutes}:${secs} UTC`,
  };
}

// ---------------------------------------------------------------------------
// duration format
// ---------------------------------------------------------------------------

export function formatDuration(value: ArgumentValue): RenderFieldResult {
  if (value.type !== "uint" && value.type !== "int")
    return typeMismatch(value, "uint or int", "duration");

  const totalSeconds = Number(value.value < 0n ? -value.value : value.value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");

  return { rendered: `${hh}:${mm}:${ss}` };
}

// ---------------------------------------------------------------------------
// unit format
// ---------------------------------------------------------------------------

const SI_PREFIXES: [bigint, string][] = [
  [10n ** 24n, "Y"],
  [10n ** 21n, "Z"],
  [10n ** 18n, "E"],
  [10n ** 15n, "P"],
  [10n ** 12n, "T"],
  [10n ** 9n, "G"],
  [10n ** 6n, "M"],
  [10n ** 3n, "k"],
];

export function formatUnit(
  value: ArgumentValue,
  fieldOptions: FieldFormatOptions,
): RenderFieldResult {
  if (value.type !== "uint" && value.type !== "int")
    return typeMismatch(value, "uint or int", "unit");

  const params = fieldOptions.params ?? {};
  const base = params.base ?? "";
  const decimals = params.decimals ?? 0;
  const prefix = params.prefix === true;

  const formatted = formatAmountWithDecimals(value.value, decimals);

  if (!prefix) {
    return { rendered: `${formatted}${base}` };
  }

  // SI prefix mode: find the largest prefix that divides evenly or minimizes the significand
  // Work with the raw bigint value, then apply decimals + SI exponent together
  const raw = value.value;
  for (const [factor, symbol] of SI_PREFIXES) {
    // Total divisor is factor * 10^decimals
    const totalFactor = factor * 10n ** BigInt(decimals);
    if (raw >= totalFactor) {
      const scaled = formatAmountWithDecimals(
        raw,
        decimals + Number(bigintLog10(factor)),
      );
      return { rendered: `${scaled}${symbol}${base}` };
    }
  }

  return { rendered: `${formatted}${base}` };
}

function bigintLog10(n: bigint): number {
  let count = 0;
  let v = n;
  while (v >= 10n) {
    v /= 10n;
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// enum format
// ---------------------------------------------------------------------------

export function formatEnum(
  field: FieldFormatOptions,
  value: ArgumentValue,
  metadata: DescriptorMetadata | undefined,
): RenderFieldResult {
  if (value.type !== "uint" && value.type !== "int")
    return typeMismatch(value, "uint or int", "enum");
  const label = resolveEnumLabel(field, value.value.toString(), metadata);
  if (!label) return formatRaw(value);
  return { rendered: label };
}

/**
 * Resolve an enum label from a metadata map using a string key.
 * Returns undefined when the reference or map can't be resolved.
 */
export function resolveEnumLabel(
  field: FieldFormatOptions,
  key: string,
  metadata: DescriptorMetadata | undefined,
): string | undefined {
  const params = field.params ?? {};
  const reference = params.$ref;
  if (typeof reference !== "string") return undefined;

  const enumMap = resolveMetadataValue(metadata, reference);
  if (!enumMap || typeof enumMap !== "object") return undefined;

  const label = (enumMap as Record<string, unknown>)[key];
  return typeof label === "string" ? label : undefined;
}

// ---------------------------------------------------------------------------
// addressName format
// ---------------------------------------------------------------------------

export async function formatAddressNameField(
  value: ArgumentValue,
  field: FieldFormatOptions,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "address")
    return typeMismatch(value, "address", "addressName");
  const checksum = toChecksumAddress(value.bytes);
  return formatAddressName(checksum, field, externalDataProvider);
}

/**
 * Resolve an address name using local wallet names and ENS.
 * Falls back to the checksum address with a warning when all resolution fails.
 */
export async function formatAddressName(
  checksumAddress: string,
  field: FieldFormatOptions,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  const normalized = checksumAddress.toLowerCase();
  const params = field.params ?? {};

  const types = params.types;
  const sources = params.sources;
  const expectedType = types?.[0] ?? "";

  const tryLocal = !sources || sources.includes("local");
  const tryEns = !sources || sources.includes("ens");

  // Try local wallet names
  if (tryLocal && externalDataProvider?.resolveLocalName) {
    try {
      const result = await externalDataProvider.resolveLocalName(
        normalized,
        expectedType,
      );
      if (result) {
        return {
          rendered: result.name,
          warning: result.typeMatch
            ? undefined
            : warn(
                "ADDRESS_TYPE_MISMATCH",
                `Resolved address type does not match expected type '${expectedType}'`,
              ),
        };
      }
    } catch {
      // Fall through to next resolution method or raw fallback
    }
  }

  // Try ENS
  if (tryEns && externalDataProvider?.resolveEnsName) {
    try {
      const result = await externalDataProvider.resolveEnsName(
        normalized,
        expectedType,
      );
      if (result) {
        return {
          rendered: result.name,
          warning: result.typeMatch
            ? undefined
            : warn(
                "ADDRESS_TYPE_MISMATCH",
                `Resolved address type does not match expected type '${expectedType}'`,
              ),
        };
      }
    } catch {
      // Fall through to raw fallback
    }
  }

  // Raw address fallback — resolution was expected but failed
  return {
    rendered: checksumAddress,
    warning: warn("UNKNOWN_ADDRESS", "Address name could not be resolved"),
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function typeMismatch(
  value: ArgumentValue,
  expected: string,
  format: DescriptorFieldFormatType,
): RenderFieldResult {
  return {
    rendered: renderRaw(value),
    warning: warn(
      "ARGUMENT_TYPE_MISMATCH",
      `Format ${format} expects ${expected} but got ${value.type}`,
    ),
  };
}
