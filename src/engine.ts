/**
 * Presentation engine for clear signing calldata.
 */

import type {
  Descriptor,
  DescriptorFieldFormat,
  DescriptorFieldGroup,
  DescriptorFormatSpec,
  DescriptorMetadata,
  DisplayField,
  DisplayModel,
  FieldType,
  ExternalDataProvider,
  RawCalldataFallback,
  Transaction,
  Warning,
} from "./types";
import type { DecodedArguments, ArgumentValue } from "./descriptor";
import {
  decodeArguments,
  defaultValueString,
  determineTokenKey,
  type ResolvedField,
  getFormatsBySelector,
  interpolateTemplate,
  isCalldataDescriptorBoundTo,
  resolveField,
  resolveMetadataValue,
  resolveTransactionPath,
} from "./descriptor";
import {
  bytesToHex,
  extractSelector,
  formatAmountWithDecimals,
  formatSelectorHex,
  hexToBytes,
  parseBigInt,
  toChecksumAddress,
  warn,
} from "./utils";
import {
  formatAddressName as sharedFormatAddressName,
  formatTimestamp,
  renderTokenAmount,
  resolveEnumLabel,
} from "./formatters";

function fieldTypeFromArgValue(value: ArgumentValue): FieldType {
  switch (value.type) {
    case "address":
      return "address";
    case "uint":
      return "uint";
    case "int":
      return "int";
    case "bool":
      return "bool";
    case "raw":
      return "bytes";
  }
}

function isFieldGroup(
  field: DescriptorFieldFormat | DescriptorFieldGroup,
): field is DescriptorFieldGroup {
  return Array.isArray((field as DescriptorFieldGroup).fields);
}

/**
 * Decodes calldata using a resolved descriptor and returns a human-readable
 * DisplayModel using the new design types.
 */
export async function formatCalldata(
  tx: Transaction,
  descriptor: Descriptor,
  externalDataProvider?: ExternalDataProvider,
): Promise<DisplayModel> {
  const warnings: Warning[] = [];
  const calldata = hexToBytes(tx.data);
  const selector = extractSelector(calldata);

  if (!isCalldataDescriptorBoundTo(descriptor, tx.chainId, tx.to)) {
    warnings.push(
      warn(
        "DEPLOYMENT_MISMATCH",
        `Descriptor is not bound to chain ${tx.chainId} and address ${tx.to}`,
      ),
    );
    return {
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
      warnings,
    };
  }

  const formatsBySelector = getFormatsBySelector(descriptor);
  const selectorHex = formatSelectorHex(selector);
  const match = formatsBySelector.get(selectorHex);

  if (!match) {
    warnings.push(
      warn("NO_FORMAT_MATCH", `No format match for selector ${selectorHex}`),
    );
    return {
      warnings,
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
    };
  }

  const { fn, spec: format } = match;
  const decoded = decodeArguments(fn, calldata);

  const render = await applyDisplayFormat(
    tx,
    descriptor,
    format,
    decoded,
    externalDataProvider,
  );
  warnings.push(...render.warnings);
  const meta = descriptor.metadata;
  return {
    intent: format.intent,
    interpolatedIntent: render.interpolatedIntent,
    fields: render.fields,
    metadata: meta
      ? {
          owner: meta.owner,
          contractName: meta.contractName,
          info: meta.info,
        }
      : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function applyDisplayFormat(
  tx: Transaction,
  descriptor: Descriptor,
  format: DescriptorFormatSpec,
  decoded: DecodedArguments,
  externalDataProvider?: ExternalDataProvider,
): Promise<{
  fields: DisplayField[];
  warnings: Warning[];
  interpolatedIntent?: string;
}> {
  const metadata = descriptor.metadata;
  const definitions = descriptor.display?.definitions ?? {};
  const fields: DisplayField[] = [];
  const warnings: Warning[] = [];
  const renderedValues = new Map<string, string>();

  for (const fieldSpec of format.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
      // Groups (nested field arrays) are not yet implemented — skip with warning
      warnings.push(
        warn("UNSUPPORTED_FIELD_GROUP", "Field groups are not yet supported"),
      );
      continue;
    }

    // Resolve $ref to a concrete field definition
    const { resolved, warnings: fieldWarnings } = resolveField(
      fieldSpec,
      definitions,
    );
    warnings.push(...fieldWarnings.map((msg) => warn("FIELD_RESOLUTION", msg)));
    if (!resolved) continue;

    // @. → container field; $. → descriptor file value; #. → structured data root; bare → relative
    let argValue: ArgumentValue | undefined;
    if (resolved.path.startsWith("@.")) {
      argValue = resolveTransactionPath(resolved.path, tx);
    } else if (resolved.path.startsWith("$.")) {
      argValue = metadataValueToArgumentValue(
        resolveMetadataValue(descriptor.metadata, resolved.path),
      );
    } else {
      const key = resolved.path.startsWith("#.")
        ? resolved.path.slice(2)
        : resolved.path;
      argValue = decoded.get(key);
    }
    if (!argValue) {
      warnings.push(
        warn(
          "MISSING_FIELD_VALUE",
          `No value found for field path '${resolved.path}'`,
        ),
      );
      continue;
    }

    const { rendered, warning: fieldWarning } = await renderField(
      resolved,
      argValue,
      decoded,
      metadata,
      tx.chainId,
      tx.to,
      externalDataProvider,
    );

    const displayField: DisplayField = {
      label: resolved.label,
      value: rendered,
      fieldType: fieldTypeFromArgValue(argValue),
      format: resolved.format ?? "raw",
      warning: fieldWarning,
    };

    if (argValue.type === "address") {
      displayField.rawAddress = toChecksumAddress(argValue.bytes);
    }

    fields.push(displayField);
    renderedValues.set(resolved.path, rendered);
  }

  let interpolatedIntent: string | undefined;
  if (format.interpolatedIntent) {
    const result = interpolateTemplate(
      format.interpolatedIntent,
      renderedValues,
    );
    if (result.error) {
      warnings.push(warn("INTERPOLATION_ERROR", result.error));
    } else {
      interpolatedIntent = result.value;
    }
  }

  return { fields, warnings, interpolatedIntent };
}

async function renderField(
  field: ResolvedField,
  value: ArgumentValue,
  decoded: DecodedArguments,
  metadata: DescriptorMetadata | undefined,
  chainId: number,
  contractAddress: string,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  switch (field.format) {
    case "date":
      return { rendered: formatDate(value) };
    case "tokenAmount":
      return await formatTokenAmount(
        field,
        value,
        decoded,
        metadata,
        chainId,
        contractAddress,
        externalDataProvider,
      );
    case "amount":
      return { rendered: formatNativeAmount(value, chainId) };
    case "addressName":
      return await formatAddressName(value, field, externalDataProvider);
    case "enum":
      return { rendered: formatEnum(field, value, metadata) };
    default:
      return { rendered: formatAddress(value) };
  }
}

function formatDate(value: ArgumentValue): string {
  if (value.type !== "uint") return defaultValueString(value);
  try {
    return formatTimestamp(value.value);
  } catch {
    return defaultValueString(value);
  }
}

async function formatTokenAmount(
  field: ResolvedField,
  value: ArgumentValue,
  decoded: DecodedArguments,
  metadata: DescriptorMetadata | undefined,
  chainId: number,
  contractAddress: string,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  if (value.type !== "uint") {
    return { rendered: defaultValueString(value) };
  }

  const amount = value.value;

  try {
    const caip19Key = determineTokenKey(
      field,
      decoded,
      chainId,
      contractAddress,
    );
    const erc20Match = caip19Key.match(/^eip155:\d+\/erc20:(.+)$/);
    if (!erc20Match) return { rendered: defaultValueString(value) };

    const token =
      (await externalDataProvider?.resolveToken?.(chainId, erc20Match[1])) ??
      null;
    if (!token) {
      return {
        rendered: defaultValueString(value),
        warning: warn(
          "TOKEN_NOT_FOUND",
          "Token metadata could not be resolved",
        ),
      };
    }

    return { rendered: renderTokenAmount(amount, token, field, metadata) };
  } catch {
    return { rendered: defaultValueString(value) };
  }
}

function formatNativeAmount(value: ArgumentValue, chainId: number): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }

  const formatted = formatAmountWithDecimals(value.value, 18);
  const symbol = nativeSymbol(chainId);
  return `${formatted} ${symbol}`;
}

function nativeSymbol(chainId: number): string {
  switch (chainId) {
    case 1: // Ethereum mainnet
    case 10: // Optimism
    case 42161: // Arbitrum
    case 8453: // Base
      return "ETH";
    default:
      return "NATIVE";
  }
}

function formatAddress(value: ArgumentValue): string {
  if (value.type !== "address") return defaultValueString(value);
  return toChecksumAddress(value.bytes);
}

async function formatAddressName(
  value: ArgumentValue,
  field: ResolvedField,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  if (value.type !== "address") return { rendered: defaultValueString(value) };
  const checksum = toChecksumAddress(value.bytes);
  return sharedFormatAddressName(checksum, field, externalDataProvider);
}

function formatEnum(
  field: ResolvedField,
  value: ArgumentValue,
  metadata: DescriptorMetadata | undefined,
): string {
  if (value.type !== "uint") return defaultValueString(value);
  return (
    resolveEnumLabel(field, value.value.toString(), metadata) ??
    value.value.toString()
  );
}

/**
 * Convert a metadata constant value to an ArgumentValue for display.
 */
function metadataValueToArgumentValue(
  value: unknown,
): ArgumentValue | undefined {
  if (typeof value === "number") {
    return { type: "uint", value: BigInt(value) };
  }
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "string") {
    const n = parseBigInt(value);
    if (n !== undefined) return { type: "uint", value: n };
    if (value.startsWith("0x") && value.length === 42) {
      return { type: "address", bytes: hexToBytes(value) };
    }
    if (value.startsWith("0x")) {
      try {
        return { type: "raw", bytes: hexToBytes(value) };
      } catch {
        /* fall through */
      }
    }
  }
  return undefined;
}

export function rawPreviewFromCalldata(
  selector: Uint8Array,
  calldata: Uint8Array,
): RawCalldataFallback {
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
