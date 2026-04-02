/**
 * Shared field formatting logic used by both engine.ts (calldata) and eip712.ts (typed data).
 */

import type {
  DescriptorFieldFormat,
  DescriptorFieldFormatType,
  DescriptorMetadata,
  ExternalDataProvider,
  NftCollectionNameResult,
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
        externalDataProvider,
      );
    case "nftName":
      return await formatNftName(
        fieldOptions,
        value,
        resolvePath,
        chainId,
        externalDataProvider,
      );
    case "date":
      return formatDate(value, fieldOptions);
    case "duration":
      return formatDuration(value);
    case "unit":
      return formatUnit(value, fieldOptions);
    case "enum":
      return formatEnum(fieldOptions, value, metadata);
    case "addressName":
      return await formatAddressNameField(
        value,
        fieldOptions,
        externalDataProvider,
      );
    case "tokenTicker":
      return await formatTokenTicker(
        value,
        fieldOptions,
        resolvePath,
        chainId,
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

  const native = getNativeCurrency();
  const formatted = formatAmountWithDecimals(value.value, native.decimals);
  return { rendered: `${formatted} ${native.symbol}` };
}

// ---------------------------------------------------------------------------
// tokenAmount format
// ---------------------------------------------------------------------------

export async function formatTokenAmount(
  field: FieldFormatOptions,
  value: ArgumentValue,
  resolvePath: ResolvePath,
  containerChainId: number | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "tokenAmount");
  }

  const chainIdResult = resolveChainId(field, resolvePath);
  if (chainIdResult.hasChainIdParam && chainIdResult.value === undefined) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "FORMAT_PARAM_RESOLUTION_ERROR",
        "chainId or chainIdPath param could not be resolved",
      ),
    };
  }
  const chainId = chainIdResult.hasChainIdParam
    ? chainIdResult.value
    : containerChainId;

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
  const tokenAddress = resolveTokenAddress(field, resolvePath);
  if (!tokenAddress) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "FORMAT_PARAM_RESOLUTION_ERROR",
        "token or tokenPath param could not be resolved",
      ),
    };
  }

  const checksumTokenAddress = toChecksumAddress(hexToBytes(tokenAddress));

  // Per ERC-7730: if tokenAddress matches nativeCurrencyAddress, format as native currency
  if (isNativeCurrencyAddress(tokenAddress, field, resolvePath)) {
    return {
      rendered: renderTokenAmount(
        amount,
        getNativeCurrency(),
        field,
        resolvePath,
      ),
      tokenAddress: checksumTokenAddress,
    };
  }

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
    rendered: renderTokenAmount(amount, token, field, resolvePath),
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
  resolvePath: ResolvePath,
): string {
  const msg = tokenAmountMessage(field, amount, resolvePath);
  if (msg) return `${msg} ${token.symbol}`;
  return `${formatAmountWithDecimals(amount, token.decimals)} ${token.symbol}`;
}

export function tokenAmountMessage(
  field: FieldFormatOptions,
  amount: bigint,
  resolvePath: ResolvePath,
): string | undefined {
  const params = field.params ?? {};
  const thresholdSpec = params.threshold;
  const message =
    typeof params.message === "string" ? params.message : "Unlimited";
  if (typeof thresholdSpec !== "string") {
    return undefined;
  }

  let threshold: bigint | undefined;
  const resolved = resolvePath(thresholdSpec);
  if (resolved?.type === "uint" || resolved?.type === "int") {
    threshold = resolved.value;
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
): string | undefined {
  const params = field.params ?? {};
  const token = params.token ?? params.tokenPath;
  if (!token) return undefined;

  // Constant address
  if (token.startsWith("0x") && token.length === 42) {
    return token.toLowerCase();
  }

  // Any path ($., @., #., or bare) — resolve via the caller's closure
  const resolved = resolvePath(token);
  if (resolved?.type === "address") {
    return bytesToHex(resolved.bytes).toLowerCase();
  }

  return undefined;
}

/**
 * Check whether a resolved token address matches one of the nativeCurrencyAddress
 * values in the field params. Values can be literal addresses or path references
 * (e.g. `$.metadata.constants.addressAsEth`).
 */
export function isNativeCurrencyAddress(
  tokenAddress: string,
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): boolean {
  const params = field.params ?? {};
  const spec = params.nativeCurrencyAddress;
  if (!spec) return false;

  const candidates = Array.isArray(spec) ? spec : [spec];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;

    // Literal address
    if (candidate.startsWith("0x") && candidate.length === 42) {
      if (candidate.toLowerCase() === tokenAddress) return true;
      continue;
    }

    // Path reference — resolve and compare
    const resolved = resolvePath(candidate);
    if (resolved?.type === "address") {
      if (bytesToHex(resolved.bytes).toLowerCase() === tokenAddress)
        return true;
    } else if (resolved?.type === "string") {
      if (resolved.value.toLowerCase() === tokenAddress) return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// nftName format
// ---------------------------------------------------------------------------

export async function formatNftName(
  field: FieldFormatOptions,
  value: ArgumentValue,
  resolvePath: ResolvePath,
  chainId: number | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "nftName");
  }

  if (chainId === undefined) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "CONTAINER_MISSING_CHAIN_ID",
        "Cannot format nftName without a chainId on the container",
      ),
    };
  }

  const tokenId = value.value;
  const collectionAddress = resolveCollectionAddress(field, resolvePath);
  if (!collectionAddress) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "FORMAT_PARAM_RESOLUTION_ERROR",
        "collection or collectionPath param could not be resolved",
      ),
    };
  }

  let collection: NftCollectionNameResult | null;
  try {
    collection =
      (await externalDataProvider?.resolveNftCollectionName?.(
        chainId,
        collectionAddress,
      )) ?? null;
  } catch {
    collection = null;
  }
  if (!collection) {
    return {
      rendered: renderRaw(value),
      warning: warn("UNKNOWN_NFT", "NFT collection name could not be resolved"),
    };
  }

  return {
    rendered: `Collection Name: ${collection.name} - Token ID: ${tokenId.toString()}`,
  };
}

/**
 * Resolve the NFT collection address for an nftName field.
 *
 * Per the spec, `collection` takes priority over `collectionPath`. Both can be
 * either a constant address or a path reference.
 */
export function resolveCollectionAddress(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): string | undefined {
  const params = field.params ?? {};
  const collection = params.collection ?? params.collectionPath;
  if (!collection) return undefined;

  // Constant address
  if (collection.startsWith("0x") && collection.length === 42) {
    return collection.toLowerCase();
  }

  // Any path ($., @., #., or bare) — resolve via the caller's closure
  const resolved = resolvePath(collection);
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
  if (encoding !== "timestamp") {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "UNKNOWN_ENCODING",
        `Unsupported or missing encoding: ${encoding ?? "(none)"}`,
      ),
    };
  }
  try {
    return formatTimestamp(value.value);
  } catch {
    return {
      rendered: renderRaw(value),
      warning: warn("UNKNOWN_ENCODING", "Failed to parse timestamp value"),
    };
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
  if (!label) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "FORMAT_PARAM_RESOLUTION_ERROR",
        "Enum label could not be resolved",
      ),
    };
  }
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
// tokenTicker format
// ---------------------------------------------------------------------------

export async function formatTokenTicker(
  value: ArgumentValue,
  fieldOptions: FieldFormatOptions,
  resolvePath: ResolvePath,
  containerChainId: number | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "address")
    return typeMismatch(value, "address", "tokenTicker");

  const tokenAddress = bytesToHex(value.bytes).toLowerCase();
  const chainIdResult = resolveChainId(fieldOptions, resolvePath);
  if (chainIdResult.hasChainIdParam && chainIdResult.value === undefined) {
    return {
      rendered: toChecksumAddress(value.bytes),
      warning: warn(
        "FORMAT_PARAM_RESOLUTION_ERROR",
        "chainId or chainIdPath param could not be resolved",
      ),
    };
  }
  const chainId = chainIdResult.hasChainIdParam
    ? chainIdResult.value
    : containerChainId;

  if (chainId === undefined) {
    return {
      rendered: toChecksumAddress(value.bytes),
      warning: warn(
        "CONTAINER_MISSING_CHAIN_ID",
        "Cannot format tokenTicker without a chainId",
      ),
    };
  }

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
      rendered: toChecksumAddress(value.bytes),
      warning: warn("UNKNOWN_TOKEN", "Token could not be resolved"),
    };
  }

  return { rendered: token.symbol };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Resolve the chain ID from params.chainId or params.chainIdPath.
 *
 * Returns:
 * - `{ hasChainIdParam: false }` — neither chainId nor chainIdPath is present
 * - `{ hasChainIdParam: true, value: number }` — successfully resolved
 * - `{ hasChainIdParam: true, value: undefined }` — param was present but could not be resolved
 */
function resolveChainId(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
):
  | { hasChainIdParam: false }
  | { hasChainIdParam: true; value: number | undefined } {
  const params = field.params ?? {};
  const spec = params.chainId ?? params.chainIdPath;
  if (!spec) return { hasChainIdParam: false };

  if (typeof spec === "number") return { hasChainIdParam: true, value: spec };

  if (typeof spec === "string") {
    const n = Number(spec);
    if (Number.isInteger(n) && n > 0)
      return { hasChainIdParam: true, value: n };

    const resolved = resolvePath(spec);
    if (resolved?.type === "uint" || resolved?.type === "int") {
      return { hasChainIdParam: true, value: Number(resolved.value) };
    }
  }

  return { hasChainIdParam: true, value: undefined };
}

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

function getNativeCurrency(): TokenResult {
  return { name: "Ether", symbol: "ETH", decimals: 18 };
}
