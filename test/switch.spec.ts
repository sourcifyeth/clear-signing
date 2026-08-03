import { describe, it, expect } from "vitest";
import { evaluateSwitchExpression, matchSwitchCase } from "../src/switch.js";
import { hexToBytes } from "../src/utils.js";
import type { ArgumentValue, ResolvePath } from "../src/descriptor.js";

describe("evaluateSwitchExpression", () => {
  const dummyResolvePath: ResolvePath = (path: string) => {
    if (path === "$.test") return { type: "uint", value: 123n };
    if (path === "@.slice")
      return { type: "bytes-slice", bytes: hexToBytes("0xabcd") };
    return undefined;
  };

  const payloadBuffer = hexToBytes("0x001122334455");

  it("resolves descriptor paths", () => {
    const val = evaluateSwitchExpression("$.test", {
      resolvePath: dummyResolvePath,
    });
    expect((val as { type: "uint"; value: bigint }).value).toBe(123n);
  });

  it("coerces bytes-slice to bytes", () => {
    const val = evaluateSwitchExpression("@.slice", {
      resolvePath: dummyResolvePath,
    });
    expect(val?.type).toBe("bytes");
    expect((val as { type: "bytes"; bytes: Uint8Array }).bytes).toEqual(
      hexToBytes("0xabcd"),
    );
  });

  it("extracts single byte from payloadBuffer", () => {
    const val = evaluateSwitchExpression(".[2]", {
      resolvePath: dummyResolvePath,
      payloadBuffer,
    });
    expect(val?.type).toBe("bytes");
    expect((val as { type: "bytes"; bytes: Uint8Array }).bytes).toEqual(
      hexToBytes("0x22"),
    );
  });

  it("extracts slice from payloadBuffer", () => {
    const val = evaluateSwitchExpression(".[2:5]", {
      resolvePath: dummyResolvePath,
      payloadBuffer,
    });
    expect(val?.type).toBe("bytes");
    expect((val as { type: "bytes"; bytes: Uint8Array }).bytes).toEqual(
      hexToBytes("0x223344"),
    );
  });

  it("returns empty buffer if slice start >= end", () => {
    const val = evaluateSwitchExpression(".[3:3]", {
      resolvePath: dummyResolvePath,
      payloadBuffer,
    });
    expect(val?.type).toBe("bytes");
    expect((val as { type: "bytes"; bytes: Uint8Array }).bytes).toEqual(
      new Uint8Array(0),
    );
  });

  it("returns undefined for unknown paths", () => {
    expect(
      evaluateSwitchExpression("$.unknown", { resolvePath: dummyResolvePath }),
    ).toBeUndefined();
  });

  it("returns undefined for slice if payloadBuffer is missing", () => {
    expect(
      evaluateSwitchExpression(".[0:1]", { resolvePath: dummyResolvePath }),
    ).toBeUndefined();
  });
});

describe("matchSwitchCase", () => {
  it("matches uint correctly", () => {
    const expr: ArgumentValue = { type: "uint", value: 42n };
    expect(matchSwitchCase(expr, "42")).toBe(true);
    expect(matchSwitchCase(expr, "0x2a")).toBe(true);
    expect(matchSwitchCase(expr, "43")).toBe(false);
  });

  it("matches bool correctly", () => {
    const exprTrue: ArgumentValue = { type: "bool", value: true };
    expect(matchSwitchCase(exprTrue, "true")).toBe(true);
    expect(matchSwitchCase(exprTrue, "1")).toBe(true);
    expect(matchSwitchCase(exprTrue, "false")).toBe(false);

    const exprFalse: ArgumentValue = { type: "bool", value: false };
    expect(matchSwitchCase(exprFalse, "false")).toBe(true);
    expect(matchSwitchCase(exprFalse, "0")).toBe(true);
    expect(matchSwitchCase(exprFalse, "true")).toBe(false);
  });

  it("matches address correctly", () => {
    const expr: ArgumentValue = {
      type: "address",
      bytes: hexToBytes("0x1111111111111111111111111111111111111111"),
    };
    expect(
      matchSwitchCase(expr, "0x1111111111111111111111111111111111111111"),
    ).toBe(true);
    expect(
      matchSwitchCase(expr, "1111111111111111111111111111111111111111"),
    ).toBe(true);
    expect(
      matchSwitchCase(expr, "0x2222222222222222222222222222222222222222"),
    ).toBe(false);
  });

  it("matches bytes correctly", () => {
    const expr: ArgumentValue = { type: "bytes", bytes: hexToBytes("0xabcd") };
    expect(matchSwitchCase(expr, "0xabcd")).toBe(true);
    expect(matchSwitchCase(expr, "abcd")).toBe(true);
    expect(matchSwitchCase(expr, "0xab")).toBe(false);
  });

  it("matches string correctly", () => {
    const expr: ArgumentValue = { type: "string", value: "hello" };
    expect(matchSwitchCase(expr, "hello")).toBe(true);
    expect(matchSwitchCase(expr, "world")).toBe(false);
  });
});
