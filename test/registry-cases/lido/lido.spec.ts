/**
 * Tests for Lido WithdrawalQueueERC721 descriptor:
 * - claimWithdrawals: uint256[] array iteration with a visible-never sibling array
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel } from "../../../src/types.js";
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
