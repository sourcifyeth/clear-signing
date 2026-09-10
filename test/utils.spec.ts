/**
 * Unit tests for the shared utility functions (utils.ts).
 */

import { describe, expect, it } from "vitest";
import { bigIntToBytes, bytesToSignedBigInt } from "../src/utils.js";

describe("bytesToSignedBigInt", () => {
  // The ABI sign-extends a narrow signed integer to a 32-byte word. The
  // declared width must decide where the sign bit sits, not the word length.
  it("decodes narrow-width boundary values from sign-extended ABI words", () => {
    for (const bits of [8, 24, 64, 128]) {
      const half = 1n << BigInt(bits - 1);
      for (const value of [-half, -1n, 0n, 1n, half - 1n]) {
        expect(bytesToSignedBigInt(bigIntToBytes(value), bits)).toBe(value);
      }
    }
  });

  it("decodes int256 boundary values from full-width ABI words", () => {
    const half = 1n << 255n;
    for (const value of [-half, -1n, 0n, 1n, half - 1n]) {
      expect(bytesToSignedBigInt(bigIntToBytes(value), 256)).toBe(value);
    }
  });

  it("decodes int24 Uniswap ticks from ABI words", () => {
    for (const value of [-887272n, -198310n, -197910n, 887272n]) {
      expect(bytesToSignedBigInt(bigIntToBytes(value), 24)).toBe(value);
    }
  });

  it("uses the byte length as the width when no width is given", () => {
    expect(bytesToSignedBigInt(new Uint8Array([0xff]))).toBe(-1n);
    expect(bytesToSignedBigInt(new Uint8Array([0x7f]))).toBe(127n);
    expect(bytesToSignedBigInt(new Uint8Array())).toBe(0n);
  });
});
