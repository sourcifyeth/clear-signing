/**
 * Descriptor parsing and calldata decoding for clear signing.
 */

import { DescriptorError, TokenLookupError } from "./errors";
import type {
  AbiFunction,
  ArgumentValue,
  DecodedArgument,
  Descriptor,
  DescriptorDisplay,
  DisplayField,
  DisplayFormat,
  EffectiveField,
  FunctionDescriptor,
  FunctionInput,
  ResolvedDescriptor,
} from "./types";
import {
  bytesToHex,
  normalizeAddress,
  normalizeCaip19,
  selectorForSignature,
  tokenKeyFromErc20,
} from "./utils";

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

  /**
   * Add the call value as a special @value argument.
   */
  withValue(value: Uint8Array | undefined): DecodedArguments {
    if (value === undefined) return this;
    if (value.length > 32) {
      throw DescriptorError.calldata("call value must be at most 32 bytes");
    }

    const word = new Uint8Array(32);
    const start = 32 - value.length;
    word.set(value, start);

    const amount = bytesToBigInt(word);
    this.push(
      "@value",
      this.ordered.length,
      { type: "uint", value: amount },
      word,
    );
    return this;
  }
}

/**
 * Merge descriptor JSON with its include files as specified in ERC-7730 "Organizing files".
 *
 * Include values fill in only keys not already present in the descriptor.
 * For nested objects, merging is applied recursively. Arrays and primitives
 * use the descriptor's value when a key conflicts.
 * The `includes` key is removed from the result.
 */
export function mergeDescriptorIncludes(
  descriptorJson: string,
  includeJsons: string[],
): Record<string, unknown> {
  const descriptor = JSON.parse(descriptorJson) as Record<string, unknown>;
  for (const includeJson of includeJsons) {
    mergeInclude(
      descriptor,
      JSON.parse(includeJson) as Record<string, unknown>,
    );
  }
  delete descriptor.includes;
  return descriptor;
}

/**
 * Build an address book from descriptor metadata, mapping addresses to
 * human-readable labels as per ERC-7730.
 *
 * Covers EIP-712 descriptors: populates from context.eip712.deployments
 * and metadata.addressBook. Pass `verifyingContract` to ensure the
 * verifying contract address is always included.
 */
export function buildAddressBook(
  descriptor: Record<string, unknown>,
  verifyingContract?: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const metadata = descriptor.metadata as Record<string, unknown> | undefined;
  if (!metadata) return map;

  const label = getMetadataLabel(metadata);
  if (label) {
    const context = descriptor.context as Record<string, unknown> | undefined;
    const eip712 = context?.eip712 as Record<string, unknown> | undefined;
    const deployments = eip712?.deployments as
      | Array<Record<string, unknown>>
      | undefined;
    if (deployments) {
      for (const dep of deployments) {
        const addr = dep.address as string | undefined;
        if (addr) {
          map.set(normalizeAddress(addr), label);
        }
      }
    }
    if (verifyingContract) {
      const key = normalizeAddress(verifyingContract);
      if (!map.has(key)) map.set(key, label);
    }
  }

  mergeAddressBookEntries(map, metadata.addressBook);
  return map;
}

function getMetadataLabel(
  metadata: Record<string, unknown>,
): string | undefined {
  const token = metadata.token as Record<string, unknown> | undefined;
  if (token) {
    const name = token.name as string | undefined;
    const symbol = token.symbol as string | undefined;
    if (name && symbol) {
      return name.toLowerCase() === symbol.toLowerCase()
        ? name
        : `${name} (${symbol})`;
    }
    return name ?? symbol;
  }

  const info = metadata.info as Record<string, unknown> | undefined;
  if (info) {
    const legalName = info.legalName as string | undefined;
    if (legalName) return legalName;
    const name = info.name as string | undefined;
    if (name) return name;
  }

  const owner = metadata.owner as string | undefined;
  if (owner) return owner;

  return undefined;
}

function mergeAddressBookEntries(
  map: Map<string, string>,
  value: unknown,
): void {
  if (!value || typeof value !== "object") return;
  const entries = value as Record<string, unknown>;
  for (const [key, labelValue] of Object.entries(entries)) {
    if (typeof labelValue === "string") {
      if (!map.has(normalizeAddress(key))) {
        map.set(normalizeAddress(key), labelValue);
      }
    } else if (typeof labelValue === "object" && labelValue !== null) {
      const nested = labelValue as Record<string, unknown>;
      for (const [innerKey, innerLabelValue] of Object.entries(nested)) {
        if (typeof innerLabelValue === "string") {
          if (!map.has(normalizeAddress(innerKey))) {
            map.set(normalizeAddress(innerKey), innerLabelValue);
          }
        }
      }
    }
  }
}

/**
 * Build a descriptor from resolved JSON strings.
 */
export function buildDescriptor(resolved: ResolvedDescriptor): Descriptor {
  const descriptorValue = mergeDescriptorIncludes(
    resolved.descriptorJson,
    resolved.includes,
  );

  // Inject ABI if needed
  if (resolved.abiJson && needsAbiInjection(descriptorValue)) {
    const abiValue = JSON.parse(resolved.abiJson);
    injectAbi(descriptorValue, abiValue);
  }

  return parseDescriptor(descriptorValue);
}

function needsAbiInjection(descriptorValue: Record<string, unknown>): boolean {
  const abi = (descriptorValue.context as Record<string, unknown> | undefined)
    ?.contract as Record<string, unknown> | undefined;
  if (!abi) return true;
  const abiValue = (abi as Record<string, unknown>).abi;
  if (abiValue === undefined || abiValue === null) return true;
  if (Array.isArray(abiValue) || typeof abiValue === "object") return false;
  return true;
}

function injectAbi(
  descriptorValue: Record<string, unknown>,
  abiValue: unknown,
): void {
  const context = descriptorValue.context as
    | Record<string, unknown>
    | undefined;
  if (!context) return;
  const contract = context.contract as Record<string, unknown> | undefined;
  if (!contract) return;
  contract.abi = abiValue;
}

function mergeInclude(
  target: Record<string, unknown>,
  include: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(include)) {
    if (target[key] === undefined) {
      target[key] = value;
    } else if (
      typeof target[key] === "object" &&
      target[key] !== null &&
      !Array.isArray(target[key]) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      mergeInclude(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    }
  }
}

function parseDescriptor(value: Record<string, unknown>): Descriptor {
  const context = value.context as Record<string, unknown> | undefined;
  if (!context) {
    throw DescriptorError.parse("missing context");
  }

  const contract = context.contract as Record<string, unknown> | undefined;
  if (!contract) {
    throw DescriptorError.parse("missing context.contract");
  }

  const deployments =
    (contract.deployments as Array<Record<string, unknown>>) || [];
  const parsedDeployments = deployments.map((d) => ({
    chainId: Number(d.chainId),
    address: String(d.address),
  }));

  let abi: AbiFunction[] | string | undefined;
  if (Array.isArray(contract.abi)) {
    abi = contract.abi as AbiFunction[];
  } else if (typeof contract.abi === "string") {
    abi = contract.abi;
  }

  const display = value.display as Record<string, unknown> | undefined;
  const parsedDisplay: DescriptorDisplay = {
    definitions: (display?.definitions as Record<string, DisplayField>) || {},
    formats: (display?.formats as Record<string, DisplayFormat>) || {},
  };

  return {
    context: {
      $id: context.$id as string | undefined,
      contract: {
        deployments: parsedDeployments,
        abi,
      },
    },
    metadata: (value.metadata as Record<string, unknown>) || {},
    display: parsedDisplay,
  };
}

/**
 * Check if descriptor is bound to a specific chain and address.
 */
export function isDescriptorBoundTo(
  descriptor: Descriptor,
  chainId: number,
  address: string,
): boolean {
  const normalized = normalizeAddress(address);
  return descriptor.context.contract.deployments.some(
    (d) => d.chainId === chainId && normalizeAddress(d.address) === normalized,
  );
}

/**
 * Get function descriptors from a descriptor's ABI.
 */
export function getFunctionDescriptors(
  descriptor: Descriptor,
): FunctionDescriptor[] {
  const abi = descriptor.context.contract.abi;
  if (!abi || typeof abi === "string") {
    return [];
  }

  return abi
    .filter((fn) => fn.type === "function")
    .map((fn) => {
      const typedSignature = typedSignatureFor(fn);
      const selector = selectorForSignature(typedSignature);
      return {
        inputs: fn.inputs,
        typedSignature,
        selector,
      };
    });
}

/**
 * Get display format map with normalized signatures.
 */
export function getFormatMap(
  descriptor: Descriptor,
): Map<string, DisplayFormat> {
  const map = new Map<string, DisplayFormat>();
  const formats = descriptor.display.formats || {};

  for (const [signature, format] of Object.entries(formats)) {
    const normalized = normalizeSignatureKey(signature);
    if (normalized) {
      map.set(normalized, format);
    }
  }

  return map;
}

function normalizeSignatureKey(signature: string): string | undefined {
  const openParen = signature.indexOf("(");
  const closeParen = signature.lastIndexOf(")");
  if (openParen === -1 || closeParen === -1) return undefined;

  const name = signature.slice(0, openParen).trim();
  const params = signature.slice(openParen + 1, closeParen);

  const types: string[] = [];
  if (params.trim().length > 0) {
    for (const param of params.split(",")) {
      const trimmed = param.trim();
      if (trimmed.length === 0) continue;
      const ty = trimmed.split(/\s+/)[0];
      types.push(ty.trim());
    }
  }

  return `${name}(${types.join(",")})`;
}

function typedSignatureFor(fn: AbiFunction): string {
  const params = fn.inputs.map(typeSignatureForInput);
  return `${fn.name.trim()}(${params.join(",")})`;
}

function typeSignatureForInput(input: FunctionInput): string {
  const ty = input.type.trim();
  if (ty.startsWith("tuple")) {
    const suffix = ty.slice(5); // Remove 'tuple' prefix
    const nested = (input.components || [])
      .map(typeSignatureForInput)
      .join(",");
    return `(${nested})${suffix}`;
  }
  return ty;
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
  const value = decodeWord(input.type, input.internalType, word);
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

function decodeWord(
  kind: string,
  internalType: string | undefined,
  word: Uint8Array,
): ArgumentValue {
  if (internalTypeIsAddress(internalType, kind) || kind === "address") {
    const bytes = word.slice(12);
    return { type: "address", bytes };
  }

  if (kind.startsWith("uint")) {
    return { type: "uint", value: bytesToBigInt(word) };
  }

  return { type: "raw", bytes: word };
}

function internalTypeIsAddress(
  internalType: string | undefined,
  kind: string,
): boolean {
  if (!internalType) return false;
  const normalized = internalType.trim();
  if (normalized.length === 0) return false;
  if (normalized.toLowerCase() === "address") return true;

  // Check if last segment is "address"
  const segments = normalized.split(/[.\s:]/);
  const lastSegment = segments[segments.length - 1];
  if (lastSegment?.toLowerCase() === "address") return true;

  // Special case: "Address" internal type with uint kind
  if (normalized === "Address" && kind.startsWith("uint")) return true;

  return false;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Resolve effective field after applying definition references.
 */
export function resolveEffectiveField(
  field: DisplayField,
  definitions: Record<string, DisplayField>,
  warnings: string[],
): EffectiveField | undefined {
  let path = field.path;
  let label = field.label;
  let format = field.format;
  let params = { ...(field.params || {}) };

  if (field.$ref) {
    const name = extractDefinitionName(field.$ref);
    if (name) {
      const def = definitions[name];
      if (def) {
        if (path === undefined) path = def.path;
        if (label === undefined) label = def.label;
        if (format === undefined) format = def.format;
        params = mergeParams(def.params || {}, params);
      } else {
        warnings.push(`Unknown display definition reference '${field.$ref}'`);
      }
    } else {
      warnings.push(`Unsupported display definition reference '${field.$ref}'`);
    }
  }

  if (path === undefined) return undefined;

  return {
    path,
    label: label ?? path,
    format,
    params,
  };
}

function extractDefinitionName(reference: string): string | undefined {
  const prefix = "$.display.definitions.";
  if (reference.startsWith(prefix)) {
    return reference.slice(prefix.length);
  }
  return undefined;
}

function mergeParams(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== null && value !== undefined) {
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Determine token lookup key from field parameters.
 */
export function determineTokenKey(
  field: EffectiveField,
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
