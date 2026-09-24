/**
 * Tests based on the ERC-7730 spec test case: example-maps.json
 * Tests `metadata.maps` references keyed on the container chain ID.
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../src/types.js";
import { hexToBytes, toChecksumAddress } from "../../src/utils.js";
import { buildFilesystemResolverOpts } from "../utils.js";

describe("example-maps.json — deposit(uint256 amount,uint256 minShares)", () => {
  // The same contract address is deployed on every chain in the descriptor.
  const CONTRACT = "0x00112233445566778899AABBCCDDEEFF00112233";

  // metadata.maps.shareToken, keyed on @.chainId
  const SHARE_TOKENS: Record<number, { address: string; symbol: string }> = {
    1: {
      address: "0x00000000000000000000000000000000abcdef01",
      symbol: "SHR1",
    },
    137: {
      address: "0x00000000000000000000000000000000abcdef02",
      symbol: "SHR137",
    },
    42161: {
      address: "0x00000000000000000000000000000000abcdef03",
      symbol: "SHR42161",
    },
  };

  // deposit(1e18, 2e18)
  // selector: 0xe2bbb158
  const DEPOSIT_CALLDATA =
    "0xe2bbb158" +
    "0000000000000000000000000000000000000000000000000de0b6b3a7640000" + // amount
    "0000000000000000000000000000000000000000000000001bc16d674ec80000"; // minShares

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    const share = SHARE_TOKENS[chainId];
    if (share && tokenAddress === share.address) {
      return { name: `Share ${chainId}`, symbol: share.symbol, decimals: 18 };
    }
    return null;
  };

  function buildOpts(
    chainId: number,
    externalDataProvider?: ExternalDataProvider,
  ) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          { chainId, address: CONTRACT, file: "example-maps.json" },
        ],
      },
      externalDataProvider,
    );
  }

  for (const chainId of [1, 137, 42161]) {
    it(`resolves the share token of chain ${chainId} from the map`, async () => {
      const share = SHARE_TOKENS[chainId];
      const result: DisplayModel = await format(
        { chainId, to: CONTRACT, data: DEPOSIT_CALLDATA },
        buildOpts(chainId, { resolveToken }),
      );

      expect(result.intent).toBe("Deposit");

      assert(result.fields);
      expect(result.fields).toHaveLength(2);

      // Field 0: Deposit Amount. The spec file's underlyingToken values are
      // 21 bytes long, so the map resolves but the value is not an address.
      // The library reports the unresolvable token param and shows the raw
      // value. Spec files are never edited.
      const amountField = result.fields[0];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Deposit Amount");
      expect(amountField.value).toBe("1000000000000000000");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("tokenAmount");
      expect(amountField.warning).toEqual({
        code: "FORMAT_PARAM_RESOLUTION_ERROR",
        message: "token or tokenPath param could not be resolved",
      });
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.tokenAddress).toBeUndefined();
      expect(amountField.embeddedCalldata).toBeUndefined();

      // Field 1: Min Received Shares — shareToken map entry for this chain.
      const sharesField = result.fields[1];
      assert(!isFieldGroup(sharesField));
      expect(sharesField.label).toBe("Min Received Shares");
      expect(sharesField.value).toBe(`2 ${share.symbol}`);
      expect(sharesField.fieldType).toBe("uint");
      expect(sharesField.format).toBe("tokenAmount");
      expect(sharesField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(share.address)),
      );
      expect(sharesField.warning).toBeUndefined();
      expect(sharesField.rawAddress).toBeUndefined();
      expect(sharesField.embeddedCalldata).toBeUndefined();

      expect(result.interpolatedIntent).toBe(
        `Deposit 1000000000000000000 to get at least 2 ${share.symbol}`,
      );

      assert(result.metadata);
      expect(result.metadata.owner).toBe("Example");
      expect(result.metadata.contractName).toBeUndefined();
      expect(result.metadata.info).toEqual({ url: "https://example.io/" });

      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  }

  it("passes the mapped token address of the chain to resolveToken", async () => {
    const calls: Array<[number, string]> = [];
    const recordingResolveToken: ExternalDataProvider["resolveToken"] = async (
      chainId,
      tokenAddress,
    ) => {
      calls.push([chainId, tokenAddress]);
      return resolveToken(chainId, tokenAddress);
    };

    await format(
      { chainId: 137, to: CONTRACT, data: DEPOSIT_CALLDATA },
      buildOpts(137, { resolveToken: recordingResolveToken }),
    );

    // Only the shareToken entry is a valid address (see above), so it is the
    // only lookup. The polygon entry is used, not the mainnet one.
    expect(calls).toEqual([[137, SHARE_TOKENS[137].address]]);
  });

  it("falls back to the raw share amount with UNKNOWN_TOKEN when the mapped token is unknown", async () => {
    const result: DisplayModel = await format(
      { chainId: 1, to: CONTRACT, data: DEPOSIT_CALLDATA },
      buildOpts(1, { resolveToken: async () => null }),
    );

    assert(result.fields);
    expect(result.fields).toHaveLength(2);
    const sharesField = result.fields[1];
    assert(!isFieldGroup(sharesField));
    expect(sharesField.label).toBe("Min Received Shares");
    expect(sharesField.value).toBe("2000000000000000000");
    expect(sharesField.fieldType).toBe("uint");
    expect(sharesField.format).toBe("tokenAmount");
    expect(sharesField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(SHARE_TOKENS[1].address)),
    );
    expect(sharesField.warning?.code).toBe("UNKNOWN_TOKEN");
    expect(sharesField.rawAddress).toBeUndefined();
    expect(sharesField.embeddedCalldata).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      "Deposit 1000000000000000000 to get at least 2000000000000000000",
    );
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
