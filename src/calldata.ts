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
import type { ArgumentValue, ResolvePath } from "./descriptor";
import {
  interpolateTemplate,
  isCalldataDescriptorBoundTo,
  resolveMetadataValue,
  resolveTransactionPath,
  toArgumentValue,
} from "./descriptor";
import {
  bytesToBigInt,
  bytesToHex,
  extractSelector,
  formatSelectorHex,
  hexToBytes,
  selectorForSignature,
  warn,
} from "./utils";
import { applyFieldFormats } from "./formatters";

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

  const resolvePath: ResolvePath = (path: string) => {
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
  word: Uint8Array;
}

/**
 * Collection of decoded arguments with name-based lookup.
 */
class DecodedArguments {
  private ordered: DecodedArgument[] = [];
  private indexByName = new Map<string, number>();
  private arrayLengths = new Map<string, number>();

  push(
    name: string | undefined,
    index: number,
    value: ArgumentValue,
    word: Uint8Array,
  ): void {
    const entryIndex = this.ordered.length;
    if (name !== undefined) {
      this.indexByName.set(name, entryIndex);
    }
    this.indexByName.set(`arg${index}`, entryIndex);
    this.ordered.push({ index, name, value, word });
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
 * Decode calldata arguments according to function descriptor.
 */
function decodeArguments(
  fn: ParsedFunctionSignature,
  calldata: Uint8Array,
): DecodedArguments {
  const totalWords = fn.inputs.reduce(
    (sum, input) => sum + argumentWordCount(input),
    0,
  );
  const expectedLen = 4 + totalWords * 32;

  if (calldata.length < expectedLen) {
    throw new Error(
      `calldata length ${calldata.length} too small for ${totalWords} arguments`,
    );
  }

  const decoded = new DecodedArguments();
  let cursor = 4;
  let globalIndex = 0;

  for (const input of fn.inputs) {
    const result = decodeInput(input, calldata, cursor, undefined, globalIndex);
    cursor = result.cursor;
    globalIndex = result.globalIndex;

    for (const arg of result.args) {
      decoded.push(arg.name, arg.index, arg.value, arg.word);
    }

    if (result.arrayMeta) {
      decoded.setArrayLength(result.arrayMeta.name, result.arrayMeta.length);
    }
  }

  return decoded;
}

interface DecodeResult {
  cursor: number;
  globalIndex: number;
  args: Array<{
    name: string | undefined;
    index: number;
    value: ArgumentValue;
    word: Uint8Array;
  }>;
  arrayMeta?: { name: string; length: number };
}

function decodeInput(
  input: FunctionInput,
  calldata: Uint8Array,
  cursor: number,
  prefix: string | undefined,
  globalIndex: number,
): DecodeResult {
  if (
    input.type.startsWith("tuple") &&
    input.components &&
    input.components.length > 0
  ) {
    const basePrefix =
      prefix !== undefined
        ? input.name.trim().length === 0
          ? prefix
          : `${prefix}.${input.name.trim()}`
        : input.name.trim().length === 0
          ? undefined
          : input.name.trim();

    const args: DecodeResult["args"] = [];
    for (const component of input.components) {
      const result = decodeInput(
        component,
        calldata,
        cursor,
        basePrefix,
        globalIndex,
      );
      cursor = result.cursor;
      globalIndex = result.globalIndex;
      args.push(...result.args);
    }
    return { cursor, globalIndex, args };
  }

  // Dynamic array: head word is an offset pointer to tail section
  if (isDynamicArrayType(input.type)) {
    const offsetWord = calldata.slice(cursor, cursor + 32);
    const offset = Number(bytesToBigInt(offsetWord));
    const argsStart = 4; // after selector
    const dataStart = argsStart + offset;

    const lengthWord = calldata.slice(dataStart, dataStart + 32);
    const length = Number(bytesToBigInt(lengthWord));

    const elementType = input.type.replace(/\[\]$/, "");
    const baseName = argumentName(prefix, input);

    const args: DecodeResult["args"] = [];
    for (let i = 0; i < length; i++) {
      const elemStart = dataStart + 32 + i * 32;
      const word = calldata.slice(elemStart, elemStart + 32);
      const value = decodeWord(elementType, word);
      const name = baseName ? `${baseName}.[${i}]` : undefined;
      args.push({ name, index: globalIndex, value, word });
    }

    return {
      cursor: cursor + 32,
      globalIndex: globalIndex + 1,
      args,
      arrayMeta: baseName ? { name: baseName, length } : undefined,
    };
  }

  // Decode single word
  const start = cursor;
  const end = start + 32;

  if (end > calldata.length) {
    throw new Error(
      `calldata length ${calldata.length} too small while decoding argument '${input.name}'`,
    );
  }

  const word = calldata.slice(start, end);
  const value = decodeWord(input.type, word);
  const name = argumentName(prefix, input);

  return {
    cursor: end,
    globalIndex: globalIndex + 1,
    args: [{ name, index: globalIndex, value, word }],
  };
}

/** Check if a type is a dynamic array (e.g. address[], uint256[]). */
function isDynamicArrayType(type: string): boolean {
  return type.endsWith("[]") && !type.startsWith("tuple");
}

function argumentWordCount(input: FunctionInput): number {
  if (
    input.type.startsWith("tuple") &&
    input.components &&
    input.components.length > 0
  ) {
    return input.components.reduce((sum, c) => sum + argumentWordCount(c), 0);
  }
  return 1;
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
    return { type: "uint", value: bytesToBigInt(word) };
  }

  if (kind.startsWith("int")) {
    const bits = kind === "int" ? 256 : parseInt(kind.slice(3), 10);
    const unsigned = bytesToBigInt(word);
    const signBit = 1n << BigInt(bits - 1);
    const value =
      unsigned & signBit ? unsigned - (1n << BigInt(bits)) : unsigned;
    return { type: "int", value };
  }

  if (kind === "bool") {
    return { type: "bool", value: word[31] !== 0 };
  }

  return { type: "bytes", bytes: word };
}
