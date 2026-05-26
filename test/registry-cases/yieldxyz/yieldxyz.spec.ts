/**
 * Tests for Yield.xyz POL Validator descriptor:
 * - buyVoucherPOL: unit format with $.metadata.constants base interpolation
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel } from "../../../src/types.js";
import { bytesToHex, selectorForSignature } from "../../../src/utils.js";
import { buildEmbeddedResolverOpts } from "../../utils.js";

describe("Yield.xyz POL Validator", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0xb929b89153fc2eed442e81e5a1add4e2fa39028f";

  function buildOpts() {
    return buildEmbeddedResolverOpts(__dirname, {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: CONTRACT,
          file: "calldata-yieldxyz-pol-validator.json",
        },
      ],
    });
  }

  // =========================================================================
  // buyVoucherPOL
  // =========================================================================
  describe("buyVoucherPOL", () => {
    // buyVoucherPOL(uint256 _amount, uint256 _minSharesToMint)
    //   _amount           = 100 * 10^18  (100 POL)
    //   _minSharesToMint  = 12345
    const SELECTOR = bytesToHex(
      selectorForSignature("buyVoucherPOL(uint256,uint256)"),
    );

    const BUY_VOUCHER_CALLDATA =
      SELECTOR +
      "0000000000000000000000000000000000000000000000056bc75e2d63100000" + // _amount = 100e18
      "0000000000000000000000000000000000000000000000000000000000003039"; // _minSharesToMint = 12345

    it("renders POL stake amount with constant-based unit ticker", async () => {
      const opts = buildOpts();

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: BUY_VOUCHER_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Stake POL");

      assert(result.fields);
      expect(result.fields).toHaveLength(2);

      // Field 0: Stake amount — unit format, 100e18 with decimals=18 → "100POL"
      const amountField = result.fields[0];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Stake amount");
      expect(amountField.value).toBe("100POL");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("unit");
      expect(amountField.tokenAddress).toBeUndefined();
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.embeddedCalldata).toBeUndefined();
      expect(amountField.warning).toBeUndefined();

      // Field 1: Min shares — raw format
      const minSharesField = result.fields[1];
      assert(!isFieldGroup(minSharesField));
      expect(minSharesField.label).toBe("Min shares");
      expect(minSharesField.value).toBe("12345");
      expect(minSharesField.fieldType).toBe("uint");
      expect(minSharesField.format).toBe("raw");
      expect(minSharesField.tokenAddress).toBeUndefined();
      expect(minSharesField.rawAddress).toBeUndefined();
      expect(minSharesField.embeddedCalldata).toBeUndefined();
      expect(minSharesField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Yield.xyz");
      expect(result.metadata.contractName).toBe("YieldxyzPolValidator");
      expect(result.metadata.info).toEqual({ url: "https://yield.xyz/" });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
