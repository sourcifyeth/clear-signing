import { describe, it, expect } from "vitest";
import {
  format,
  formatWithValue,
  hexToBytes,
  bytesToHex,
  toChecksumAddress,
  ResolverError,
} from "../src/index.js";

describe("clear-signing", () => {
  describe("hexToBytes", () => {
    it("should convert hex string to bytes", () => {
      const bytes = hexToBytes("0x1234");
      expect(bytes).toEqual(new Uint8Array([0x12, 0x34]));
    });

    it("should handle hex without 0x prefix", () => {
      const bytes = hexToBytes("abcd");
      expect(bytes).toEqual(new Uint8Array([0xab, 0xcd]));
    });
  });

  describe("bytesToHex", () => {
    it("should convert bytes to hex string", () => {
      const hex = bytesToHex(new Uint8Array([0x12, 0x34]));
      expect(hex).toBe("0x1234");
    });
  });

  describe("toChecksumAddress", () => {
    it("should generate EIP-55 checksum address", () => {
      // USDT contract address
      const bytes = hexToBytes("dAC17F958D2ee523a2206206994597C13D831ec7");
      const checksum = toChecksumAddress(bytes);
      expect(checksum).toBe("0xdAC17F958D2ee523a2206206994597C13D831ec7");
    });
  });

  describe("format", () => {
    it("should format ERC20 approve call for USDT", () => {
      // approve(address spender, uint256 value)
      // selector: 0x095ea7b3
      // spender: 0xe592427a0aece92de3edee1f18e0157c05861564 (Uniswap V3 Router)
      // value: 1000000 (1 USDT with 6 decimals)
      const calldata = hexToBytes(
        "0x095ea7b3" +
          "000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564" +
          "00000000000000000000000000000000000000000000000000000000000f4240",
      );

      const result = format(
        1, // Ethereum mainnet
        "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
        calldata,
      );

      expect(result.intent).toBe("Approve USDT spending");
      expect(result.items.length).toBeGreaterThan(0);

      // Check spender field
      const spenderItem = result.items.find((item) => item.label === "Spender");
      expect(spenderItem).toBeDefined();
      expect(spenderItem?.value).toBe("Uniswap V3 Router");

      // Check amount field
      const amountItem = result.items.find((item) => item.label === "Amount");
      expect(amountItem).toBeDefined();
      expect(amountItem?.value).toBe("1 USDT");
    });

    it('should format max approval as "All"', () => {
      // approve with max uint256 value
      const calldata = hexToBytes(
        "0x095ea7b3" +
          "000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564" +
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );

      const result = format(
        1,
        "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        calldata,
      );

      const amountItem = result.items.find((item) => item.label === "Amount");
      expect(amountItem).toBeDefined();
      expect(amountItem?.value).toBe("All USDT");
    });

    it("should throw for unknown contract", () => {
      const calldata = hexToBytes("0x12345678");

      expect(() => {
        format(1, "0x0000000000000000000000000000000000000000", calldata);
      }).toThrow(ResolverError);
    });

    it("should return raw preview for unknown function", () => {
      // Random function selector that doesn't exist in USDT
      const calldata = hexToBytes(
        "0x12345678" +
          "0000000000000000000000000000000000000000000000000000000000000001",
      );

      const result = format(
        1,
        "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        calldata,
      );

      expect(result.intent).toBe("Unknown transaction");
      expect(result.raw).toBeDefined();
      expect(result.raw?.selector).toBe("0x12345678");
    });
  });

  describe("formatWithValue", () => {
    it("should include ETH value in preview", () => {
      // WETH deposit()
      // selector: 0xd0e30db0
      const calldata = hexToBytes("0xd0e30db0");
      const value = hexToBytes("0x0de0b6b3a7640000"); // 1 ETH

      const result = formatWithValue(
        1,
        "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
        value,
        calldata,
      );

      expect(result.intent).toBe("Wrap ETH into WETH");
      const amountItem = result.items.find((item) => item.label === "Amount");
      expect(amountItem).toBeDefined();
      expect(amountItem?.value).toBe("1 WETH");
    });
  });
});
