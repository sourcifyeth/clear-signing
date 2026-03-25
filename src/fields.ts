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
  Warning,
} from "./types";
import type { ResolvePath } from "./descriptor";
import {
  isFieldGroup,
  mergeDefinitions,
  resolveFieldValue,
} from "./descriptor";
import { toChecksumAddress, warn } from "./utils";
import { renderField } from "./formatters";

/** Callback to get the length of an array at a given container path. */
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
