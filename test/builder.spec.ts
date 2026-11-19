/**
 * Unit tests for the builder entry point: input fields of a format spec,
 * input models from a resolver, and the calldata builder.
 */

import { describe, it, expect, assert } from "vitest";
import {
  buildCalldata,
  buildInputFields,
  getCalldataInputModels,
} from "../src/builder.js";
import { parseFunctionSignatureKey } from "../src/calldata.js";
import type { FunctionInput } from "../src/calldata.js";
import type { BuilderOptions, InputModel } from "../src/builder.types.js";
import type {
  Descriptor,
  DescriptorFormatSpec,
  RegistryIndex,
} from "../src/types.js";
import { bytesToHex, selectorForSignature } from "../src/utils.js";
import { pad32, padAddr, padInt, padRight32 } from "./utils.js";

const CHAIN_ID = 1;
const CONTRACT = "0x1111111111111111111111111111111111111111";
const ALICE = "0x2222222222222222222222222222222222222222";
const BOB = "0x3333333333333333333333333333333333333333";

function inputsOf(signature: string): FunctionInput[] {
  const parsed = parseFunctionSignatureKey(signature);
  assert(parsed);
  return parsed.inputs;
}

function fieldsOf(
  spec: DescriptorFormatSpec,
  signature: string,
  definitions = {},
  metadata = {},
) {
  return buildInputFields(spec, definitions, metadata, inputsOf(signature));
}

/** Format options backed by an in-memory descriptor map. */
function memoryOpts(
  index: Partial<RegistryIndex>,
  descriptors: Record<string, Descriptor>,
): BuilderOptions {
  return {
    descriptorResolverOptions: {
      type: "custom",
      resolver: {
        index: { calldataIndex: {}, typedDataIndex: {}, ...index },
        fetchDescriptor: async (path) => {
          const descriptor = descriptors[path];
          if (!descriptor) throw new Error(`no file ${path}`);
          return descriptor;
        },
      },
    },
  };
}

function calldataModel(signature: string): InputModel {
  const selector = parseFunctionSignatureKey(signature)?.selector;
  return {
    signature,
    selector: selector ? bytesToHex(selector) : "",
    fields: [],
  };
}

function selectorHex(canonical: string): string {
  return bytesToHex(selectorForSignature(canonical));
}

// ---------------------------------------------------------------------------
// buildInputFields
// ---------------------------------------------------------------------------

describe("buildInputFields", () => {
  it("merges $ref definitions, marks hidden fields and appends uncovered inputs", () => {
    const result = fieldsOf(
      {
        fields: [
          {
            path: "amount",
            $ref: "$.display.definitions.amount",
            params: { tokenPath: "token" },
          },
          { path: "#.recipient", format: "addressName", visible: "never" },
        ],
      },
      "send(address token,uint256 amount,address recipient)",
      {
        amount: {
          label: "Amount",
          format: "tokenAmount",
          params: { threshold: "0xff" },
        },
      },
    );

    expect(result).toEqual({
      fields: [
        {
          label: "Amount",
          path: "amount",
          type: "uint256",
          format: "tokenAmount",
          params: { threshold: "0xff", tokenPath: "token" },
        },
        {
          label: "recipient",
          path: "recipient",
          type: "address",
          format: "addressName",
          hidden: true,
        },
        { label: "token", path: "token", type: "address" },
      ],
    });
  });

  it("lists literal and $.metadata constants with their values", () => {
    const result = fieldsOf(
      {
        fields: [
          { label: "Fee tier", value: 30, format: "raw" },
          {
            label: "Router",
            path: "$.metadata.constants.router",
            format: "addressName",
          },
          { label: "Pool", value: "$.metadata.constants.pool" },
          { value: true },
          { label: "Missing", path: "$.metadata.constants.missing" },
        ],
      },
      "swap()",
      {},
      { constants: { router: ALICE, pool: "WETH/USDC" } },
    );

    expect(result).toEqual({
      fields: [
        { label: "Fee tier", constant: 30, format: "raw" },
        { label: "Router", constant: ALICE, format: "addressName" },
        { label: "Pool", constant: "WETH/USDC" },
        { label: "", constant: true },
      ],
    });
  });

  it("emits @.value as a uint256 input and skips other container paths", () => {
    const result = fieldsOf(
      {
        fields: [
          { label: "Value", path: "@.value", format: "amount" },
          { label: "From", path: "@.from", format: "addressName" },
          { path: "@.to", format: "addressName" },
        ],
      },
      "deposit()",
    );

    expect(result).toEqual({
      fields: [
        { label: "Value", path: "@.value", type: "uint256", format: "amount" },
      ],
    });
  });

  it("skips byte slices and fixed indices and appends the inputs they leave uncovered", () => {
    const result = fieldsOf(
      {
        fields: [
          { label: "Selector", path: "#.data.[:4]", format: "raw" },
          { label: "First token", path: "legs.[0].token", format: "raw" },
          { label: "Last amount", path: "legs.[-1].amount", format: "raw" },
          { label: "Recipient", path: "flags.[-20:]", format: "raw" },
        ],
      },
      "route(bytes data,(address token,uint256 amount)[] legs,uint256 flags)",
    );

    expect(result).toEqual({
      fields: [
        { label: "data", path: "data", type: "bytes" },
        {
          label: "legs",
          path: "legs",
          type: "(address token,uint256 amount)[]",
        },
        { label: "flags", path: "flags", type: "uint256" },
      ],
    });
  });

  it("applies the group prefix of struct groups and array groups", () => {
    const result = fieldsOf(
      {
        fields: [
          {
            path: "#.order",
            label: "Order",
            fields: [
              { path: "fee", label: "Fee", format: "raw" },
              { path: "@.value", label: "Value", format: "amount" },
              { path: "$.metadata.constants.fee", label: "Fee cap" },
            ],
          },
          {
            path: "items.[]",
            fields: [{ path: "#.amount", label: "Amount", format: "raw" }],
          },
          {
            path: "hops",
            label: "Hops",
            iteration: "bundled",
            fields: [
              { path: "hops.[].pool", label: "Pool", format: "raw" },
              { path: "fees.[]", label: "Hop fee", format: "raw" },
            ],
          },
        ],
      },
      "fill((address maker,uint256 fee) order,(address token,uint256 amount)[] items,(address pool,bytes data)[] hops,uint24[] fees)",
      {},
      { constants: { fee: 100 } },
    );

    expect(result).toEqual({
      fields: [
        {
          label: "Order",
          path: "order",
          fields: [
            { label: "Fee", path: "order.fee", type: "uint256", format: "raw" },
            {
              label: "Value",
              path: "@.value",
              type: "uint256",
              format: "amount",
            },
            { label: "Fee cap", constant: 100 },
          ],
        },
        {
          path: "items.[]",
          fields: [
            {
              label: "Amount",
              path: "items.[].amount",
              type: "uint256",
              format: "raw",
            },
          ],
        },
        {
          label: "Hops",
          path: "hops",
          fields: [
            {
              label: "Pool",
              path: "hops.[].pool",
              type: "address",
              format: "raw",
            },
            {
              label: "Hop fee",
              path: "fees.[]",
              type: "uint24",
              format: "raw",
            },
          ],
        },
        { label: "maker", path: "order.maker", type: "address" },
        { label: "token", path: "items.[].token", type: "address" },
        { label: "data", path: "hops.[].data", type: "bytes" },
      ],
    });
  });

  it("appends only the uncovered parts of a partly covered tuple", () => {
    const result = fieldsOf(
      {
        fields: [
          { path: "recipients.[]", label: "Recipient", format: "raw" },
          { path: "settings.limits.max", label: "Maximum", format: "raw" },
          { path: "settings.owner", label: "Owner", format: "raw" },
        ],
      },
      "setup(address[] recipients,(address owner,(uint256 min,uint256 max) limits,bool paused) settings)",
    );

    expect(result).toEqual({
      fields: [
        {
          label: "Recipient",
          path: "recipients.[]",
          type: "address",
          format: "raw",
        },
        {
          label: "Maximum",
          path: "settings.limits.max",
          type: "uint256",
          format: "raw",
        },
        {
          label: "Owner",
          path: "settings.owner",
          type: "address",
          format: "raw",
        },
        { label: "min", path: "settings.limits.min", type: "uint256" },
        { label: "paused", path: "settings.paused", type: "bool" },
      ],
    });
  });

  it("covers the whole input when a field names a tuple", () => {
    const result = fieldsOf(
      { fields: [{ path: "order", label: "Order", format: "raw" }] },
      "submit((address token,uint256 amount) order)",
    );

    expect(result).toEqual({
      fields: [
        {
          label: "Order",
          path: "order",
          type: "(address token,uint256 amount)",
          format: "raw",
        },
      ],
    });
  });

  it("skips a field whose path names no input and covers nothing", () => {
    const result = fieldsOf(
      {
        fields: [
          { path: "amuont", label: "Typo", format: "raw" },
          { path: "b.[]", label: "Bytes element", format: "raw" },
        ],
      },
      "f(uint256 amount,bytes b)",
    );

    expect(result).toEqual({
      fields: [
        { label: "amount", path: "amount", type: "uint256" },
        { label: "b", path: "b", type: "bytes" },
      ],
    });
  });

  it("makes path params absolute like the path, inside and outside groups", () => {
    const fieldSpec = {
      path: "amount",
      format: "tokenAmount" as const,
      params: {
        tokenPath: "#.token",
        chainIdPath: "@.chainId",
        token: { map: "$.metadata.maps.tokens", keyPath: "token" },
        collection: { map: "$.metadata.maps.tokens", keyPath: "@.to" },
        message: "token",
      },
    };
    const spec: DescriptorFormatSpec = {
      fields: [
        { path: "orders.[]", fields: [fieldSpec] },
        {
          path: "#.fee",
          format: "tokenAmount",
          params: { tokenPath: "#.feeToken" },
        },
      ],
    };
    const result = fieldsOf(
      spec,
      "fill((address token,uint256 amount)[] orders,uint256 fee,address feeToken)",
    );

    expect(result).toEqual({
      fields: [
        {
          path: "orders.[]",
          fields: [
            {
              label: "amount",
              path: "orders.[].amount",
              type: "uint256",
              format: "tokenAmount",
              params: {
                tokenPath: "orders.[].token",
                chainIdPath: "@.chainId",
                token: {
                  map: "$.metadata.maps.tokens",
                  keyPath: "orders.[].token",
                },
                collection: { map: "$.metadata.maps.tokens", keyPath: "@.to" },
                message: "token",
              },
            },
          ],
        },
        {
          label: "fee",
          path: "fee",
          type: "uint256",
          format: "tokenAmount",
          params: { tokenPath: "feeToken" },
        },
        { label: "token", path: "orders.[].token", type: "address" },
        { label: "feeToken", path: "feeToken", type: "address" },
      ],
    });
    // The descriptor is not changed.
    expect(fieldSpec.params.tokenPath).toBe("#.token");
    expect(fieldSpec.params.token.keyPath).toBe("token");
  });

  it("uses the ABI name as label for unlabeled fields in a group, hidden ones included", () => {
    const result = fieldsOf(
      {
        fields: [
          {
            path: "#.order",
            label: "Order",
            fields: [
              { path: "fee", format: "raw" },
              { path: "maker", visible: "never" },
            ],
          },
        ],
      },
      "f((address maker,uint256 fee) order)",
    );

    expect(result).toEqual({
      fields: [
        {
          label: "Order",
          path: "order",
          fields: [
            { label: "fee", path: "order.fee", type: "uint256", format: "raw" },
            {
              label: "maker",
              path: "order.maker",
              type: "address",
              hidden: true,
            },
          ],
        },
      ],
    });
  });

  it("returns DEFINITIONS_RESOLUTION_ERROR for an unknown $ref", () => {
    const result = fieldsOf(
      {
        fields: [
          {
            path: "#.order",
            fields: [{ path: "fee", $ref: "$.display.definitions.nope" }],
          },
        ],
      },
      "f((uint256 fee) order)",
    );

    expect(result).toEqual({
      warnings: [
        {
          code: "DEFINITIONS_RESOLUTION_ERROR",
          message:
            "Unknown display definition reference '$.display.definitions.nope'",
        },
      ],
    });
  });

  it("returns UNSUPPORTED_NESTED_FIELD_GROUP for a nested group", () => {
    const result = fieldsOf(
      {
        fields: [
          {
            path: "#.order",
            fields: [{ path: "inner", fields: [{ path: "fee" }] }],
          },
        ],
      },
      "f(((uint256 fee) inner) order)",
    );

    expect(result).toEqual({
      warnings: [
        {
          code: "UNSUPPORTED_NESTED_FIELD_GROUP",
          message: "Nested field groups are not supported",
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// getCalldataInputModels
// ---------------------------------------------------------------------------

describe("getCalldataInputModels", () => {
  const CAIP = `eip155:${CHAIN_ID}:${CONTRACT}`;
  const descriptor: Descriptor = {
    context: {
      contract: { deployments: [{ chainId: CHAIN_ID, address: CONTRACT }] },
    },
    metadata: { owner: "Example", contractName: "Vault" },
    display: {
      formats: {
        "deposit(address receiver,uint256 assets)": {
          intent: "Deposit",
          fields: [{ path: "assets", label: "Assets", format: "raw" }],
        },
        "f(uint256,(address,bool))": {},
        "broken(uint256 a)": {
          fields: [{ path: "a", $ref: "$.display.definitions.missing" }],
        },
        notASignature: { intent: "Ignored" },
      },
    },
  };

  it("returns one model per function and names unnamed inputs param<i>", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      CONTRACT,
      memoryOpts(
        { calldataIndex: { [CAIP]: "vault.json" } },
        {
          "vault.json": descriptor,
        },
      ),
    );

    expect(result).toEqual({
      models: [
        {
          signature: "deposit(address receiver,uint256 assets)",
          selector: selectorHex("deposit(address,uint256)"),
          metadata: {
            owner: "Example",
            contractName: "Vault",
            info: undefined,
          },
          intent: "Deposit",
          fields: [
            { label: "Assets", path: "assets", type: "uint256", format: "raw" },
            { label: "receiver", path: "receiver", type: "address" },
          ],
        },
        {
          signature: "f(uint256,(address,bool))",
          selector: selectorHex("f(uint256,(address,bool))"),
          metadata: {
            owner: "Example",
            contractName: "Vault",
            info: undefined,
          },
          fields: [
            { label: "param0", path: "param0", type: "uint256" },
            {
              label: "param1",
              path: "param1",
              type: "(address param0,bool param1)",
            },
          ],
        },
      ],
      warnings: [
        {
          code: "DEFINITIONS_RESOLUTION_ERROR",
          message:
            "Format 'broken(uint256 a)' has no input model: Unknown display definition reference '$.display.definitions.missing'",
        },
      ],
    });
  });

  it("returns NO_DESCRIPTOR when nothing is indexed", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      CONTRACT,
      memoryOpts({}, {}),
    );
    expect(result).toEqual({
      warnings: [
        {
          code: "NO_DESCRIPTOR",
          message: `No descriptor found for chain ${CHAIN_ID} and address ${CONTRACT}`,
        },
      ],
    });
  });

  it("returns DEPLOYMENT_MISMATCH when the descriptor is not bound to the address", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      CONTRACT,
      memoryOpts(
        { calldataIndex: { [CAIP]: "vault.json" } },
        {
          "vault.json": {
            ...descriptor,
            context: {
              contract: { deployments: [{ chainId: 10, address: CONTRACT }] },
            },
          },
        },
      ),
    );
    expect(result).toEqual({
      warnings: [
        {
          code: "DEPLOYMENT_MISMATCH",
          message: `Descriptor is not bound to chain ${CHAIN_ID} and address ${CONTRACT}`,
        },
      ],
    });
  });

  it("returns DESCRIPTOR_FETCH_ERROR when the descriptor fetch throws", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      CONTRACT,
      memoryOpts({ calldataIndex: { [CAIP]: "absent.json" } }, {}),
    );
    expect(result).toEqual({
      warnings: [
        {
          code: "DESCRIPTOR_FETCH_ERROR",
          message: `Failed to resolve descriptor for chain ${CHAIN_ID} and address ${CONTRACT}: Error: no file absent.json`,
        },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// buildCalldata
// ---------------------------------------------------------------------------

describe("buildCalldata", () => {
  it("encodes static arguments", () => {
    const result = buildCalldata(
      calldataModel("transfer(address to,uint256 amount)"),
      { to: ALICE, amount: 1_000_000n },
    );
    expect(result).toEqual({
      data: "0xa9059cbb" + padAddr(ALICE) + padInt(1_000_000n),
    });
  });

  it("accepts numbers and decimal or hex strings for integers", () => {
    const expected = "0xa9059cbb" + padAddr(ALICE) + padInt(255n);
    const model = calldataModel("transfer(address to,uint256 amount)");
    expect(buildCalldata(model, { to: ALICE, amount: 255 })).toEqual({
      data: expected,
    });
    expect(buildCalldata(model, { to: ALICE, amount: "255" })).toEqual({
      data: expected,
    });
    expect(buildCalldata(model, { to: ALICE, amount: "0xff" })).toEqual({
      data: expected,
    });
  });

  it("encodes dynamic string and bytes arguments", () => {
    const result = buildCalldata(calldataModel("f(string s,bytes b)"), {
      s: "abc",
      b: "0x1234",
    });
    expect(result).toEqual({
      data:
        selectorHex("f(string,bytes)") +
        pad32("40") +
        pad32("80") +
        pad32("3") +
        padRight32("616263") +
        pad32("2") +
        padRight32("1234"),
    });
  });

  it("encodes a static tuple inline with signed integers in two's complement", () => {
    const result = buildCalldata(
      calldataModel("g((uint8 a,bool b) t,int16 c)"),
      {
        t: { a: 255, b: true },
        c: -1,
      },
    );
    expect(result).toEqual({
      data:
        selectorHex("g((uint8,bool),int16)") +
        padInt(255n) +
        padInt(1n) +
        padInt(-1n),
    });
  });

  it("encodes dynamic arrays, fixed arrays and bytesN", () => {
    const id = "0x" + "ab".repeat(32);
    const result = buildCalldata(
      calldataModel("h(uint256[] xs,address[2] pair,bytes32 id)"),
      { xs: [1n, 2n], pair: [ALICE, BOB], id },
    );
    expect(result).toEqual({
      data:
        selectorHex("h(uint256[],address[2],bytes32)") +
        pad32("80") +
        padAddr(ALICE) +
        padAddr(BOB) +
        id.slice(2) +
        pad32("2") +
        pad32("1") +
        pad32("2"),
    });
  });

  it("encodes nested dynamic arrays and arrays of dynamic tuples", () => {
    const result = buildCalldata(
      calldataModel("n(uint256[][] m,(string s)[] ts)"),
      { m: [[1n], [2n, 3n]], ts: [{ s: "a" }] },
    );
    expect(result).toEqual({
      data:
        selectorHex("n(uint256[][],(string)[])") +
        pad32("40") +
        pad32("140") +
        // m: length, element offsets, [1], [2, 3]
        pad32("2") +
        pad32("40") +
        pad32("80") +
        pad32("1") +
        pad32("1") +
        pad32("2") +
        pad32("2") +
        pad32("3") +
        // ts: length, element offset, tuple head, string
        pad32("1") +
        pad32("20") +
        pad32("20") +
        pad32("1") +
        padRight32("61"),
    });
  });

  it("encodes a fixed array of a dynamic type as a dynamic value", () => {
    const result = buildCalldata(calldataModel("f(string[2] s)"), {
      s: ["a", "bc"],
    });
    expect(result).toEqual({
      data:
        selectorHex("f(string[2])") +
        pad32("20") +
        pad32("40") +
        pad32("80") +
        pad32("1") +
        padRight32("61") +
        pad32("2") +
        padRight32("6263"),
    });
  });

  it("encodes a dynamic tuple argument in the tail", () => {
    const result = buildCalldata(
      calldataModel("f((uint256 a,string s) t,uint256 b)"),
      { t: { a: 1, s: "x" }, b: 2 },
    );
    expect(result).toEqual({
      data:
        selectorHex("f((uint256,string),uint256)") +
        pad32("40") +
        pad32("2") +
        pad32("1") +
        pad32("40") +
        pad32("1") +
        padRight32("78"),
    });
  });

  it("encodes dynamic tuples inside a fixed array", () => {
    const result = buildCalldata(calldataModel("f((string s)[2] ts)"), {
      ts: [{ s: "a" }, { s: "b" }],
    });
    expect(result).toEqual({
      data:
        selectorHex("f((string)[2])") +
        pad32("20") +
        pad32("40") +
        pad32("a0") +
        pad32("20") +
        pad32("1") +
        padRight32("61") +
        pad32("20") +
        pad32("1") +
        padRight32("62"),
    });
  });

  it("encodes empty arrays and an array of an empty array", () => {
    const result = buildCalldata(
      calldataModel("f(uint256[] a,uint256[][] b)"),
      { a: [], b: [[]] },
    );
    expect(result).toEqual({
      data:
        selectorHex("f(uint256[],uint256[][])") +
        pad32("40") +
        pad32("60") +
        pad32("0") +
        pad32("1") +
        pad32("20") +
        pad32("0"),
    });
  });

  it("encodes empty bytes and an empty string", () => {
    const result = buildCalldata(calldataModel("f(bytes b,string s)"), {
      b: "0x",
      s: "",
    });
    expect(result).toEqual({
      data:
        selectorHex("f(bytes,string)") +
        pad32("40") +
        pad32("60") +
        pad32("0") +
        pad32("0"),
    });
  });

  it("accepts the integer range boundaries", () => {
    const result = buildCalldata(
      calldataModel("f(int8 a,int8 b,int256 c,uint256 d)"),
      { a: -128, b: 127, c: -(1n << 255n), d: (1n << 256n) - 1n },
    );
    expect(result).toEqual({
      data:
        selectorHex("f(int8,int8,int256,uint256)") +
        padInt(-128n) +
        padInt(127n) +
        padInt(-(1n << 255n)) +
        "f".repeat(64),
    });
  });

  it("uses param<i> keys for unnamed arguments", () => {
    const result = buildCalldata(calldataModel("f(address,uint256)"), {
      param0: ALICE,
      param1: 7n,
    });
    expect(result).toEqual({
      data: selectorHex("f(address,uint256)") + padAddr(ALICE) + padInt(7n),
    });
  });

  it("returns MISSING_VALUE for an absent argument", () => {
    const result = buildCalldata(
      calldataModel("transfer(address to,uint256 amount)"),
      { to: ALICE },
    );
    expect(result).toEqual({
      errors: [
        { path: "amount", code: "MISSING_VALUE", message: "Value is required" },
      ],
    });
  });

  it("returns INVALID_TYPE for wrong shapes, bad hex, non-integers and non-booleans", () => {
    const result = buildCalldata(
      calldataModel(
        "f(uint256 a,uint256 b,bool c,bytes d,address e,string s,uint256[] l,(uint8 x) t,uint256 big)",
      ),
      {
        a: "1.5",
        b: 1.5,
        c: "true",
        d: "0x123",
        e: "alice.eth",
        s: 5,
        l: "1,2",
        t: [1],
        big: 2 ** 60,
      },
    );
    expect(result).toEqual({
      errors: [
        { path: "a", code: "INVALID_TYPE", message: "Value is not an integer" },
        { path: "b", code: "INVALID_TYPE", message: "Value is not an integer" },
        { path: "c", code: "INVALID_TYPE", message: "Value is not a boolean" },
        { path: "d", code: "INVALID_TYPE", message: "Value is not hex" },
        {
          path: "e",
          code: "INVALID_TYPE",
          message: "Value is not a hex address",
        },
        { path: "s", code: "INVALID_TYPE", message: "Value is not a string" },
        { path: "l", code: "INVALID_TYPE", message: "Value must be an array" },
        { path: "t", code: "INVALID_TYPE", message: "Value must be an object" },
        {
          path: "big",
          code: "INVALID_TYPE",
          message: "Number is too large. Use a bigint or a string",
        },
      ],
    });
  });

  it("returns INVALID_TYPE at the root when values is not an object", () => {
    const result = buildCalldata(
      calldataModel("f(uint256 a)"),
      null as unknown as Record<string, unknown>,
    );
    expect(result).toEqual({
      errors: [
        { path: "", code: "INVALID_TYPE", message: "Value must be an object" },
      ],
    });
  });

  it("returns OUT_OF_RANGE for integers that do not fit their type", () => {
    const result = buildCalldata(
      calldataModel("f(uint8 a,int8 b,int8 c,uint256 d,uint256 e)"),
      { a: 256, b: -129, c: 128, d: -1, e: 1n << 256n },
    );
    expect(result).toEqual({
      errors: [
        {
          path: "a",
          code: "OUT_OF_RANGE",
          message: "Value does not fit uint8",
        },
        { path: "b", code: "OUT_OF_RANGE", message: "Value does not fit int8" },
        { path: "c", code: "OUT_OF_RANGE", message: "Value does not fit int8" },
        {
          path: "d",
          code: "OUT_OF_RANGE",
          message: "Value does not fit uint256",
        },
        {
          path: "e",
          code: "OUT_OF_RANGE",
          message: "Value does not fit uint256",
        },
      ],
    });
  });

  it("returns INVALID_LENGTH for addresses, bytesN and fixed arrays of the wrong length", () => {
    const result = buildCalldata(
      calldataModel("f(address a,bytes4 b,uint256[2] c)"),
      { a: "0x" + "11".repeat(19), b: "0x123456", c: [1] },
    );
    expect(result).toEqual({
      errors: [
        {
          path: "a",
          code: "INVALID_LENGTH",
          message: "Address must be 20 bytes",
        },
        { path: "b", code: "INVALID_LENGTH", message: "Value must be 4 bytes" },
        {
          path: "c",
          code: "INVALID_LENGTH",
          message: "Array must have 2 elements",
        },
      ],
    });
  });

  it("returns UNKNOWN_FIELD for keys the function does not declare", () => {
    const result = buildCalldata(calldataModel("f((uint256 a) t)"), {
      t: { a: 1, b: 2 },
      value: 5,
    });
    expect(result).toEqual({
      errors: [
        { path: "t.b", code: "UNKNOWN_FIELD", message: "Unknown field" },
        { path: "value", code: "UNKNOWN_FIELD", message: "Unknown field" },
      ],
    });
  });

  it("returns INVALID_SIGNATURE for an unparsable signature or an unsupported type", () => {
    expect(buildCalldata(calldataModel("notASignature"), {})).toEqual({
      errors: [
        {
          path: "",
          code: "INVALID_SIGNATURE",
          message: "Cannot parse the function signature 'notASignature'",
        },
      ],
    });
    expect(
      buildCalldata(calldataModel("f(fixed128x18 a)"), { a: "1" }),
    ).toEqual({
      errors: [
        {
          path: "a",
          code: "INVALID_SIGNATURE",
          message: "Unsupported type 'fixed128x18'",
        },
      ],
    });
  });

  it("collects all errors with the concrete array index in each path", () => {
    const result = buildCalldata(
      calldataModel(
        "fill((address token,uint8 amount)[] orders,address recipient)",
      ),
      {
        orders: [
          { token: ALICE, amount: 1 },
          { token: "0x12", amount: 300 },
          null,
        ],
      },
    );
    expect(result).toEqual({
      errors: [
        {
          path: "orders.[1].token",
          code: "INVALID_LENGTH",
          message: "Address must be 20 bytes",
        },
        {
          path: "orders.[1].amount",
          code: "OUT_OF_RANGE",
          message: "Value does not fit uint8",
        },
        {
          path: "orders.[2]",
          code: "MISSING_VALUE",
          message: "Value is required",
        },
        {
          path: "recipient",
          code: "MISSING_VALUE",
          message: "Value is required",
        },
      ],
    });
  });
});
