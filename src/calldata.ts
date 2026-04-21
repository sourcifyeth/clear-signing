/**
 * Calldata decoding and formatting for clear signing.
 */

import type {
  Descriptor,
  DescriptorFormatSpec,
  DisplayModel,
  ExternalDataProvider,
  FormatCalldata,
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
  formatEmbeddedCalldata?: FormatCalldata,
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

  const selectorHex = bytesToHex(selector);
  const match = findFormatBySelector(descriptor, selectorHex);

  if (!match) {
    return {
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
      warnings: [
        warn("NO_FORMAT_MATCH", `No format match for selector ${selectorHex}`),
      ],
    };
  }

  const { inputs, spec: format } = match;
  const decoded = decodeArguments(inputs, calldata);

  const resolvePath: BaseResolvePath = (path: string) => {
    if (path.startsWith("@.")) return resolveTransactionPath(path, tx);
    if (path.startsWith("$."))
      return toArgumentValue(resolveMetadataValue(descriptor.metadata, path));
    const key = path.startsWith("#.") ? path.slice(2) : path;
    return decoded.values.get(key);
  };

  const definitions = descriptor.display?.definitions ?? {};
  const result = await applyFieldFormats(
    format,
    definitions,
    resolvePath,
    (path: string) => decoded.arrayLengths.get(path) ?? 0,
    tx.chainId,
    descriptor.metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
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
    selector: bytesToHex(selector),
    args,
  };
}

/** Find the format spec whose parsed function selector matches the given hex. */
function findFormatBySelector(
  descriptor: Descriptor,
  selectorHex: string,
): { inputs: FunctionInput[]; spec: DescriptorFormatSpec } | undefined {
  const formats = descriptor.display?.formats;
  if (!formats) return undefined;

  for (const [key, spec] of Object.entries(formats)) {
    const parsed = parseFunctionSignatureKey(key);
    if (!parsed) continue;
    if (bytesToHex(parsed.selector) === selectorHex) {
      return { inputs: parsed.inputs, spec };
    }
  }
  return undefined;
}

/** ABI function input parameter. */
interface FunctionInput {
  name: string;
  type: string;
  components?: FunctionInput[];
}

/**
 * Parse a display.formats key as a full function signature.
 * Returns the parsed inputs and the 4-byte selector.
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
): { inputs: FunctionInput[]; selector: Uint8Array } | undefined {
  const openParen = key.indexOf("(");
  if (openParen === -1) return undefined;

  const fnName = key.slice(0, openParen).trim();
  if (!fnName) return undefined;

  // Find the matching closing paren for the top-level param list
  const afterOpen = key.slice(openParen + 1);
  const closeIdx = findMatchingClose(afterOpen);
  if (closeIdx === -1) return undefined;

  const paramsStr = afterOpen.slice(0, closeIdx);
  const inputs = parseParamList(paramsStr);

  const canonical = `${fnName}(${canonicalParamList(inputs)})`;
  const selector = selectorForSignature(canonical);

  return { inputs, selector };
}

/** Find the index of the closing ')' that matches the opening '(' at depth 0. */
function findMatchingClose(s: string): number {
  let depth = 0;
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
    const closeIdx = findMatchingClose(param.slice(1));
    if (closeIdx === -1) return { name: "", type: "tuple" };

    const inner = param.slice(1, closeIdx + 1);
    const components = parseParamList(inner);

    const rest = param.slice(closeIdx + 2).trim(); // after ")"
    const { arraySuffix, name } = extractSuffixAndName(rest);

    return { type: `tuple${arraySuffix}`, name, components };
  }

  // Non-tuple: "type" or "type name" or "type[] name"
  const spaceIdx = param.indexOf(" ");
  if (spaceIdx === -1) return { type: param, name: "" };
  return { type: param.slice(0, spaceIdx), name: param.slice(spaceIdx + 1) };
}

/** Extract leading array brackets and trailing name from post-tuple remainder. */
function extractSuffixAndName(rest: string): {
  arraySuffix: string;
  name: string;
} {
  const match = rest.match(/^((?:\[\d*\])*)\s*(.*)/);
  if (!match) return { arraySuffix: "", name: rest.trim() };
  return { arraySuffix: match[1], name: match[2] };
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

/**
 * Parse an array type string into its element type and optional fixed size.
 * Returns undefined for non-array types.
 *
 * Examples:
 *   "uint256[]"   → { elementType: "uint256",   size: undefined }
 *   "uint256[3]"  → { elementType: "uint256",   size: 3 }
 *   "tuple[]"     → { elementType: "tuple",     size: undefined }
 *   "uint256[][]" → { elementType: "uint256[]", size: undefined }
 *   "address"     → undefined
 */
function parseArrayType(
  type: string,
): { elementType: string; size: number | undefined } | undefined {
  const match = type.match(/^(.+)\[(\d*)\]$/);
  if (!match) return undefined;
  return {
    elementType: match[1],
    size: match[2].length > 0 ? parseInt(match[2], 10) : undefined,
  };
}

/** Decoded calldata: name-based value lookup and array lengths. */
interface DecodedArguments {
  values: Map<string, ArgumentValue>;
  arrayLengths: Map<string, number>;
}

/**
 * Check if a function input type requires dynamic (offset-based) ABI encoding.
 * Per ABI spec: bytes, string, T[], T[k] where T is dynamic, and tuples with
 * any dynamic component are dynamic. Everything else is static.
 */
function isDynamicInput(input: FunctionInput): boolean {
  if (input.type === "bytes" || input.type === "string") return true;
  const arr = parseArrayType(input.type);
  if (arr) {
    // T[] is always dynamic; T[k] is dynamic iff T is dynamic
    if (arr.size === undefined) return true;
    return isDynamicInput({
      name: "",
      type: arr.elementType,
      components: input.components,
    });
  }
  if (input.type === "tuple" && input.components) {
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
  const arr = parseArrayType(input.type);
  if (arr && arr.size !== undefined) {
    return (
      arr.size *
      staticHeadSize({
        name: "",
        type: arr.elementType,
        components: input.components,
      })
    );
  }
  return 32;
}

/**
 * Decode calldata arguments according to function descriptor.
 * Supports all ABI types: static/dynamic tuples, dynamic arrays (T[]),
 * fixed-size arrays (T[k]), nested arrays, bytes/string, and bytesN.
 */
function decodeArguments(
  inputs: FunctionInput[],
  calldata: Uint8Array,
): DecodedArguments {
  const headSize = inputs.reduce((sum, input) => {
    return sum + (isDynamicInput(input) ? 32 : staticHeadSize(input));
  }, 0);

  if (calldata.length < 4 + headSize) {
    throw new Error(
      `calldata length ${calldata.length} too small (expected at least ${4 + headSize} bytes)`,
    );
  }

  const decoded: DecodedArguments = {
    values: new Map(),
    arrayLengths: new Map(),
  };
  // Skip the 4-byte selector; offsets in data are relative to params start.
  const data = calldata.slice(4);
  decodeComponents(inputs, data, 0, undefined, decoded);
  return decoded;
}

/**
 * Decode a sequence of ABI-encoded inputs using head-tail encoding.
 * Dynamic inputs have an offset word in the head pointing to tail data;
 * static inputs are encoded inline in the head.
 */
function decodeComponents(
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
      decodeValue(input, data, baseOffset + relOffset, prefix, decoded);
      headCursor += 32;
    } else {
      decodeValue(input, data, headCursor, prefix, decoded);
      headCursor += staticHeadSize(input);
    }
  }
}

/**
 * Decode a single ABI-encoded value at the given offset.
 * Handles all type categories: bytes/string, arrays (T[] and T[k]),
 * tuples, and elementary types.
 */
function decodeValue(
  input: FunctionInput,
  data: Uint8Array,
  offset: number,
  prefix: string | undefined,
  decoded: DecodedArguments,
): void {
  const name = argumentName(prefix, input);

  // bytes or string: length word + raw content
  if (input.type === "bytes" || input.type === "string") {
    const length = Number(
      bytesToUnsignedBigInt(data.slice(offset, offset + 32)),
    );
    const content = data.slice(offset + 32, offset + 32 + length);
    const value: ArgumentValue =
      input.type === "string"
        ? { type: "string", value: bytesToAscii(content) }
        : { type: "bytes", bytes: content };
    if (name) decoded.values.set(name, value);
    return;
  }

  // Array types: T[] (dynamic) and T[k] (fixed-size)
  const arr = parseArrayType(input.type);
  if (arr) {
    let count: number;
    let elementsStart: number;

    if (arr.size === undefined) {
      // Dynamic array T[]: length prefix + elements
      count = Number(bytesToUnsignedBigInt(data.slice(offset, offset + 32)));
      elementsStart = offset + 32;
    } else {
      // Fixed-size array T[k]: no length prefix
      count = arr.size;
      elementsStart = offset;
    }

    if (name) decoded.arrayLengths.set(name, count);

    // Build synthetic element inputs and decode as a tuple
    const elemInputs: FunctionInput[] = [];
    for (let i = 0; i < count; i++) {
      elemInputs.push({
        name: `[${i}]`,
        type: arr.elementType,
        components: input.components,
      });
    }
    decodeComponents(elemInputs, data, elementsStart, name, decoded);
    return;
  }

  // Tuple (non-array)
  if (
    input.type === "tuple" &&
    input.components &&
    input.components.length > 0
  ) {
    decodeComponents(input.components, data, offset, name, decoded);
    return;
  }

  // Elementary type (address, uint*, int*, bool, bytesN)
  const value = decodeWord(input.type, data.slice(offset, offset + 32));
  if (name) decoded.values.set(name, value);
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

  // bytesN (e.g. bytes4, bytes32): left-aligned, return only N bytes
  const bytesNMatch = kind.match(/^bytes(\d+)$/);
  if (bytesNMatch) {
    const n = parseInt(bytesNMatch[1], 10);
    return { type: "bytes", bytes: word.slice(0, n) };
  }

  return { type: "bytes", bytes: word };
}
