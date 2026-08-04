import { describe, it, expect } from "vitest";
import { decodeLayoutField, layoutSourceBuffer } from "../src/layout.js";
import { applyFieldFormats } from "../src/fields.js";
import { hexToBytes } from "../src/utils.js";
import type { LayoutNode, DescriptorFormatSpec } from "../src/types.js";
import type { ArgumentValue } from "../src/descriptor.js";

describe("layoutSourceBuffer", () => {
  it("pads boolean to 32 bytes", () => {
    const val: ArgumentValue = { type: "bool", value: true };
    const buf = layoutSourceBuffer(val);
    expect(buf.length).toBe(32);
    expect(buf[31]).toBe(1);
    expect(buf[0]).toBe(0);
  });

  it("pads address to 32 bytes", () => {
    const val: ArgumentValue = {
      type: "address",
      bytes: hexToBytes("0x1111111111111111111111111111111111111111"),
    };
    const buf = layoutSourceBuffer(val);
    expect(buf.length).toBe(32);
    expect(buf[31]).toBe(0x11);
    expect(buf[12]).toBe(0x11);
    expect(buf[11]).toBe(0);
  });

  it("pads uint to 32 bytes", () => {
    const val: ArgumentValue = { type: "uint", value: 255n };
    const buf = layoutSourceBuffer(val);
    expect(buf.length).toBe(32);
    expect(buf[31]).toBe(0xff);
    expect(buf[0]).toBe(0);
  });

  it("pads int to 32 bytes (sign extended)", () => {
    const val: ArgumentValue = { type: "int", value: -1n };
    const buf = layoutSourceBuffer(val);
    expect(buf.length).toBe(32);
    expect(buf[31]).toBe(0xff);
    expect(buf[0]).toBe(0xff);
  });

  it("keeps bytes as is", () => {
    const val: ArgumentValue = { type: "bytes", bytes: hexToBytes("0xabcd") };
    const buf = layoutSourceBuffer(val);
    expect(buf.length).toBe(2);
    expect(buf[0]).toBe(0xab);
  });
});

describe("decodeNode", () => {
  it("decodes uint (endian and mask)", () => {
    const resolved = new Map<string, ArgumentValue>();
    // 4 bytes: 0xaabbccdd
    const buf = hexToBytes("0xaabbccdd");

    // BE
    decodeLayoutField({ type: "uint", bytes: 4 }, buf, "val1", resolved);
    expect(
      (resolved.get("val1") as { type: "uint"; value: bigint }).value,
    ).toBe(0xaabbccddn);

    // LE
    decodeLayoutField(
      { type: "uint", bytes: 4, endian: "le" },
      buf,
      "val2",
      resolved,
    );
    expect(
      (resolved.get("val2") as { type: "uint"; value: bigint }).value,
    ).toBe(0xddccbbaan);

    // Mask (0x00ff00ff)
    decodeLayoutField(
      { type: "uint", bytes: 4, mask: "0x00ff00ff" },
      buf,
      "val3",
      resolved,
    );
    expect(
      (resolved.get("val3") as { type: "uint"; value: bigint }).value,
    ).toBe(0x00bb00ddn);
  });

  it("returns LAYOUT_DECODE_ERROR on OOB read", () => {
    const resolved = new Map<string, ArgumentValue>();
    const buf = hexToBytes("0xaa");
    const warning = decodeLayoutField(
      { type: "uint", bytes: 4 },
      buf,
      "val1",
      resolved,
    );
    expect(warning?.code).toBe("LAYOUT_DECODE_ERROR");
  });

  it("decodes object and resolves sibling paths", () => {
    const resolved = new Map<string, ArgumentValue>();
    // { a: uint8, b: address }
    const buf = hexToBytes("0xaa1111111111111111111111111111111111111111"); // 1 byte + 20 bytes

    const node: LayoutNode = {
      type: "object",
      fields: [
        { name: "a", schema: { type: "uint", bytes: 1 } },
        { name: "b", schema: { type: "address" } },
      ],
    };

    decodeLayoutField(node, buf, "obj", resolved);
    expect(
      (resolved.get("obj.a") as { type: "uint"; value: bigint }).value,
    ).toBe(0xaan);
    expect(
      (resolved.get("obj.b") as { type: "address"; bytes: Uint8Array }).bytes,
    ).toEqual(hexToBytes("0x1111111111111111111111111111111111111111"));
  });

  it("decodes sequence with count", () => {
    const resolved = new Map<string, ArgumentValue>();
    const buf = hexToBytes("0xaaabbb");
    const node: LayoutNode = {
      type: "sequence",
      element: { type: "uint", bytes: 1 },
      count: 3,
    };
    const warning = decodeLayoutField(node, buf, "seq", resolved);
    expect(warning).toBeUndefined();
    expect(
      (resolved.get("seq.[0]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xaan);
    expect(
      (resolved.get("seq.[1]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xabn);
    expect(
      (resolved.get("seq.[2]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xbbn);
    // actually, wait, 0xaaabbbccc is 4.5 bytes -> invalid hex.
    // Let's use "0xaaabbbcc" -> 4 bytes
  });

  it("decodes sequence with exact multiple (exhaust)", () => {
    const resolved = new Map<string, ArgumentValue>();
    const buf = hexToBytes("0xaaabbbcc"); // 4 bytes
    const node: LayoutNode = {
      type: "sequence",
      element: { type: "uint", bytes: 1 },
    };
    const warning = decodeLayoutField(node, buf, "seq", resolved);
    expect(warning).toBeUndefined();
    expect(
      (resolved.get("seq.[0]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xaan);
    expect(
      (resolved.get("seq.[1]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xabn);
    expect(
      (resolved.get("seq.[2]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xbbn);
    expect(
      (resolved.get("seq.[3]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xccn);
  });

  it("decodes sequence with countFrom", () => {
    const resolved = new Map<string, ArgumentValue>();
    const buf = hexToBytes("0x02aabb");
    const node: LayoutNode = {
      type: "object",
      fields: [
        { name: "len", schema: { type: "uint", bytes: 1 } },
        {
          name: "items",
          schema: {
            type: "sequence",
            element: { type: "uint", bytes: 1 },
            countFrom: "len",
          },
        },
      ],
    };
    const warning = decodeLayoutField(node, buf, "obj", resolved);
    expect(warning).toBeUndefined();
    expect(
      (resolved.get("obj.len") as { type: "uint"; value: bigint }).value,
    ).toBe(2n);
    expect(
      (resolved.get("obj.items.[0]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xaan);
    expect(
      (resolved.get("obj.items.[1]") as { type: "uint"; value: bigint }).value,
    ).toBe(0xbbn);
  });
});

describe("applyFieldFormats with layout", () => {
  it("decodes an anchored layout and resolves a child path", async () => {
    const formatSpec: DescriptorFormatSpec = {
      fields: [
        {
          label: "My Layout Anchor",
          path: "$.data",
          layout: {
            type: "object",
            fields: [{ name: "a", schema: { type: "uint", bytes: 1 } }],
          },
        },
        {
          label: "Value A",
          path: "$.data.a",
          format: "raw",
        },
      ],
    };

    // Provide a mocked base resolver
    const baseResolve = (path: string) => {
      if (path === "$.data") {
        return { type: "bytes", bytes: hexToBytes("0xff") } as ArgumentValue;
      }
      return undefined;
    };

    const result = await applyFieldFormats(
      formatSpec,
      {},
      baseResolve,
      () => 0,
      1,
      undefined,
    );

    if ("warnings" in result) {
      throw new Error(
        `Unexpected warnings: ${JSON.stringify(result.warnings)}`,
      );
    }

    expect(result.fields).toHaveLength(2);
    // wait, layout anchor field has `layout` but no `format`.
    // It should render as "raw" according to the plan ("default effectiveFormat = merged.format ?? 'raw'").
    // So the layout anchor itself might be rendered, AND the child field "Value A".
    expect(result.fields).toHaveLength(2);
    expect((result.fields[1] as { value: string }).value).toBe("255");
    expect((result.fields[1] as { label: string }).label).toBe("Value A");
  });
});

describe("decodeNode - bitfield", () => {
  it("decodes single bits and multi-bit ranges correctly", () => {
    // 0x81 = 1000 0001
    // bit 7 = 1, bit 0 = 1, bit 1 = 0
    // bits [3, 0] = 0001 = 1
    // bits [7, 4] = 1000 = 8
    // bits [7, 0] = 0x81 = 129
    const buffer = hexToBytes("0x81");
    const node: LayoutNode = {
      type: "bitfield",
      bytes: 1,
      fields: [
        { name: "flag7", bit: 7 },
        { name: "flag0", bit: 0 },
        { name: "flag1", bit: 1 },
        { name: "lowNibble", bits: [3, 0] },
        { name: "highNibble", bits: [7, 4] },
        { name: "full", bits: [7, 0] },
      ],
    };

    const ctx = {
      buffer,
      offset: 0,
      depth: 0,
      resolvedValues: new Map(),
    };

    const warning = decodeLayoutField(
      node,
      buffer,
      "flags",
      ctx.resolvedValues,
    );
    expect(warning).toBeUndefined();
    expect(ctx.resolvedValues.get("flags.flag7")).toEqual({
      type: "bool",
      value: true,
    });
    expect(ctx.resolvedValues.get("flags.flag0")).toEqual({
      type: "bool",
      value: true,
    });
    expect(ctx.resolvedValues.get("flags.flag1")).toEqual({
      type: "bool",
      value: false,
    });
    expect(ctx.resolvedValues.get("flags.lowNibble")).toEqual({
      type: "uint",
      value: 1n,
    });
    expect(ctx.resolvedValues.get("flags.highNibble")).toEqual({
      type: "uint",
      value: 8n,
    });
    expect(ctx.resolvedValues.get("flags.full")).toEqual({
      type: "uint",
      value: 129n,
    });
  });

  it("handles overlapping ranges", () => {
    // 0xff = 1111 1111
    const buffer = hexToBytes("0xff");
    const node: LayoutNode = {
      type: "bitfield",
      bytes: 1,
      fields: [
        { name: "b0", bit: 0 },
        { name: "b0", bit: 0 }, // Duplicate name overwrites
        { name: "b01", bits: [1, 0] },
      ],
    };

    const ctx = {
      buffer,
      offset: 0,
      depth: 0,
      resolvedValues: new Map(),
    };

    decodeLayoutField(node, buffer, "flags", ctx.resolvedValues);
    expect(ctx.resolvedValues.get("flags.b0")).toEqual({
      type: "bool",
      value: true,
    });
    expect(ctx.resolvedValues.get("flags.b01")).toEqual({
      type: "uint",
      value: 3n,
    });
  });

  it("honors endianness", () => {
    // 0x0102
    // BE -> val = 0x0102 = 258
    // LE -> slice reversed -> [0x02, 0x01] -> val = 0x0201 = 513
    const buffer = hexToBytes("0x0102");

    // Test BE
    const nodeBE: LayoutNode = {
      type: "bitfield",
      bytes: 2,
      endian: "be",
      fields: [{ name: "val", bits: [15, 0] }],
    };
    const ctxBE = { buffer, offset: 0, depth: 0, resolvedValues: new Map() };
    decodeLayoutField(nodeBE, buffer, "flags", ctxBE.resolvedValues);
    expect(ctxBE.resolvedValues.get("flags.val")).toEqual({
      type: "uint",
      value: 258n,
    });

    // Test LE
    // NOTE: slice.reverse() mutates the slice in place, which is a view of buffer if we used subarray!
    // But slice() returns a new array, so buffer shouldn't be mutated.
    const nodeLE: LayoutNode = {
      type: "bitfield",
      bytes: 2,
      endian: "le",
      fields: [{ name: "val", bits: [15, 0] }],
    };
    const ctxLE = { buffer, offset: 0, depth: 0, resolvedValues: new Map() };
    decodeLayoutField(nodeLE, buffer, "flags", ctxLE.resolvedValues);
    expect(ctxLE.resolvedValues.get("flags.val")).toEqual({
      type: "uint",
      value: 513n,
    });
  });

  it("returns INVALID_DESCRIPTOR for out-of-width-range and malformed bits", () => {
    const buffer = hexToBytes("0x00");

    // bit too high
    expect(
      decodeLayoutField(
        { type: "bitfield", bytes: 1, fields: [{ name: "x", bit: 8 }] },
        buffer,
        "flags",
        new Map(),
      ),
    ).toEqual({ code: "INVALID_DESCRIPTOR", message: expect.any(String) });

    // bit negative
    expect(
      decodeLayoutField(
        { type: "bitfield", bytes: 1, fields: [{ name: "x", bit: -1 }] },
        buffer,
        "flags",
        new Map(),
      ),
    ).toEqual({ code: "INVALID_DESCRIPTOR", message: expect.any(String) });

    // bits hi too high
    expect(
      decodeLayoutField(
        { type: "bitfield", bytes: 1, fields: [{ name: "x", bits: [8, 0] }] },
        buffer,
        "flags",
        new Map(),
      ),
    ).toEqual({ code: "INVALID_DESCRIPTOR", message: expect.any(String) });

    // bits lo > hi
    expect(
      decodeLayoutField(
        { type: "bitfield", bytes: 1, fields: [{ name: "x", bits: [2, 3] }] },
        buffer,
        "flags",
        new Map(),
      ),
    ).toEqual({ code: "INVALID_DESCRIPTOR", message: expect.any(String) });

    // bits negative
    expect(
      decodeLayoutField(
        { type: "bitfield", bytes: 1, fields: [{ name: "x", bits: [2, -1] }] },
        buffer,
        "flags",
        new Map(),
      ),
    ).toEqual({ code: "INVALID_DESCRIPTOR", message: expect.any(String) });

    // missing both bit and bits
    expect(
      decodeLayoutField(
        { type: "bitfield", bytes: 1, fields: [{ name: "x" }] },
        buffer,
        "flags",
        new Map(),
      ),
    ).toEqual({ code: "INVALID_DESCRIPTOR", message: expect.any(String) });
  });
});
