/**
 * Tests for Aave Lending Pool v2 descriptor:
 * - repay: tokenAmount with threshold/message (max uint → "All"),
 *   enum-formatted interest rate mode, addressName onBehalfOf
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../../src/types.js";
import { toChecksumAddress, hexToBytes } from "../../../src/utils.js";
import { buildEmbeddedResolverOpts } from "../../utils.js";

describe("Aave Lending Pool v2", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9";
  const ON_BEHALF_OF = "0x2fec9b58d089447d3e5e50578b9f71321713a470";
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-lpv2.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  // =========================================================================
  // repay
  // =========================================================================
  describe("repay", () => {
    // repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)
    // Calldata extracted from an EIP-1559 mainnet tx to the Aave LPv2 contract:
    //   asset       = USDC
    //   amount      = max uint256  (matches $.metadata.constants.max → "All")
    //   rateMode    = 2            (variable)
    //   onBehalfOf  = 0x2fec…a470
    const REPAY_CALLDATA =
      "0x573ade81" +
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" +
      "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" +
      "0000000000000000000000000000000000000000000000000000000000000002" +
      "0000000000000000000000002fec9b58d089447d3e5e50578b9f71321713a470";

    const resolveToken: ExternalDataProvider["resolveToken"] = async (
      chainId,
      tokenAddress,
    ) => {
      if (chainId === CHAIN_ID && tokenAddress === USDC) {
        return { name: "USD Coin", symbol: "USDC", decimals: 6 };
      }
      return null;
    };

    const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
      address,
    ) => {
      if (address === ON_BEHALF_OF.toLowerCase()) {
        return { name: "alice.eth", typeMatch: true };
      }
      return null;
    };

    it("renders 'All' when amount equals the max threshold constant", async () => {
      const opts = buildOpts({ resolveToken, resolveLocalName });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: REPAY_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Repay loan");

      assert(result.fields);
      expect(result.fields).toHaveLength(3);

      // Field 0: Amount to repay — amount == $.metadata.constants.max → "All"
      const amountField = result.fields[0];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Amount to repay");
      expect(amountField.value).toBe("All USDC");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("tokenAmount");
      expect(amountField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(USDC)),
      );
      expect(amountField.embeddedCalldata).toBeUndefined();
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.warning).toBeUndefined();

      // Field 1: Interest rate mode (enum, rateMode=2 → "variable")
      const rateField = result.fields[1];
      assert(!isFieldGroup(rateField));
      expect(rateField.label).toBe("Interest rate mode");
      expect(rateField.value).toBe("variable");
      expect(rateField.fieldType).toBe("uint");
      expect(rateField.format).toBe("enum");
      expect(rateField.tokenAddress).toBeUndefined();
      expect(rateField.embeddedCalldata).toBeUndefined();
      expect(rateField.rawAddress).toBeUndefined();
      expect(rateField.warning).toBeUndefined();

      // Field 2: For debt holder (addressName, onBehalfOf → alice.eth)
      const onBehalfOfField = result.fields[2];
      assert(!isFieldGroup(onBehalfOfField));
      expect(onBehalfOfField.label).toBe("For debt holder");
      expect(onBehalfOfField.value).toBe("alice.eth");
      expect(onBehalfOfField.fieldType).toBe("address");
      expect(onBehalfOfField.format).toBe("addressName");
      expect(onBehalfOfField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(ON_BEHALF_OF)),
      );
      expect(onBehalfOfField.tokenAddress).toBeUndefined();
      expect(onBehalfOfField.embeddedCalldata).toBeUndefined();
      expect(onBehalfOfField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Aave DAO");
      expect(result.metadata.contractName).toBe("Lending Pool v2");
      expect(result.metadata.info).toEqual({
        url: "https://aave.com",
        deploymentDate: "2020-11-30T09:25:48Z",
      });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
