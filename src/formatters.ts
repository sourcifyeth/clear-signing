/**
 * Shared field formatting logic used by both engine.ts (calldata) and eip712.ts (typed data).
 */

import type {
  BlockTimestampResult,
  ChainInfoResult,
  DescriptorFieldFormat,
  DescriptorFieldFormatType,
  DescriptorMetadata,
  DisplayModel,
  ExternalDataProvider,
  FormatCalldata,
  NftCollectionNameResult,
  TokenResult,
  Transaction,
  Warning,
} from "./types";
import type { ArgumentValue, ResolvePath } from "./descriptor";
import {
  bytesToAddressArgumentValue,
  resolveMetadataValue,
} from "./descriptor";
import {
  addThousandSeparators,
  bytesToUnsignedBigInt,
  bytesToHex,
  formatAmountWithDecimals,
  hexToBytes,
  isAddressString,
  keccak256,
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
  calldataDisplay?: DisplayModel;
  warning?: Warning;
  tokenAddress?: string;
  rawAddress?: string;
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
  formatEmbeddedCalldata?: FormatCalldata,
): Promise<RenderFieldResult> {
  switch (format) {
    case "raw":
      return formatRaw(value);
    case "amount":
      return await formatNativeAmount(value, chainId, externalDataProvider);
    case "tokenAmount":
      return await formatTokenAmount(
        fieldOptions,
        value,
        resolvePath,
        chainId,
        metadata,
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
      return await formatDate(
        value,
        fieldOptions,
        chainId,
        externalDataProvider,
      );
    case "duration":
      return formatDuration(value);
    case "unit":
      return formatUnit(value, fieldOptions);
    case "enum":
      return formatEnum(fieldOptions, value, metadata);
    case "chainId":
      return await formatChainId(value, externalDataProvider);
    case "calldata":
      return await formatCalldata(
        value,
        fieldOptions,
        resolvePath,
        chainId,
        formatEmbeddedCalldata,
      );
    case "addressName":
      return await formatAddressName(
        value,
        fieldOptions,
        resolvePath,
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
  const rendered = renderRaw(value);
  if (value.type === "address") {
    return { rendered, rawAddress: toChecksumAddress(value.bytes) };
  }
  return { rendered };
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

export async function formatNativeAmount(
  value: ArgumentValue,
  chainId: number | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "amount");
  }

  let chainInfo: ChainInfoResult | null = null;
  if (chainId !== undefined) {
    try {
      chainInfo =
        (await externalDataProvider?.resolveChainInfo?.(chainId)) ?? null;
    } catch {
      /* fall through */
    }
  }
  if (!chainInfo) {
    return {
      rendered: renderRaw(value),
      warning: warn("UNKNOWN_CHAIN", "Chain info could not be resolved"),
    };
  }

  const native = chainInfo.nativeCurrency;
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
  metadata: DescriptorMetadata | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "tokenAmount");
  }

  const amount = value.value;

  // When token param points to $.metadata.token, use metadata directly —
  // no chainId or external provider needed since we have the full token info.
  const metadataTokenResult = resolveMetadataToken(field, metadata);
  if (metadataTokenResult.hasMetadataRef) {
    if (!metadataTokenResult.token) {
      return {
        rendered: renderRaw(value),
        warning: warn(
          "FORMAT_PARAM_RESOLUTION_ERROR",
          "$.metadata.token is missing required ticker or decimals",
        ),
      };
    }
    return {
      rendered: renderTokenAmount(
        amount,
        metadataTokenResult.token,
        field,
        resolvePath,
      ),
    };
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
    let chainInfo: ChainInfoResult | null = null;
    try {
      chainInfo =
        (await externalDataProvider?.resolveChainInfo?.(chainId)) ?? null;
    } catch {
      /* fall through */
    }
    if (!chainInfo) {
      return {
        rendered: renderRaw(value),
        tokenAddress: checksumTokenAddress,
        warning: warn("UNKNOWN_CHAIN", "Chain info could not be resolved"),
      };
    }
    return {
      rendered: renderTokenAmount(
        amount,
        chainInfo.nativeCurrency,
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
  if (resolved === undefined) {
    threshold = parseBigInt(thresholdSpec);
  } else if (resolved.type === "uint" || resolved.type === "int") {
    threshold = resolved.value;
  } else if (resolved.type === "string") {
    threshold = parseBigInt(resolved.value);
  } else if (resolved.type === "bytes-slice") {
    threshold = bytesToUnsignedBigInt(resolved.bytes);
  }

  return threshold !== undefined && amount >= threshold ? message : undefined;
}

/**
 * When the token param points to `$.metadata.token`, the descriptor metadata
 * contains the ERC-20 token info (name, ticker, decimals) directly — the
 * contract itself is the token and doesn't need external resolution.
 *
 * Returns:
 * - `{ hasMetadataRef: false }` — token param does not reference $.metadata.token
 * - `{ hasMetadataRef: true, token: TokenResult }` — successfully resolved from metadata
 * - `{ hasMetadataRef: true, token: undefined }` — references $.metadata.token but metadata is missing/incomplete
 */
export function resolveMetadataToken(
  field: FieldFormatOptions,
  metadata: DescriptorMetadata | undefined,
):
  | { hasMetadataRef: false }
  | { hasMetadataRef: true; token: TokenResult | undefined } {
  const params = field.params ?? {};
  const tokenSpec = params.token ?? params.tokenPath;
  if (tokenSpec !== "$.metadata.token") return { hasMetadataRef: false };

  const meta = metadata?.token;
  if (!meta?.ticker || meta.decimals === undefined) {
    return { hasMetadataRef: true, token: undefined };
  }

  return {
    hasMetadataRef: true,
    token: {
      name: meta.name ?? meta.ticker,
      symbol: meta.ticker,
      decimals: meta.decimals,
    },
  };
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
  if (isAddressString(token)) {
    return token.toLowerCase();
  }

  // Any path ($., @., #., or bare) — resolve via the caller's closure
  let resolved = resolvePath(token);
  if (resolved?.type === "bytes-slice") {
    resolved = bytesToAddressArgumentValue(resolved.bytes);
  }
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
    if (isAddressString(candidate)) {
      if (candidate.toLowerCase() === tokenAddress) return true;
      continue;
    }

    // Path reference — resolve and compare
    const resolved = resolvePath(candidate);
    if (resolved?.type === "address" || resolved?.type === "bytes-slice") {
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
      warning: warn(
        "UNKNOWN_NFT_COLLECTION",
        "NFT collection name could not be resolved",
      ),
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
  if (isAddressString(collection)) {
    return collection.toLowerCase();
  }

  // Any path ($., @., #., or bare) — resolve via the caller's closure
  let resolved = resolvePath(collection);
  if (resolved?.type === "bytes-slice") {
    resolved = bytesToAddressArgumentValue(resolved.bytes);
  }
  if (resolved?.type === "address") {
    return bytesToHex(resolved.bytes).toLowerCase();
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// date format
// ---------------------------------------------------------------------------

export async function formatDate(
  value: ArgumentValue,
  fieldOptions: FieldFormatOptions,
  chainId: number | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int")
    return typeMismatch(value, "uint or int", "date");
  const encoding = fieldOptions.params?.encoding;

  if (encoding === "timestamp") {
    try {
      return formatTimestamp(value.value);
    } catch {
      return {
        rendered: renderRaw(value),
        warning: warn("UNKNOWN_ENCODING", "Failed to parse timestamp value"),
      };
    }
  }

  if (encoding === "blockheight") {
    if (chainId === undefined) {
      return {
        rendered: renderRaw(value),
        warning: warn(
          "CONTAINER_MISSING_CHAIN_ID",
          "Cannot format blockheight without a chainId on the container",
        ),
      };
    }

    let result: BlockTimestampResult | null;
    try {
      result =
        (await externalDataProvider?.resolveBlockTimestamp?.(
          chainId,
          value.value,
        )) ?? null;
    } catch {
      result = null;
    }
    if (!result) {
      return {
        rendered: renderRaw(value),
        warning: warn("UNKNOWN_BLOCK", "Block timestamp could not be resolved"),
      };
    }

    return formatTimestamp(BigInt(result.timestamp));
  }

  return {
    rendered: renderRaw(value),
    warning: warn(
      "UNKNOWN_ENCODING",
      `Unsupported or missing encoding: ${encoding ?? "(none)"}`,
    ),
  };
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
// chainId format
// ---------------------------------------------------------------------------

export async function formatChainId(
  value: ArgumentValue,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "uint" && value.type !== "int") {
    return typeMismatch(value, "uint or int", "chainId");
  }

  const id = Number(value.value);
  let chainInfo: ChainInfoResult | null = null;
  try {
    chainInfo = (await externalDataProvider?.resolveChainInfo?.(id)) ?? null;
  } catch {
    /* fall through */
  }
  if (!chainInfo) {
    return {
      rendered: renderRaw(value),
      warning: warn("UNKNOWN_CHAIN", "Chain info could not be resolved"),
    };
  }

  return { rendered: chainInfo.name };
}

// ---------------------------------------------------------------------------
// calldata format (embedded calldata)
// ---------------------------------------------------------------------------

async function formatCalldata(
  value: ArgumentValue,
  fieldOptions: FieldFormatOptions,
  resolvePath: ResolvePath,
  containerChainId: number | undefined,
  formatCalldata?: FormatCalldata,
): Promise<RenderFieldResult> {
  if (value.type !== "bytes") {
    return typeMismatch(value, "bytes", "calldata");
  }

  const callee = resolveCallee(fieldOptions, resolvePath);
  if (!callee) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "FORMAT_PARAM_RESOLUTION_ERROR",
        "callee or calleePath param could not be resolved",
      ),
    };
  }

  const chainIdResult = resolveChainId(fieldOptions, resolvePath);
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
        "Cannot format embedded calldata without a chainId on the container",
      ),
    };
  }

  if (!formatCalldata) {
    return {
      rendered: renderRaw(value),
      warning: warn(
        "EMBEDDED_CALLDATA_NOT_SUPPORTED",
        "Embedded calldata formatting is not available",
      ),
    };
  }

  const rendered = bytesToHex(keccak256(value.bytes));

  const selector = resolveSelectorParam(fieldOptions, resolvePath);
  const data = selector
    ? bytesToHex(new Uint8Array([...selector, ...value.bytes]))
    : bytesToHex(value.bytes);
  const amount = resolveAmountParam(fieldOptions, resolvePath);
  const spender = resolveSpenderParam(fieldOptions, resolvePath);

  const tx: Transaction = { chainId, to: callee, data };
  if (amount !== undefined) tx.value = amount;
  if (spender !== undefined) tx.from = spender;

  const result = await formatCalldata(tx);

  return { rendered, calldataDisplay: result };
}

/**
 * Resolve the callee address for an embedded calldata field.
 * Accepts `callee` or `calleePath` as a constant address or path reference.
 */
function resolveCallee(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): string | undefined {
  const params = field.params ?? {};
  const spec = params.callee ?? params.calleePath;
  if (!spec) return undefined;

  if (isAddressString(spec)) {
    return spec.toLowerCase();
  }

  let resolved = resolvePath(spec);
  if (resolved?.type === "bytes-slice") {
    resolved = bytesToAddressArgumentValue(resolved.bytes);
  }
  if (resolved?.type === "address") {
    return bytesToHex(resolved.bytes).toLowerCase();
  }

  return undefined;
}

/**
 * Resolve the native currency amount for embedded calldata.
 * Maps to `@.value` in the nested transaction's container paths.
 */
function resolveAmountParam(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): bigint | undefined {
  const params = field.params ?? {};
  const spec = params.amount ?? params.amountPath;
  if (!spec) return undefined;

  const resolved = resolvePath(spec);
  if (resolved === undefined) {
    return parseBigInt(spec);
  }
  if (resolved?.type === "uint" || resolved?.type === "int") {
    return resolved.value;
  }
  if (resolved?.type === "string") {
    return parseBigInt(resolved.value);
  }
  if (resolved?.type === "bytes-slice") {
    return bytesToUnsignedBigInt(resolved.bytes);
  }

  return undefined;
}

/**
 * Resolve the spender address for embedded calldata.
 * Maps to `@.from` in the nested transaction's container paths.
 */
function resolveSpenderParam(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): string | undefined {
  const params = field.params ?? {};
  const spec = params.spender ?? params.spenderPath;
  if (!spec) return undefined;

  if (isAddressString(spec)) {
    return spec.toLowerCase();
  }

  let resolved = resolvePath(spec);
  if (resolved?.type === "bytes-slice") {
    resolved = bytesToAddressArgumentValue(resolved.bytes);
  }
  if (resolved?.type === "address") {
    return bytesToHex(resolved.bytes).toLowerCase();
  }

  return undefined;
}

/**
 * Resolve the selector for embedded calldata.
 * Returns 4 bytes if specified, or undefined to use the first 4 bytes of the calldata.
 */
function resolveSelectorParam(
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): Uint8Array | undefined {
  const params = field.params ?? {};
  const spec = params.selector ?? params.selectorPath;
  if (!spec) return undefined;

  if (typeof spec === "string" && spec.startsWith("0x") && spec.length === 10) {
    return hexToBytes(spec);
  }

  const resolved = resolvePath(spec);
  if (resolved?.type === "bytes") return resolved.bytes.slice(0, 4);
  if (resolved?.type === "bytes-slice") return resolved.bytes.slice(0, 4);

  return undefined;
}

// ---------------------------------------------------------------------------
// addressName format
// ---------------------------------------------------------------------------

export async function formatAddressName(
  value: ArgumentValue,
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
  externalDataProvider?: ExternalDataProvider,
): Promise<RenderFieldResult> {
  if (value.type !== "address")
    return typeMismatch(value, "address", "addressName");
  const checksumAddress = toChecksumAddress(value.bytes);
  const normalized = checksumAddress.toLowerCase();

  // Per ERC-7730: if the address matches senderAddress, display "Sender"
  // and substitute the address with @.from
  if (isSenderAddress(normalized, field, resolvePath)) {
    const fromResolved = resolvePath("@.from");
    const senderAddress =
      fromResolved?.type === "address"
        ? toChecksumAddress(fromResolved.bytes)
        : checksumAddress;
    return { rendered: "Sender", rawAddress: senderAddress };
  }

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
          rawAddress: checksumAddress,
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
          rawAddress: checksumAddress,
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
    rawAddress: checksumAddress,
    warning: warn("UNKNOWN_ADDRESS", "Address name could not be resolved"),
  };
}

/**
 * Check whether a resolved address matches one of the senderAddress
 * values in the field params. Per ERC-7730, when the field value equals
 * a senderAddress, it is interpreted as the sender referenced by @.from.
 */
export function isSenderAddress(
  address: string,
  field: FieldFormatOptions,
  resolvePath: ResolvePath,
): boolean {
  const params = field.params ?? {};
  const spec = params.senderAddress;
  if (!spec) return false;

  const candidates = Array.isArray(spec) ? spec : [spec];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;

    // Literal address
    if (isAddressString(candidate)) {
      if (candidate.toLowerCase() === address) return true;
      continue;
    }

    // Path reference — resolve and compare
    const resolved = resolvePath(candidate);
    if (resolved?.type === "address" || resolved?.type === "bytes-slice") {
      if (bytesToHex(resolved.bytes).toLowerCase() === address) return true;
    } else if (resolved?.type === "string") {
      if (resolved.value.toLowerCase() === address) return true;
    }
  }

  return false;
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
    let resolvedN: bigint | undefined;
    if (resolved?.type === "uint" || resolved?.type === "int") {
      resolvedN = resolved.value;
    } else if (resolved?.type === "bytes-slice") {
      resolvedN = bytesToUnsignedBigInt(resolved.bytes);
    }

    if (resolvedN !== undefined && resolvedN <= Number.MAX_SAFE_INTEGER) {
      return {
        hasChainIdParam: true,
        value: Number(resolvedN),
      };
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
