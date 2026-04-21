/**
 * Calldata decoding and formatting for clear signing.
 */

import type {
  Descriptor,
  DescriptorFormatSpec,
  DisplayModel,
  ExternalDataProvider,
  RawCalldataFallback,
  Transaction,
  Warning,
} from "./types";
import type { ArgumentValue, BaseResolvePath } from "./descriptor";
import {
  interpolateTemplate,
  isCalldataDescriptorBoundTo,
  resolveMetadataValue,
  resolveTransactionPath,
  toArgumentValue,
} from "./descriptor";
import {
  bytesToAscii,
  bytesToUnsignedBigInt,
  bytesToHex,
  bytesToSignedBigInt,
  extractSelector,
  formatSelectorHex,
  hexToBytes,
  selectorForSignature,
  warn,
} from "./utils";
import { applyFieldFormats } from "./fields";

/**
 * Decodes calldata using a resolved descriptor and returns a human-readable
 * DisplayModel using the new design types.
 */
export async function formatCalldata(
  tx: Transaction,
  descriptor: Descriptor,
  externalDataProvider?: ExternalDataProvider,
): Promise<DisplayModel> {
  const calldata = hexToBytes(tx.data);
  const selector = extractSelector(calldata);

  if (!isCalldataDescriptorBoundTo(descriptor, tx.chainId, tx.to)) {
    return {
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
      warnings: [
        warn(
          "DEPLOYMENT_MISMATCH",
          `Descriptor is not bound to chain ${tx.chainId} and address ${tx.to}`,
        ),
      ],
    };
  }

  const formatsBySelector = getFormatsBySelector(descriptor);
  const selectorHex = formatSelectorHex(selector);
  const match = formatsBySelector.get(selectorHex);

  if (!match) {
    return {
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
      warnings: [
        warn("NO_FORMAT_MATCH", `No format match for selector ${selectorHex}`),
      ],
    };
  }

  const { fn, spec: format } = match;
  const decoded = decodeArguments(fn, calldata);

  const resolvePath: BaseResolvePath = (path: string) => {
    if (path.startsWith("@.")) return resolveTransactionPath(path, tx);
    if (path.startsWith("$."))
      return toArgumentValue(resolveMetadataValue(descriptor.metadata, path));
    const key = path.startsWith("#.") ? path.slice(2) : path;
    return decoded.get(key);
  };

  const definitions = descriptor.display?.definitions ?? {};
  const result = await applyFieldFormats(
    format,
    definitions,
    resolvePath,
    (path: string) => decoded.getArrayLength(path),
    tx.chainId,
    descriptor.metadata,
    externalDataProvider,
  );

  if ("warnings" in result) {
    return {
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
      warnings: result.warnings,
    };
  }

  const warnings: Warning[] = [];
  let interpolatedIntent: string | undefined;
  if (format.interpolatedIntent) {
    try {
      interpolatedIntent = interpolateTemplate(
        format.interpolatedIntent,
        result.renderedValues,
      );
    } catch (e) {
      warnings.push(warn("INTERPOLATION_ERROR", (e as Error).message));
    }
  }

  const meta = descriptor.metadata;
  return {
    intent: format.intent,
    interpolatedIntent,
    fields: result.fields,
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

export function rawPreviewFromCalldata(
  selector: Uint8Array,
  calldata: Uint8Array,
): RawCalldataFallback {
  const args: string[] = [];
  if (calldata.length > 4) {
    const data = calldata.slice(4);
    for (let i = 0; i < data.length; i += 32) {
      const chunk = data.slice(i, Math.min(i + 32, data.length));
      args.push(bytesToHex(chunk).slice(2));
    }
  }

  return {
    selector: formatSelectorHex(selector),
    args,
  };
}

/**
 * Build a map from hex selector (e.g. "0x095ea7b3") to the parsed function descriptor
 * and its display format spec. Parses display.formats keys as function signatures —
 * no separate ABI needed.
 */
function getFormatsBySelector(
  descriptor: Descriptor,
): Map<string, { fn: ParsedFunctionSignature; spec: DescriptorFormatSpec }> {
  const map = new Map<
    string,
    { fn: ParsedFunctionSignature; spec: DescriptorFormatSpec }
  >();
  const formats = descriptor.display?.formats;
  if (!formats) return map;

  for (const [key, spec] of Object.entries(formats)) {
    const fn = parseFunctionSignatureKey(key);
    if (!fn) continue;
    map.set(bytesToHex(fn.selector), { fn, spec });
  }
  return map;
}

/** ABI function input parameter. */
interface FunctionInput {
  name: string;
  type: string;
  components?: FunctionInput[];
}

/** Parsed function signature with computed selector. */
interface ParsedFunctionSignature {
  inputs: FunctionInput[];
  selector: Uint8Array;
}

/**
 * Parse a display.formats key as a full function signature into a ParsedFunctionSignature.
 *
 * Per ERC-7730, keys MUST include parameter names and use canonical Solidity types.
 * Commas MUST NOT be followed by spaces; exactly one space between type and name.
 *
 * Examples:
 *   "deposit()"
 *   "approve(address spender,uint256 value)"
 *   "submitOrder((address token,uint256 amount) order,bytes32 salt)"
 */
function parseFunctionSignatureKey(
  key: string,
): ParsedFunctionSignature | undefined {
  const openParen = key.indexOf("(");
  if (openParen === -1) return undefined;

  const fnName = key.slice(0, openParen).trim();
  if (!fnName) return undefined;

  // Find the matching closing paren for the top-level param list
  const afterOpen = key.slice(openParen + 1);
  const closeIdx = findMatchingClose(afterOpen, 0);
  if (closeIdx === -1) return undefined;

  const paramsStr = afterOpen.slice(0, closeIdx);
  const inputs = parseParamList(paramsStr);

  const canonical = `${fnName}(${canonicalParamList(inputs)})`;
  const selector = selectorForSignature(canonical);

  return { inputs, selector };
}

/** Find the index of the closing ')' that matches the opening '(' at depth 0. */
function findMatchingClose(s: string, startDepth: number): number {
  let depth = startDepth;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Split a top-level parameter list string by commas, respecting nested parens. */
function splitTopLevel(paramsStr: string): string[] {
  if (paramsStr.trim() === "") return [];
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of paramsStr) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseParamList(paramsStr: string): FunctionInput[] {
  return splitTopLevel(paramsStr).map(parseParam);
}

/**
 * Parse a single parameter string like:
 *   "address"            → {type:"address", name:""}
 *   "address spender"    → {type:"address", name:"spender"}
 *   "uint256[]"          → {type:"uint256[]", name:""}
 *   "(address src,uint256 amt) desc"  → {type:"tuple", name:"desc", components:[...]}
 *   "(address src,uint256 amt)[] orders" → {type:"tuple[]", name:"orders", components:[...]}
 */
function parseParam(param: string): FunctionInput {
  param = param.trim();

  if (param.startsWith("(")) {
    // Tuple: find matching close, then check for array suffix and optional name
    const closeIdx = findMatchingClose(param.slice(1), 0);
    if (closeIdx === -1) return { name: "", type: "tuple" };

    const inner = param.slice(1, closeIdx + 1);
    const components = parseParamList(inner);

    const rest = param.slice(closeIdx + 2).trim(); // after ")"
    const { arraySuffix, name } = extractSuffixAndName(rest);

    return { type: `tuple${arraySuffix}`, name, components };
  }

  // Non-tuple: "type" or "type name" or "type[] name"
  const { arraySuffix, base, name } = extractBaseArrayName(param);
  return { type: `${base}${arraySuffix}`, name };
}

/**
 * From a string like "[] orders" or "orders" or "" extract array suffix and name.
 * Used after the closing ) of a tuple.
 */
function extractSuffixAndName(rest: string): {
  arraySuffix: string;
  name: string;
} {
  // Collect leading array brackets: [], [3], etc.
  let arraySuffix = "";
  let i = 0;
  while (i < rest.length && rest[i] === "[") {
    const closeB = rest.indexOf("]", i);
    if (closeB === -1) break;
    arraySuffix += rest.slice(i, closeB + 1);
    i = closeB + 1;
  }
  const name = rest.slice(i).trim();
  return { arraySuffix, name };
}

/**
 * From a non-tuple param string like "address", "address spender", "uint256[]",
 * "uint256[] values" — extract base type, array suffix, and name.
 */
function extractBaseArrayName(param: string): {
  base: string;
  arraySuffix: string;
  name: string;
} {
  // Split by whitespace
  const parts = param.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { base: "", arraySuffix: "", name: "" };

  // Check if last token could be an identifier name (purely alphanumeric/underscore, not a type)
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join("");

  const looksLikeName = /^[a-zA-Z_]\w*$/.test(last) && parts.length > 1;

  const typeStr = looksLikeName ? rest : parts.join("");
  const name = looksLikeName ? last : "";

  // Separate base type from trailing array suffixes like "[]", "[3]"
  const arrayMatch = typeStr.match(/^(.*?)(\[[\d,\s]*\](?:\[[\d,\s]*\])*)$/);
  if (arrayMatch) {
    return { base: arrayMatch[1], arraySuffix: arrayMatch[2], name };
  }
  return { base: typeStr, arraySuffix: "", name };
}

/** Build canonical (selector-compatible) param list — types only, no names. */
function canonicalParamList(inputs: FunctionInput[]): string {
  return inputs.map(canonicalParam).join(",");
}

function canonicalParam(input: FunctionInput): string {
  if (input.type.startsWith("tuple")) {
    const suffix = input.type.slice(5); // array suffix after "tuple", e.g. "[]"
    return `(${canonicalParamList(input.components ?? [])})${suffix}`;
  }
  return input.type;
}

/** Decoded argument value. */
interface DecodedArgument {
  index: number;
  name?: string;
  value: ArgumentValue;
}

/**
 * Collection of decoded arguments with name-based lookup.
 */
class DecodedArguments {
  private ordered: DecodedArgument[] = [];
  private indexByName = new Map<string, number>();
  private arrayLengths = new Map<string, number>();

  push(name: string | undefined, index: number, value: ArgumentValue): void {
    const entryIndex = this.ordered.length;
    if (name !== undefined) {
      this.indexByName.set(name, entryIndex);
    }
    this.indexByName.set(`arg${index}`, entryIndex);
    this.ordered.push({ index, name, value });
  }

  setArrayLength(name: string, length: number): void {
    this.arrayLengths.set(name, length);
  }

  getArrayLength(name: string): number {
    return this.arrayLengths.get(name) ?? 0;
  }

  get(key: string): ArgumentValue | undefined {
    const idx = this.indexByName.get(key);
    if (idx === undefined) return undefined;
    return this.ordered[idx]?.value;
  }

  getOrdered(): DecodedArgument[] {
    return this.ordered;
  }
}

/**
 * Check if a function input type requires dynamic (offset-based) ABI encoding.
 */
function isDynamicInput(input: FunctionInput): boolean {
  if (input.type === "bytes" || input.type === "string") return true;
  if (input.type.endsWith("[]")) return true;
  if (input.type.startsWith("tuple") && input.components) {
    return input.components.some(isDynamicInput);
  }
  return false;
}

/** Calculate the inline head size in bytes for a static input. */
function staticHeadSize(input: FunctionInput): number {
  if (
    input.type === "tuple" &&
    input.components &&
    input.components.length > 0
  ) {
    return input.components.reduce((sum, c) => sum + staticHeadSize(c), 0);
  }
  return 32;
}

/**
 * Decode calldata arguments according to function descriptor.
 * Supports static types, static/dynamic tuples, dynamic arrays (including
 * tuple[]), and bytes/string dynamic types.
 */
function decodeArguments(
  fn: ParsedFunctionSignature,
  calldata: Uint8Array,
): DecodedArguments {
  const headSize = fn.inputs.reduce((sum, input) => {
    return sum + (isDynamicInput(input) ? 32 : staticHeadSize(input));
  }, 0);

  if (calldata.length < 4 + headSize) {
    throw new Error(
      `calldata length ${calldata.length} too small (expected at least ${4 + headSize} bytes)`,
    );
  }

  const decoded = new DecodedArguments();
  // Skip the 4-byte selector; offsets in data are relative to params start.
  const data = calldata.slice(4);
  decodeTuple(fn.inputs, data, 0, undefined, decoded);
  return decoded;
}

/**
 * Decode a sequence of ABI-encoded inputs using head-tail encoding.
 * Each dynamic input has an offset word in the head pointing to tail data.
 * Each static input is encoded inline in the head.
 */
function decodeTuple(
  inputs: FunctionInput[],
  data: Uint8Array,
  baseOffset: number,
  prefix: string | undefined,
  decoded: DecodedArguments,
): void {
  let headCursor = baseOffset;

  for (const input of inputs) {
    if (isDynamicInput(input)) {
      const relOffset = Number(
        bytesToUnsignedBigInt(data.slice(headCursor, headCursor + 32)),
      );
      decodeDynamicInput(input, data, baseOffset + relOffset, prefix, decoded);
      headCursor += 32;
    } else {
      headCursor = decodeStaticInput(input, data, headCursor, prefix, decoded);
    }
  }
}

/**
 * Decode a static input (basic type or all-static tuple) at the given position.
 * Returns the cursor position after the decoded data.
 */
function decodeStaticInput(
  input: FunctionInput,
  data: Uint8Array,
  cursor: number,
  prefix: string | undefined,
  decoded: DecodedArguments,
): number {
  if (
    input.type === "tuple" &&
    input.components &&
    input.components.length > 0
  ) {
    const tuplePrefix = argumentName(prefix, input);
    let pos = cursor;
    for (const component of input.components) {
      pos = decodeStaticInput(component, data, pos, tuplePrefix, decoded);
    }
    return pos;
  }

  const value = decodeWord(input.type, data.slice(cursor, cursor + 32));
  const name = argumentName(prefix, input);
  decoded.push(name, decoded.getOrdered().length, value);
  return cursor + 32;
}

/**
 * Decode a dynamic input (bytes, string, dynamic array, or dynamic tuple)
 * at the given data offset.
 */
function decodeDynamicInput(
  input: FunctionInput,
  data: Uint8Array,
  dataStart: number,
  prefix: string | undefined,
  decoded: DecodedArguments,
): void {
  const name = argumentName(prefix, input);

  // bytes or string: length word + raw content
  if (input.type === "bytes" || input.type === "string") {
    const length = Number(
      bytesToUnsignedBigInt(data.slice(dataStart, dataStart + 32)),
    );
    const content = data.slice(dataStart + 32, dataStart + 32 + length);
    const value: ArgumentValue =
      input.type === "string"
        ? { type: "string", value: bytesToAscii(content) }
        : { type: "bytes", bytes: content };
    decoded.push(name, decoded.getOrdered().length, value);
    return;
  }

  // Dynamic array (type[], including tuple[])
  if (input.type.endsWith("[]")) {
    const length = Number(
      bytesToUnsignedBigInt(data.slice(dataStart, dataStart + 32)),
    );
    if (name) decoded.setArrayLength(name, length);

    if (
      input.type === "tuple[]" &&
      input.components &&
      input.components.length > 0
    ) {
      const elementsStart = dataStart + 32;

      if (input.components.some(isDynamicInput)) {
        // Dynamic tuple elements: each has an offset word
        for (let i = 0; i < length; i++) {
          const elemOffset = Number(
            bytesToUnsignedBigInt(
              data.slice(elementsStart + i * 32, elementsStart + (i + 1) * 32),
            ),
          );
          const elemPrefix = name ? `${name}.[${i}]` : undefined;
          decodeTuple(
            input.components,
            data,
            elementsStart + elemOffset,
            elemPrefix,
            decoded,
          );
        }
      } else {
        // Static tuple elements: packed sequentially
        const elemSize = input.components.reduce(
          (sum, c) => sum + staticHeadSize(c),
          0,
        );
        for (let i = 0; i < length; i++) {
          const elemPrefix = name ? `${name}.[${i}]` : undefined;
          let pos = elementsStart + i * elemSize;
          for (const component of input.components) {
            pos = decodeStaticInput(component, data, pos, elemPrefix, decoded);
          }
        }
      }
    } else {
      // Simple element type (address[], uint256[], etc.)
      const elementType = input.type.replace(/\[\]$/, "");
      for (let i = 0; i < length; i++) {
        const elemStart = dataStart + 32 + i * 32;
        const word = data.slice(elemStart, elemStart + 32);
        const value = decodeWord(elementType, word);
        const elemName = name ? `${name}.[${i}]` : undefined;
        decoded.push(elemName, decoded.getOrdered().length, value);
      }
    }
    return;
  }

  // Dynamic tuple (non-array): has at least one dynamic component
  if (
    input.type === "tuple" &&
    input.components &&
    input.components.length > 0
  ) {
    decodeTuple(input.components, data, dataStart, name, decoded);
    return;
  }
}

function argumentName(
  prefix: string | undefined,
  input: FunctionInput,
): string | undefined {
  const trimmed = input.name.trim();
  if (prefix !== undefined) {
    return trimmed.length === 0 ? prefix : `${prefix}.${trimmed}`;
  }
  return trimmed.length === 0 ? undefined : trimmed;
}

function decodeWord(kind: string, word: Uint8Array): ArgumentValue {
  if (kind === "address") {
    return { type: "address", bytes: word.slice(12) };
  }

  if (kind.startsWith("uint")) {
    return { type: "uint", value: bytesToUnsignedBigInt(word) };
  }

  if (kind.startsWith("int")) {
    const bits = kind === "int" ? 256 : parseInt(kind.slice(3), 10);
    return { type: "int", value: bytesToSignedBigInt(word, bits) };
  }

  if (kind === "bool") {
    return { type: "bool", value: word[31] !== 0 };
  }

  return { type: "bytes", bytes: word };
}
