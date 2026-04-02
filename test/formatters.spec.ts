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
  formatTokenAmount,
  renderTokenAmount,
  tokenAmountMessage,
  resolveTokenAddress,
  formatDate,
  formatTimestamp,
  formatEnum,
  resolveEnumLabel,
  formatUnit,
  formatDuration,
  formatNftName,
  resolveCollectionAddress,
  formatAddressNameField,
  formatAddressName,
  formatTokenTicker,
  isNativeCurrencyAddress,
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
  it("formats 1 ETH", () => {
    const result = formatNativeAmount(uint(1000000000000000000n));
    expect(result.rendered).toBe("1 ETH");
    expect(result.warning).toBeUndefined();
  });

  it("formats fractional ETH", () => {
    const result = formatNativeAmount(uint(1500000000000000000n));
    expect(result.rendered).toBe("1.5 ETH");
  });

  it("accepts int values", () => {
    const result = formatNativeAmount(int(1000000000000000000n));
    expect(result.rendered).toBe("1 ETH");
  });

  it("returns type mismatch for non-uint/int", () => {
    const result = formatNativeAmount(str("not a number"));
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// tokenAmount format: renderTokenAmount
// ---------------------------------------------------------------------------

describe("renderTokenAmount", () => {
  const usdc: TokenResult = { name: "USD Coin", symbol: "USDC", decimals: 6 };

  it("formats token amount with symbol", () => {
    const result = renderTokenAmount(1000000n, usdc, {}, noopResolvePath);
    expect(result).toBe("1 USDC");
  });

  it("formats fractional token amount", () => {
    const result = renderTokenAmount(1500000n, usdc, {}, noopResolvePath);
    expect(result).toBe("1.5 USDC");
  });

  it("applies threshold message when amount >= threshold", () => {
    const field = {
      params: { threshold: "1000000", message: "Unlimited" },
    };
    const result = renderTokenAmount(1000000n, usdc, field, noopResolvePath);
    expect(result).toBe("Unlimited USDC");
  });

  it("does not apply threshold message when amount < threshold", () => {
    const field = {
      params: { threshold: "2000000", message: "Unlimited" },
    };
    const result = renderTokenAmount(999999n, usdc, field, noopResolvePath);
    expect(result).toBe("0.999999 USDC");
  });
});

// ---------------------------------------------------------------------------
// tokenAmount format: tokenAmountMessage
// ---------------------------------------------------------------------------

describe("tokenAmountMessage", () => {
  it("returns undefined when no threshold/message params", () => {
    expect(tokenAmountMessage({}, 100n, noopResolvePath)).toBeUndefined();
  });

  it("defaults message to 'Unlimited' when not specified", () => {
    const field = { params: { threshold: "100" } };
    expect(tokenAmountMessage(field, 100n, noopResolvePath)).toBe("Unlimited");
  });

  it("returns undefined when threshold is not a string", () => {
    expect(
      tokenAmountMessage(
        { params: { threshold: 100, message: "msg" } },
        100n,
        noopResolvePath,
      ),
    ).toBeUndefined();
  });

  it("returns message when amount >= literal threshold", () => {
    const field = { params: { threshold: "100", message: "Over limit" } };
    expect(tokenAmountMessage(field, 100n, noopResolvePath)).toBe("Over limit");
  });

  it("returns undefined when amount < literal threshold", () => {
    const field = { params: { threshold: "100", message: "Over limit" } };
    expect(tokenAmountMessage(field, 99n, noopResolvePath)).toBeUndefined();
  });

  it("resolves threshold from metadata path", () => {
    const field = {
      params: { threshold: "$.metadata.constants.maxAmount", message: "Max" },
    };
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.maxAmount"
        ? { type: "uint", value: 500n }
        : undefined;
    expect(tokenAmountMessage(field, 500n, resolve)).toBe("Max");
    expect(tokenAmountMessage(field, 499n, resolve)).toBeUndefined();
  });

  it("resolves numeric metadata threshold", () => {
    const field = {
      params: { threshold: "$.metadata.constants.maxAmount", message: "Max" },
    };
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.maxAmount"
        ? { type: "uint", value: 200n }
        : undefined;
    expect(tokenAmountMessage(field, 200n, resolve)).toBe("Max");
  });
});

// ---------------------------------------------------------------------------
// tokenAmount format: resolveTokenAddress
// ---------------------------------------------------------------------------

describe("resolveTokenAddress", () => {
  it("returns undefined when no token or tokenPath", () => {
    expect(resolveTokenAddress({}, noopResolvePath)).toBeUndefined();
  });

  it("resolves constant address from params.token", () => {
    const field = {
      params: { token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    };
    expect(resolveTokenAddress(field, noopResolvePath)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("resolves constant address from params.tokenPath", () => {
    const field = {
      params: { tokenPath: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    };
    expect(resolveTokenAddress(field, noopResolvePath)).toBe(
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
    expect(resolveTokenAddress(field, noopResolvePath)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("resolves token from metadata path via resolvePath", () => {
    const tokenBytes = hexToBytes("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.tokenAddr"
        ? { type: "address", bytes: tokenBytes }
        : undefined;
    const field = { params: { token: "$.metadata.constants.tokenAddr" } };
    expect(resolveTokenAddress(field, resolve)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("returns undefined for non-address metadata value", () => {
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.foo"
        ? { type: "string", value: "not-an-addr" }
        : undefined;
    const field = { params: { token: "$.metadata.constants.foo" } };
    expect(resolveTokenAddress(field, resolve)).toBeUndefined();
  });

  it("resolves token from resolvePath (address type)", () => {
    const tokenBytes = hexToBytes("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
    const resolvePath: ResolvePath = (path) => {
      if (path === "token") return { type: "address", bytes: tokenBytes };
      return undefined;
    };
    const field = { params: { token: "token" } };
    expect(resolveTokenAddress(field, resolvePath)).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
  });

  it("returns undefined when resolvePath returns non-address", () => {
    const resolvePath: ResolvePath = () => ({
      type: "uint",
      value: 42n,
    });
    const field = { params: { token: "someField" } };
    expect(resolveTokenAddress(field, resolvePath)).toBeUndefined();
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
    );
    expect(result.warning?.code).toBe("CONTAINER_MISSING_CHAIN_ID");
  });

  it("falls back to raw when no token address can be resolved", async () => {
    const result = await formatTokenAmount(
      {},
      uint(1000000n),
      noopResolvePath,
      1,
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
      provider,
    );
    expect(result.rendered).toBe("1 USDC");
    expect(result.tokenAddress).toBe(
      "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    );
    expect(result.warning).toBeUndefined();
  });

  it("uses chainId from params over container chainId", async () => {
    const resolveTokenSpy: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const field = { params: { token: tokenAddr, chainId: 137 } };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      noopResolvePath,
      1,
      resolveTokenSpy,
    );
    expect(result.rendered).toBe("1 USDC");
    expect(resolveTokenSpy.resolveToken).toHaveBeenCalledWith(
      137,
      tokenAddr.toLowerCase(),
    );
  });

  it("resolves chainIdPath via resolvePath", async () => {
    const resolve: ResolvePath = (path) =>
      path === "destChain" ? { type: "uint", value: 42n } : undefined;
    const resolveTokenSpy: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const field = { params: { token: tokenAddr, chainIdPath: "destChain" } };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      resolve,
      1,
      resolveTokenSpy,
    );
    expect(result.rendered).toBe("1 USDC");
    expect(resolveTokenSpy.resolveToken).toHaveBeenCalledWith(
      42,
      tokenAddr.toLowerCase(),
    );
  });

  it("falls back to container chainId when param chainId is absent", async () => {
    const resolveTokenSpy: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const field = { params: { token: tokenAddr } };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      noopResolvePath,
      10,
      resolveTokenSpy,
    );
    expect(result.rendered).toBe("1 USDC");
    expect(resolveTokenSpy.resolveToken).toHaveBeenCalledWith(
      10,
      tokenAddr.toLowerCase(),
    );
  });

  it("falls back to raw when chainIdPath cannot be resolved", async () => {
    const field = { params: { token: tokenAddr, chainIdPath: "missingPath" } };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe("1,000,000");
    expect(result.warning).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// nativeCurrencyAddress: isNativeCurrencyAddress + formatTokenAmount integration
// ---------------------------------------------------------------------------

describe("isNativeCurrencyAddress", () => {
  const ethSentinel = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

  it("returns false when nativeCurrencyAddress is not set", () => {
    expect(isNativeCurrencyAddress(ethSentinel, {}, noopResolvePath)).toBe(
      false,
    );
  });

  it("matches a literal address (string)", () => {
    const field = {
      params: {
        nativeCurrencyAddress: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      },
    };
    expect(isNativeCurrencyAddress(ethSentinel, field, noopResolvePath)).toBe(
      true,
    );
  });

  it("matches one of several literal addresses (array)", () => {
    const field = {
      params: {
        nativeCurrencyAddress: [
          "0x0000000000000000000000000000000000000000",
          "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
        ],
      },
    };
    expect(isNativeCurrencyAddress(ethSentinel, field, noopResolvePath)).toBe(
      true,
    );
  });

  it("returns false when no literal address matches", () => {
    const field = {
      params: {
        nativeCurrencyAddress: "0x0000000000000000000000000000000000000000",
      },
    };
    expect(isNativeCurrencyAddress(ethSentinel, field, noopResolvePath)).toBe(
      false,
    );
  });

  it("resolves a path reference to an address", () => {
    const ethBytes = hexToBytes("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.addressAsEth"
        ? { type: "address", bytes: ethBytes }
        : undefined;
    const field = {
      params: {
        nativeCurrencyAddress: "$.metadata.constants.addressAsEth",
      },
    };
    expect(isNativeCurrencyAddress(ethSentinel, field, resolve)).toBe(true);
  });

  it("resolves a path reference to a string value", () => {
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.ethAddr"
        ? {
            type: "string",
            value: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          }
        : undefined;
    const field = {
      params: {
        nativeCurrencyAddress: "$.metadata.constants.ethAddr",
      },
    };
    expect(isNativeCurrencyAddress(ethSentinel, field, resolve)).toBe(true);
  });
});

describe("formatTokenAmount with nativeCurrencyAddress", () => {
  const ethSentinel = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const ethBytes = hexToBytes(ethSentinel);

  const resolve: ResolvePath = (path) => {
    if (path === "tokenAddr") {
      return { type: "address", bytes: ethBytes };
    }
    if (path === "$.metadata.constants.addressAsEth") {
      return { type: "address", bytes: ethBytes };
    }
    return undefined;
  };

  it("formats as native currency when tokenAddress matches nativeCurrencyAddress", async () => {
    const field = {
      params: {
        tokenPath: "tokenAddr",
        nativeCurrencyAddress: ethSentinel,
      },
    };
    const result = await formatTokenAmount(
      field,
      uint(5n * 10n ** 18n),
      resolve,
      1,
    );
    expect(result.rendered).toBe("5 ETH");
    expect(result.tokenAddress).toBe(
      "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    );
    expect(result.warning).toBeUndefined();
  });

  it("does not call resolveToken when nativeCurrencyAddress matches", async () => {
    const spy = vi.fn().mockResolvedValue({
      name: "Wrapped Ether",
      symbol: "WETH",
      decimals: 18,
    });
    const field = {
      params: {
        tokenPath: "tokenAddr",
        nativeCurrencyAddress: ethSentinel,
      },
    };
    await formatTokenAmount(field, uint(10n ** 18n), resolve, 1, {
      resolveToken: spy,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls through to resolveToken when tokenAddress does not match", async () => {
    const otherAddr = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
    const otherBytes = hexToBytes(otherAddr);
    const otherResolve: ResolvePath = (path) => {
      if (path === "tokenAddr") return { type: "address", bytes: otherBytes };
      return undefined;
    };
    const usdc: TokenResult = { name: "USD Coin", symbol: "USDC", decimals: 6 };
    const field = {
      params: {
        tokenPath: "tokenAddr",
        nativeCurrencyAddress: ethSentinel,
      },
    };
    const result = await formatTokenAmount(
      field,
      uint(1000000n),
      otherResolve,
      1,
      { resolveToken: async () => usdc },
    );
    expect(result.rendered).toBe("1 USDC");
  });

  it("applies threshold message with native currency", async () => {
    const field = {
      params: {
        tokenPath: "tokenAddr",
        nativeCurrencyAddress: ethSentinel,
        threshold: "1000000000000000000",
        message: "Unlimited",
      },
    };
    const result = await formatTokenAmount(field, uint(10n ** 18n), resolve, 1);
    expect(result.rendered).toBe("Unlimited ETH");
  });
});

// ---------------------------------------------------------------------------
// nftName format: formatNftName, resolveCollectionAddress
// ---------------------------------------------------------------------------

describe("resolveCollectionAddress", () => {
  it("returns constant address from collection param", () => {
    const field = {
      params: { collection: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const result = resolveCollectionAddress(field, noopResolvePath);
    expect(result).toBe("0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d");
  });

  it("falls back to collectionPath param", () => {
    const field = {
      params: { collectionPath: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const result = resolveCollectionAddress(field, noopResolvePath);
    expect(result).toBe("0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d");
  });

  it("resolves from metadata path via resolvePath", () => {
    const collectionBytes = hexToBytes(
      "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D",
    );
    const resolve: ResolvePath = (path) =>
      path === "$.metadata.constants.collectionAddr"
        ? { type: "address", bytes: collectionBytes }
        : undefined;
    const field = {
      params: { collection: "$.metadata.constants.collectionAddr" },
    };
    const result = resolveCollectionAddress(field, resolve);
    expect(result).toBe("0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d");
  });

  it("resolves from resolvePath for bare paths", () => {
    const resolve: ResolvePath = (path) =>
      path === "nftAddr" ? addr() : undefined;
    const field = { params: { collection: "nftAddr" } };
    const result = resolveCollectionAddress(field, resolve);
    expect(result).toBe("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
  });

  it("returns undefined when no collection param", () => {
    const result = resolveCollectionAddress({}, noopResolvePath);
    expect(result).toBeUndefined();
  });
});

describe("formatNftName", () => {
  it("renders collection name and token ID when resolved", async () => {
    const field = {
      params: { collection: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const provider: ExternalDataProvider = {
      resolveNftCollectionName: vi.fn().mockResolvedValue({
        name: "BoredApeYachtClub",
      }),
    };
    const result = await formatNftName(
      field,
      uint(1036n),
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe(
      "Collection Name: BoredApeYachtClub - Token ID: 1036",
    );
    expect(result.warning).toBeUndefined();
  });

  it("falls back to raw when collection address is missing", async () => {
    const result = await formatNftName({}, uint(1036n), noopResolvePath, 1);
    expect(result.rendered).toBe("1,036");
    expect(result.warning).toBeUndefined();
  });

  it("returns CONTAINER_MISSING_CHAIN_ID warning when chainId is undefined", async () => {
    const field = {
      params: { collection: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const result = await formatNftName(
      field,
      uint(1036n),
      noopResolvePath,
      undefined,
    );
    expect(result.rendered).toBe("1,036");
    expect(result.warning?.code).toBe("CONTAINER_MISSING_CHAIN_ID");
  });

  it("returns UNKNOWN_NFT warning when provider returns null", async () => {
    const field = {
      params: { collection: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const provider: ExternalDataProvider = {
      resolveNftCollectionName: vi.fn().mockResolvedValue(null),
    };
    const result = await formatNftName(
      field,
      uint(1036n),
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe("1,036");
    expect(result.warning?.code).toBe("UNKNOWN_NFT");
  });

  it("returns UNKNOWN_NFT warning when provider throws", async () => {
    const field = {
      params: { collection: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const provider: ExternalDataProvider = {
      resolveNftCollectionName: vi.fn().mockRejectedValue(new Error("fail")),
    };
    const result = await formatNftName(
      field,
      uint(1036n),
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe("1,036");
    expect(result.warning?.code).toBe("UNKNOWN_NFT");
  });

  it("returns type mismatch for non-numeric types", async () => {
    const result = await formatNftName({}, str("hello"), noopResolvePath, 1);
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });

  it("accepts int type", async () => {
    const field = {
      params: { collection: "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D" },
    };
    const provider: ExternalDataProvider = {
      resolveNftCollectionName: vi.fn().mockResolvedValue({ name: "CoolCats" }),
    };
    const result = await formatNftName(
      field,
      int(42n),
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe("Collection Name: CoolCats - Token ID: 42");
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
// unit format: formatUnit
// ---------------------------------------------------------------------------

describe("formatUnit", () => {
  it("formats integer with base unit (no decimals)", () => {
    const result = formatUnit(uint(10n), { params: { base: "h" } });
    expect(result.rendered).toBe("10h");
  });

  it("formats with decimals", () => {
    const result = formatUnit(uint(15n), {
      params: { base: "d", decimals: 1 },
    });
    expect(result.rendered).toBe("1.5d");
  });

  it("formats percentage with decimals", () => {
    const result = formatUnit(uint(5000n), {
      params: { base: "%", decimals: 2 },
    });
    expect(result.rendered).toBe("50%");
  });

  it("formats with SI prefix", () => {
    const result = formatUnit(uint(36000n), {
      params: { base: "s", prefix: true },
    });
    expect(result.rendered).toBe("36ks");
  });

  it("formats with SI prefix and decimals", () => {
    const result = formatUnit(uint(1500000n), {
      params: { base: "W", decimals: 3, prefix: true },
    });
    expect(result.rendered).toBe("1.5kW");
  });

  it("falls back to no prefix when value is too small", () => {
    const result = formatUnit(uint(500n), {
      params: { base: "s", prefix: true },
    });
    expect(result.rendered).toBe("500s");
  });

  it("returns type mismatch for non-numeric values", () => {
    const result = formatUnit(str("hello"), { params: { base: "m" } });
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
  });

  it("defaults decimals to 0 and base to empty", () => {
    const result = formatUnit(uint(42n), {});
    expect(result.rendered).toBe("42");
  });
});

// ---------------------------------------------------------------------------
// duration format: formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it("formats seconds as HH:MM:ss", () => {
    const result = formatDuration(uint(8250n));
    expect(result.rendered).toBe("02:17:30");
  });

  it("formats zero", () => {
    const result = formatDuration(uint(0n));
    expect(result.rendered).toBe("00:00:00");
  });

  it("formats values under a minute", () => {
    const result = formatDuration(uint(45n));
    expect(result.rendered).toBe("00:00:45");
  });

  it("formats exactly one hour", () => {
    const result = formatDuration(uint(3600n));
    expect(result.rendered).toBe("01:00:00");
  });

  it("handles large values (over 99 hours)", () => {
    const result = formatDuration(uint(360000n));
    expect(result.rendered).toBe("100:00:00");
  });

  it("accepts int type", () => {
    const result = formatDuration(int(8250n));
    expect(result.rendered).toBe("02:17:30");
  });

  it("returns type mismatch for non-numeric types", () => {
    const result = formatDuration(str("hello"));
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
// tokenTicker format: formatTokenTicker
// ---------------------------------------------------------------------------

describe("formatTokenTicker", () => {
  const usdc: TokenResult = { name: "USD Coin", symbol: "USDC", decimals: 6 };
  const tokenAddr = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const tokenBytes = hexToBytes(tokenAddr);

  it("renders token symbol when resolved", async () => {
    const provider: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const result = await formatTokenTicker(
      addr(tokenBytes),
      {},
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe("USDC");
    expect(result.warning).toBeUndefined();
  });

  it("returns UNKNOWN_TOKEN warning when provider returns null", async () => {
    const provider: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(null),
    };
    const result = await formatTokenTicker(
      addr(tokenBytes),
      {},
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe(tokenAddr);
    expect(result.warning?.code).toBe("UNKNOWN_TOKEN");
  });

  it("returns UNKNOWN_TOKEN warning when provider throws", async () => {
    const provider: ExternalDataProvider = {
      resolveToken: vi.fn().mockRejectedValue(new Error("fail")),
    };
    const result = await formatTokenTicker(
      addr(tokenBytes),
      {},
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe(tokenAddr);
    expect(result.warning?.code).toBe("UNKNOWN_TOKEN");
  });

  it("returns CONTAINER_MISSING_CHAIN_ID when no chainId available", async () => {
    const result = await formatTokenTicker(
      addr(tokenBytes),
      {},
      noopResolvePath,
      undefined,
    );
    expect(result.rendered).toBe(tokenAddr);
    expect(result.warning?.code).toBe("CONTAINER_MISSING_CHAIN_ID");
  });

  it("uses chainId from params over container chainId", async () => {
    const provider: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const result = await formatTokenTicker(
      addr(tokenBytes),
      { params: { chainId: 137 } },
      noopResolvePath,
      1,
      provider,
    );
    expect(result.rendered).toBe("USDC");
    expect(provider.resolveToken).toHaveBeenCalledWith(
      137,
      tokenAddr.toLowerCase(),
    );
  });

  it("resolves chainIdPath via resolvePath", async () => {
    const resolve: ResolvePath = (path) =>
      path === "destChain" ? { type: "uint", value: 42n } : undefined;
    const provider: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const result = await formatTokenTicker(
      addr(tokenBytes),
      { params: { chainIdPath: "destChain" } },
      resolve,
      1,
      provider,
    );
    expect(result.rendered).toBe("USDC");
    expect(provider.resolveToken).toHaveBeenCalledWith(
      42,
      tokenAddr.toLowerCase(),
    );
  });

  it("falls back to container chainId when param chainId is absent", async () => {
    const provider: ExternalDataProvider = {
      resolveToken: vi.fn().mockResolvedValue(usdc),
    };
    const result = await formatTokenTicker(
      addr(tokenBytes),
      {},
      noopResolvePath,
      10,
      provider,
    );
    expect(result.rendered).toBe("USDC");
    expect(provider.resolveToken).toHaveBeenCalledWith(
      10,
      tokenAddr.toLowerCase(),
    );
  });

  it("falls back to raw when chainIdPath cannot be resolved", async () => {
    const result = await formatTokenTicker(
      addr(tokenBytes),
      { params: { chainIdPath: "missingPath" } },
      noopResolvePath,
      1,
    );
    expect(result.rendered).toBe(tokenAddr);
    expect(result.warning).toBeUndefined();
  });

  it("returns type mismatch for non-address types", async () => {
    const result = await formatTokenTicker(uint(42n), {}, noopResolvePath, 1);
    expect(result.warning?.code).toBe("ARGUMENT_TYPE_MISMATCH");
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
      "nftName",
      {},
      noopResolvePath,
      1,
      undefined,
    );
    expect(result.rendered).toBe("7");
  });
});
