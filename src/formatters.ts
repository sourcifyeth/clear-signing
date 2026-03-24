/**
 * Shared field formatting logic used by both engine.ts (calldata) and eip712.ts (typed data).
 */

import type {
  DescriptorFieldFormat,
  DescriptorFieldFormatType,
  DescriptorFieldGroup,
  DescriptorFormatSpec,
  DescriptorMetadata,
  DisplayField,
  DisplayFieldGroup,
  ExternalDataProvider,
  TokenResult,
  Warning,
} from "./types";
import type { ArgumentValue, ResolvePath } from "./descriptor";
import {
  isFieldGroup,
  mergeDefinitions,
  resolveFieldValue,
  resolveMetadataValue,
} from "./descriptor";
import {
  addThousandSeparators,
  bytesToHex,
  formatAmountWithDecimals,
  hexToBytes,
  parseBigInt,
  toChecksumAddress,
  warn,
} from "./utils";

/** Callback to get the length of an array at a given message path. */
export type GetArrayLength = (path: string) => number;

/**
 * Shared field formatting loop used by both calldata and EIP-712 engines.
 *
 * Iterates over format.fields, merges definitions, resolves values, renders
 * each field, and builds the DisplayField array. Returns either the fields
 * and rendered values, or warnings on failure.
 */
export async function applyFieldFormats(
  format: DescriptorFormatSpec,
  definitions: Record<string, DescriptorFieldFormat>,
  resolvePath: ResolvePath,
  getArrayLength: GetArrayLength,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  externalDataProvider?: ExternalDataProvider,
): Promise<
  | {
      fields: (DisplayField | DisplayFieldGroup)[];
      renderedValues: Map<string, string>;
    }
  | { warnings: Warning[] }
> {
  const fields: (DisplayField | DisplayFieldGroup)[] = [];
  const renderedValues = new Map<string, string>();

  for (const fieldSpec of format.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
      const groupResult = await processFieldGroup(
        fieldSpec,
        definitions,
        resolvePath,
        getArrayLength,
        chainId,
        metadata,
        renderedValues,
        externalDataProvider,
      );
      if ("warnings" in groupResult) return groupResult;
      fields.push(groupResult.group);
      continue;
    }

    const result = await processSingleField(
      fieldSpec,
      definitions,
      resolvePath,
      chainId,
      metadata,
      renderedValues,
      externalDataProvider,
    );
    if ("warnings" in result) return result;
    if (result.field) fields.push(result.field);
  }

  return { fields, renderedValues };
}

/**
 * Process a single (non-group) field spec.
 * Returns null if the field is hidden.
 */
async function processSingleField(
  fieldSpec: DescriptorFieldFormat,
  definitions: Record<string, DescriptorFieldFormat>,
  resolvePath: ResolvePath,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  renderedValues: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ field: DisplayField | null } | { warnings: Warning[] }> {
  const { merged, warnings: defWarnings } = mergeDefinitions(
    fieldSpec,
    definitions,
  );
  if (defWarnings.length > 0) {
    return {
      warnings: defWarnings.map((msg) =>
        warn("DEFINITIONS_RESOLUTION_ERROR", msg),
      ),
    };
  }

  if (merged.visible === "never") return { field: null };

  const argValue = resolveFieldValue(merged, resolvePath);
  if (!argValue) {
    return {
      warnings: [
        warn(
          "INVALID_DESCRIPTOR",
          `No value found for field '${merged.path ?? merged.value}'`,
        ),
      ],
    };
  }

  if (!merged.format || !merged.label) {
    return {
      warnings: [
        warn(
          "INVALID_DESCRIPTOR",
          `Missing ${!merged.format ? "format" : "label"} for field '${merged.label ?? merged.path}'`,
        ),
      ],
    };
  }

  const {
    rendered,
    warning: fieldWarning,
    tokenAddress,
  } = await renderField(
    argValue,
    merged.format,
    merged,
    resolvePath,
    chainId,
    metadata,
    externalDataProvider,
  );

  // Apply separator prefix for array elements (e.g. "Recipient {index}" → "Recipient 0")
  let finalValue = rendered;
  if (merged.separator && merged.path) {
    const indexMatch = merged.path.match(/\.\[(\d+)\]/);
    if (indexMatch) {
      const sep = merged.separator.replace("{index}", indexMatch[1]);
      finalValue = `${sep} ${rendered}`;
    }
  }

  const displayField: DisplayField = {
    label: merged.label,
    value: finalValue,
    fieldType: argValue.type,
    format: merged.format,
    warning: fieldWarning,
  };

  if (argValue.type === "address") {
    displayField.rawAddress = toChecksumAddress(argValue.bytes);
  }

  if (tokenAddress) {
    displayField.tokenAddress = tokenAddress;
  }

  if (merged.path) renderedValues.set(merged.path, finalValue);
  return { field: displayField };
}

/**
 * Process a field group by iterating over arrays.
 *
 * Two patterns are supported:
 *
 * 1. **Group-level array path** (e.g. PermitBatch): group.path = "details.[]",
 *    children have relative paths within each element.
 *
 * 2. **Child-level array paths** (e.g. distribute): group has no .[] path,
 *    children each have their own .[] paths (e.g. "recipients.[]", "percentages.[]").
 *    In bundled mode, children are paired by index.
 */
async function processFieldGroup(
  group: DescriptorFieldGroup,
  definitions: Record<string, DescriptorFieldFormat>,
  resolvePath: ResolvePath,
  getArrayLength: GetArrayLength,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  renderedValues: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  // Pattern 1: group itself has a .[] path
  if (group.path?.endsWith(".[]")) {
    return processGroupArrayPath(
      group,
      definitions,
      resolvePath,
      getArrayLength,
      chainId,
      metadata,
      renderedValues,
      externalDataProvider,
    );
  }

  // Pattern 2: children have their own .[] paths
  return processChildArrayPaths(
    group,
    definitions,
    resolvePath,
    getArrayLength,
    chainId,
    metadata,
    renderedValues,
    externalDataProvider,
  );
}

/**
 * Pattern 1: Group iterates over a single array, children are relative paths.
 * E.g. PermitBatch: path="details.[]", children: amount, expiration, nonce.
 */
async function processGroupArrayPath(
  group: DescriptorFieldGroup,
  definitions: Record<string, DescriptorFieldFormat>,
  resolvePath: ResolvePath,
  getArrayLength: GetArrayLength,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  renderedValues: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  const basePath = parseGroupBasePath(group.path);
  const length = getArrayLength(basePath);

  if (length === 0) {
    return {
      group: {
        label: group.label,
        fields: [],
        warning: warn("EMPTY_ARRAY", `Array at '${basePath}' is empty`),
      },
    };
  }

  const allFields: DisplayField[] = [];
  for (let i = 0; i < length; i++) {
    const prefix = `${basePath}.[${i}]`;
    const scopedResolvePath: ResolvePath = (path: string) => {
      if (path.startsWith("@.") || path.startsWith("$.")) {
        return resolvePath(path);
      }
      const key = path.startsWith("#.") ? path.slice(2) : path;
      return resolvePath(`${prefix}.${key}`);
    };

    const result = await processFlatFields(
      group.fields ?? [],
      definitions,
      scopedResolvePath,
      chainId,
      metadata,
      renderedValues,
      externalDataProvider,
    );
    if ("warnings" in result) return result;

    allFields.push(...result.fields);
  }

  return { group: { label: group.label, fields: allFields } };
}

/**
 * Pattern 2: Children have their own .[] paths.
 * - Sequential (default): each child array is iterated fully before the next.
 * - Bundled: children are paired by index across parallel arrays.
 */
async function processChildArrayPaths(
  group: DescriptorFieldGroup,
  definitions: Record<string, DescriptorFieldFormat>,
  resolvePath: ResolvePath,
  getArrayLength: GetArrayLength,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  renderedValues: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  // Collect array lengths from children with .[] paths
  const childFields = group.fields ?? [];
  const arrayLengths: { path: string; length: number }[] = [];
  for (const child of childFields) {
    if (!isFieldGroup(child) && child.path?.includes(".[]")) {
      const childBasePath = parseGroupBasePath(child.path);
      arrayLengths.push({
        path: childBasePath,
        length: getArrayLength(childBasePath),
      });
    }
  }

  if (arrayLengths.length === 0 || arrayLengths.every((a) => a.length === 0)) {
    return {
      group: {
        label: group.label,
        fields: [],
        warning: warn("EMPTY_ARRAY", "All arrays in group are empty"),
      },
    };
  }

  const isBundled = group.iteration === "bundled";

  if (isBundled) {
    const lengths = arrayLengths.map((a) => a.length);
    const first = lengths[0];
    if (lengths.some((l) => l !== first)) {
      const detail = arrayLengths
        .map((a) => `${a.path}=${a.length}`)
        .join(", ");
      return {
        warnings: [
          warn(
            "BUNDLED_ARRAY_SIZE_MISMATCH",
            `Bundled arrays must have equal lengths: ${detail}`,
          ),
        ],
      };
    }

    // Bundled: pair children by index — a0[0] a1[0] a0[1] a1[1] ...
    const allFields: DisplayField[] = [];
    for (let i = 0; i < first; i++) {
      const indexedFields = childFields.map(
        (child): DescriptorFieldFormat | DescriptorFieldGroup => {
          if (isFieldGroup(child)) return child;
          if (child.path?.includes(".[]")) {
            return { ...child, path: child.path.replace(".[]", `.[${i}]`) };
          }
          return child;
        },
      );

      const result = await processFlatFields(
        indexedFields,
        definitions,
        resolvePath,
        chainId,
        metadata,
        renderedValues,
        externalDataProvider,
      );
      if ("warnings" in result) return result;

      allFields.push(...result.fields);
    }

    joinArrayValues(arrayLengths, renderedValues);
    return { group: { label: group.label, fields: allFields } };
  }

  // Sequential (default): iterate each child array fully — a0[0] a0[1] ... a1[0] a1[1] ...
  const allFields: DisplayField[] = [];
  for (const child of childFields) {
    if (isFieldGroup(child)) {
      return {
        warnings: [
          warn(
            "UNSUPPORTED_NESTED_FIELD_GROUP",
            "Nested field groups are not supported",
          ),
        ],
      };
    }

    if (child.path?.includes(".[]")) {
      const childBasePath = parseGroupBasePath(child.path);
      const len = getArrayLength(childBasePath);
      for (let i = 0; i < len; i++) {
        const indexed = {
          ...child,
          path: child.path.replace(".[]", `.[${i}]`),
        };
        const result = await processSingleField(
          indexed,
          definitions,
          resolvePath,
          chainId,
          metadata,
          renderedValues,
          externalDataProvider,
        );
        if ("warnings" in result) return result;
        if (result.field) allFields.push(result.field);
      }
    } else {
      const result = await processSingleField(
        child,
        definitions,
        resolvePath,
        chainId,
        metadata,
        renderedValues,
        externalDataProvider,
      );
      if ("warnings" in result) return result;
      if (result.field) allFields.push(result.field);
    }
  }

  joinArrayValues(arrayLengths, renderedValues);
  return { group: { label: group.label, fields: allFields } };
}

/**
 * Process a flat list of field specs (no groups allowed).
 * Used inside field groups where nesting is not supported.
 */
async function processFlatFields(
  fieldSpecs: (DescriptorFieldFormat | DescriptorFieldGroup)[],
  definitions: Record<string, DescriptorFieldFormat>,
  resolvePath: ResolvePath,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  renderedValues: Map<string, string>,
  externalDataProvider?: ExternalDataProvider,
): Promise<{ fields: DisplayField[] } | { warnings: Warning[] }> {
  const fields: DisplayField[] = [];

  for (const fieldSpec of fieldSpecs) {
    if (isFieldGroup(fieldSpec)) {
      return {
        warnings: [
          warn(
            "UNSUPPORTED_NESTED_FIELD_GROUP",
            "Nested field groups are not supported",
          ),
        ],
      };
    }
    const result = await processSingleField(
      fieldSpec,
      definitions,
      resolvePath,
      chainId,
      metadata,
      renderedValues,
      externalDataProvider,
    );
    if ("warnings" in result) return result;
    if (result.field) fields.push(result.field);
  }

  return { fields };
}

/**
 * For each array tracked in arrayLengths, join the rendered values of
 * individual elements (e.g. "recipients.[0]", "recipients.[1]") with " and "
 * and store the result under the base path (e.g. "recipients") in renderedValues.
 * This allows interpolateTemplate to resolve array placeholders directly.
 */
function joinArrayValues(
  arrayLengths: { path: string; length: number }[],
  renderedValues: Map<string, string>,
): void {
  for (const { path, length } of arrayLengths) {
    const parts: string[] = [];
    for (let i = 0; i < length; i++) {
      const v = renderedValues.get(`${path}.[${i}]`);
      if (v !== undefined) parts.push(v);
    }
    if (parts.length > 0) {
      renderedValues.set(`${path}.[]`, parts.join(" and "));
      renderedValues.set(path, parts.join(" and "));
    }
  }
}

/**
 * Parse a group path like "details.[]" into the base path "details".
 * Strips the trailing `.[]` selector.
 */
function parseGroupBasePath(path: string | undefined): string {
  if (!path) return "";
  if (path.endsWith(".[]")) return path.slice(0, -3);
  return path;
}

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

  const token =
    (await externalDataProvider?.resolveToken?.(chainId, tokenAddress)) ?? null;
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
  if (tryEns && externalDataProvider?.resolveEnsName) {
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
