/**
 * Descriptor parsing and calldata decoding for clear signing.
 */

import { DescriptorError, TokenLookupError } from "./errors";
import type {
  Descriptor,
  DescriptorFieldFormat,
  DescriptorFieldFormatParams,
  DescriptorFieldFormatType,
  DescriptorFormatSpec,
  DescriptorMetadata,
  FunctionDescriptor,
  FunctionInput,
  Transaction,
  TypedData,
} from "./types";
import {
  bytesToHex,
  hexToBytes,
  normalizeAddress,
  normalizeCaip19,
  selectorForSignature,
  tokenKeyFromErc20,
} from "./utils";

/** Argument value union type. */
export type ArgumentValue =
  | { type: "address"; bytes: Uint8Array }
  | { type: "uint"; value: bigint }
  | { type: "bool"; value: boolean }
  | { type: "raw"; bytes: Uint8Array };

/** Decoded argument value. */
export interface DecodedArgument {
  index: number;
  name?: string;
  value: ArgumentValue;
  word: Uint8Array;
}

/**
 * Collection of decoded arguments with name-based lookup.
 */
export class DecodedArguments {
  private ordered: DecodedArgument[] = [];
  private indexByName = new Map<string, number>();

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
 * Check if a calldata descriptor is bound to a specific chain and address.
 */
export function isCalldataDescriptorBoundTo(
  descriptor: Descriptor,
  chainId: number,
  address: string,
): boolean {
  const normalized = normalizeAddress(address);
  return (
    descriptor.context?.contract?.deployments?.some(
      (d) =>
        d.chainId === chainId &&
        typeof d.address === "string" &&
        normalizeAddress(d.address) === normalized,
    ) ?? false
  );
}

/**
 * Check if an EIP-712 descriptor is bound to a specific chain and verifying contract.
 */
export function isEip712DescriptorBoundTo(
  descriptor: Descriptor,
  chainId: number,
  address: string,
): boolean {
  const normalized = normalizeAddress(address);
  return (
    descriptor.context?.eip712?.deployments?.some(
      (d) =>
        d.chainId === chainId &&
        typeof d.address === "string" &&
        normalizeAddress(d.address) === normalized,
    ) ?? false
  );
}

/**
 * Build a map from hex selector (e.g. "0x095ea7b3") to the parsed function descriptor
 * and its display format spec. Parses display.formats keys as function signatures —
 * no separate ABI needed.
 */
export function getFormatsBySelector(
  descriptor: Descriptor,
): Map<string, { fn: FunctionDescriptor; spec: DescriptorFormatSpec }> {
  const map = new Map<
    string,
    { fn: FunctionDescriptor; spec: DescriptorFormatSpec }
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

/**
 * Parse a display.formats key as a full function signature into a FunctionDescriptor.
 *
 * Per ERC-7730, keys MUST include parameter names and use canonical Solidity types.
 * Commas MUST NOT be followed by spaces; exactly one space between type and name.
 *
 * Examples:
 *   "deposit()"
 *   "approve(address spender,uint256 value)"
 *   "submitOrder((address token,uint256 amount) order,bytes32 salt)"
 */
export function parseFunctionSignatureKey(
  key: string,
): FunctionDescriptor | undefined {
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

  return { inputs, typedSignature: canonical, selector };
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

/**
 * Decode calldata arguments according to function descriptor.
 */
export function decodeArguments(
  fn: FunctionDescriptor,
  calldata: Uint8Array,
): DecodedArguments {
  const totalWords = fn.inputs.reduce(
    (sum, input) => sum + argumentWordCount(input),
    0,
  );
  const expectedLen = 4 + totalWords * 32;

  if (calldata.length < expectedLen) {
    throw DescriptorError.calldata(
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

  // Decode single word
  const start = cursor;
  const end = start + 32;

  if (end > calldata.length) {
    throw DescriptorError.calldata(
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
    const bytes = word.slice(12);
    return { type: "address", bytes };
  }

  if (kind.startsWith("uint")) {
    return { type: "uint", value: bytesToBigInt(word) };
  }

  return { type: "raw", bytes: word };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/** Resolved effective field after applying references. */
export interface ResolvedField {
  path: string;
  label: string;
  format?: DescriptorFieldFormatType;
  params: DescriptorFieldFormatParams;
}

/**
 * Resolve effective field after applying definition references.
 */
export function resolveField(
  field: DescriptorFieldFormat,
  definitions: Record<string, DescriptorFieldFormat>,
): { resolved: ResolvedField | undefined; warnings: string[] } {
  const warnings: string[] = [];
  let path = field.path;
  let label = field.label;
  let format = field.format;
  let params: DescriptorFieldFormatParams = field.params ?? {};

  if (field.$ref) {
    const name = extractDefinitionName(field.$ref);
    if (name) {
      const def = definitions[name];
      if (def) {
        if (path === undefined) path = def.path;
        if (label === undefined) label = def.label;
        if (format === undefined) format = def.format;
        params = mergeParams(def.params ?? {}, params);
      } else {
        warnings.push(`Unknown display definition reference '${field.$ref}'`);
      }
    } else {
      warnings.push(`Unsupported display definition reference '${field.$ref}'`);
    }
  }

  if (path === undefined) return { resolved: undefined, warnings };

  return {
    resolved: { path, label: label ?? path, format, params },
    warnings,
  };
}

function extractDefinitionName(reference: string): string | undefined {
  const prefix = "$.display.definitions.";
  if (reference.startsWith(prefix)) {
    return reference.slice(prefix.length);
  }
  return undefined;
}

/**
 * Resolves an ERC-7730 container path for an EVM transaction.
 * Handles @.from, @.value, @.to, @.chainId as per the spec.
 */
export function resolveTransactionPath(
  path: string,
  tx: Transaction,
): ArgumentValue | undefined {
  switch (path) {
    case "@.from":
      if (!tx.from) return undefined;
      return { type: "address", bytes: hexToBytes(tx.from) };
    case "@.value":
      if (tx.value === undefined) return undefined;
      return { type: "uint", value: tx.value };
    case "@.to":
      return { type: "address", bytes: hexToBytes(tx.to) };
    case "@.chainId":
      return { type: "uint", value: BigInt(tx.chainId) };
    default:
      return undefined;
  }
}

/**
 * Resolves an ERC-7730 container path for EIP-712 typed data.
 * @.from → signer account, @.to → verifyingContract, @.chainId → domain.chainId.
 */
export function resolveTypedDataPath(
  path: string,
  typedData: TypedData,
): ArgumentValue | undefined {
  switch (path) {
    case "@.from":
      return { type: "address", bytes: hexToBytes(typedData.account) };
    case "@.to":
      if (!typedData.domain.verifyingContract) return undefined;
      return {
        type: "address",
        bytes: hexToBytes(typedData.domain.verifyingContract),
      };
    case "@.chainId":
      if (typedData.domain.chainId === undefined) return undefined;
      return { type: "uint", value: BigInt(typedData.domain.chainId) };
    default:
      return undefined;
  }
}

function mergeParams(
  base: DescriptorFieldFormatParams,
  overlay: DescriptorFieldFormatParams,
): DescriptorFieldFormatParams {
  const merged: DescriptorFieldFormatParams = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== null && value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

/**
 * Determine token lookup key from field parameters.
 */
export function determineTokenKey(
  field: ResolvedField,
  decoded: DecodedArguments,
  chainId: number,
  contractAddress: string,
): string {
  const tokenParam = field.params.token;
  if (typeof tokenParam === "string") {
    return normalizeCaip19(tokenParam);
  }

  const tokenPath = field.params.tokenPath;
  if (typeof tokenPath === "string") {
    let address: string;

    if (tokenPath === "@.to") {
      address = normalizeAddress(contractAddress);
    } else {
      const tokenValue = decoded.get(tokenPath);
      if (!tokenValue) {
        throw TokenLookupError.missingPath(tokenPath, field.path);
      }

      if (tokenValue.type !== "address") {
        throw TokenLookupError.notAddress(tokenPath, field.path);
      }

      address = normalizeAddress(bytesToHex(tokenValue.bytes));
    }

    return tokenKeyFromErc20(chainId, address);
  }

  throw TokenLookupError.missingToken(field.path);
}

/**
 * Get display label for a decoded argument.
 */
export function displayLabel(arg: DecodedArgument): string {
  return arg.name && arg.name.length > 0 ? arg.name : `arg${arg.index}`;
}

/**
 * Get default string representation of an argument value.
 */
export function defaultValueString(value: ArgumentValue): string {
  switch (value.type) {
    case "address":
      return bytesToHex(value.bytes);
    case "uint":
      return value.value.toString();
    case "bool":
      return value.value.toString();
    case "raw":
      return bytesToHex(value.bytes);
  }
}

/**
 * Get raw word hex for a decoded argument.
 */
export function rawWordHex(arg: DecodedArgument): string {
  return bytesToHex(arg.word);
}

/**
 * Resolve a metadata value by dot-path pointer (e.g. "$.metadata.enums.OrderType").
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
 * Interpolate {placeholder} tokens in a template string from a values map.
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
