/**
 * Presentation engine for clear signing previews.
 */

import { EngineError } from "./errors";
import type {
  ArgumentValue,
  LegacyDisplayField,
  DisplayFormat,
  DisplayItem,
  LegacyDisplayModel,
  EffectiveField,
  LegacyRawPreview,
  ResolvedCall,
  TokenMeta,
} from "./types";
import type { DecodedArguments } from "./descriptor";
import {
  buildDescriptor,
  decodeArguments,
  defaultValueString,
  determineTokenKey,
  displayLabel,
  getFormatMap,
  getFunctionDescriptors,
  isDescriptorBoundTo,
  rawWordHex,
  resolveEffectiveField,
} from "./descriptor";
import {
  bytesEqual,
  bytesToHex,
  extractSelector,
  formatAmountWithDecimals,
  formatSelectorHex,
  nativeTokenKey,
  parseBigInt,
  toChecksumAddress,
} from "./utils";

interface FormatRender {
  items: DisplayItem[];
  warnings: string[];
  interpolatedIntent?: string;
}

/**
 * Decodes calldata using a previously resolved descriptor bundle and returns
 * a human-readable preview.
 */
export function formatWithResolvedCall(
  resolved: ResolvedCall,
  chainId: number,
  to: string,
  value: Uint8Array | undefined,
  calldata: Uint8Array,
): LegacyDisplayModel {
  const tokenMetadata = resolved.tokenMetadata;
  const descriptor = buildDescriptor(resolved.descriptor);

  const warnings: string[] = [];

  if (!isDescriptorBoundTo(descriptor, chainId, to)) {
    warnings.push(
      `Descriptor deployment mismatch for chain ${chainId} and address ${to}`,
    );
  }

  const selector = extractSelector(calldata);
  const selectorHex = formatSelectorHex(selector);

  const functions = getFunctionDescriptors(descriptor);
  const displayFormats = getFormatMap(descriptor);
  const addressBook = resolved.addressBook;

  const fn = functions.find((f) => bytesEqual(f.selector, selector));

  if (!fn) {
    warnings.push(`No ABI match for selector ${selectorHex}`);
    return {
      intent: "Unknown transaction",
      items: [],
      warnings,
      raw: rawPreviewFromCalldata(selector, calldata),
    };
  }

  const decoded = decodeArguments(fn, calldata).withValue(value);

  const format = displayFormats.get(fn.typedSignature);
  if (format) {
    const render = applyDisplayFormat(
      format,
      decoded,
      descriptor.metadata,
      chainId,
      to,
      addressBook,
      descriptor.display.definitions || {},
      tokenMetadata,
    );
    warnings.push(...render.warnings);
    return {
      intent: format.intent,
      interpolatedIntent: render.interpolatedIntent,
      items: render.items,
      warnings,
    };
  }

  warnings.push(`No display format defined for signature ${fn.typedSignature}`);
  const items = decoded.getOrdered().map((arg) => ({
    label: displayLabel(arg),
    value: defaultValueString(arg.value),
  }));

  return {
    intent: "Transaction",
    items,
    warnings,
    raw: {
      selector: selectorHex,
      args: decoded.getOrdered().map(rawWordHex),
    },
  };
}

function applyDisplayFormat(
  format: DisplayFormat,
  decoded: DecodedArguments,
  metadata: Record<string, unknown>,
  chainId: number,
  contractAddress: string,
  addressBook: Map<string, string>,
  definitions: Record<string, LegacyDisplayField>,
  tokenMetadata: Map<string, TokenMeta>,
): FormatRender {
  const items: DisplayItem[] = [];
  const warnings: string[] = [];
  const renderedValues = new Map<string, string>();

  for (const required of format.required) {
    if (decoded.get(required) === undefined) {
      warnings.push(`Missing required argument '${required}'`);
    }
  }

  for (const field of format.fields) {
    const effective = resolveEffectiveField(field, definitions, warnings);
    if (!effective) continue;

    const value = decoded.get(effective.path);
    if (value) {
      const rendered = renderField(
        effective,
        value,
        decoded,
        metadata,
        chainId,
        contractAddress,
        addressBook,
        tokenMetadata,
      );
      items.push({
        label: effective.label,
        value: rendered,
      });
      renderedValues.set(effective.path, rendered);
    } else {
      warnings.push(`No value found for field path '${effective.path}'`);
    }
  }

  let interpolatedIntent: string | undefined;
  if (format.interpolatedIntent) {
    const result = interpolateTemplate(
      format.interpolatedIntent,
      renderedValues,
    );
    if (result.error) {
      warnings.push(result.error);
    } else {
      interpolatedIntent = result.value;
    }
  }

  return { items, warnings, interpolatedIntent };
}

/**
 * Interpolate placeholders in a template string.
 */
export function interpolateTemplate(
  template: string,
  values: Map<string, string>,
): { value?: string; error?: string } {
  let output = "";
  let i = 0;

  while (i < template.length) {
    const ch = template[i];
    if (ch === "{") {
      let placeholder = "";
      i++;
      let closed = false;
      while (i < template.length) {
        if (template[i] === "}") {
          closed = true;
          i++;
          break;
        }
        placeholder += template[i];
        i++;
      }
      if (!closed) {
        return { error: "Unclosed placeholder in interpolated intent" };
      }
      const key = placeholder.trim();
      if (key.length === 0) {
        return { error: "Empty placeholder in interpolated intent" };
      }
      const value = values.get(key);
      if (value === undefined) {
        return { error: `Missing interpolated value for '${key}'` };
      }
      output += value;
    } else {
      output += ch;
      i++;
    }
  }

  return { value: output };
}

function renderField(
  field: EffectiveField,
  value: ArgumentValue,
  decoded: DecodedArguments,
  metadata: Record<string, unknown>,
  chainId: number,
  contractAddress: string,
  addressBook: Map<string, string>,
  tokenMetadata: Map<string, TokenMeta>,
): string {
  switch (field.format) {
    case "date":
      return formatDate(value);
    case "tokenAmount":
      return formatTokenAmount(
        field,
        value,
        decoded,
        metadata,
        chainId,
        contractAddress,
        tokenMetadata,
      );
    case "amount":
      return formatNativeAmount(value, chainId, tokenMetadata);
    case "address":
    case "addressName":
      return formatAddress(value, addressBook);
    case "enum":
      return formatEnum(field, value, metadata);
    case "number":
      return formatNumber(value);
    default:
      return defaultValueString(value);
  }
}

function formatDate(value: ArgumentValue): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }

  try {
    const seconds = Number(value.value);
    const date = new Date(seconds * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const secs = String(date.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${secs} UTC`;
  } catch {
    return defaultValueString(value);
  }
}

function formatTokenAmount(
  field: EffectiveField,
  value: ArgumentValue,
  decoded: DecodedArguments,
  metadata: Record<string, unknown>,
  chainId: number,
  contractAddress: string,
  tokenMetadata: Map<string, TokenMeta>,
): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }

  const amount = value.value;

  try {
    const tokenMeta = lookupTokenMeta(
      field,
      decoded,
      chainId,
      contractAddress,
      tokenMetadata,
    );

    const message = tokenAmountMessage(field, amount, metadata);
    if (message) {
      return `${message} ${tokenMeta.symbol}`;
    }

    const formatted = formatAmountWithDecimals(amount, tokenMeta.decimals);
    return `${formatted} ${tokenMeta.symbol}`;
  } catch {
    return defaultValueString(value);
  }
}

function formatNativeAmount(
  value: ArgumentValue,
  chainId: number,
  tokenMetadata: Map<string, TokenMeta>,
): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }

  const amount = value.value;
  const key = nativeTokenKey(chainId);

  if (key) {
    const meta = tokenMetadata.get(key);
    if (meta) {
      const formatted = formatAmountWithDecimals(amount, meta.decimals);
      return `${formatted} ${meta.symbol}`;
    }
  }

  const formatted = formatAmountWithDecimals(amount, 18);
  return `${formatted} NATIVE`;
}

function formatAddress(
  value: ArgumentValue,
  addressBook: Map<string, string>,
): string {
  if (value.type !== "address") {
    return defaultValueString(value);
  }

  const checksum = toChecksumAddress(value.bytes);
  const normalized = checksum.toLowerCase();

  const label = addressBook.get(normalized);
  if (label) {
    return label;
  }

  return checksum;
}

function formatNumber(value: ArgumentValue): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }
  return value.value.toString();
}

function formatEnum(
  field: EffectiveField,
  value: ArgumentValue,
  metadata: Record<string, unknown>,
): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }

  const reference = field.params.$ref;
  if (typeof reference !== "string") {
    return defaultValueString(value);
  }

  const enumMap = resolveMetadataValue(metadata, reference);
  if (!enumMap || typeof enumMap !== "object") {
    return defaultValueString(value);
  }

  const label = (enumMap as Record<string, unknown>)[value.value.toString()];
  if (typeof label === "string") {
    return label;
  }

  return value.value.toString();
}

function tokenAmountMessage(
  field: EffectiveField,
  amount: bigint,
  metadata: Record<string, unknown>,
): string | undefined {
  const thresholdSpec = field.params.threshold;
  const message = field.params.message;

  if (typeof thresholdSpec !== "string" || typeof message !== "string") {
    return undefined;
  }

  let threshold: bigint | undefined;
  if (thresholdSpec.startsWith("$.")) {
    const value = resolveMetadataValue(metadata, thresholdSpec);
    if (typeof value === "string") {
      threshold = parseBigInt(value);
    } else if (typeof value === "number") {
      threshold = BigInt(value);
    }
  } else {
    threshold = parseBigInt(thresholdSpec);
  }

  if (threshold === undefined) {
    return undefined;
  }

  return amount >= threshold ? message : undefined;
}

function lookupTokenMeta(
  field: EffectiveField,
  decoded: DecodedArguments,
  chainId: number,
  contractAddress: string,
  tokenMetadata: Map<string, TokenMeta>,
): TokenMeta {
  const key = determineTokenKey(field, decoded, chainId, contractAddress);
  const meta = tokenMetadata.get(key);
  if (!meta) {
    throw EngineError.tokenRegistry(`token registry missing entry for ${key}`);
  }
  return meta;
}

/**
 * Resolve a metadata value by JSON path.
 */
export function resolveMetadataValue(
  metadata: Record<string, unknown>,
  pointer: string,
): unknown {
  const prefix = "$.metadata.";
  if (!pointer.startsWith(prefix)) {
    return undefined;
  }

  const rest = pointer.slice(prefix.length);
  let current: unknown = metadata;

  for (const segment of rest.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function rawPreviewFromCalldata(
  selector: Uint8Array,
  calldata: Uint8Array,
): LegacyRawPreview {
  const args: string[] = [];
  if (calldata.length > 4) {
    const data = calldata.slice(4);
    for (let i = 0; i < data.length; i += 32) {
      const chunk = data.slice(i, Math.min(i + 32, data.length));
      args.push(bytesToHex(chunk));
    }
  }

  return {
    selector: formatSelectorHex(selector),
    args,
  };
}
