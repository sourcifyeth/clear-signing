/**
 * Unit tests for the field processing pipeline (fields.ts).
 * Tests applyFieldFormats() with mocked resolvePath and getArrayLength
 * to verify field groups, iteration modes, separators, and slice handling.
 */

import { describe, it, expect, assert } from "vitest";
import {
  applyFieldFormats,
  applyByteSlice,
  bytesSliceToArgumentValue,
  bytesSliceToFieldType,
  parseByteSlice,
} from "../src/fields";
import type { ArgumentValue, BaseResolvePath } from "../src/descriptor";
import type {
  DescriptorFieldFormat,
  DescriptorFieldGroup,
  DescriptorFormatSpec,
} from "../src/types";
import { hexToBytes, isFieldGroup } from "../src/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a BaseResolvePath from a simple key→ArgumentValue map. */
function mapResolvePath(map: Record<string, ArgumentValue>): BaseResolvePath {
  return (path: string) => {
    const key = path.startsWith("#.") ? path.slice(2) : path;
    return map[key];
  };
}

/** Build a getArrayLength from a map of path→length. */
function mapArrayLength(map: Record<string, number>) {
  return (path: string) => map[path] ?? 0;
}

const UINT = (n: bigint): ArgumentValue => ({ type: "uint", value: n });
const ADDR = (hex: string): ArgumentValue => ({
  type: "address",
  bytes: hexToBytes(hex),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyFieldFormats", () => {
  describe("single fields", () => {
    it("renders a simple raw uint field", async () => {
      const format: DescriptorFormatSpec = {
        fields: [{ path: "amount", label: "Amount", format: "raw" }],
      };
      const resolvePath = mapResolvePath({ amount: UINT(42n) });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      expect(result.fields).toHaveLength(1);
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.label).toBe("Amount");
      expect(field.value).toBe("42");
      expect(field.fieldType).toBe("uint");
      expect(field.format).toBe("raw");
    });

    it("skips fields with visible=never", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          { path: "amount", label: "Amount", format: "raw" },
          {
            path: "hidden",
            label: "Hidden",
            format: "raw",
            visible: "never",
          },
        ],
      };
      const resolvePath = mapResolvePath({
        amount: UINT(1n),
        hidden: UINT(2n),
      });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      expect(result.fields).toHaveLength(1);
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.label).toBe("Amount");
    });

    it("merges field with $ref definition", async () => {
      const definitions: Record<string, DescriptorFieldFormat> = {
        myDef: { label: "Defined Label", format: "raw" },
      };
      const format: DescriptorFormatSpec = {
        fields: [{ path: "value", $ref: "$.display.definitions.myDef" }],
      };
      const resolvePath = mapResolvePath({ value: UINT(99n) });

      const result = await applyFieldFormats(
        format,
        definitions,
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      expect(result.fields).toHaveLength(1);
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.label).toBe("Defined Label");
      expect(field.value).toBe("99");
    });

    it("field params override definition params", async () => {
      const definitions: Record<string, DescriptorFieldFormat> = {
        dateDef: {
          label: "Date",
          format: "date",
          params: { encoding: "timestamp" },
        },
      };
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "ts",
            $ref: "$.display.definitions.dateDef",
            label: "Custom Date",
          },
        ],
      };
      const resolvePath = mapResolvePath({ ts: UINT(1700000000n) });

      const result = await applyFieldFormats(
        format,
        definitions,
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.label).toBe("Custom Date");
      expect(field.value).toContain("2023");
    });

    it("returns warning for missing field value", async () => {
      const format: DescriptorFormatSpec = {
        fields: [{ path: "missing", label: "Missing", format: "raw" }],
      };
      const resolvePath = mapResolvePath({});

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert("warnings" in result);
      expect(result.warnings[0].code).toBe("INVALID_DESCRIPTOR");
    });
  });

  describe("field group with group-level array path (pattern 1)", () => {
    it("iterates group over array elements", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "items.[]",
            label: "Items",
            fields: [
              { path: "name", label: "Name", format: "raw" },
              { path: "value", label: "Value", format: "raw" },
            ],
          } as DescriptorFieldGroup,
        ],
      };
      const resolvePath = mapResolvePath({
        "items.[0].name": { type: "string", value: "Alice" },
        "items.[0].value": UINT(100n),
        "items.[1].name": { type: "string", value: "Bob" },
        "items.[1].value": UINT(200n),
      });
      const getArrayLength = mapArrayLength({ items: 2 });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        getArrayLength,
        1,
        undefined,
      );

      assert(!("warnings" in result));
      expect(result.fields).toHaveLength(1);

      const group = result.fields[0];
      assert(isFieldGroup(group));
      expect(group.label).toBe("Items");
      expect(group.fields).toHaveLength(4);
      expect(group.fields[0].label).toBe("Name");
      expect(group.fields[0].value).toBe("Alice");
      expect(group.fields[1].label).toBe("Value");
      expect(group.fields[1].value).toBe("100");
      expect(group.fields[2].label).toBe("Name");
      expect(group.fields[2].value).toBe("Bob");
      expect(group.fields[3].label).toBe("Value");
      expect(group.fields[3].value).toBe("200");
    });

    it("returns EMPTY_ARRAY warning for empty group array", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "items.[]",
            label: "Items",
            fields: [{ path: "name", label: "Name", format: "raw" }],
          } as DescriptorFieldGroup,
        ],
      };
      const resolvePath = mapResolvePath({});
      const getArrayLength = mapArrayLength({ items: 0 });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        getArrayLength,
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const group = result.fields[0];
      assert(isFieldGroup(group));
      expect(group.fields).toHaveLength(0);
      assert(group.warning);
      expect(group.warning.code).toBe("EMPTY_ARRAY");
    });
  });

  describe("field group with child-level array paths (pattern 2)", () => {
    it("sequential mode: iterates each child array fully", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          {
            label: "Group",
            iteration: "sequential",
            fields: [
              {
                path: "addrs.[]",
                label: "Address",
                format: "raw",
              },
              {
                path: "vals.[]",
                label: "Value",
                format: "raw",
              },
            ],
          } as DescriptorFieldGroup,
        ],
      };
      const resolvePath = mapResolvePath({
        "addrs.[0]": ADDR("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        "addrs.[1]": ADDR("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        "vals.[0]": UINT(10n),
        "vals.[1]": UINT(20n),
      });
      const getArrayLength = mapArrayLength({ addrs: 2, vals: 2 });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        getArrayLength,
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const group = result.fields[0];
      assert(isFieldGroup(group));
      // Sequential: addrs[0], addrs[1], vals[0], vals[1]
      expect(group.fields).toHaveLength(4);
      expect(group.fields[0].label).toBe("Address");
      expect(group.fields[1].label).toBe("Address");
      expect(group.fields[2].label).toBe("Value");
      expect(group.fields[3].label).toBe("Value");
    });

    it("bundled mode: interleaves array elements", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          {
            label: "Group",
            iteration: "bundled",
            fields: [
              { path: "addrs.[]", label: "Address", format: "raw" },
              { path: "vals.[]", label: "Value", format: "raw" },
            ],
          } as DescriptorFieldGroup,
        ],
      };
      const resolvePath = mapResolvePath({
        "addrs.[0]": ADDR("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        "addrs.[1]": ADDR("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        "vals.[0]": UINT(10n),
        "vals.[1]": UINT(20n),
      });
      const getArrayLength = mapArrayLength({ addrs: 2, vals: 2 });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        getArrayLength,
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const group = result.fields[0];
      assert(isFieldGroup(group));
      // Bundled: addrs[0], vals[0], addrs[1], vals[1]
      expect(group.fields).toHaveLength(4);
      expect(group.fields[0].label).toBe("Address");
      expect(group.fields[1].label).toBe("Value");
      expect(group.fields[2].label).toBe("Address");
      expect(group.fields[3].label).toBe("Value");
    });

    it("bundled mode: returns error for mismatched array lengths", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          {
            label: "Group",
            iteration: "bundled",
            fields: [
              { path: "addrs.[]", label: "Address", format: "raw" },
              { path: "vals.[]", label: "Value", format: "raw" },
            ],
          } as DescriptorFieldGroup,
        ],
      };
      const resolvePath = mapResolvePath({});
      const getArrayLength = mapArrayLength({ addrs: 2, vals: 3 });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        getArrayLength,
        1,
        undefined,
      );

      assert("warnings" in result);
      expect(result.warnings[0].code).toBe("BUNDLED_ARRAY_SIZE_MISMATCH");
    });
  });

  describe("separator handling", () => {
    it("prepends separator with interpolated {index} to array elements", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          {
            label: "Group",
            iteration: "sequential",
            fields: [
              {
                path: "vals.[]",
                label: "Value",
                format: "raw",
                separator: "Item {index}",
              },
            ],
          } as DescriptorFieldGroup,
        ],
      };
      const resolvePath = mapResolvePath({
        "vals.[0]": UINT(10n),
        "vals.[1]": UINT(20n),
      });
      const getArrayLength = mapArrayLength({ vals: 2 });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        getArrayLength,
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const group = result.fields[0];
      assert(isFieldGroup(group));
      expect(group.fields[0].value).toBe("Item 0 10");
      expect(group.fields[1].value).toBe("Item 1 20");
    });
  });

  describe("byte slice paths (end-to-end via applyFieldFormats)", () => {
    it("resolves a byte slice on a uint256 field to extract an address for tokenPath", async () => {
      // srcToken is a uint256 where the last 20 bytes encode an address
      const srcTokenValue =
        0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48n;
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "inputAmount",
            label: "Amount",
            format: "tokenAmount",
            params: { tokenPath: "srcToken.[-20:]" },
          },
        ],
      };
      const resolvePath = mapResolvePath({
        inputAmount: UINT(1000000n),
        srcToken: UINT(srcTokenValue),
      });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
        {
          resolveToken: async (_chainId, addr) => {
            if (addr === "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48") {
              return { name: "USD Coin", symbol: "USDC", decimals: 6 };
            }
            return null;
          },
        },
      );

      assert(!("warnings" in result));
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.value).toBe("1 USDC");
    });

    it("resolves a byte slice to extract a uint timestamp via date format", async () => {
      // goodUntil.[-4:] → last 4 bytes as uint (timestamp)
      const goodUntilValue = BigInt(1700000000);
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "goodUntil.[-4:]",
            label: "Expires",
            format: "date",
            params: { encoding: "timestamp" },
          },
        ],
      };
      const resolvePath = mapResolvePath({
        goodUntil: UINT(goodUntilValue),
      });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.value).toContain("2023");
    });

    it("resolves byte range slice on bytes value with raw format", async () => {
      // data.[:1] → first byte, format=raw → bytes type
      const bytesData = new Uint8Array(64);
      bytesData[0] = 82; // 0x52
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "data.[:1]",
            label: "Selector",
            format: "raw",
          },
        ],
      };
      const resolvePath = mapResolvePath({
        data: { type: "bytes", bytes: bytesData },
      });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      // raw format on bytes → hex rendering
      expect(field.value).toBe("0x52");
      expect(field.fieldType).toBe("bytes");
    });

    it("converts byte slice to address when field format is addressName", async () => {
      // beneficiaryAndApproveFlag.[-20:] with addressName format
      // uint256 with address in last 20 bytes
      const flagValue =
        0x000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045n;
      const format: DescriptorFormatSpec = {
        fields: [
          {
            path: "flag.[-20:]",
            label: "Beneficiary",
            format: "addressName",
          },
        ],
      };
      const resolvePath = mapResolvePath({
        flag: UINT(flagValue),
      });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      const field = result.fields[0];
      assert(!isFieldGroup(field));
      expect(field.fieldType).toBe("address");
      expect(field.format).toBe("addressName");
      // Falls back to checksum address with UNKNOWN_ADDRESS warning
      assert(field.warning);
      expect(field.warning.code).toBe("UNKNOWN_ADDRESS");
    });
  });

  describe("byte slice utility functions", () => {
    it("parseByteSlice parses negative start slice", () => {
      const result = parseByteSlice("srcToken.[-20:]");
      assert(result);
      expect(result.basePath).toBe("srcToken");
      expect(result.slice.start).toBe(-20);
      expect(result.slice.end).toBeUndefined();
    });

    it("parseByteSlice parses range slice", () => {
      const result = parseByteSlice("data.[292:324]");
      assert(result);
      expect(result.basePath).toBe("data");
      expect(result.slice.start).toBe(292);
      expect(result.slice.end).toBe(324);
    });

    it("parseByteSlice parses start-only slice", () => {
      const result = parseByteSlice("data.[:1]");
      assert(result);
      expect(result.basePath).toBe("data");
      expect(result.slice.start).toBeUndefined();
      expect(result.slice.end).toBe(1);
    });

    it("parseByteSlice returns null for array index (no colon)", () => {
      expect(parseByteSlice("orders.[0]")).toBeNull();
      expect(parseByteSlice("orders.[-1]")).toBeNull();
    });

    it("parseByteSlice returns null for plain path", () => {
      expect(parseByteSlice("srcToken")).toBeNull();
    });

    it("applyByteSlice extracts last 20 bytes", () => {
      const bytes = new Uint8Array(32);
      bytes[12] = 0xaa;
      bytes[31] = 0xbb;
      const sliced = applyByteSlice(bytes, { start: -20 });
      expect(sliced.length).toBe(20);
      expect(sliced[0]).toBe(0xaa);
      expect(sliced[19]).toBe(0xbb);
    });

    it("applyByteSlice extracts first byte", () => {
      const bytes = new Uint8Array([0x52, 0x00, 0x00]);
      const sliced = applyByteSlice(bytes, { end: 1 });
      expect(sliced.length).toBe(1);
      expect(sliced[0]).toBe(0x52);
    });

    it("applyByteSlice extracts range", () => {
      const bytes = new Uint8Array(400);
      bytes[292] = 0xab;
      bytes[323] = 0xcd;
      const sliced = applyByteSlice(bytes, { start: 292, end: 324 });
      expect(sliced.length).toBe(32);
      expect(sliced[0]).toBe(0xab);
      expect(sliced[31]).toBe(0xcd);
    });

    it("applyByteSlice returns empty for invalid range", () => {
      const bytes = new Uint8Array(10);
      const sliced = applyByteSlice(bytes, { start: 5, end: 3 });
      expect(sliced.length).toBe(0);
    });

    it("bytesSliceToArgumentValue converts to address for tokenAmount format", () => {
      const addrBytes = hexToBytes(
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      );
      const result = bytesSliceToArgumentValue(
        { type: "bytes-slice", bytes: addrBytes },
        "tokenAmount",
      );
      // tokenAmount → uint type
      expect(result.type).toBe("uint");
    });

    it("bytesSliceToArgumentValue converts to address for addressName format", () => {
      const addrBytes = hexToBytes(
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      );
      const result = bytesSliceToArgumentValue(
        { type: "bytes-slice", bytes: addrBytes },
        "addressName",
      );
      expect(result.type).toBe("address");
    });

    it("bytesSliceToFieldType converts 20 bytes to address", () => {
      const addrBytes = hexToBytes(
        "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      );
      const result = bytesSliceToFieldType(addrBytes, "address");
      expect(result.type).toBe("address");
      assert(result.type === "address");
      expect(result.bytes.length).toBe(20);
    });

    it("bytesSliceToFieldType converts 32-byte ABI-encoded address", () => {
      const abiEncoded = new Uint8Array(32);
      // 12 zero bytes + 20 address bytes
      abiEncoded.set(
        hexToBytes("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
        12,
      );
      const result = bytesSliceToFieldType(abiEncoded, "address");
      expect(result.type).toBe("address");
      assert(result.type === "address");
      expect(result.bytes.length).toBe(20);
    });

    it("bytesSliceToFieldType converts bytes to uint", () => {
      const bytes = new Uint8Array([0x00, 0x01]);
      const result = bytesSliceToFieldType(bytes, "uint");
      expect(result.type).toBe("uint");
      assert(result.type === "uint");
      expect(result.value).toBe(1n);
    });

    it("bytesSliceToFieldType returns raw bytes for bytes type", () => {
      const bytes = new Uint8Array([0x52]);
      const result = bytesSliceToFieldType(bytes, "bytes");
      expect(result.type).toBe("bytes");
      assert(result.type === "bytes");
      expect(result.bytes[0]).toBe(0x52);
    });
  });

  describe("renderedValues for interpolation", () => {
    it("stores rendered values keyed by path", async () => {
      const format: DescriptorFormatSpec = {
        fields: [
          { path: "a", label: "A", format: "raw" },
          { path: "b", label: "B", format: "raw" },
        ],
      };
      const resolvePath = mapResolvePath({
        a: UINT(1n),
        b: { type: "string", value: "hello" },
      });

      const result = await applyFieldFormats(
        format,
        {},
        resolvePath,
        mapArrayLength({}),
        1,
        undefined,
      );

      assert(!("warnings" in result));
      expect(result.renderedValues.get("a")).toBe("1");
      expect(result.renderedValues.get("b")).toBe("hello");
    });
  });
});
