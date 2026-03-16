/**
 * Presentation engine for clear signing previews.
 */

import type {
  ArgumentValue,
  Descriptor,
  DescriptorFieldFormat,
  DescriptorFieldGroup,
  DescriptorFormatSpec,
  DescriptorMetadata,
  DisplayField,
  DisplayModel,
  ExternalDataProvider,
  RawPreview,
  TokenMeta,
  Transaction,
  Warning,
} from "./types";
import type { DecodedArguments } from "./descriptor";
import {
  decodeArguments,
  defaultValueString,
  determineTokenKey,
  type ResolvedField,
  getFormatsBySelector,
  isDescriptorBoundTo,
  resolveField,
  resolveTransactionPath,
} from "./descriptor";
import {
  bytesToHex,
  extractSelector,
  formatAmountWithDecimals,
  formatSelectorHex,
  hexToBytes,
  nativeTokenKey,
  parseBigInt,
  toChecksumAddress,
} from "./utils";
import { lookupTokenByCaip19 } from "./token-registry";

function warn(code: string, message: string): Warning {
  return { code, message };
}

function fieldTypeFromArgValue(value: ArgumentValue): string {
  switch (value.type) {
    case "address":
      return "address";
    case "uint":
      return "uint256";
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
  addressBook: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<DisplayModel> {
  const warnings: Warning[] = [];
  const calldata = hexToBytes(tx.data);
  const selector = extractSelector(calldata);

  if (!isDescriptorBoundTo(descriptor, tx.chainId, tx.to)) {
    warnings.push(
      warn(
        "DEPLOYMENT_MISMATCH",
        `Descriptor is not bound to chain ${tx.chainId} and address ${tx.to}`,
      ),
    );
    return {
      raw: rawPreviewFromCalldata(selector, calldata),
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
      raw: rawPreviewFromCalldata(selector, calldata),
    };
  }

  const { fn, spec: format } = match;
  const decoded = decodeArguments(fn, calldata);

  const render = await applyDisplayFormat(
    tx,
    descriptor,
    format,
    decoded,
    addressBook,
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

interface ApplyFormatResult {
  fields: DisplayField[];
  warnings: Warning[];
  interpolatedIntent?: string;
}

async function applyDisplayFormat(
  tx: Transaction,
  descriptor: Descriptor,
  format: DescriptorFormatSpec,
  decoded: DecodedArguments,
  addressBook: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<ApplyFormatResult> {
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
      argValue = metadataValueToArgumentValue(resolveMetadataValue(descriptor.metadata, resolved.path));
    } else {
      const key = resolved.path.startsWith("#.") ? resolved.path.slice(2) : resolved.path;
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
      addressBook,
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

async function renderField(
  field: ResolvedField,
  value: ArgumentValue,
  decoded: DecodedArguments,
  metadata: DescriptorMetadata | undefined,
  chainId: number,
  contractAddress: string,
  addressBook: Map<string, string>,
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
      return await formatAddressName(
        value,
        addressBook,
        field,
        externalDataProvider,
      );
    case "enum":
      return { rendered: formatEnum(field, value, metadata) };
    default:
      return { rendered: formatAddress(value, addressBook) };
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

    let tokenMeta: TokenMeta | undefined;

    // Try external provider first
    if (externalDataProvider?.resolveToken) {
      const erc20Match = caip19Key.match(/^eip155:\d+\/erc20:(.+)$/);
      if (erc20Match) {
        const result = await externalDataProvider.resolveToken(
          chainId,
          erc20Match[1],
        );
        if (result) tokenMeta = result;
      }
    }

    // Fall back to embedded token registry
    if (!tokenMeta) {
      tokenMeta = lookupTokenByCaip19(caip19Key) ?? undefined;
    }

    if (!tokenMeta) {
      return {
        rendered: defaultValueString(value),
        warning: warn(
          "TOKEN_NOT_FOUND",
          "Token metadata could not be resolved",
        ),
      };
    }

    const message = tokenAmountMessage(field, amount, metadata);
    if (message) {
      return { rendered: `${message} ${tokenMeta.symbol}` };
    }

    const formatted = formatAmountWithDecimals(amount, tokenMeta.decimals);
    return { rendered: `${formatted} ${tokenMeta.symbol}` };
  } catch {
    return { rendered: defaultValueString(value) };
  }
}

function formatNativeAmount(value: ArgumentValue, chainId: number): string {
  if (value.type !== "uint") {
    return defaultValueString(value);
  }

  const amount = value.value;
  const key = nativeTokenKey(chainId);

  if (key) {
    const meta = lookupTokenByCaip19(key);
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
  return addressBook.get(normalized) ?? checksum;
}

async function formatAddressName(
  value: ArgumentValue,
  addressBook: Map<string, string>,
  field: ResolvedField,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  if (value.type !== "address") {
    return { rendered: defaultValueString(value) };
  }

  const checksum = toChecksumAddress(value.bytes);
  const normalized = checksum.toLowerCase();

  // Descriptor address book is trusted — no warning
  const bookLabel = addressBook.get(normalized);
  if (bookLabel) {
    return { rendered: bookLabel };
  }

  const types = field.params.types;
  const sources = field.params.sources;
  const expectedType = types?.[0] ?? "";

  // Try local wallet names
  if (sources?.includes("local") && externalDataProvider?.resolveLocalName) {
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
  }

  // Try ENS
  if (sources?.includes("ens") && externalDataProvider?.resolveEnsName) {
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
  }

  // Raw address fallback — resolution was expected but failed
  return {
    rendered: checksum,
    warning: warn("ADDRESS_NOT_RESOLVED", "Address name could not be resolved"),
  };
}

function formatEnum(
  field: ResolvedField,
  value: ArgumentValue,
  metadata: DescriptorMetadata | undefined,
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

/**
 * Resolve a metadata value by JSON path.
 */
export function resolveMetadataValue(
  metadata: DescriptorMetadata | undefined,
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
    return { type: "uint", value: value ? 1n : 0n };
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
): RawPreview {
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
