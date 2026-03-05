/**
 * EIP-712 typed data formatting for clear signing.
 */

import { Eip712Error } from "./errors";
import type {
  DisplayField,
  DisplayFormat,
  DisplayItem,
  DisplayModel,
  EffectiveField,
  TypedData,
} from "./types";
import { resolveEffectiveField, buildAddressBook } from "./descriptor";
import { lookupTokenByCaip19 } from "./token-registry";
import {
  formatAmountWithDecimals,
  parseBigInt,
  toChecksumAddress,
  hexToBytes,
} from "./utils";
import { interpolateTemplate, resolveMetadataValue } from "./engine";
import type { DescriptorResolver } from "./resolver";

interface TypedDescriptor {
  context?: TypedContext;
  metadata: Record<string, unknown>;
  display: TypedDisplay;
}

interface TypedContext {
  eip712: TypedEip712Context;
}

interface TypedEip712Context {
  deployments: Array<{ chainId: number; address: string }>;
}

interface TypedDisplay {
  definitions: Record<string, DisplayField>;
  formats: Record<string, DisplayFormat>;
}

/**
 * Format EIP-712 typed data for clear signing display.
 */
export async function formatTypedData(
  data: TypedData,
  resolver: DescriptorResolver,
): Promise<DisplayModel> {
  const chainId = extractChainId(data.domain);
  const verifyingContract = extractVerifyingContract(data.domain);

  const r = resolver;
  const mergedDescriptor = await r.resolveTypedDataDescriptor(
    chainId,
    verifyingContract,
  );
  if (!mergedDescriptor) {
    throw Eip712Error.typedData(
      `No descriptor found for chain ${chainId} and address ${verifyingContract}`,
    );
  }
  const descriptor = parseDescriptor(mergedDescriptor);
  const addressBook = buildAddressBook(mergedDescriptor, verifyingContract);
  const warnings: string[] = [];

  if (descriptor.context) {
    const hasDeployment = descriptor.context.eip712.deployments.some(
      (d) =>
        d.chainId === chainId &&
        d.address.toLowerCase() === verifyingContract.toLowerCase(),
    );
    if (!hasDeployment) {
      warnings.push(
        `Descriptor deployment mismatch for chain ${chainId} and address ${verifyingContract}`,
      );
    }
  }

  const format = descriptor.display.formats[data.primaryType];
  if (!format) {
    throw Eip712Error.typedData(
      `No display format for primary type ${data.primaryType}`,
    );
  }

  const items: DisplayItem[] = [];
  const renderedValues = new Map<string, string>();

  for (const required of format.required) {
    if (getValue(data.message, required) === undefined) {
      warnings.push(`Missing required field '${required}'`);
    }
  }

  for (const field of format.fields) {
    const effective = resolveEffectiveField(
      field,
      descriptor.display.definitions,
      warnings,
    );
    if (!effective) continue;

    const value = getValue(data.message, effective.path);
    if (value === undefined) {
      warnings.push(`No value found for field path '${effective.path}'`);
      continue;
    }

    const rendered = renderField(
      effective,
      value,
      data.message,
      descriptor.metadata,
      chainId,
      addressBook,
      warnings,
    );
    renderedValues.set(effective.path, rendered);
    items.push({ label: effective.label, value: rendered });
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

  return {
    intent: format.intent,
    interpolatedIntent,
    items,
    warnings,
  };
}

function parseDescriptor(merged: Record<string, unknown>): TypedDescriptor {
  return {
    context: merged.context as TypedContext | undefined,
    metadata: (merged.metadata as Record<string, unknown>) || {},
    display: {
      definitions:
        ((merged.display as Record<string, unknown>)?.definitions as Record<
          string,
          DisplayField
        >) || {},
      formats:
        ((merged.display as Record<string, unknown>)?.formats as Record<
          string,
          DisplayFormat
        >) || {},
    },
  };
}

function renderField(
  field: EffectiveField,
  value: unknown,
  message: Record<string, unknown>,
  metadata: Record<string, unknown>,
  chainId: number,
  addressBook: Map<string, string>,
  warnings: string[],
): string {
  switch (field.format) {
    case "tokenAmount":
      return formatTokenAmount(
        field,
        value,
        message,
        metadata,
        chainId,
        warnings,
      );
    case "date":
      return formatDate(value);
    case "number":
      return formatNumber(value);
    case "address":
    case "addressName":
      return formatAddress(value, addressBook);
    case "enum":
      return formatEnum(field, value, metadata);
    case "raw":
    default:
      return formatRaw(value);
  }
}

function formatTokenAmount(
  field: EffectiveField,
  value: unknown,
  message: Record<string, unknown>,
  metadata: Record<string, unknown>,
  chainId: number,
  warnings: string[],
): string {
  const amount = parseBigIntFromValue(value);
  if (amount === undefined) {
    return formatRaw(value);
  }

  const tokenPath = field.params.tokenPath;
  if (typeof tokenPath !== "string") {
    return formatRaw(value);
  }

  const tokenValue = getValue(message, tokenPath);
  if (tokenValue === undefined) {
    warnings.push(
      `token path '${tokenPath}' not found for field '${field.path}'`,
    );
    return formatRaw(value);
  }

  const tokenAddress = extractAddressValue(tokenValue);
  if (tokenAddress === undefined) {
    warnings.push(
      `token path '${tokenPath}' is not an address for field '${field.path}'`,
    );
    return formatRaw(value);
  }

  const caip19 = `eip155:${chainId}/erc20:${tokenAddress.toLowerCase()}`;
  const meta = lookupTokenByCaip19(caip19);
  if (!meta) {
    warnings.push(
      `Token registry missing entry for chain ${chainId} and address ${tokenAddress}`,
    );
    return formatRaw(value);
  }

  const message2 = tokenAmountMessage(field, amount, metadata);
  if (message2) {
    return `${message2} ${meta.symbol}`;
  }

  const formatted = formatAmountWithDecimals(amount, meta.decimals);
  return `${formatted} ${meta.symbol}`;
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
    threshold = parseBigIntFromValue(value);
  } else {
    threshold = parseBigInt(thresholdSpec);
  }

  if (threshold === undefined) {
    return undefined;
  }

  return amount >= threshold ? message : undefined;
}

function formatDate(value: unknown): string {
  const amount = parseBigIntFromValue(value);
  if (amount === undefined) {
    return formatRaw(value);
  }

  try {
    const seconds = Number(amount);
    const date = new Date(seconds * 1000);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const secs = String(date.getUTCSeconds()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}:${secs} UTC`;
  } catch {
    return formatRaw(value);
  }
}

function formatNumber(value: unknown): string {
  if (typeof value === "number") {
    return value.toString();
  }
  const str = valueAsString(value);
  return str ?? formatRaw(value);
}

function formatAddress(
  value: unknown,
  addressBook: Map<string, string>,
): string {
  const address = valueAsString(value);
  if (address === undefined) {
    return formatRaw(value);
  }

  const cleaned = address.trim();
  try {
    const bytes = hexToBytes(
      cleaned.startsWith("0x") ? cleaned.slice(2) : cleaned,
    );
    if (bytes.length !== 20) {
      return address;
    }
    const checksum = toChecksumAddress(bytes);
    const normalized = cleaned.toLowerCase();

    const label = addressBook.get(normalized);
    if (label) {
      return label;
    }

    return checksum;
  } catch {
    return address;
  }
}

function formatEnum(
  field: EffectiveField,
  value: unknown,
  metadata: Record<string, unknown>,
): string {
  const reference = field.params.$ref;
  if (typeof reference !== "string") {
    return formatRaw(value);
  }

  const enumMap = resolveMetadataValue(metadata, reference);
  if (!enumMap || typeof enumMap !== "object") {
    return formatRaw(value);
  }

  const text = valueAsString(value);
  if (text !== undefined) {
    const label = (enumMap as Record<string, unknown>)[text];
    if (typeof label === "string") {
      return label;
    }
  }

  return formatRaw(value);
}

function formatRaw(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  return JSON.stringify(value);
}

function extractChainId(domain: Record<string, unknown>): number {
  const chainValue = domain.chainId;
  if (chainValue === undefined) {
    throw Eip712Error.typedData("typed data domain missing chainId");
  }

  if (typeof chainValue === "number") {
    return chainValue;
  }

  if (typeof chainValue === "string") {
    const value = parseBigInt(chainValue);
    if (value === undefined) {
      throw Eip712Error.typedData("chainId is not a valid integer");
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw Eip712Error.typedData("chainId out of range");
    }
    return Number(value);
  }

  throw Eip712Error.typedData("chainId must be a number or string");
}

function extractVerifyingContract(domain: Record<string, unknown>): string {
  const value = domain.verifyingContract;
  if (typeof value !== "string") {
    throw Eip712Error.typedData("typed data domain missing verifyingContract");
  }
  return value.toLowerCase();
}

function getValue(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root;
  let trimmed = path.trim();
  if (trimmed.startsWith("@.")) {
    trimmed = trimmed.slice(2);
  }
  if (trimmed.length === 0) {
    return current;
  }

  for (const segment of trimmed.split(".")) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function parseBigIntFromValue(value: unknown): bigint | undefined {
  if (typeof value === "string") {
    return parseBigInt(value);
  }
  if (typeof value === "number") {
    return BigInt(value);
  }
  return undefined;
}

function extractAddressValue(value: unknown): string | undefined {
  const text = valueAsString(value);
  if (text === undefined) return undefined;
  if (text.startsWith("0x") && text.length === 42) {
    return text.toLowerCase();
  }
  return undefined;
}

function valueAsString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  return undefined;
}
