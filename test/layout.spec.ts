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
