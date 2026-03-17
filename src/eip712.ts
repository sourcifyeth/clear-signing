/**
 * EIP-712 typed data formatting for clear signing.
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
  TokenMeta,
  TypedData,
  TypeMember,
  Warning,
} from "./types";
import {
  type ResolvedField,
  resolveField,
  interpolateTemplate,
  isEip712DescriptorBoundTo,
  resolveMetadataValue,
  resolveTypedDataPath,
  type ArgumentValue,
} from "./descriptor";
import { lookupTokenByCaip19 } from "./token-registry";
import {
  bytesToHex,
  formatAmountWithDecimals,
  hexToBytes,
  parseBigInt,
  toChecksumAddress,
  warn,
} from "./utils";

function isFieldGroup(
  field: DescriptorFieldFormat | DescriptorFieldGroup,
): field is DescriptorFieldGroup {
  return Array.isArray((field as DescriptorFieldGroup).fields);
}

/**
 * Format EIP-712 typed data for clear signing display.
 *
 * Per ERC-7730 (current spec), display.formats keys are the full encodeType
 * string from EIP-712 (e.g. "Mail(Person from,Person to,string contents)Person(...)").
 * Old descriptor files use bare primary type names — both are supported.
 */
export async function formatEip712(
  typedData: TypedData,
  descriptor: Descriptor,
  addressBook: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<DisplayModel> {
  const warnings: Warning[] = [];
  const { chainId, verifyingContract } = typedData.domain;

  if (chainId !== undefined && verifyingContract !== undefined) {
    if (!isEip712DescriptorBoundTo(descriptor, chainId, verifyingContract)) {
      warnings.push(
        warn(
          "DEPLOYMENT_MISMATCH",
          `Descriptor is not bound to chain ${chainId} and address ${verifyingContract}`,
        ),
      );
      return { warnings };
    }
  }

  const format = findFormatSpec(descriptor, typedData);
  if (!format) {
    warnings.push(
      warn(
        "NO_FORMAT_MATCH",
        `No display format found for primary type '${typedData.primaryType}'`,
      ),
    );
    return { warnings };
  }

  const render = await applyDisplayFormat(
    typedData,
    descriptor,
    format,
    addressBook,
    externalDataProvider,
  );
  warnings.push(...render.warnings);

  const meta = descriptor.metadata;
  return {
    intent: format.intent,
    interpolatedIntent: render.interpolatedIntent,
    fields: render.fields.length > 0 ? render.fields : undefined,
    metadata: meta
      ? { owner: meta.owner, contractName: meta.contractName, info: meta.info }
      : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

async function applyDisplayFormat(
  typedData: TypedData,
  descriptor: Descriptor,
  format: DescriptorFormatSpec,
  addressBook: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{
  fields: DisplayField[];
  warnings: Warning[];
  interpolatedIntent?: string;
}> {
  const { chainId } = typedData.domain;
  const definitions = descriptor.display?.definitions ?? {};
  const fields: DisplayField[] = [];
  const warnings: Warning[] = [];
  const renderedValues = new Map<string, string>();

  for (const fieldSpec of format.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
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
    let rawValue: unknown;
    if (resolved.path.startsWith("@.")) {
      const av = resolveTypedDataPath(resolved.path, typedData);
      rawValue = av !== undefined ? argumentValueToRaw(av) : undefined;
    } else if (resolved.path.startsWith("$.")) {
      rawValue = resolveMetadataValue(descriptor.metadata, resolved.path);
    } else {
      const key = resolved.path.startsWith("#.")
        ? resolved.path.slice(2)
        : resolved.path;
      rawValue = getMessageValue(typedData.message, key);
    }

    if (rawValue === undefined) {
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
      rawValue,
      typedData.message,
      descriptor.metadata,
      chainId ?? 1,
      addressBook,
      externalDataProvider,
    );

    const bareKey = resolved.path.startsWith("#.")
      ? resolved.path.slice(2)
      : resolved.path;
    const fieldType = resolveFieldType(
      bareKey,
      typedData.primaryType,
      typedData.types,
    );
    if (!fieldType) {
      warnings.push(
        warn(
          "UNRESOLVABLE_FIELD_TYPE",
          `Cannot determine ERC-7730 field type for path '${resolved.path}'`,
        ),
      );
      continue;
    }

    const displayField: DisplayField = {
      label: resolved.label,
      value: rendered,
      fieldType,
      format: resolved.format ?? "raw",
      warning: fieldWarning,
    };

    const address = extractAddressValue(rawValue);
    if (address) {
      try {
        displayField.rawAddress = toChecksumAddress(hexToBytes(address));
      } catch {
        // ignore malformed addresses
      }
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
 * Locate the DescriptorFormatSpec for the incoming message's primary type.
 *
 * Per ERC-7730, display.formats keys are the full encodeType string from EIP-712
 * (e.g. "Mail(Person from,Person to,string contents)Person(...)").
 */
function findFormatSpec(
  descriptor: Descriptor,
  typedData: TypedData,
): DescriptorFormatSpec | undefined {
  const formats = descriptor.display?.formats;
  if (!formats) return undefined;

  const encodeTypeStr = computeEncodeType(
    typedData.primaryType,
    typedData.types,
  );
  if (!encodeTypeStr) return undefined;

  return formats[encodeTypeStr];
}

/**
 * Compute the EIP-712 encodeType string for a given primary type.
 *
 * encodeType(T) = "TypeName(field0Type field0Name,...)" followed by all
 * referenced struct types sorted alphabetically (EIP-712 spec).
 */
function computeEncodeType(
  primaryType: string,
  types: Record<string, TypeMember[]>,
): string | undefined {
  if (!(primaryType in types)) return undefined;

  const referenced = new Set<string>();
  collectReferencedTypes(primaryType, types, referenced);
  referenced.delete(primaryType);

  return [primaryType, ...Array.from(referenced).sort()]
    .map((typeName) => {
      const members = types[typeName] ?? [];
      return `${typeName}(${members.map((m) => `${m.type} ${m.name}`).join(",")})`;
    })
    .join("");
}

function collectReferencedTypes(
  typeName: string,
  types: Record<string, TypeMember[]>,
  result: Set<string>,
): void {
  if (result.has(typeName)) return;
  result.add(typeName);
  for (const member of types[typeName] ?? []) {
    // Strip array brackets to get the base struct name
    const baseType = member.type.replace(/(\[.*?\])+$/, "");
    if (baseType in types) {
      collectReferencedTypes(baseType, types, result);
    }
  }
}

/**
 * Navigate a dot-path in an EIP-712 message object.
 */
function getMessageValue(
  message: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = message;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Convert an ArgumentValue (from @. container path resolution) to a raw JS
 * value compatible with the EIP-712 renderers.
 */
function argumentValueToRaw(av: ArgumentValue): unknown {
  switch (av.type) {
    case "address":
      return toChecksumAddress(av.bytes);
    case "uint":
      return av.value.toString();
    case "bool":
      return av.value.toString();
    case "raw":
      return bytesToHex(av.bytes);
  }
}

/**
 * Walk the EIP-712 type tree to resolve the leaf Solidity type at a dot-path.
 * Returns undefined for struct/array reference types and unresolvable paths.
 */
function resolveFieldType(
  path: string,
  primaryType: string,
  types: Record<string, TypeMember[]>,
): FieldType | undefined {
  const segments = path.split(".");
  let currentType = primaryType;
  for (let i = 0; i < segments.length; i++) {
    const members = types[currentType];
    if (!members) return undefined;
    const member = members.find((m) => m.name === segments[i]);
    if (!member) return undefined;
    if (i === segments.length - 1) {
      const baseType = member.type.replace(/(\[.*?\])+$/, "");
      // Struct references and arrays have no ERC-7730 format category
      if (baseType in types) return undefined;
      return toFieldType(baseType);
    }
    currentType = member.type.replace(/(\[.*?\])+$/, "");
  }
  return undefined;
}

/** Map an EIP-712 concrete type to its ERC-7730 FieldType category. */
function toFieldType(type: string): FieldType | undefined {
  if (type === "address") return "address";
  if (type === "bool") return "bool";
  if (type === "string") return "string";
  if (type === "bytes" || /^bytes\d+$/.test(type)) return "bytes";
  if (/^uint\d*$/.test(type)) return "uint";
  if (/^int\d*$/.test(type)) return "int";
  return undefined;
}

async function renderField(
  field: ResolvedField,
  value: unknown,
  message: Record<string, unknown>,
  metadata: DescriptorMetadata | undefined,
  chainId: number,
  addressBook: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  switch (field.format) {
    case "tokenAmount":
      return await formatTokenAmount(
        field,
        value,
        message,
        metadata,
        chainId,
        externalDataProvider,
      );
    case "date":
      return { rendered: formatDate(value) };
    case "addressName":
      return { rendered: formatAddress(value, addressBook) };
    case "enum":
      return { rendered: formatEnum(field, value, metadata) };
    default:
      return { rendered: formatRaw(value) };
  }
}

async function formatTokenAmount(
  field: ResolvedField,
  value: unknown,
  message: Record<string, unknown>,
  metadata: DescriptorMetadata | undefined,
  chainId: number,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ rendered: string; warning?: Warning }> {
  const amount = parseBigIntFromValue(value);
  if (amount === undefined) return { rendered: formatRaw(value) };

  const tokenPath = field.params.tokenPath;
  if (typeof tokenPath !== "string") return { rendered: formatRaw(value) };

  const tokenValue = getMessageValue(message, tokenPath);
  const tokenAddress = extractAddressValue(tokenValue);
  if (!tokenAddress) {
    return {
      rendered: formatRaw(value),
      warning: warn(
        "TOKEN_NOT_FOUND",
        `Token path '${tokenPath}' did not resolve to an address`,
      ),
    };
  }

  const caip19 = `eip155:${chainId}/erc20:${tokenAddress}`;
  let tokenMeta: TokenMeta | undefined;

  if (externalDataProvider?.resolveToken) {
    const result = await externalDataProvider.resolveToken(
      chainId,
      tokenAddress,
    );
    if (result) tokenMeta = result;
  }
  if (!tokenMeta) {
    tokenMeta = lookupTokenByCaip19(caip19) ?? undefined;
  }

  if (!tokenMeta) {
    return {
      rendered: formatRaw(value),
      warning: warn(
        "TOKEN_NOT_FOUND",
        `Token metadata could not be resolved for ${tokenAddress}`,
      ),
    };
  }

  const message2 = tokenAmountMessage(field, amount, metadata);
  if (message2) return { rendered: `${message2} ${tokenMeta.symbol}` };

  return {
    rendered: `${formatAmountWithDecimals(amount, tokenMeta.decimals)} ${tokenMeta.symbol}`,
  };
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
    if (typeof value === "string") threshold = parseBigInt(value);
    else if (typeof value === "number") threshold = BigInt(value);
  } else {
    threshold = parseBigInt(thresholdSpec);
  }

  return threshold !== undefined && amount >= threshold ? message : undefined;
}

function formatDate(value: unknown): string {
  const ts = parseBigIntFromValue(value);
  if (ts === undefined) return formatRaw(value);
  try {
    const date = new Date(Number(ts) * 1000);
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

function formatAddress(
  value: unknown,
  addressBook: Map<string, string>,
): string {
  const address = extractAddressValue(value);
  if (!address) return formatRaw(value);
  try {
    const bytes = hexToBytes(address);
    if (bytes.length !== 20) return address;
    const checksum = toChecksumAddress(bytes);
    return addressBook.get(address) ?? checksum;
  } catch {
    return address;
  }
}

function formatEnum(
  field: ResolvedField,
  value: unknown,
  metadata: DescriptorMetadata | undefined,
): string {
  const reference = field.params.$ref;
  if (typeof reference !== "string") return formatRaw(value);

  const enumMap = resolveMetadataValue(metadata, reference);
  if (!enumMap || typeof enumMap !== "object") return formatRaw(value);

  const key = valueAsString(value);
  if (key !== undefined) {
    const label = (enumMap as Record<string, unknown>)[key];
    if (typeof label === "string") return label;
  }
  return formatRaw(value);
}

function formatRaw(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  return JSON.stringify(value);
}

function parseBigIntFromValue(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return parseBigInt(value);
  return undefined;
}

function extractAddressValue(value: unknown): string | undefined {
  const text = valueAsString(value);
  if (!text) return undefined;
  if (text.startsWith("0x") && text.length === 42) return text.toLowerCase();
  return undefined;
}

function valueAsString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value.toString();
  return undefined;
}
