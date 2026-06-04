/**
 * Tests for Lido descriptors:
 * - WithdrawalQueueERC721.claimWithdrawals: uint256[] array iteration with a
 *   visible-never sibling array
 * - WithdrawalQueueERC721.requestWithdrawals: uint256[] tokenAmount iteration
 *   followed by a non-iterating addressName field
 * - stETH.approve: addressName + tokenAmount with descriptor constants
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
import { buildFilesystemResolverOpts } from "../../utils.js";

describe("Lido WithdrawalQueueERC721", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1";

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-WithdrawalQueueERC721.json",
          },
        ],
      },
      externalDataProvider,
    );
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

      expect(result.intent).toBe("Claim withdrawals");

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

  // =========================================================================
  // requestWithdrawals
  // =========================================================================
  describe("requestWithdrawals", () => {
    const STETH_ADDRESS = "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84";
    const OWNER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const OWNER_ENS = "vitalik.eth";

    // requestWithdrawals(uint256[] _amounts, address _owner)
    //   selector: 0xd6681042
    //   _amounts: [1e18, 25e17, 1e19]   (1 stETH, 2.5 stETH and 10 stETH)
    //   _owner:   0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
    const SELECTOR = bytesToHex(
      selectorForSignature("requestWithdrawals(uint256[],address)"),
    );
    const REQUEST_WITHDRAWALS_CALLDATA =
      SELECTOR +
      "0000000000000000000000000000000000000000000000000000000000000040" + // offset to _amounts
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // _owner
      "0000000000000000000000000000000000000000000000000000000000000003" + // _amounts.length = 3
      "0000000000000000000000000000000000000000000000000de0b6b3a7640000" + // _amounts[0] = 1e18 (1 stETH)
      "00000000000000000000000000000000000000000000000022b1c8c1227a0000" + // _amounts[1] = 2.5e18 (2.5 stETH)
      "0000000000000000000000000000000000000000000000008ac7230489e80000"; // _amounts[2] = 1e19 (10 stETH)

    const resolveEnsName: ExternalDataProvider["resolveEnsName"] = async (
      address,
    ) => {
      if (address === OWNER.toLowerCase()) {
        return { name: OWNER_ENS, typeMatch: true };
      }
      return null;
    };

    const resolveToken: ExternalDataProvider["resolveToken"] = async (
      chainId,
      tokenAddress,
    ) => {
      if (
        chainId === CHAIN_ID &&
        tokenAddress === STETH_ADDRESS.toLowerCase()
      ) {
        return {
          name: "Liquid staked Ether 2.0",
          symbol: "stETH",
          decimals: 18,
        };
      }
      return null;
    };

    it("formats requestWithdrawals iterating over stETH amounts with a beneficiary", async () => {
      const opts = buildOpts({ resolveEnsName, resolveToken });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: REQUEST_WITHDRAWALS_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Request Withdrawal");
      expect(result.interpolatedIntent).toBe(
        "Withdraw 1 stETH and 2.5 stETH and 10 stETH",
      );

      assert(result.fields);
      // Amount group (iterating over _amounts) + Beneficiary field
      expect(result.fields).toHaveLength(2);

      const amountGroup = result.fields[0];
      assert(isFieldGroup(amountGroup));
      expect(amountGroup.label).toBeUndefined();
      expect(amountGroup.warning).toBeUndefined();
      expect(amountGroup.fields).toHaveLength(3);

      const amount0 = amountGroup.fields[0];
      assert(!isFieldGroup(amount0));
      expect(amount0.label).toBe("Amount");
      expect(amount0.value).toBe("1 stETH");
      expect(amount0.fieldType).toBe("uint");
      expect(amount0.format).toBe("tokenAmount");
      expect(amount0.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(STETH_ADDRESS)),
      );
      expect(amount0.rawAddress).toBeUndefined();
      expect(amount0.embeddedCalldata).toBeUndefined();
      expect(amount0.warning).toBeUndefined();

      const amount1 = amountGroup.fields[1];
      assert(!isFieldGroup(amount1));
      expect(amount1.label).toBe("Amount");
      expect(amount1.value).toBe("2.5 stETH");
      expect(amount1.fieldType).toBe("uint");
      expect(amount1.format).toBe("tokenAmount");
      expect(amount1.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(STETH_ADDRESS)),
      );
      expect(amount1.rawAddress).toBeUndefined();
      expect(amount1.embeddedCalldata).toBeUndefined();
      expect(amount1.warning).toBeUndefined();

      const amount2 = amountGroup.fields[2];
      assert(!isFieldGroup(amount2));
      expect(amount2.label).toBe("Amount");
      expect(amount2.value).toBe("10 stETH");
      expect(amount2.fieldType).toBe("uint");
      expect(amount2.format).toBe("tokenAmount");
      expect(amount2.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(STETH_ADDRESS)),
      );
      expect(amount2.rawAddress).toBeUndefined();
      expect(amount2.embeddedCalldata).toBeUndefined();
      expect(amount2.warning).toBeUndefined();

      const beneficiaryField = result.fields[1];
      assert(!isFieldGroup(beneficiaryField));
      expect(beneficiaryField.label).toBe("Beneficiary");
      expect(beneficiaryField.value).toBe(OWNER_ENS);
      expect(beneficiaryField.fieldType).toBe("address");
      expect(beneficiaryField.format).toBe("addressName");
      expect(beneficiaryField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(OWNER)),
      );
      expect(beneficiaryField.tokenAddress).toBeUndefined();
      expect(beneficiaryField.embeddedCalldata).toBeUndefined();
      expect(beneficiaryField.warning).toBeUndefined();

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Lido DAO");
      expect(result.metadata.contractName).toBe("WithdrawalQueueERC721");
      expect(result.metadata.info).toEqual({ url: "https://lido.fi" });

      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });

    // requestWithdrawals with an empty _amounts array:
    //   selector: 0xd6681042
    //   _amounts: []
    //   _owner:   0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
    const REQUEST_WITHDRAWALS_EMPTY_CALLDATA =
      SELECTOR +
      "0000000000000000000000000000000000000000000000000000000000000040" + // offset to _amounts
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // _owner
      "0000000000000000000000000000000000000000000000000000000000000000"; // _amounts.length = 0

    it("returns EMPTY_ARRAY warning when _amounts is empty", async () => {
      const opts = buildOpts({ resolveEnsName, resolveToken });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: REQUEST_WITHDRAWALS_EMPTY_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Request Withdrawal");

      assert(result.fields);
      // Empty amount group + Beneficiary field
      expect(result.fields).toHaveLength(2);

      const amountGroup = result.fields[0];
      assert(isFieldGroup(amountGroup));
      expect(amountGroup.label).toBe("Amount");
      expect(amountGroup.fields).toHaveLength(0);
      assert(amountGroup.warning);
      expect(amountGroup.warning.code).toBe("EMPTY_ARRAY");

      const beneficiaryField = result.fields[1];
      assert(!isFieldGroup(beneficiaryField));
      expect(beneficiaryField.label).toBe("Beneficiary");
      expect(beneficiaryField.value).toBe(OWNER_ENS);
      expect(beneficiaryField.fieldType).toBe("address");
      expect(beneficiaryField.format).toBe("addressName");
      expect(beneficiaryField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(OWNER)),
      );
      expect(beneficiaryField.tokenAddress).toBeUndefined();
      expect(beneficiaryField.embeddedCalldata).toBeUndefined();
      expect(beneficiaryField.warning).toBeUndefined();

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Lido DAO");
      expect(result.metadata.contractName).toBe("WithdrawalQueueERC721");
      expect(result.metadata.info).toEqual({ url: "https://lido.fi" });

      // interpolatedIntent references {_amounts.[]} which cannot resolve to an
      // empty array, so interpolation fails and the value is omitted.
      expect(result.interpolatedIntent).toBeUndefined();
      assert(result.warnings);
      expect(
        result.warnings.some((w) => w.code === "INTERPOLATION_ERROR"),
      ).toBe(true);

      expect(result.rawCalldataFallback).toBeUndefined();
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
    return buildFilesystemResolverOpts(
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
