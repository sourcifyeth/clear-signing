/**
 * Field processing pipeline: iterates format fields, merges definitions,
 * resolves values, renders each field, and builds DisplayField arrays.
 *
 * Used by both calldata and EIP-712 engines via applyFieldFormats().
 */

import type {
  DescriptorFieldFormat,
  DescriptorFieldGroup,
  DescriptorFormatSpec,
  DescriptorMetadata,
  DisplayField,
  DisplayFieldGroup,
  ExternalDataProvider,
  FieldType,
  FormatCalldata,
  Warning,
} from "./types";
import type {
  ArgumentValue,
  BaseResolvePath,
  BytesSliceValue,
  ResolvePath,
} from "./descriptor";
import {
  argumentValueToBytes,
  bytesToAddressArgumentValue,
  fieldTypeForFormat,
  isFieldGroup,
  mergeDefinitions,
  resolveFieldValue,
} from "./descriptor";
import type { DescriptorFieldFormatType } from "./types";
import {
  bytesToAscii,
  bytesToSignedBigInt,
  bytesToUnsignedBigInt,
  warn,
} from "./utils";
import { renderField } from "./formatters";

/** Callback to get the length of an array at a given container path. */
export type GetArrayLength = (path: string) => number;

/** Shared context threaded through all internal processing functions. */
interface FieldContext {
  definitions: Record<string, DescriptorFieldFormat>;
  resolvePath: ResolvePath;
  getArrayLength: GetArrayLength;
  chainId: number | undefined;
  metadata: DescriptorMetadata | undefined;
  renderedValues: Map<string, string>;
  externalDataProvider?: ExternalDataProvider;
  formatEmbeddedCalldata?: FormatCalldata;
}

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
  resolvePath: BaseResolvePath,
  getArrayLength: GetArrayLength,
  chainId: number | undefined,
  metadata: DescriptorMetadata | undefined,
  externalDataProvider?: ExternalDataProvider,
  formatEmbeddedCalldata?: FormatCalldata,
): Promise<
  | {
      fields: (DisplayField | DisplayFieldGroup)[];
      renderedValues: Map<string, string>;
    }
  | { warnings: Warning[] }
> {
  const renderedValues = new Map<string, string>();
  const sliceResolvePath = buildSliceResolvePath(resolvePath);
  const ctx: FieldContext = {
    definitions,
    resolvePath: sliceResolvePath,
    getArrayLength,
    chainId,
    metadata,
    renderedValues,
    externalDataProvider,
    formatEmbeddedCalldata,
  };

  const fields: (DisplayField | DisplayFieldGroup)[] = [];

  for (const fieldSpec of format.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
      const groupResult = await processFieldGroup(fieldSpec, ctx);
      if ("warnings" in groupResult) return groupResult;
      fields.push(groupResult.group);
      continue;
    }

    const result = await processSingleField(fieldSpec, ctx);
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
  ctx: FieldContext,
): Promise<{ field: DisplayField | null } | { warnings: Warning[] }> {
  const { merged, warnings: defWarnings } = mergeDefinitions(
    fieldSpec,
    ctx.definitions,
  );
  if (defWarnings.length > 0) {
    return {
      warnings: defWarnings.map((msg) =>
        warn("DEFINITIONS_RESOLUTION_ERROR", msg),
      ),
    };
  }

  if (merged.visible === "never") return { field: null };

  const resolvedValue = resolveFieldValue(merged, ctx.resolvePath);
  if (!resolvedValue) {
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

  // Convert bytes-slice to a typed ArgumentValue based on the field format
  const argValue: ArgumentValue =
    resolvedValue.type === "bytes-slice"
      ? bytesSliceToArgumentValue(resolvedValue, merged.format)
      : resolvedValue;

  const {
    rendered,
    calldataDisplay,
    warning: fieldWarning,
    tokenAddress,
    rawAddress,
  } = await renderField(
    argValue,
    merged.format,
    merged,
    ctx.resolvePath,
    ctx.chainId,
    ctx.metadata,
    ctx.externalDataProvider,
    ctx.formatEmbeddedCalldata,
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

  if (rawAddress) {
    displayField.rawAddress = rawAddress;
  }

  if (tokenAddress) {
    displayField.tokenAddress = tokenAddress;
  }

  if (calldataDisplay) {
    displayField.calldataDisplay = calldataDisplay;
  }

  if (merged.path) ctx.renderedValues.set(merged.path, finalValue);
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
  ctx: FieldContext,
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  if (group.path?.endsWith(".[]")) {
    return processGroupArrayPath(group, ctx);
  }
  return processChildArrayPaths(group, ctx);
}

/**
 * Pattern 1: Group iterates over a single array, children are relative paths.
 * E.g. PermitBatch: path="details.[]", children: amount, expiration, nonce.
 */
async function processGroupArrayPath(
  group: DescriptorFieldGroup,
  ctx: FieldContext,
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  const basePath = parseGroupBasePath(group.path);
  const length = ctx.getArrayLength(basePath);

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
        return ctx.resolvePath(path);
      }
      const key = path.startsWith("#.") ? path.slice(2) : path;
      return ctx.resolvePath(`${prefix}.${key}`);
    };

    const result = await processFlatFields(group.fields ?? [], {
      ...ctx,
      resolvePath: scopedResolvePath,
    });
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
  ctx: FieldContext,
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  const childFields = group.fields ?? [];
  const arrayLengths: { path: string; length: number }[] = [];
  for (const child of childFields) {
    if (!isFieldGroup(child) && child.path?.includes(".[]")) {
      const childBasePath = parseGroupBasePath(child.path);
      arrayLengths.push({
        path: childBasePath,
        length: ctx.getArrayLength(childBasePath),
      });
    }
  }

  // Per ERC-7730: when a field param references an array path, it must have
  // the same length as the field's own array path.
  const paramMismatch = checkParamArrayLengths(childFields, arrayLengths, ctx);
  if (paramMismatch) return { warnings: [paramMismatch] };

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
      const result = await processFlatFields(
        expandArrayIndex(childFields, i),
        ctx,
      );
      if ("warnings" in result) return result;
      allFields.push(...result.fields);
    }

    joinArrayValues(arrayLengths, ctx.renderedValues);
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
      const len = ctx.getArrayLength(childBasePath);
      for (let i = 0; i < len; i++) {
        const indexed = {
          ...child,
          path: child.path.replace(".[]", `.[${i}]`),
        };
        const result = await processSingleField(indexed, ctx);
        if ("warnings" in result) return result;
        if (result.field) allFields.push(result.field);
      }
    } else {
      const result = await processSingleField(child, ctx);
      if ("warnings" in result) return result;
      if (result.field) allFields.push(result.field);
    }
  }

  joinArrayValues(arrayLengths, ctx.renderedValues);
  return { group: { label: group.label, fields: allFields } };
}

/**
 * Process a flat list of field specs (no groups allowed).
 * Used inside field groups where nesting is not supported.
 */
async function processFlatFields(
  fieldSpecs: (DescriptorFieldFormat | DescriptorFieldGroup)[],
  ctx: FieldContext,
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
    const result = await processSingleField(fieldSpec, ctx);
    if ("warnings" in result) return result;
    if (result.field) fields.push(result.field);
  }

  return { fields };
}

/**
 * Replace .[] with .[index] in child field paths for a given iteration index.
 */
function expandArrayIndex(
  childFields: (DescriptorFieldFormat | DescriptorFieldGroup)[],
  index: number,
): (DescriptorFieldFormat | DescriptorFieldGroup)[] {
  return childFields.map((child) => {
    if (isFieldGroup(child)) return child;
    if (child.path?.includes(".[]")) {
      return { ...child, path: child.path.replace(".[]", `.[${index}]`) };
    }
    return child;
  });
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
 * Check that parameter array paths referenced by child fields have the same
 * length as the field's own array path. Per ERC-7730, parameter arrays must
 * match the formatted array length.
 */
function checkParamArrayLengths(
  childFields: (DescriptorFieldFormat | DescriptorFieldGroup)[],
  fieldArrayLengths: { path: string; length: number }[],
  ctx: FieldContext,
): Warning | undefined {
  for (const child of childFields) {
    if (isFieldGroup(child) || !child.path?.includes(".[]")) continue;
    const childBasePath = parseGroupBasePath(child.path);
    const fieldLength = fieldArrayLengths.find(
      (a) => a.path === childBasePath,
    )?.length;
    if (fieldLength === undefined) continue;

    const params = child.params ?? {};
    for (const paramValue of Object.values(params)) {
      if (typeof paramValue !== "string" || !paramValue.includes(".[]"))
        continue;
      const paramBasePath = parseGroupBasePath(paramValue);
      const paramLength = ctx.getArrayLength(paramBasePath);
      if (paramLength > 0 && paramLength !== fieldLength) {
        return warn(
          "PARAM_ARRAY_SIZE_MISMATCH",
          `Parameter array '${paramBasePath}' has length ${paramLength} but field array '${childBasePath}' has length ${fieldLength}`,
        );
      }
    }
  }
  return undefined;
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

// ---------------------------------------------------------------------------
// Byte Slice Support
// ---------------------------------------------------------------------------

/** Parsed byte range from a path like "foo.[-20:]" or "bar.[0:20]". */
export interface ByteSlice {
  start?: number;
  end?: number;
}

/**
 * Parse a byte range slice from the end of a path.
 * Byte ranges contain a colon: .[start:end], .[-20:], .[:1], .[292:324].
 * Single array indices like .[0] or .[-1] are NOT byte slices (no colon).
 * Returns null if no byte slice is found.
 */
export function parseByteSlice(
  path: string,
): { basePath: string; slice: ByteSlice } | null {
  const match = path.match(/^(.+)\.\[(-?\d*):(-?\d*)\]$/);
  if (!match) return null;
  return {
    basePath: match[1],
    slice: {
      start: match[2].length > 0 ? parseInt(match[2], 10) : undefined,
      end: match[3].length > 0 ? parseInt(match[3], 10) : undefined,
    },
  };
}

/**
 * Apply a byte slice and return the raw sliced bytes.
 */
export function applyByteSlice(
  rawBytes: Uint8Array,
  slice: ByteSlice,
): Uint8Array {
  const len = rawBytes.length;
  let start = slice.start ?? 0;
  let end = slice.end ?? len;
  if (start < 0) start = Math.max(0, len + start);
  if (end < 0) end = Math.max(0, len + end);
  start = Math.min(start, len);
  end = Math.min(end, len);
  if (start >= end) return new Uint8Array(0);
  return rawBytes.slice(start, end);
}

/**
 * Build a slice-aware ResolvePath from a BaseResolvePath.
 * Paths with byte slice notation (e.g. "srcToken.[-20:]") are resolved by
 * fetching the base value and returning a BytesSliceValue with the raw bytes.
 */
export function buildSliceResolvePath(resolve: BaseResolvePath): ResolvePath {
  return (path: string) => {
    const parsed = parseByteSlice(path);
    if (!parsed) return resolve(path);
    const baseValue = resolve(parsed.basePath);
    if (!baseValue) return undefined;
    const rawBytes = argumentValueToBytes(baseValue);
    const sliced = applyByteSlice(rawBytes, parsed.slice);
    return { type: "bytes-slice", bytes: sliced } as BytesSliceValue;
  };
}

/**
 * Convert raw slice bytes to an ArgumentValue for a given FieldType.
 */
export function bytesSliceToFieldType(
  bytes: Uint8Array,
  fieldType: FieldType,
): ArgumentValue {
  switch (fieldType) {
    case "address":
      // Try to parse as address, but fall back to bytes if it doesn't fit
      return bytesToAddressArgumentValue(bytes) ?? { type: "bytes", bytes };
    case "uint":
      return { type: "uint", value: bytesToUnsignedBigInt(bytes) };
    case "int":
      return { type: "int", value: bytesToSignedBigInt(bytes) };
    case "bool":
      return {
        type: "bool",
        value: bytes.length > 0 && bytes[bytes.length - 1] !== 0,
      };
    case "string":
      return { type: "string", value: bytesToAscii(bytes) };
    case "bytes":
    default:
      return { type: "bytes", bytes };
  }
}

/**
 * Convert a BytesSliceValue to an ArgumentValue based on the field format's
 * expected type. Uses the ERC-7730 format→type mapping to determine how to
 * interpret the raw slice bytes.
 */
export function bytesSliceToArgumentValue(
  slice: BytesSliceValue,
  format: DescriptorFieldFormatType,
): ArgumentValue {
  const fieldType = fieldTypeForFormat(format);
  return bytesSliceToFieldType(slice.bytes, fieldType);
}
