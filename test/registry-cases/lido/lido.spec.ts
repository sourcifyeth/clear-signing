/**
 * Tests for Lido descriptors:
 * - WithdrawalQueueERC721.claimWithdrawals: uint256[] array iteration with a
 *   visible-never sibling array
 * - stETH.approve: addressName + tokenAmount with descriptor constants
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../../src/types.js";
import { hexToBytes, toChecksumAddress } from "../../../src/utils.js";
import { buildEmbeddedResolverOpts } from "../../utils.js";

describe("Lido WithdrawalQueueERC721", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1";

  function buildOpts() {
    return buildEmbeddedResolverOpts(__dirname, {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: CONTRACT,
          file: "calldata-WithdrawalQueueERC721.json",
        },
      ],
    });
  }

  // =========================================================================
  // claimWithdrawals
  // =========================================================================
  describe("claimWithdrawals", () => {
    // Calldata extracted from mainnet tx
    //   0x79a234f238f16b22ff70a2023fbbba8cf4982f46c795eeee6ffd0232d942fa99
    //   selector:    0xe3afe0a3 = claimWithdrawals(uint256[],uint256[])
    //   _requestIds: [93761]               (0x16e41)
    //   _hints:      [844]      (visible: never; 0x34c)
    const CLAIM_WITHDRAWALS_CALLDATA =
      "0xe3afe0a3" +
      "0000000000000000000000000000000000000000000000000000000000000040" + // offset to _requestIds
      "0000000000000000000000000000000000000000000000000000000000000080" + // offset to _hints
      "0000000000000000000000000000000000000000000000000000000000000001" + // _requestIds.length = 1
      "0000000000000000000000000000000000000000000000000000000000016e41" + // _requestIds[0] = 93761
      "0000000000000000000000000000000000000000000000000000000000000001" + // _hints.length = 1
      "000000000000000000000000000000000000000000000000000000000000034c"; // _hints[0] = 844

    it("formats claimWithdrawals iterating over visible request IDs only", async () => {
      const opts = buildOpts();

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: CLAIM_WITHDRAWALS_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("claim withdrawals");

      assert(result.fields);
      // Only _requestIds is visible → 1 DisplayFieldGroup
      expect(result.fields).toHaveLength(1);

      const requestIdsGroup = result.fields[0];
      assert(isFieldGroup(requestIdsGroup));
      expect(requestIdsGroup.label).toBeUndefined();
      expect(requestIdsGroup.warning).toBeUndefined();
      expect(requestIdsGroup.fields).toHaveLength(1);

      const requestIdField = requestIdsGroup.fields[0];
      assert(!isFieldGroup(requestIdField));
      expect(requestIdField.label).toBe("Request ID");
      expect(requestIdField.value).toBe("93761");
      expect(requestIdField.fieldType).toBe("uint");
      expect(requestIdField.format).toBe("raw");
      expect(requestIdField.tokenAddress).toBeUndefined();
      expect(requestIdField.rawAddress).toBeUndefined();
      expect(requestIdField.embeddedCalldata).toBeUndefined();
      expect(requestIdField.warning).toBeUndefined();

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Lido DAO");
      expect(result.metadata.contractName).toBe("WithdrawalQueueERC721");
      expect(result.metadata.info).toEqual({ url: "https://lido.fi" });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});

describe("Lido stETH", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
  const SPENDER = "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1";

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    if (address === SPENDER.toLowerCase()) {
      return { name: "WithdrawalQueueERC721", typeMatch: true };
    }
    return null;
  };

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (chainId === CHAIN_ID && tokenAddress === CONTRACT.toLowerCase()) {
      return { name: "Liquid staked Ether 2.0", symbol: "stETH", decimals: 18 };
    }
    return null;
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-stETH.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  // =========================================================================
  // approve
  // =========================================================================
  describe("approve", () => {
    // approve(address _spender, uint256 _amount)
    //   selector:  0x095ea7b3
    //   _spender:  0x889edC2eDab5f40e902b864ad4d7ade8e412f9b1 (WithdrawalQueueERC721)
    //   _amount:   2_000_000_000_000_000_000 (2 stETH, below the 2^255 "unlimited" threshold)
    const APPROVE_CALLDATA =
      "0x095ea7b3" +
      "000000000000000000000000889edc2edab5f40e902b864ad4d7ade8e412f9b1" +
      "0000000000000000000000000000000000000000000000001bc16d674ec80000";

    it("formats an approve call resolving the spender name and stETH amount", async () => {
      const opts = buildOpts({ resolveLocalName, resolveToken });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: APPROVE_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Approve stETH");
      expect(result.interpolatedIntent).toBe("Allow to spend 2 stETH");

      assert(result.fields);
      expect(result.fields).toHaveLength(2);

      const spenderField = result.fields[0];
      assert(!isFieldGroup(spenderField));
      expect(spenderField.label).toBe("Spender");
      expect(spenderField.value).toBe("WithdrawalQueueERC721");
      expect(spenderField.fieldType).toBe("address");
      expect(spenderField.format).toBe("addressName");
      expect(spenderField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(SPENDER)),
      );
      expect(spenderField.tokenAddress).toBeUndefined();
      expect(spenderField.embeddedCalldata).toBeUndefined();
      expect(spenderField.warning).toBeUndefined();

      const amountField = result.fields[1];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Amount");
      expect(amountField.value).toBe("2 stETH");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("tokenAmount");
      expect(amountField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(CONTRACT)),
      );
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.embeddedCalldata).toBeUndefined();
      expect(amountField.warning).toBeUndefined();

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Lido DAO");
      expect(result.metadata.contractName).toBe("stETH");
      expect(result.metadata.info).toEqual({ url: "https://lido.fi" });

      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
