/**
 * Tests for Ekubo Positions descriptor:
 * - mintAndDeposit: `int32` ticks sign-extended to 32-byte ABI words, next to
 *   a static tuple and tokenAmount fields that resolve tokens through the tuple
 * - maybeInitializePool: a single negative `int32` tick after a static tuple
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../../src/types.js";
import {
  bytesToHex,
  hexToBytes,
  selectorForSignature,
  toChecksumAddress,
} from "../../../src/utils.js";
import { buildFilesystemResolverOpts, padAddr, padInt } from "../../utils.js";

describe("Ekubo Positions", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x02D9876A21AF7545f8632C3af76eC90b5ad4b66D";
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  // Pool config: 20-byte extension (none) + 8-byte fee + 4-byte tick spacing
  const CONFIG = "00".repeat(20) + "000010c6f7a0b5ed" + "000003e8";

  const checksum = (addr: string) => toChecksumAddress(hexToBytes(addr));

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    address,
  ) => {
    if (chainId !== CHAIN_ID) return null;
    if (address === USDC) {
      return { name: "USD Coin", symbol: "USDC", decimals: 6 };
    }
    if (address === WETH) {
      return { name: "Wrapped Ether", symbol: "WETH", decimals: 18 };
    }
    return null;
  };

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    if (address === USDC) return { name: "USDC", typeMatch: true };
    if (address === WETH) return { name: "WETH", typeMatch: true };
    return null;
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-Positions.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  // =========================================================================
  // mintAndDeposit
  // =========================================================================
  describe("mintAndDeposit", () => {
    const TICK_LOWER = -88722835n;
    const TICK_UPPER = 88722835n;

    const SELECTOR = bytesToHex(
      selectorForSignature(
        "mintAndDeposit((address,address,bytes32),int32,int32,uint128,uint128,uint128)",
      ),
    );

    // The tuple holds static members only, so the ABI encodes it in place.
    const MINT_AND_DEPOSIT_CALLDATA =
      SELECTOR +
      padAddr(USDC) + // poolKey.token0
      padAddr(WETH) + // poolKey.token1
      CONFIG + // poolKey.config
      padInt(TICK_LOWER) + // tickLower — sign-extended to 32 bytes
      padInt(TICK_UPPER) + // tickUpper
      padInt(1_500_000_000n) + // maxAmount0 = 1500 USDC
      padInt(500_000_000_000_000_000n) + // maxAmount1 = 0.5 WETH
      padInt(1_000_000n); // minLiquidity

    it("formats mintAndDeposit with negative and positive int32 ticks", async () => {
      const opts = buildOpts({ resolveToken });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: MINT_AND_DEPOSIT_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Create liquidity position");
      expect(result.interpolatedIntent).toBe("Add liquidity");

      assert(result.fields);
      expect(result.fields).toHaveLength(6);

      const maxAmount0Field = result.fields[0];
      assert(!isFieldGroup(maxAmount0Field));
      expect(maxAmount0Field.label).toBe("Maximum token 0");
      expect(maxAmount0Field.value).toBe("1500 USDC");
      expect(maxAmount0Field.fieldType).toBe("uint");
      expect(maxAmount0Field.format).toBe("tokenAmount");
      expect(maxAmount0Field.tokenAddress).toBe(checksum(USDC));
      expect(maxAmount0Field.rawAddress).toBeUndefined();
      expect(maxAmount0Field.embeddedCalldata).toBeUndefined();
      expect(maxAmount0Field.warning).toBeUndefined();

      const maxAmount1Field = result.fields[1];
      assert(!isFieldGroup(maxAmount1Field));
      expect(maxAmount1Field.label).toBe("Maximum token 1");
      expect(maxAmount1Field.value).toBe("0.5 WETH");
      expect(maxAmount1Field.fieldType).toBe("uint");
      expect(maxAmount1Field.format).toBe("tokenAmount");
      expect(maxAmount1Field.tokenAddress).toBe(checksum(WETH));
      expect(maxAmount1Field.rawAddress).toBeUndefined();
      expect(maxAmount1Field.embeddedCalldata).toBeUndefined();
      expect(maxAmount1Field.warning).toBeUndefined();

      const minLiquidityField = result.fields[2];
      assert(!isFieldGroup(minLiquidityField));
      expect(minLiquidityField.label).toBe("Minimum liquidity");
      expect(minLiquidityField.value).toBe("1000000");
      expect(minLiquidityField.fieldType).toBe("uint");
      expect(minLiquidityField.format).toBe("raw");
      expect(minLiquidityField.tokenAddress).toBeUndefined();
      expect(minLiquidityField.rawAddress).toBeUndefined();
      expect(minLiquidityField.embeddedCalldata).toBeUndefined();
      expect(minLiquidityField.warning).toBeUndefined();

      const tickLowerField = result.fields[3];
      assert(!isFieldGroup(tickLowerField));
      expect(tickLowerField.label).toBe("Lower tick");
      expect(tickLowerField.value).toBe(TICK_LOWER.toString());
      expect(tickLowerField.fieldType).toBe("int");
      expect(tickLowerField.format).toBe("raw");
      expect(tickLowerField.tokenAddress).toBeUndefined();
      expect(tickLowerField.rawAddress).toBeUndefined();
      expect(tickLowerField.embeddedCalldata).toBeUndefined();
      expect(tickLowerField.warning).toBeUndefined();

      const tickUpperField = result.fields[4];
      assert(!isFieldGroup(tickUpperField));
      expect(tickUpperField.label).toBe("Upper tick");
      expect(tickUpperField.value).toBe(TICK_UPPER.toString());
      expect(tickUpperField.fieldType).toBe("int");
      expect(tickUpperField.format).toBe("raw");
      expect(tickUpperField.tokenAddress).toBeUndefined();
      expect(tickUpperField.rawAddress).toBeUndefined();
      expect(tickUpperField.embeddedCalldata).toBeUndefined();
      expect(tickUpperField.warning).toBeUndefined();

      const configField = result.fields[5];
      assert(!isFieldGroup(configField));
      expect(configField.label).toBe("Pool config");
      expect(configField.value).toBe(`0x${CONFIG}`);
      expect(configField.fieldType).toBe("bytes");
      expect(configField.format).toBe("raw");
      expect(configField.tokenAddress).toBeUndefined();
      expect(configField.rawAddress).toBeUndefined();
      expect(configField.embeddedCalldata).toBeUndefined();
      expect(configField.warning).toBeUndefined();

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Ekubo Protocol");
      expect(result.metadata.contractName).toBe("Ekubo Positions");
      expect(result.metadata.info).toBeUndefined();

      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });

  // =========================================================================
  // maybeInitializePool
  // =========================================================================
  describe("maybeInitializePool", () => {
    const TICK = -76_300_000n;

    const SELECTOR = bytesToHex(
      selectorForSignature(
        "maybeInitializePool((address,address,bytes32),int32)",
      ),
    );

    const MAYBE_INITIALIZE_POOL_CALLDATA =
      SELECTOR +
      padAddr(USDC) + // poolKey.token0
      padAddr(WETH) + // poolKey.token1
      CONFIG + // poolKey.config
      padInt(TICK); // tick — sign-extended to 32 bytes

    it("formats maybeInitializePool with a negative int32 tick", async () => {
      const opts = buildOpts({ resolveLocalName });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: MAYBE_INITIALIZE_POOL_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Initialize pool if needed");
      expect(result.interpolatedIntent).toBe("Initialize pool if needed");

      assert(result.fields);
      expect(result.fields).toHaveLength(4);

      const token0Field = result.fields[0];
      assert(!isFieldGroup(token0Field));
      expect(token0Field.label).toBe("Pool token 0");
      expect(token0Field.value).toBe("USDC");
      expect(token0Field.fieldType).toBe("address");
      expect(token0Field.format).toBe("addressName");
      expect(token0Field.tokenAddress).toBeUndefined();
      expect(token0Field.rawAddress).toBe(checksum(USDC));
      expect(token0Field.embeddedCalldata).toBeUndefined();
      expect(token0Field.warning).toBeUndefined();

      const token1Field = result.fields[1];
      assert(!isFieldGroup(token1Field));
      expect(token1Field.label).toBe("Pool token 1");
      expect(token1Field.value).toBe("WETH");
      expect(token1Field.fieldType).toBe("address");
      expect(token1Field.format).toBe("addressName");
      expect(token1Field.tokenAddress).toBeUndefined();
      expect(token1Field.rawAddress).toBe(checksum(WETH));
      expect(token1Field.embeddedCalldata).toBeUndefined();
      expect(token1Field.warning).toBeUndefined();

      const tickField = result.fields[2];
      assert(!isFieldGroup(tickField));
      expect(tickField.label).toBe("Initial tick");
      expect(tickField.value).toBe(TICK.toString());
      expect(tickField.fieldType).toBe("int");
      expect(tickField.format).toBe("raw");
      expect(tickField.tokenAddress).toBeUndefined();
      expect(tickField.rawAddress).toBeUndefined();
      expect(tickField.embeddedCalldata).toBeUndefined();
      expect(tickField.warning).toBeUndefined();

      const configField = result.fields[3];
      assert(!isFieldGroup(configField));
      expect(configField.label).toBe("Pool config");
      expect(configField.value).toBe(`0x${CONFIG}`);
      expect(configField.fieldType).toBe("bytes");
      expect(configField.format).toBe("raw");
      expect(configField.tokenAddress).toBeUndefined();
      expect(configField.rawAddress).toBeUndefined();
      expect(configField.embeddedCalldata).toBeUndefined();
      expect(configField.warning).toBeUndefined();

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Ekubo Protocol");
      expect(result.metadata.contractName).toBe("Ekubo Positions");
      expect(result.metadata.info).toBeUndefined();

      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
