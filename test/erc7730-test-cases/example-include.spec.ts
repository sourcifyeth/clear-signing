/**
 * Tests based on the ERC-7730 spec test case: example-include.json
 * Tests the descriptor includes/merge mechanism.
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index";
import type { ExternalDataProvider } from "../../src/types";
import { toChecksumAddress, hexToBytes } from "../../src/utils";
import { buildEmbeddedResolverOpts } from "../utils";

describe("example-include.json — approve(address spender, uint256 value)", () => {
  const CONTRACT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
  const CHAIN_ID = 1;

  const SPENDER = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const SPENDER_LOCAL_NAME = "Uniswap V3";

  // approve(address,uint256) selector = 0x095ea7b3
  const APPROVE_NORMAL_AMOUNT =
    "0x095ea7b3" +
    `000000000000000000000000${SPENDER.slice(2)}` + // spender
    "0000000000000000000000000000000000000000000000000000000000989680"; // value = 10_000_000 (10 EXA)

  // threshold = 0xFFFFFFFFFFFFFFFFFF = 4_722_366_482_869_645_213_695
  const APPROVE_UNLIMITED =
    "0x095ea7b3" +
    `000000000000000000000000${SPENDER.slice(2)}` +
    "0000000000000000000000000000000000000000000000ffffffffffffffffff"; // exactly the threshold

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (
      chainId === CHAIN_ID &&
      tokenAddress === CONTRACT_ADDRESS.toLowerCase()
    ) {
      return { name: "Example Stablecoin", symbol: "EXA", decimals: 6 };
    }
    return null;
  };

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    if (address.toLowerCase() === SPENDER.toLowerCase()) {
      return { name: SPENDER_LOCAL_NAME, typeMatch: true };
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
            address: CONTRACT_ADDRESS,
            file: "example-include.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("merges included descriptor and formats approve with inherited fields", async () => {
    const opts = buildOpts({ resolveToken, resolveLocalName });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT_ADDRESS,
        data: APPROVE_NORMAL_AMOUNT,
      },
      opts,
    );

    // Intent comes from the included erc20 descriptor
    expect(result.intent).toBe("Approve");

    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    // Spender field inherited from erc20 descriptor
    const spenderField = result.fields[0];
    assert(!isFieldGroup(spenderField));
    expect(spenderField.label).toBe("Spender");
    expect(spenderField.value).toBe(SPENDER_LOCAL_NAME);
    expect(spenderField.fieldType).toBe("address");
    expect(spenderField.format).toBe("addressName");
    expect(spenderField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(SPENDER)),
    );
    expect(spenderField.tokenAddress).toBeUndefined();
    expect(spenderField.warning).toBeUndefined();

    // Amount field — merged: inherited tokenPath from erc20 + threshold from include
    const amountField = result.fields[1];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Amount");
    expect(amountField.value).toBe("10 EXA");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(CONTRACT_ADDRESS)),
    );
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    // Metadata comes from the including descriptor
    assert(result.metadata);
    expect(result.metadata.owner).toBe("Example");
    expect(result.metadata.contractName).toBe("MyToken");
    expect(result.metadata.info).toEqual({
      url: "https://example.io/",
      deploymentDate: "2017-11-28T12:41:21Z",
    });

    // Interpolated intent from included descriptor
    expect(result.interpolatedIntent).toBe(
      `Approve ${SPENDER_LOCAL_NAME} to spend 10 EXA`,
    );

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("shows 'Unlimited' message when amount meets threshold", async () => {
    const opts = buildOpts({ resolveToken, resolveLocalName });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT_ADDRESS,
        data: APPROVE_UNLIMITED,
      },
      opts,
    );

    assert(result.fields);
    const amountField = result.fields[1];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Amount");
    expect(amountField.value).toBe("Unlimited EXA");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(CONTRACT_ADDRESS)),
    );
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      `Approve ${SPENDER_LOCAL_NAME} to spend Unlimited EXA`,
    );
  });
});
