/**
 * Tests for the Kiln USDT Aave v3 vault descriptor:
 * - ERC-4626 deposit, with the format spec inherited through two levels
 *   of includes:
 *     calldata-Vault-USDT-Aave-v3.json
 *       └─ common-KilnVaults.json
 *            └─ ercs/calldata-erc4626-vaults.json
 */

import { join } from "node:path";
import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { ExternalDataProvider } from "../../../src/types.js";
import { hexToBytes, toChecksumAddress } from "../../../src/utils.js";
import { buildEmbeddedResolverOpts } from "../../utils.js";

describe("Kiln Vault USDT Aave v3", () => {
  const CHAIN_ID = 1;
  const VAULT = "0xdD7927c757c1659B56C81c65af848Ae400EB879D";
  const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const FROM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const RECEIVER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (chainId === CHAIN_ID && tokenAddress === USDT.toLowerCase()) {
      return { name: "Tether USD", symbol: "USDT", decimals: 6 };
    }
    return null;
  };

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    if (address === RECEIVER.toLowerCase()) {
      return { name: "vitalik.eth", typeMatch: true };
    }
    return null;
  };

  // The descriptor's include chain crosses out of the kiln directory:
  //   registry-cases/kiln/calldata-Vault-USDT-Aave-v3.json
  //     └─ common-KilnVaults.json
  //          └─ ../../ercs/calldata-erc4626-vaults.json
  // To let the `../../` traverse correctly, the index value must be the
  // descriptor's full path relative to `descriptorDirectory`, not a basename.
  const TEST_ROOT = join(__dirname, "..", "..");

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      TEST_ROOT,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: VAULT,
            file: "registry-cases/kiln/calldata-Vault-USDT-Aave-v3.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats a deposit using the format inherited from the ERC-4626 include", async () => {
    // deposit(uint256 assets, address receiver), selector 0x6e553f65
    // assets = 100_000_000 (100 USDT), receiver = vitalik.eth address
    const DEPOSIT_CALLDATA =
      "0x6e553f65" +
      "0000000000000000000000000000000000000000000000000000000005f5e100" + // assets = 100e6
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045"; // receiver

    const opts = buildOpts({ resolveToken, resolveLocalName });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: VAULT,
        from: FROM,
        data: DEPOSIT_CALLDATA,
      },
      opts,
    );

    expect(result.intent).toBe("Deposit");

    assert(result.fields);
    // Visible fields: Deposit asset (tokenAmount), Share ticker (raw constant),
    //                 Send shares to (addressName)
    expect(result.fields).toHaveLength(3);

    // Field 0: Deposit asset — tokenAmount with token from
    // $.metadata.constants.underlyingToken (USDT)
    const assetField = result.fields[0];
    assert(!isFieldGroup(assetField));
    expect(assetField.label).toBe("Deposit asset");
    expect(assetField.value).toBe("100 USDT");
    expect(assetField.fieldType).toBe("uint");
    expect(assetField.format).toBe("tokenAmount");
    expect(assetField.tokenAddress).toBe(toChecksumAddress(hexToBytes(USDT)));
    expect(assetField.embeddedCalldata).toBeUndefined();
    expect(assetField.rawAddress).toBeUndefined();
    expect(assetField.warning).toBeUndefined();

    // Field 1: Share ticker — raw constant from $.metadata.constants.vaultTicker
    const tickerField = result.fields[1];
    assert(!isFieldGroup(tickerField));
    expect(tickerField.label).toBe("Share ticker");
    expect(tickerField.value).toBe("kAaveUSDT");
    expect(tickerField.fieldType).toBe("string");
    expect(tickerField.format).toBe("raw");
    expect(tickerField.tokenAddress).toBeUndefined();
    expect(tickerField.rawAddress).toBeUndefined();
    expect(tickerField.embeddedCalldata).toBeUndefined();
    expect(tickerField.warning).toBeUndefined();

    // Field 2: Send shares to — addressName for the receiver
    const receiverField = result.fields[2];
    assert(!isFieldGroup(receiverField));
    expect(receiverField.label).toBe("Send shares to");
    expect(receiverField.value).toBe("vitalik.eth");
    expect(receiverField.fieldType).toBe("address");
    expect(receiverField.format).toBe("addressName");
    expect(receiverField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(RECEIVER)),
    );
    expect(receiverField.tokenAddress).toBeUndefined();
    expect(receiverField.embeddedCalldata).toBeUndefined();
    expect(receiverField.warning).toBeUndefined();

    // Metadata — owner and info inherited from common-KilnVaults.json
    assert(result.metadata);
    expect(result.metadata.owner).toBe("Kiln");
    expect(result.metadata.contractName).toBeUndefined();
    expect(result.metadata.info).toEqual({ url: "https://kiln.fi/" });

    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
