import { describe, it, expect, vi } from "vitest";
import type { ArgumentValue, ResolvePath } from "../src/descriptor.js";
import type {
  DescriptorMetadata,
  ExternalDataProvider,
  TokenResult,
} from "../src/types.js";
import {
  formatRaw,
  renderRaw,
  formatNativeAmount,
  nativeSymbol,
  formatTokenAmount,
  renderTokenAmount,
  tokenAmountMessage,
  resolveTokenAddress,
  formatDate,
  formatTimestamp,
  formatEnum,
  resolveEnumLabel,
  formatAddressNameField,
  formatAddressName,
  typeMismatch,
  renderField,
} from "../src/formatters.js";
import { hexToBytes } from "../src/utils.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const ADDR_BYTES = hexToBytes("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");

function uint(value: bigint): ArgumentValue {
  return { type: "uint", value };
}

function addr(bytes?: Uint8Array): ArgumentValue {
  return { type: "address", bytes: bytes ?? ADDR_BYTES };
}

function str(value: string): ArgumentValue {
  return { type: "string", value };
}

function bool(value: boolean): ArgumentValue {
  return { type: "bool", value };
}

function bytes(hex: string): ArgumentValue {
  return { type: "bytes", bytes: hexToBytes(hex) };
}

function int(value: bigint): ArgumentValue {
  return { type: "int", value };
}

const noopResolvePath: ResolvePath = () => undefined;

// ---------------------------------------------------------------------------
// raw format: renderRaw
// ---------------------------------------------------------------------------

describe("renderRaw", () => {
  it("formats address as EIP-55 checksum", () => {
    expect(renderRaw(addr())).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    );
  });

  it("formats uint with thousand separators", () => {
    expect(renderRaw(uint(1000000n))).toBe("1,000,000");
  });

  it("formats int with thousand separators", () => {
    expect(renderRaw(int(123456n))).toBe("123,456");
  });

  it("formats bool", () => {
    expect(renderRaw(bool(true))).toBe("true");
    expect(renderRaw(bool(false))).toBe("false");
  });

  it("formats string as-is", () => {
    expect(renderRaw(str("hello"))).toBe("hello");
  });

  it("formats bytes as hex", () => {
    expect(renderRaw(bytes("0xdeadbeef"))).toBe("0xdeadbeef");
  });
});

// ---------------------------------------------------------------------------
// raw format: formatRaw
// ---------------------------------------------------------------------------

describe("formatRaw", () => {
  it("wraps renderRaw in RenderFieldResult", () => {
    const result = formatRaw(uint(42n));
    expect(result.rendered).toBe("42");
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// amount format: formatNativeAmount
// ---------------------------------------------------------------------------

describe("formatNativeAmount", () => {
  it("formats 1 ETH on mainnet", () => {
    const result = formatNativeAmount(uint(1000000000000000000n), 1);
    expect(result.rendered).toBe("1 ETH");
    expect(result.warning).toBeUndefined();
  });

  it("formats fractional ETH", () => {
    const result = formatNativeAmount(uint(1500000000000000000n), 1);
    expect(result.rendered).toBe("1.5 ETH");
  });

  it("uses ETH for Optimism", () => {
    const result = formatNativeAmount(uint(1000000000000000000n), 10);
    expect(result.rendered).toBe("1 ETH");
  });

  it("uses ETH for Arbitrum", () => {
    const result = formatNativeAmount(uint(1000000000000000000n), 42161);
    expect(result.rendered).toBe("1 ETH");
  });

  it("uses ETH for Base", () => {
    const result = formatNativeAmount(uint(1000000000000000000n), 8453);
    expect(result.rendered).toBe("1 ETH");
  });

  it("uses NATIVE for unknown chains", () => {
    const result = formatNativeAmount(uint(1000000000000000000n), 999);
    expect(result.rendered).toBe("1 NATIVE");
  });

  it("returns warning when chainId is undefined", () => {
    const result = formatNativeAmount(uint(100n), undefined);
    expect(result.warning?.code).toBe("CONTAINER_MISSING_CHAIN_ID");
  });

  it("accepts int values", () => {
    const result = formatNativeAmount(int(1000000000000000000n), 1);
    expect(result.rendered).toBe("1 ETH");
  });

  it("returns type mismatch for non-uint/int", () => {
    const result = formatNativeAmount(str("not a number"), 1);
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// amount format: nativeSymbol
// ---------------------------------------------------------------------------

describe("nativeSymbol", () => {
  it("returns ETH for mainnet", () => expect(nativeSymbol(1)).toBe("ETH"));
  it("returns ETH for Optimism", () => expect(nativeSymbol(10)).toBe("ETH"));
  it("returns ETH for Arbitrum", () => expect(nativeSymbol(42161)).toBe("ETH"));
  it("returns ETH for Base", () => expect(nativeSymbol(8453)).toBe("ETH"));
  it("returns NATIVE for unknown", () =>
    expect(nativeSymbol(137)).toBe("NATIVE"));
});

// ---------------------------------------------------------------------------
// tokenAmount format: renderTokenAmount
// ---------------------------------------------------------------------------

describe("renderTokenAmount", () => {
  const usdc: TokenResult = { name: "USD Coin", symbol: "USDC", decimals: 6 };

  it("formats token amount with symbol", () => {
    const result = renderTokenAmount(1000000n, usdc, {}, undefined);
    expect(result).toBe("1 USDC");
  });

  it("formats fractional token amount", () => {
    const result = renderTokenAmount(1500000n, usdc, {}, undefined);
    expect(result).toBe("1.5 USDC");
  });

  it("applies threshold message when amount >= threshold", () => {
    const field = {
      params: { threshold: "1000000", message: "Unlimited" },
    };
    const result = renderTokenAmount(1000000n, usdc, field, undefined);
    expect(result).toBe("Unlimited USDC");
  });

  it("does not apply threshold message when amount < threshold", () => {
    const field = {
      params: { threshold: "2000000", message: "Unlimited" },
    };
    const result = renderTokenAmount(999999n, usdc, field, undefined);
    expect(result).toBe("0.999999 USDC");
  });
});

// ---------------------------------------------------------------------------
// tokenAmount format: tokenAmountMessage
// ---------------------------------------------------------------------------

describe("tokenAmountMessage", () => {
  it("returns undefined when no threshold/message params", () => {
    expect(tokenAmountMessage({}, 100n, undefined)).toBeUndefined();
  });

  it("defaults message to 'Unlimited' when not specified", () => {
    const field = { params: { threshold: "100" } };
    expect(tokenAmountMessage(field, 100n, undefined)).toBe("Unlimited");
  });

  it("returns undefined when threshold is not a string", () => {
    expect(
      tokenAmountMessage(
        { params: { threshold: 100, message: "msg" } },
        100n,
        undefined,
      ),
    ).toBeUndefined();
  });

  it("returns message when amount >= literal threshold", () => {
    const field = { params: { threshold: "100", message: "Over limit" } };
    expect(tokenAmountMessage(field, 100n, undefined)).toBe("Over limit");
  });

  it("returns undefined when amount < literal threshold", () => {
    const field = { params: { threshold: "100", message: "Over limit" } };
    expect(tokenAmountMessage(field, 99n, undefined)).toBeUndefined();
  });

  it("resolves threshold from metadata path", () => {
    const field = {
      params: { threshold: "$.metadata.constants.maxAmount", message: "Max" },
    };
    const metadata: DescriptorMetadata = {
      constants: { maxAmount: "500" },
    };
    expect(tokenAmountMessage(field, 500n, metadata)).toBe("Max");
    expect(tokenAmountMessage(field, 499n, metadata)).toBeUndefined();
  });

  it("resolves numeric metadata threshold", () => {
    const field = {
      params: { threshold: "$.metadata.constants.maxAmount", message: "Max" },
    };
    const metadata: DescriptorMetadata = {
      constants: { maxAmount: 200 },
    };
    expect(tokenAmountMessage(field, 200n, metadata)).toBe("Max");
  });
});

// ---------------------------------------------------------------------------
// tokenAmount format: resolveTokenAddress
// ---------------------------------------------------------------------------

describe("resolveTokenAddress", () => {
  it("returns undefined when no token or tokenPath", () => {
    expect(resolveTokenAddress({}, noopResolvePath, undefined)).toBeUndefined();
  });

  it("resolves constant address from params.token", () => {
    const field = {
      params: { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    };
    expect(resolveTokenAddress(field, noopResolvePath, undefined)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("resolves constant address from params.tokenPath", () => {
    const field = {
      params: { tokenPath: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    };
    expect(resolveTokenAddress(field, noopResolvePath, undefined)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("prefers token over tokenPath", () => {
    const field = {
      params: {
        token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        tokenPath: "0x0000000000000000000000000000000000000001",
      },
    };
    expect(resolveTokenAddress(field, noopResolvePath, undefined)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("resolves token from metadata path", () => {
    const field = { params: { token: "$.metadata.constants.tokenAddr" } };
    const metadata: DescriptorMetadata = {
      constants: { tokenAddr: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    };
    expect(resolveTokenAddress(field, noopResolvePath, metadata)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("returns undefined for non-address metadata value", () => {
    const field = { params: { token: "$.metadata.constants.foo" } };
    const metadata: DescriptorMetadata = { constants: { foo: "not-an-addr" } };
    expect(
      resolveTokenAddress(field, noopResolvePath, metadata),
    ).toBeUndefined();
  });

  it("resolves token from resolvePath (address type)", () => {
    const tokenBytes = hexToBytes("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    const resolvePath: ResolvePath = (path) => {
      if (path === "token") return { type: "address", bytes: tokenBytes };
      return undefined;
    };
    const field = { params: { token: "token" } };
    expect(resolveTokenAddress(field, resolvePath, undefined)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("returns undefined when resolvePath returns non-address", () => {
    const resolvePath: ResolvePath = () => ({
      type: "uint",
      value: 42n,
    });
    const field = { params: { token: "someField" } };
    expect(resolveTokenAddress(field, resolvePath, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// tokenAmount format: formatTokenAmount
// ---------------------------------------------------------------------------

describe("formatTokenAmount", () => {
  const usdc: TokenResult = { name: "USD Coin", symbol: "USDC", decimals: 6 };
  const tokenAddr = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  const provider: ExternalDataProvider = {
    resolveToken: async () => usdc,
  };

  it("returns type mismatch for non-uint/int", async () => {
    const result = await formatTokenAmount(
      {},
      str("hello"),
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });

  it("accepts int values", async () => {
    const field = { params: { token: tokenAddr } };
    const result = await formatTokenAmount(
      field,
      int(1000000n),
      noopResolvePath,
      1,
      undefined,
      provider,
    );
    expect(result.rendered).toBe("1 USDC");
  });

  it("returns warning when chainId is undefined", async () => {
    const result = await formatTokenAmount(
      {},
      uint(100n),
      noopResolvePath,
      undefined,
      undefined,
    );
    expect(result.warning?.code).toBe("CONTAINER_MISSING_CHAIN_ID");
  });

  it("falls back to raw when no token address can be resolved", async () => {
    const result = await formatTokenAmount(
      {},
      uint(1000000n),
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.rendered).toBe("1,000,000");
    expect(result.warning).toBeUndefined();
  });

  it("returns UNKNOWN_TOKEN when provider returns null", async () => {
    const nullProvider: ExternalDataProvider = {
      resolveToken: async () => null,
    };
    const field = { params: { token: tokenAddr } };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      noopResolvePath,
      1,
      undefined,
      nullProvider,
    );
    expect(result.rendered).toBe("1,000,000");
    expect(result.warning?.code).toBe("UNKNOWN_TOKEN");
    expect(result.tokenAddress).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
  });

  it("formats token amount with resolved token", async () => {
    const field = { params: { token: tokenAddr } };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      noopResolvePath,
      1,
      undefined,
      provider,
    );
    expect(result.rendered).toBe("1 USDC");
    expect(result.tokenAddress).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// date format: formatTimestamp
// ---------------------------------------------------------------------------

describe("formatTimestamp", () => {
  it("formats Unix epoch as UTC date", () => {
    // 2024-01-15 10:00:00 UTC = 1705312800
    const result = formatTimestamp(1705312800n);
    expect(result.rendered).toBe("2024-01-15 10:00:00 UTC");
  });

  it("formats epoch 0", () => {
    const result = formatTimestamp(0n);
    expect(result.rendered).toBe("1970-01-01 00:00:00 UTC");
  });

  it("pads single-digit months and days", () => {
    // 2024-03-05 08:01:02 UTC = 1709625662
    const result = formatTimestamp(1709625662n);
    expect(result.rendered).toBe("2024-03-05 08:01:02 UTC");
  });
});

// ---------------------------------------------------------------------------
// date format: formatDate
// ---------------------------------------------------------------------------

describe("formatDate", () => {
  const timestampOpts = { params: { encoding: "timestamp" as const } };

  it("formats a uint value as date with encoding=timestamp", () => {
    const result = formatDate(uint(1705312800n), timestampOpts);
    expect(result.rendered).toBe("2024-01-15 10:00:00 UTC");
    expect(result.warning).toBeUndefined();
  });

  it("formats an int value as date with encoding=timestamp", () => {
    const result = formatDate(int(1705312800n), timestampOpts);
    expect(result.rendered).toBe("2024-01-15 10:00:00 UTC");
    expect(result.warning).toBeUndefined();
  });

  it("falls back to raw when encoding is missing", () => {
    const result = formatDate(uint(1705312800n), {});
    expect(result.rendered).toBe("1,705,312,800");
    expect(result.warning).toBeUndefined();
  });

  it("returns type mismatch for non-uint/int", () => {
    const result = formatDate(str("not a date"), timestampOpts);
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// enum format: resolveEnumLabel
// ---------------------------------------------------------------------------

describe("resolveEnumLabel", () => {
  const metadata: DescriptorMetadata = {
    enums: {
      orderType: { "0": "Buy", "1": "Sell", "2": "Cancel" },
    },
  };

  it("resolves an enum label by key", () => {
    const field = { params: { $ref: "$.metadata.enums.orderType" } };
    expect(resolveEnumLabel(field, "0", metadata)).toBe("Buy");
    expect(resolveEnumLabel(field, "1", metadata)).toBe("Sell");
    expect(resolveEnumLabel(field, "2", metadata)).toBe("Cancel");
  });

  it("returns undefined for missing key", () => {
    const field = { params: { $ref: "$.metadata.enums.orderType" } };
    expect(resolveEnumLabel(field, "99", metadata)).toBeUndefined();
  });

  it("returns undefined when no $ref param", () => {
    expect(resolveEnumLabel({}, "0", metadata)).toBeUndefined();
  });

  it("returns undefined when metadata is undefined", () => {
    const field = { params: { $ref: "$.metadata.enums.orderType" } };
    expect(resolveEnumLabel(field, "0", undefined)).toBeUndefined();
  });

  it("returns undefined when $ref points to non-object", () => {
    const field = { params: { $ref: "$.metadata.constants.foo" } };
    const meta: DescriptorMetadata = { constants: { foo: "bar" } };
    expect(resolveEnumLabel(field, "0", meta)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// enum format: formatEnum
// ---------------------------------------------------------------------------

describe("formatEnum", () => {
  const metadata: DescriptorMetadata = {
    enums: {
      status: { "0": "Pending", "1": "Active" },
    },
  };

  it("renders enum label", () => {
    const field = { params: { $ref: "$.metadata.enums.status" } };
    const result = formatEnum(field, uint(0n), metadata);
    expect(result.rendered).toBe("Pending");
    expect(result.warning).toBeUndefined();
  });

  it("falls back to raw when enum label not found", () => {
    const field = { params: { $ref: "$.metadata.enums.status" } };
    const result = formatEnum(field, uint(99n), metadata);
    expect(result.rendered).toBe("99");
    expect(result.warning).toBeUndefined();
  });

  it("accepts int values", () => {
    const field = { params: { $ref: "$.metadata.enums.status" } };
    const result = formatEnum(field, int(1n), metadata);
    expect(result.rendered).toBe("Active");
  });

  it("returns type mismatch for non-uint/int", () => {
    const field = { params: { $ref: "$.metadata.enums.status" } };
    const result = formatEnum(field, str("hello"), metadata);
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// addressName format: formatAddressName
// ---------------------------------------------------------------------------

describe("formatAddressName", () => {
  const checksumAddr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  it("falls back to checksum address with UNKNOWN_ADDRESS warning when no provider", async () => {
    const result = await formatAddressName(checksumAddr, {});
    expect(result.rendered).toBe(checksumAddr);
    expect(result.warning?.code).toBe("UNKNOWN_ADDRESS");
  });

  it("resolves local name", async () => {
    const provider: ExternalDataProvider = {
      resolveLocalName: async () => ({
        name: "My Wallet",
        typeMatch: true,
      }),
    };
    const result = await formatAddressName(checksumAddr, {}, provider);
    expect(result.rendered).toBe("My Wallet");
    expect(result.warning).toBeUndefined();
  });

  it("returns ADDRESS_TYPE_MISMATCH when type does not match", async () => {
    const provider: ExternalDataProvider = {
      resolveLocalName: async () => ({
        name: "My Wallet",
        typeMatch: false,
      }),
    };
    const field = { params: { types: ["contract" as const] } };
    const result = await formatAddressName(checksumAddr, field, provider);
    expect(result.rendered).toBe("My Wallet");
    expect(result.warning?.code).toBe("ADDRESS_TYPE_MISMATCH");
  });

  it("falls through to ENS when local returns null", async () => {
    const provider: ExternalDataProvider = {
      resolveLocalName: async () => null,
      resolveEnsName: async () => ({
        name: "vitalik.eth",
        typeMatch: true,
      }),
    };
    const result = await formatAddressName(checksumAddr, {}, provider);
    expect(result.rendered).toBe("vitalik.eth");
    expect(result.warning).toBeUndefined();
  });

  it("respects sources=['ens'] — skips local", async () => {
    const provider: ExternalDataProvider = {
      resolveLocalName: vi.fn(async () => ({
        name: "Local",
        typeMatch: true,
      })),
      resolveEnsName: vi.fn(async () => ({
        name: "ens.eth",
        typeMatch: true,
      })),
    };
    const field = { params: { sources: ["ens" as const] } };
    const result = await formatAddressName(checksumAddr, field, provider);
    expect(result.rendered).toBe("ens.eth");
    expect(provider.resolveLocalName).not.toHaveBeenCalled();
  });

  it("respects sources=['local'] — skips ENS", async () => {
    const provider: ExternalDataProvider = {
      resolveLocalName: vi.fn(async () => null),
      resolveEnsName: vi.fn(async () => ({
        name: "ens.eth",
        typeMatch: true,
      })),
    };
    const field = { params: { sources: ["local" as const] } };
    const result = await formatAddressName(checksumAddr, field, provider);
    expect(result.rendered).toBe(checksumAddr);
    expect(result.warning?.code).toBe("UNKNOWN_ADDRESS");
    expect(provider.resolveEnsName).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// addressName format: formatAddressNameField
// ---------------------------------------------------------------------------

describe("formatAddressNameField", () => {
  it("returns type mismatch for non-address", async () => {
    const result = await formatAddressNameField(uint(42n), {});
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });

  it("delegates to formatAddressName for address values", async () => {
    const result = await formatAddressNameField(addr(), {});
    expect(result.warning?.code).toBe("UNKNOWN_ADDRESS");
    // It returns a checksum address
    expect(result.rendered).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

// ---------------------------------------------------------------------------
// typeMismatch (utility)
// ---------------------------------------------------------------------------

describe("typeMismatch", () => {
  it("returns raw value with ARGUMENT_TYPE_MISMATCH warning", () => {
    const result = typeMismatch(str("hello"), "uint", "tokenAmount");
    expect(result.rendered).toBe("hello");
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// renderField (dispatcher)
// ---------------------------------------------------------------------------

describe("renderField", () => {
  it("dispatches 'raw' format", async () => {
    const result = await renderField(
      uint(42n),
      "raw",
      {},
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.rendered).toBe("42");
  });

  it("dispatches 'amount' format", async () => {
    const result = await renderField(
      uint(1000000000000000000n),
      "amount",
      {},
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.rendered).toBe("1 ETH");
  });

  it("dispatches 'date' format with encoding=timestamp", async () => {
    const result = await renderField(
      uint(0n),
      "date",
      { params: { encoding: "timestamp" } },
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.rendered).toBe("1970-01-01 00:00:00 UTC");
  });

  it("dispatches 'enum' format", async () => {
    const metadata: DescriptorMetadata = {
      enums: { t: { "0": "A" } },
    };
    const field = { params: { $ref: "$.metadata.enums.t" } };
    const result = await renderField(
      uint(0n),
      "enum",
      field,
      noopResolvePath,
      1,
      metadata,
    );
    expect(result.rendered).toBe("A");
  });

  it("falls back to raw for unrecognized format", async () => {
    const result = await renderField(
      uint(7n),
      "duration",
      {},
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.rendered).toBe("7");
  });
});
