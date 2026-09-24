/**
 * Tests based on the ERC-7730 spec test case: example-maps-pools.json
 * Same maps as example-maps.json, but the descriptor is bound to a single
 * chain although the maps carry entries for several chains.
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../src/types.js";
import { hexToBytes, toChecksumAddress } from "../../src/utils.js";
import { buildFilesystemResolverOpts } from "../utils.js";

describe("example-maps-pools.json — deposit(uint256 amount,uint256 minShares)", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x00112233445566778899AABBCCDDEEFF00112233";
  // metadata.maps.shareToken entry for chain 1
  const SHARE_TOKEN = "0x00000000000000000000000000000000abcdef01";

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
    if (chainId === CHAIN_ID && tokenAddress === SHARE_TOKEN) {
      return { name: "Pool Share", symbol: "PSHR", decimals: 18 };
    }
    return null;
  };

  function buildOpts(chainId: number) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          { chainId, address: CONTRACT, file: "example-maps-pools.json" },
        ],
      },
      { resolveToken },
    );
  }

  it("resolves the share token from the map on the bound chain", async () => {
    const result: DisplayModel = await format(
      { chainId: CHAIN_ID, to: CONTRACT, data: DEPOSIT_CALLDATA },
      buildOpts(CHAIN_ID),
    );

    expect(result.intent).toBe("Deposit");

    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    // Field 0: Deposit Amount. The spec file's underlyingToken values are
    // 21 bytes long, so the mapped value is not an address and the token
    // param cannot be resolved. Spec files are never edited.
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

    // Field 1: Min Received Shares
    const sharesField = result.fields[1];
    assert(!isFieldGroup(sharesField));
    expect(sharesField.label).toBe("Min Received Shares");
    expect(sharesField.value).toBe("2 PSHR");
    expect(sharesField.fieldType).toBe("uint");
    expect(sharesField.format).toBe("tokenAmount");
    expect(sharesField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(SHARE_TOKEN)),
    );
    expect(sharesField.warning).toBeUndefined();
    expect(sharesField.rawAddress).toBeUndefined();
    expect(sharesField.embeddedCalldata).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      "Deposit 1000000000000000000 to get at least 2 PSHR",
    );

    assert(result.metadata);
    expect(result.metadata.owner).toBe("Example");
    expect(result.metadata.contractName).toBeUndefined();
    expect(result.metadata.info).toEqual({ url: "https://example.io/" });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("does not extend the binding to chains that only appear in the maps", async () => {
    // The maps have an entry for chain 137, but the descriptor is bound to
    // chain 1 only. Binding is checked before any map is consulted.
    const result: DisplayModel = await format(
      { chainId: 137, to: CONTRACT, data: DEPOSIT_CALLDATA },
      buildOpts(137),
    );

    expect(result.intent).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.rawCalldataFallback).toEqual({
      selector: "0xe2bbb158",
      args: [
        "0000000000000000000000000000000000000000000000000de0b6b3a7640000",
        "0000000000000000000000000000000000000000000000001bc16d674ec80000",
      ],
    });
    expect(result.warnings).toEqual([
      {
        code: "DEPLOYMENT_MISMATCH",
        message: `Descriptor is not bound to chain 137 and address ${CONTRACT}`,
      },
    ]);
  });
});
