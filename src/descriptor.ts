/**
 * Shared descriptor utilities for clear signing.
 *
 * Contains descriptor binding checks, path resolution, field/definition merging,
 * metadata resolution, and template interpolation used by both calldata and EIP-712 paths.
 */

import type {
  Descriptor,
  DescriptorFieldFormat,
  DescriptorFieldFormatParams,
  DescriptorFieldGroup,
  DescriptorMetadata,
  FieldType,
  Transaction,
  TypedData,
} from "./types";
import {
  hexToBytes,
  coerceBigInt,
  normalizeAddress,
  parseBigInt,
} from "./utils";

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
 * Check if an EIP-712 descriptor is bound to the given typed data.
 *
 * Verifies both `context.eip712.deployments` (chain + address) and
 * `context.eip712.domain` (key-value constraints) against the message domain.
 */
export function isEip712DescriptorBoundTo(
  descriptor: Descriptor,
  typedData: TypedData,
): boolean {
  const { chainId, verifyingContract } = typedData.domain;
  const eip712 = descriptor.context?.eip712;

  // Check deployments
  if (
    chainId !== undefined &&
    verifyingContract !== undefined &&
    eip712?.deployments
  ) {
    const normalized = normalizeAddress(verifyingContract);
    const match = eip712.deployments.some(
      (d) =>
        d.chainId === chainId &&
        typeof d.address === "string" &&
        normalizeAddress(d.address) === normalized,
    );
    if (!match) return false;
  }

  // Check domain constraints
  const domainConstraint = eip712?.domain;
  if (domainConstraint) {
    const messageDomain = typedData.domain as Record<string, unknown>;
    for (const [key, expected] of Object.entries(domainConstraint)) {
      const actual = messageDomain[key];
      if (String(actual) !== String(expected)) return false;
    }
  }

  return true;
}

/** Argument value union type. */
export type ArgumentValue =
  | { type: "address"; bytes: Uint8Array }
  | { type: "uint"; value: bigint }
  | { type: "int"; value: bigint }
  | { type: "bool"; value: boolean }
  | { type: "string"; value: string }
  | { type: "bytes"; bytes: Uint8Array };

/**
 * Convert a raw JS value (e.g. from an EIP-712 message) to an ArgumentValue
 * using the known FieldType from the type tree.
 */
export function rawToArgumentValue(
  value: unknown,
  fieldType: FieldType,
): ArgumentValue | undefined {
  switch (fieldType) {
    case "address": {
      if (typeof value !== "string") return undefined;
      if (!value.startsWith("0x") || value.length !== 42) return undefined;
      return { type: "address", bytes: hexToBytes(value) };
    }
    case "uint": {
      const n = coerceBigInt(value);
      if (n === undefined) return undefined;
      return { type: "uint", value: n };
    }
    case "int": {
      const n = coerceBigInt(value);
      if (n === undefined) return undefined;
      return { type: "int", value: n };
    }
    case "bool": {
      if (typeof value === "boolean") return { type: "bool", value };
      if (value === "true") return { type: "bool", value: true };
      if (value === "false") return { type: "bool", value: false };
      return undefined;
    }
    case "string": {
      if (typeof value !== "string") return undefined;
      return { type: "string", value };
    }
    case "bytes": {
      if (typeof value !== "string") return undefined;
      try {
        return { type: "bytes", bytes: hexToBytes(value) };
      } catch {
        return undefined;
      }
    }
  }
}


/**
 * Convert a descriptor metadata value to an ArgumentValue.
 * Used for `$.metadata.*` path resolution.
 */
export function toArgumentValue(
  value: unknown,
): ArgumentValue | undefined {
  if (typeof value === "number") {
    return { type: "uint", value: BigInt(value) };
  }
  if (typeof value === "boolean") {
    return { type: "bool", value };
  }
  if (typeof value === "string") {
    const n = parseBigInt(value);
    if (n !== undefined) return { type: "uint", value: n };
    if (value.startsWith("0x") && value.length === 42) {
      return { type: "address", bytes: hexToBytes(value) };
    }
    if (value.startsWith("0x")) {
      try {
        return { type: "bytes", bytes: hexToBytes(value) };
      } catch {
        /* fall through */
      }
    }
    return { type: "string", value };
  }
  return undefined;
}

/**
 * Resolves an ERC-7730 path to an ArgumentValue.
 * Handles `@.` (container), `$.` (metadata), `#.` (structured data), and bare paths.
 */
export type ResolvePath = (path: string) => ArgumentValue | undefined;

export function isFieldGroup(
  field: DescriptorFieldFormat | DescriptorFieldGroup,
): field is DescriptorFieldGroup {
  return "iteration" in field;
}

/**
 * Merge a field with its referenced definition (if any).
 * Always returns a DescriptorFieldFormat — the input itself if no $ref is present.
 */
export function mergeDefinitions(
  field: DescriptorFieldFormat,
  definitions: Record<string, DescriptorFieldFormat>,
): { merged: DescriptorFieldFormat; warnings: string[] } {
  const warnings: string[] = [];

  if (!field.$ref) {
    return { merged: field, warnings };
  }

  const name = extractDefinitionName(field.$ref);
  if (!name) {
    warnings.push(`Unsupported display definition reference '${field.$ref}'`);
    return { merged: field, warnings };
  }

  const def = definitions[name];
  if (!def) {
    warnings.push(`Unknown display definition reference '${field.$ref}'`);
    return { merged: field, warnings };
  }

  return {
    merged: {
      path: field.path ?? def.path,
      value: field.value ?? def.value,
      label: field.label ?? def.label,
      format: field.format ?? def.format,
      params: mergeParams(def.params ?? {}, field.params ?? {}),
      visible: field.visible ?? def.visible,
      separator: field.separator ?? def.separator,
      encryption: field.encryption ?? def.encryption,
    },
    warnings,
  };
}

/**
 * Resolve a field's value using its `value` (literal) or `path` property.
 */
export function resolveFieldValue(
  field: DescriptorFieldFormat,
  resolvePath: ResolvePath,
): ArgumentValue | undefined {
  if (field.value !== undefined) return toArgumentValue(field.value);
  if (field.path !== undefined) return resolvePath(field.path);
  return undefined;
}

function extractDefinitionName(reference: string): string | undefined {
  const prefix = "$.display.definitions.";
  if (reference.startsWith(prefix)) {
    return reference.slice(prefix.length);
  }
  return undefined;
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
): string {
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
        throw new Error("Unclosed placeholder in interpolated intent");
      }
      const key = placeholder.trim();
      if (key.length === 0) {
        throw new Error("Empty placeholder in interpolated intent");
      }
      const value = values.get(key);
      if (value === undefined) {
        throw new Error(`Missing interpolated value for '${key}'`);
      }
      output += value;
    } else {
      output += ch;
      i++;
    }
  }

  return output;
}
