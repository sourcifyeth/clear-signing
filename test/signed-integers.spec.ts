import { describe, expect, it } from "vitest";
import { bytesToSignedBigInt } from "../src/utils.js";

function abiWord(value: bigint): Uint8Array {
  const hex = BigInt.asUintN(256, value).toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

describe("ABI sign-extended signed integers", () => {
  for (const bits of [8, 24, 64, 128, 256]) {
    const half = 1n << BigInt(bits - 1);
    for (const value of [-half, -1n, 0n, 1n, half - 1n]) {
      it(`decodes int${bits} ${value}`, () => {
        expect(bytesToSignedBigInt(abiWord(value), bits)).toBe(value);
      });
    }
  }
  it("decodes actual negative Uniswap ticks", () => {
    for (const value of [-887272n, -198310n, -197910n, 887272n]) {
      expect(bytesToSignedBigInt(abiWord(value), 24)).toBe(value);
    }
  });
  it("preserves natural-width and empty byte input behavior", () => {
    expect(bytesToSignedBigInt(new Uint8Array([0xff]))).toBe(-1n);
    expect(bytesToSignedBigInt(new Uint8Array([0x7f]))).toBe(127n);
    expect(bytesToSignedBigInt(new Uint8Array())).toBe(0n);
  });
});
