/**
 * Builder entry point: input models and call building from ERC-7730
 * descriptors.
 *
 * This is the opposite direction of `format()`. A builder UI (e.g. a block
 * explorer) has a chain ID and a contract address. It gets one input model per
 * function, renders the inputs with the descriptor labels and formats, and
 * builds the calldata from the user input.
 *
 * @example
 * ```typescript
 * import {
 *   getCalldataInputModels,
 *   buildCalldata,
 * } from "@ethereum-sourcify/clear-signing/builder";
 *
 * const { models, warnings } = await getCalldataInputModels(1, address);
 * const result = buildCalldata(models[0], { to: "0x...", amount: 1000000n });
 * if ("errors" in result) showErrors(result.errors);
 * else sendTransaction({ to: address, data: result.data });
 * ```
 *
 * Lives in a separate entry point, so integrators that only format carry
 * none of this code. `index.ts` never imports this module.
 */

import { resolveCalldataDescriptor } from "./resolver.js";
import type { FunctionInput } from "./calldata.js";
import {
  isDynamicInput,
  functionFormats,
  parseArrayType,
  parseFunctionSignatureKey,
} from "./calldata.js";
import {
  isCalldataDescriptorBoundTo,
  isFieldGroup,
  mergeDefinitions,
  resolveMetadataValue,
  stripStructuredRootPrefix,
} from "./descriptor.js";
import { parseByteSlice } from "./fields.js";
import {
  bigIntToBytes,
  bytesToHex,
  concatBytes,
  hexToBytes,
  utf8ToBytes,
  warn,
} from "./utils.js";
import type {
  BuildInputError,
  BuildInputErrorCode,
  BuilderOptions,
  InputField,
  InputFieldGroup,
  InputModel,
  InputModels,
} from "./builder.types.js";
import type {
  Descriptor,
  DescriptorFieldFormat,
  DescriptorFieldFormatParams,
  DescriptorFieldGroup,
  DescriptorFormatSpec,
  DescriptorMetadata,
  Warning,
} from "./types.js";

export type * from "./builder.types.js";
export type {
  ChainClient,
  CustomResolverOptions,
  DescriptorFieldFormatParams,
  DescriptorFieldFormatType,
  DescriptorMapReference,
  GitHubResolverOptions,
  Warning,
  WarningCode,
} from "./types.js";

// ---------------------------------------------------------------------------
// Input models
// ---------------------------------------------------------------------------

/**
 * Resolves the calldata descriptor for `(chainId, to)` and returns one
 * {@link InputModel} per `display.formats` function.
 *
 * Descriptor resolution is the same as in `format()`: `trustedTokens` and the
 * attestation policy apply. `opts.chainClient` serves the attestation
 * revocation read. Never throws: failures are returned as `warnings`. A format
 * that fails (e.g. a broken `$ref`) adds its warning and gets no model.
 */
export async function getCalldataInputModels(
  chainId: number,
  to: string,
  opts?: BuilderOptions,
): Promise<InputModels> {
  try {
    let descriptor: Descriptor;
    try {
      const result = await resolveCalldataDescriptor(
        chainId,
        to,
        opts?.descriptorResolverOptions,
        opts?.chainClient,
      );
      if ("warning" in result) return { warnings: [result.warning] };
      descriptor = result.descriptor;
    } catch (error) {
      return { warnings: [fetchErrorWarning(chainId, to, error)] };
    }

    if (!isCalldataDescriptorBoundTo(descriptor, chainId, to)) {
      return {
        warnings: [
          warn(
            "DEPLOYMENT_MISMATCH",
            `Descriptor is not bound to chain ${chainId} and address ${to}`,
          ),
        ],
      };
    }

    const models: InputModel[] = [];
    const warnings: Warning[] = [];
    for (const fn of functionFormats(descriptor)) {
      const result = buildInputFields(
        fn.spec,
        descriptor.display?.definitions ?? {},
        descriptor.metadata,
        nameInputs(fn.inputs),
      );
      if ("warnings" in result) {
        warnings.push(...formatWarnings(fn.key, result.warnings));
        continue;
      }
      models.push({
        signature: fn.key,
        selector: bytesToHex(fn.selector),
        ...modelInfo(descriptor, fn.spec),
        fields: result.fields,
      });
    }
    if (models.length === 0 && warnings.length === 0) {
      warnings.push(
        warn(
          "NO_FORMAT_MATCH",
          `Descriptor for chain ${chainId} and address ${to} has no function format`,
        ),
      );
    }
    return inputModels(models, warnings);
  } catch (error) {
    return { warnings: [unexpectedErrorWarning(error)] };
  }
}

/**
 * Builds the input fields of one format spec: the descriptor fields in
 * display order, then the inputs that no field covers.
 *
 * @internal Exported for unit tests only.
 */
export function buildInputFields(
  spec: DescriptorFormatSpec,
  definitions: Record<string, DescriptorFieldFormat>,
  metadata: DescriptorMetadata | undefined,
  inputs: FunctionInput[],
): { fields: (InputField | InputFieldGroup)[] } | { warnings: Warning[] } {
  const ctx: FieldsContext = {
    definitions,
    metadata,
    inputs,
    covered: new Set(),
  };
  const fields: (InputField | InputFieldGroup)[] = [];

  for (const fieldSpec of spec.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
      const result = buildGroup(fieldSpec, ctx);
      if ("warnings" in result) return result;
      fields.push(result.group);
    } else {
      const result = buildField(fieldSpec, undefined, ctx);
      if ("warnings" in result) return result;
      if (result.field) fields.push(result.field);
    }
  }

  appendUncovered(inputs, "", ctx, fields);
  return { fields };
}

interface FieldsContext {
  definitions: Record<string, DescriptorFieldFormat>;
  metadata: DescriptorMetadata | undefined;
  inputs: FunctionInput[];
  /** Absolute input paths that a descriptor field covers. */
  covered: Set<string>;
}

function buildGroup(
  group: DescriptorFieldGroup,
  ctx: FieldsContext,
): { group: InputFieldGroup } | { warnings: Warning[] } {
  const prefix = groupPrefix(group);
  const fields: InputField[] = [];
  for (const child of group.fields ?? []) {
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
    const result = buildField(child, prefix, ctx);
    if ("warnings" in result) return result;
    if (result.field) fields.push(result.field);
  }
  return {
    group: {
      ...(group.label !== undefined && { label: group.label }),
      ...(group.path !== undefined && {
        path: stripStructuredRootPrefix(group.path),
      }),
      fields,
    },
  };
}

/**
 * The prefix of a group's child paths, by the same rules as `fields.ts`:
 * an array group (`details.[]`) and a struct group (`swapData`) scope their
 * children. A group whose children iterate their own arrays does not.
 */
function groupPrefix(group: DescriptorFieldGroup): string | undefined {
  if (!group.path) return undefined;
  const path = stripStructuredRootPrefix(group.path);
  if (path.endsWith(".[]")) return path;
  const hasArrayChildren = (group.fields ?? []).some(
    (child) => !isFieldGroup(child) && child.path?.includes(".[]"),
  );
  return hasArrayChildren ? undefined : path;
}

function buildField(
  fieldSpec: DescriptorFieldFormat,
  prefix: string | undefined,
  ctx: FieldsContext,
): { field: InputField | null } | { warnings: Warning[] } {
  const { merged, warnings } = mergeDefinitions(fieldSpec, ctx.definitions);
  if (warnings.length > 0) {
    return {
      warnings: warnings.map((msg) =>
        warn("DEFINITIONS_RESOLUTION_ERROR", msg),
      ),
    };
  }

  const display = {
    ...(merged.format !== undefined && { format: merged.format }),
    ...(merged.params !== undefined && {
      params: absoluteParams(merged.params, prefix),
    }),
    ...(merged.visible === "never" && { hidden: true }),
  };

  // A constant: a literal value, or a value from the descriptor metadata.
  if (merged.value !== undefined || merged.path?.startsWith("$.")) {
    const raw = merged.value !== undefined ? merged.value : merged.path;
    const constant =
      typeof raw === "string" && raw.startsWith("$.")
        ? resolveMetadataValue(ctx.metadata, raw)
        : raw;
    if (
      typeof constant !== "string" &&
      typeof constant !== "number" &&
      typeof constant !== "boolean"
    ) {
      return { field: null };
    }
    return {
      field: {
        label: merged.label ?? lastName(merged.path ?? ""),
        constant,
        ...display,
      },
    };
  }

  if (!merged.path) return { field: null };

  if (merged.path.startsWith("@.")) {
    // The transaction value is the only container input.
    if (merged.path !== "@.value") return { field: null };
    return {
      field: {
        label: merged.label ?? "value",
        path: "@.value",
        type: "uint256",
        ...display,
      },
    };
  }

  const path = absolutePath(merged.path, prefix);

  // A byte slice or a fixed index does not name a whole input. The input
  // stays uncovered and is appended.
  if (parseByteSlice(path) || hasFixedIndex(path)) return { field: null };

  // A path that names no input gets no field. Nothing is covered, so the
  // inputs it would reach are appended.
  const node = findInput(ctx.inputs, path);
  if (!node) return { field: null };

  // A descriptor can show one input in more than one way. The first field
  // of a path is the input.
  if (ctx.covered.has(path)) return { field: null };

  ctx.covered.add(path);
  return {
    field: {
      label: merged.label ?? lastName(path),
      path,
      type: inputType(node),
      ...display,
    },
  };
}

/** Strip `#.` and apply the group prefix to a structured data path. */
function absolutePath(path: string, prefix: string | undefined): string {
  const relative = stripStructuredRootPrefix(path);
  return prefix ? `${prefix}.${relative}` : relative;
}

/**
 * Make the path params absolute like the field path: every string param
 * whose key ends in `Path`, and the `keyPath` of every map reference.
 * Container (`@.`) and metadata (`$.`) paths stay as they are. Returns a copy.
 */
function absoluteParams(
  params: DescriptorFieldFormatParams,
  prefix: string | undefined,
): DescriptorFieldFormatParams {
  const isStructuredPath = (value: string) =>
    !value.startsWith("@.") && !value.startsWith("$.");
  const result: Record<string, unknown> = { ...params };
  for (const [key, value] of Object.entries(params)) {
    if (
      typeof value === "string" &&
      key.endsWith("Path") &&
      isStructuredPath(value)
    ) {
      result[key] = absolutePath(value, prefix);
    } else if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as { keyPath?: unknown }).keyPath === "string"
    ) {
      const keyPath = (value as { keyPath: string }).keyPath;
      if (isStructuredPath(keyPath)) {
        result[key] = { ...value, keyPath: absolutePath(keyPath, prefix) };
      }
    }
  }
  return result as DescriptorFieldFormatParams;
}

function hasFixedIndex(path: string): boolean {
  return path.split(".").some((segment) => /^\[-?\d+\]$/.test(segment));
}

/** The last name segment of a path, e.g. `amount` for `orders.[].amount`. */
function lastName(path: string): string {
  const segments = path.split(".").filter((s) => !s.startsWith("["));
  return segments[segments.length - 1] ?? "";
}

/** The element node of an array node, or undefined for a non-array node. */
function elementInput(node: FunctionInput): FunctionInput | undefined {
  const arr = parseArrayType(node.type);
  if (!arr) return undefined;
  return {
    name: node.name,
    type: arr.elementType,
    components: node.components,
  };
}

/** Find the input node that an absolute path names. */
function findInput(
  inputs: FunctionInput[],
  path: string,
): FunctionInput | undefined {
  let node: FunctionInput | undefined;
  let members: FunctionInput[] | undefined = inputs;
  for (const segment of path.split(".")) {
    if (segment === "[]") {
      node = node && elementInput(node);
      if (!node) return undefined;
    } else {
      node = members?.find((m) => m.name === segment);
      if (!node) return undefined;
    }
    members = parseArrayType(node.type) ? undefined : node.components;
  }
  return node;
}

/**
 * The type of an input for {@link InputField.type}. A tuple is spelled out
 * with its component names, e.g. `(address token,uint256 amount)[]`.
 */
function inputType(node: FunctionInput): string {
  if (!node.components || !node.type.startsWith("tuple")) return node.type;
  const members = node.components.map((c) => `${inputType(c)} ${c.name}`);
  return `(${members.join(",")})${node.type.slice("tuple".length)}`;
}

/**
 * Append the inputs that no covered path reaches. An input without a covered
 * path at, above or under it is appended whole. A partly covered tuple or
 * array is recursed, and only its uncovered parts are appended.
 */
function appendUncovered(
  inputs: FunctionInput[],
  prefix: string,
  ctx: FieldsContext,
  out: (InputField | InputFieldGroup)[],
): void {
  for (const input of inputs) {
    appendUncoveredInput(
      input,
      prefix ? `${prefix}.${input.name}` : input.name,
      ctx,
      out,
    );
  }
}

function appendUncoveredInput(
  input: FunctionInput,
  path: string,
  ctx: FieldsContext,
  out: (InputField | InputFieldGroup)[],
): void {
  let partly = false;
  for (const c of ctx.covered) {
    if (c === path || path.startsWith(`${c}.`)) return;
    if (c.startsWith(`${path}.`)) partly = true;
  }
  if (!partly) {
    out.push({ label: input.name, path, type: inputType(input) });
    return;
  }
  const element = elementInput(input);
  if (element) {
    appendUncoveredInput(element, `${path}.[]`, ctx, out);
    return;
  }
  if (input.components) appendUncovered(input.components, path, ctx, out);
}

/** Give each unnamed input the name `param<i>`, at every level. */
function nameInputs(inputs: FunctionInput[]): FunctionInput[] {
  return inputs.map((input, i) => ({
    ...input,
    name: input.name.trim() || `param${i}`,
    ...(input.components && { components: nameInputs(input.components) }),
  }));
}

function modelInfo(
  descriptor: Descriptor,
  spec: DescriptorFormatSpec,
): Pick<InputModel, "metadata" | "intent"> {
  const meta = descriptor.metadata;
  return {
    ...(meta && {
      metadata: {
        owner: meta.owner,
        contractName: meta.contractName,
        info: meta.info,
      },
    }),
    ...(spec.intent !== undefined && { intent: spec.intent }),
  };
}

function inputModels(models: InputModel[], warnings: Warning[]): InputModels {
  return {
    ...(models.length > 0 && { models }),
    ...(warnings.length > 0 && { warnings }),
  };
}

/** Name the format key in the warnings of a format that has no model. */
function formatWarnings(key: string, warnings: Warning[]): Warning[] {
  return warnings.map((w) =>
    warn(w.code, `Format '${key}' has no input model: ${w.message}`),
  );
}

function fetchErrorWarning(
  chainId: number,
  address: string,
  error: unknown,
): Warning {
  return warn(
    "DESCRIPTOR_FETCH_ERROR",
    `Failed to resolve descriptor for chain ${chainId} and address ${address}: ${String(error)}`,
  );
}

function unexpectedErrorWarning(error: unknown): Warning {
  return warn(
    "UNEXPECTED_LIB_ERROR",
    `Encountered an unexpected error in @ethereum-sourcify/clear-signing. Please report to the maintainers: ${String(error)}`,
  );
}

// ---------------------------------------------------------------------------
// Calldata building
// ---------------------------------------------------------------------------

/**
 * Builds the calldata of `model` from `values` (keyed like the function
 * arguments, see {@link InputField.path}). Values are raw: `bigint`, number,
 * or decimal / `0x` string for integers; hex string for `address`, `bytes`
 * and `bytesN`; boolean; string.
 *
 * Validates all values and returns every error, or the 0x-hex calldata
 * (selector and ABI-encoded arguments). Never throws.
 */
export function buildCalldata(
  model: InputModel,
  values: Record<string, unknown>,
): { data: string } | { errors: BuildInputError[] } {
  try {
    const parsed = parseFunctionSignatureKey(model.signature);
    if (!parsed) {
      return {
        errors: [
          buildError(
            "",
            "INVALID_SIGNATURE",
            `Cannot parse the function signature '${model.signature}'`,
          ),
        ],
      };
    }

    const inputs = nameInputs(parsed.inputs);
    const errors: BuildInputError[] = [];
    const normalized = normalizeMembers(inputs, values, "", errors);
    if (errors.length > 0 || !normalized) {
      return { errors: withFieldPaths(errors, model) };
    }

    return {
      data: bytesToHex(
        concatBytes(parsed.selector, encodeMembers(inputs, normalized)),
      ),
    };
  } catch (error) {
    return { errors: [unexpectedBuildError(error)] };
  }
}

/** Add to each error the path of the model field that takes the bad value. */
function withFieldPaths(
  errors: BuildInputError[],
  model: InputModel,
): BuildInputError[] {
  const fieldPaths = model.fields
    .flatMap((item) => ("fields" in item ? item.fields : [item]))
    .map((field) => field.path)
    .filter((path): path is string => path !== undefined);

  return errors.map((error) => {
    const fieldPath = findFieldPath(fieldPaths, error.path);
    return fieldPath === undefined ? error : { ...error, fieldPath };
  });
}

/**
 * Find the field path for a concrete error path. The exact field wins, then
 * the longest field that contains the path, then the first field inside it.
 */
function findFieldPath(
  fieldPaths: string[],
  errorPath: string,
): string | undefined {
  if (!errorPath) return undefined;
  const pattern = errorPath.replace(/\[\d+\]/g, "[]");
  if (fieldPaths.includes(pattern)) return pattern;

  const containing = fieldPaths
    .filter((path) => pattern.startsWith(`${path}.`))
    .sort((a, b) => b.length - a.length);
  if (containing.length > 0) return containing[0];

  return fieldPaths.find((path) => path.startsWith(`${pattern}.`));
}

function buildError(
  path: string,
  code: BuildInputErrorCode,
  message: string,
): BuildInputError {
  return { path, code, message };
}

function unexpectedBuildError(error: unknown): BuildInputError {
  return buildError(
    "",
    "INVALID_SIGNATURE",
    `Cannot build from this input model: ${String(error)}`,
  );
}

/** A validated value, ready for ABI encoding. */
type Normalized = bigint | boolean | Uint8Array | Normalized[];

function joinPath(path: string, segment: string): string {
  return path ? `${path}.${segment}` : segment;
}

/**
 * Validate the object `value` against `members`. Push every error. Return
 * the normalized member values in member order, or undefined on an error.
 */
function normalizeMembers(
  members: FunctionInput[],
  value: unknown,
  path: string,
  errors: BuildInputError[],
): Normalized[] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    errors.push(buildError(path, "INVALID_TYPE", "Value must be an object"));
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const result: Normalized[] = [];
  let valid = true;

  for (const member of members) {
    const normalized = normalizeEntry(
      member,
      Object.hasOwn(record, member.name) ? record[member.name] : undefined,
      joinPath(path, member.name),
      errors,
    );
    if (normalized === undefined) valid = false;
    else result.push(normalized);
  }

  for (const key of Object.keys(record)) {
    if (!members.some((m) => m.name === key)) {
      errors.push(
        buildError(joinPath(path, key), "UNKNOWN_FIELD", "Unknown field"),
      );
      valid = false;
    }
  }

  return valid ? result : undefined;
}

/** Validate one value of a member or array element. */
function normalizeEntry(
  input: FunctionInput,
  value: unknown,
  path: string,
  errors: BuildInputError[],
): Normalized | undefined {
  if (value === undefined || value === null) {
    errors.push(buildError(path, "MISSING_VALUE", "Value is required"));
    return undefined;
  }

  const element = elementInput(input);
  if (element) {
    if (!Array.isArray(value)) {
      errors.push(buildError(path, "INVALID_TYPE", "Value must be an array"));
      return undefined;
    }
    const size = parseArrayType(input.type)?.size;
    if (size !== undefined && value.length !== size) {
      errors.push(
        buildError(
          path,
          "INVALID_LENGTH",
          `Array must have ${size} element${size === 1 ? "" : "s"}`,
        ),
      );
      return undefined;
    }
    const result: Normalized[] = [];
    let valid = true;
    value.forEach((item, i) => {
      const normalized = normalizeEntry(
        element,
        item,
        `${path}.[${i}]`,
        errors,
      );
      if (normalized === undefined) valid = false;
      else result.push(normalized);
    });
    return valid ? result : undefined;
  }

  if (input.type === "tuple") {
    return normalizeMembers(input.components ?? [], value, path, errors);
  }

  const scalar = normalizeScalar(input.type, value);
  if ("code" in scalar) {
    errors.push(buildError(path, scalar.code, scalar.message));
    return undefined;
  }
  return scalar.value;
}

type ScalarResult =
  | { value: bigint | boolean | Uint8Array }
  | { code: BuildInputErrorCode; message: string };

/**
 * Validate an elementary value. Integers become `bigint`, `bool` a boolean,
 * and `address`, `bytes`, `bytesN` and `string` their bytes.
 */
function normalizeScalar(type: string, value: unknown): ScalarResult {
  const int = /^(u?)int(\d*)$/.exec(type);
  if (int) {
    const bits = int[2] ? Number(int[2]) : 256;
    if (bits < 8 || bits > 256 || bits % 8 !== 0) return unsupported(type);
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      return Number.isInteger(value)
        ? {
            code: "INVALID_TYPE",
            message: "Number is too large. Use a bigint or a string",
          }
        : { code: "INVALID_TYPE", message: "Value is not an integer" };
    }
    const n = toBigInt(value);
    if (n === undefined) {
      return { code: "INVALID_TYPE", message: "Value is not an integer" };
    }
    const signed = int[1] === "";
    const min = signed ? -(1n << BigInt(bits - 1)) : 0n;
    const max = signed
      ? (1n << BigInt(bits - 1)) - 1n
      : (1n << BigInt(bits)) - 1n;
    if (n < min || n > max) {
      return { code: "OUT_OF_RANGE", message: `Value does not fit ${type}` };
    }
    return { value: n };
  }

  switch (type) {
    case "bool":
      return typeof value === "boolean"
        ? { value }
        : { code: "INVALID_TYPE", message: "Value is not a boolean" };
    case "string":
      return typeof value === "string"
        ? { value: utf8ToBytes(value) }
        : { code: "INVALID_TYPE", message: "Value is not a string" };
    case "address": {
      const bytes = parseHex(value);
      if (!bytes) {
        return { code: "INVALID_TYPE", message: "Value is not a hex address" };
      }
      return bytes.length === 20
        ? { value: bytes }
        : { code: "INVALID_LENGTH", message: "Address must be 20 bytes" };
    }
    case "bytes": {
      const bytes = parseHex(value);
      return bytes
        ? { value: bytes }
        : { code: "INVALID_TYPE", message: "Value is not hex" };
    }
  }

  const fixedBytes = /^bytes(\d+)$/.exec(type);
  if (fixedBytes) {
    const size = Number(fixedBytes[1]);
    if (size < 1 || size > 32) return unsupported(type);
    const bytes = parseHex(value);
    if (!bytes) return { code: "INVALID_TYPE", message: "Value is not hex" };
    return bytes.length === size
      ? { value: bytes }
      : {
          code: "INVALID_LENGTH",
          message: `Value must be ${size} byte${size === 1 ? "" : "s"}`,
        };
  }

  return unsupported(type);
}

function unsupported(type: string): ScalarResult {
  return { code: "INVALID_SIGNATURE", message: `Unsupported type '${type}'` };
}

/** Parse a bigint, a safe integer number, or a decimal / 0x-hex string. */
function toBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value !== "string") return undefined;
  if (/^-?\d+$/.test(value) || /^0x[0-9a-fA-F]+$/.test(value)) {
    return BigInt(value);
  }
  return undefined;
}

/** Parse a 0x-prefixed, even-length hex string. */
function parseHex(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(value)) {
    return undefined;
  }
  return hexToBytes(value);
}

// ---------------------------------------------------------------------------
// ABI encoder
// ---------------------------------------------------------------------------

/** ABI-encode a sequence of values with head / tail encoding. */
function encodeMembers(
  inputs: FunctionInput[],
  values: Normalized[],
): Uint8Array {
  const encoded = inputs.map((input, i) => encodeValue(input, values[i]));
  const dynamic = inputs.map(isDynamicInput);
  let offset = encoded.reduce(
    (sum, bytes, i) => sum + (dynamic[i] ? 32 : bytes.length),
    0,
  );

  const heads: Uint8Array[] = [];
  const tails: Uint8Array[] = [];
  encoded.forEach((bytes, i) => {
    if (dynamic[i]) {
      heads.push(bigIntToBytes(BigInt(offset)));
      tails.push(bytes);
      offset += bytes.length;
    } else {
      heads.push(bytes);
    }
  });
  return concatBytes(...heads, ...tails);
}

function encodeValue(input: FunctionInput, value: Normalized): Uint8Array {
  const element = elementInput(input);
  if (element) {
    const items = value as Normalized[];
    const body = encodeMembers(
      items.map(() => element),
      items,
    );
    return parseArrayType(input.type)?.size === undefined
      ? concatBytes(bigIntToBytes(BigInt(items.length)), body)
      : body;
  }

  if (input.type === "tuple") {
    return encodeMembers(input.components ?? [], value as Normalized[]);
  }

  if (input.type === "bytes" || input.type === "string") {
    const bytes = value as Uint8Array;
    return concatBytes(bigIntToBytes(BigInt(bytes.length)), padRight(bytes));
  }

  if (typeof value === "bigint") return bigIntToBytes(value);
  if (typeof value === "boolean") return bigIntToBytes(value ? 1n : 0n);

  const bytes = value as Uint8Array;
  if (input.type === "address") {
    return concatBytes(new Uint8Array(12), bytes);
  }
  // bytesN: left-aligned in one word.
  return padRight(bytes);
}

/** Right-pad bytes with zeros to a multiple of 32 bytes. */
function padRight(bytes: Uint8Array): Uint8Array {
  const padding = (32 - (bytes.length % 32)) % 32;
  return concatBytes(bytes, new Uint8Array(padding));
}
