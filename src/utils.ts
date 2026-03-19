/**
 * Shared utility functions for the clear signing library.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import type { Warning, WarningCode } from "./types";

/** Create a Warning object. */
export function warn(code: WarningCode, message: string): Warning {
  return { code, message };
}


/** Compute keccak256 hash of input data. */
function keccak256(data: Uint8Array): Uint8Array {
  return keccak_256(data);
}

/** Encode an ASCII string to bytes without relying on TextEncoder (React Native compatible). */
function asciiToBytes(str: string): Uint8Array {
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    bytes[i] = str.charCodeAt(i);
  }
  return bytes;
}

/** Convert hex string to bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const cleaned = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleaned.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Convert bytes to hex string with 0x prefix. */
export function bytesToHex(bytes: Uint8Array): string {
  let hex = "0x";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/** Normalize address to lowercase (preserves 0x prefix). */
export function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

/** Convert 20-byte address to EIP-55 checksum format. */
export function toChecksumAddress(bytes: Uint8Array): string {
  if (bytes.length !== 20) {
    throw new Error("Address must be 20 bytes");
  }

  const lower = bytesToHex(bytes).slice(2).toLowerCase();
  const hash = keccak256(asciiToBytes(lower));

  let result = "0x";
  for (let i = 0; i < lower.length; i++) {
    const char = lower[i];
    if (char >= "a" && char <= "f") {
      const hashByte = hash[Math.floor(i / 2)];
      const nibble = i % 2 === 0 ? (hashByte >> 4) & 0x0f : hashByte & 0x0f;
      result += nibble >= 8 ? char.toUpperCase() : char;
    } else {
      result += char;
    }
  }
  return result;
}

/** Add thousand separators to a numeric string. */
export function addThousandSeparators(value: string): string {
  const chars = value.split("").reverse();
  const result: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    if (i > 0 && i % 3 === 0) {
      result.push(",");
    }
    result.push(chars[i]);
  }
  return result.reverse().join("");
}

/** Format a bigint amount with decimal places. */
export function formatAmountWithDecimals(
  amount: bigint,
  decimals: number,
): string {
  if (decimals === 0) {
    return addThousandSeparators(amount.toString());
  }

  const factor = 10n ** BigInt(decimals);
  const integer = amount / factor;
  const remainder = amount % factor;

  const integerPart = addThousandSeparators(integer.toString());
  if (remainder === 0n) {
    return integerPart;
  }

  let fractional = remainder.toString().padStart(decimals, "0");
  // Trim trailing zeros
  while (fractional.endsWith("0")) {
    fractional = fractional.slice(0, -1);
  }

  if (fractional.length === 0) {
    return integerPart;
  }

  return `${integerPart}.${fractional}`;
}

/** Parse a string as bigint, supporting both decimal and hex formats. */
export function parseBigInt(text: string): bigint | undefined {
  try {
    const trimmed = text.trim();
    if (trimmed.startsWith("0x")) {
      return BigInt(trimmed);
    }
    return BigInt(trimmed);
  } catch {
    return undefined;
  }
}

/** Coerce an unknown value to bigint if possible. */
export function coerceBigInt(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return parseBigInt(value);
  return undefined;
}

/** Compute function selector from signature. */
export function selectorForSignature(signature: string): Uint8Array {
  const hash = keccak256(asciiToBytes(signature));
  return hash.slice(0, 4);
}


/** Format selector bytes as hex string. */
export function formatSelectorHex(selector: Uint8Array): string {
  return bytesToHex(selector);
}


/** Extract 4-byte selector from calldata. */
export function extractSelector(calldata: Uint8Array): Uint8Array {
  if (calldata.length < 4) {
    throw new Error("calldata must be at least 4 bytes");
  }
  return calldata.slice(0, 4);
}

export function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}
