/**
 * Tests based on the ERC-7730 spec test case: example-array-iteration.json
 * Tests calldata formatting with bundled array iteration (distribute function).
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index";
import type { ExternalDataProvider } from "../../src/types";
import { toChecksumAddress, hexToBytes } from "../../src/utils";
import { buildEmbeddedResolverOpts } from "../utils";

describe("example-array-iteration.json — distribute", () => {
  const CHAIN_ID = 1;
  const CONTRACT_ADDRESS = "0x123456789abcdef0112233445566778899aabbcc";

  const RECIPIENT_1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const RECIPIENT_2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const RECIPIENT_1_NAME = "Alice Vault";
  const RECIPIENT_2_NAME = "Bob Vault";

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    const lower = address.toLowerCase();
    if (lower === RECIPIENT_1.toLowerCase()) {
      return { name: RECIPIENT_1_NAME, typeMatch: true };
    }
    if (lower === RECIPIENT_2.toLowerCase()) {
      return { name: RECIPIENT_2_NAME, typeMatch: true };
    }
    return null;
  };

  // ABI-encoded: distribute([RECIPIENT_1, RECIPIENT_2], [9901, 99])
  // selector: 0x2929abe6
  // head: offset1=64, offset2=160
  // tail: len=2, addr1, addr2, len=2, 9901 (0x26AD), 99 (0x63)
  // With decimals=2: 99.01% + 0.99% = 100%
  const DISTRIBUTE_CALLDATA =
    "0x2929abe6" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "00000000000000000000000000000000000000000000000000000000000000a0" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
    "000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "00000000000000000000000000000000000000000000000000000000000026ad" +
    "0000000000000000000000000000000000000000000000000000000000000063";

  // ABI-encoded: distribute([RECIPIENT_1, RECIPIENT_2], [5000]) — mismatched lengths (2 vs 1)
  // Head: offset to recipients=64 (0x40), offset to percentages=160 (0xa0)
  // recipients tail (at 64): length=2, addr1, addr2
  // percentages tail (at 160): length=1, 5000
  const DISTRIBUTE_MISMATCHED_CALLDATA =
    "0x2929abe6" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "00000000000000000000000000000000000000000000000000000000000000a0" +
    "0000000000000000000000000000000000000000000000000000000000000002" +
    "000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" +
    "000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000000000000000001388";

  // ABI-encoded: distribute([], [])
  const DISTRIBUTE_EMPTY_CALLDATA =
    "0x2929abe6" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "0000000000000000000000000000000000000000000000000000000000000060" +
    "0000000000000000000000000000000000000000000000000000000000000000" +
    "0000000000000000000000000000000000000000000000000000000000000000";

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT_ADDRESS,
            file: "example-array-iteration.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats distribute with bundled array iteration", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      from: "0xcccccccccccccccccccccccccccccccccccccccc",
      data: DISTRIBUTE_CALLDATA,
      value: 1000000000000000000n, // 1 ETH
    };

    const opts = buildOpts({
      resolveLocalName,
      resolveChainInfo: async () => ({
        name: "Ethereum Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      }),
    });
    const result = await format(tx, opts);

    expect(result.intent).toBe("Distribute fees among recipients");

    assert(result.fields);
    // Total Distributed Amount (flat) + 1 DisplayFieldGroup with all indexed fields
    expect(result.fields).toHaveLength(2);

    // Total Distributed Amount — @.value with amount format
    const amountField = result.fields[0];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Total Distributed Amount");
    expect(amountField.value).toBe("1 ETH");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("amount");
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.tokenAddress).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    // Single "Recipients and Fees" group containing all 4 indexed fields (index 0 then index 1)
    const group = result.fields[1];
    assert(isFieldGroup(group));
    expect(group.label).toBe("Recipients and Fees");
    expect(group.warning).toBeUndefined();
    expect(group.fields).toHaveLength(4);

    const checksumRecipient1 = toChecksumAddress(hexToBytes(RECIPIENT_1));
    const checksumRecipient2 = toChecksumAddress(hexToBytes(RECIPIENT_2));

    // Index 0: recipient[0] + percentage[0]
    const recipient0 = group.fields[0];
    assert(!isFieldGroup(recipient0));
    expect(recipient0.label).toBe("Recipients");
    expect(recipient0.value).toBe(`Recipient 0 ${RECIPIENT_1_NAME}`);
    expect(recipient0.fieldType).toBe("address");
    expect(recipient0.format).toBe("addressName");
    expect(recipient0.rawAddress).toBe(checksumRecipient1);
    expect(recipient0.tokenAddress).toBeUndefined();
    expect(recipient0.warning).toBeUndefined();

    const percentage0 = group.fields[1];
    assert(!isFieldGroup(percentage0));
    expect(percentage0.label).toBe("Percentages");
    expect(percentage0.value).toBe("99.01%");
    expect(percentage0.fieldType).toBe("uint");
    expect(percentage0.format).toBe("unit");
    expect(percentage0.rawAddress).toBeUndefined();
    expect(percentage0.tokenAddress).toBeUndefined();
    expect(percentage0.warning).toBeUndefined();

    // Index 1: recipient[1] + percentage[1]
    const recipient1 = group.fields[2];
    assert(!isFieldGroup(recipient1));
    expect(recipient1.label).toBe("Recipients");
    expect(recipient1.value).toBe(`Recipient 1 ${RECIPIENT_2_NAME}`);
    expect(recipient1.fieldType).toBe("address");
    expect(recipient1.format).toBe("addressName");
    expect(recipient1.rawAddress).toBe(checksumRecipient2);
    expect(recipient1.tokenAddress).toBeUndefined();
    expect(recipient1.warning).toBeUndefined();

    const percentage1 = group.fields[3];
    assert(!isFieldGroup(percentage1));
    expect(percentage1.label).toBe("Percentages");
    expect(percentage1.value).toBe("0.99%");
    expect(percentage1.fieldType).toBe("uint");
    expect(percentage1.format).toBe("unit");
    expect(percentage1.rawAddress).toBeUndefined();
    expect(percentage1.tokenAddress).toBeUndefined();
    expect(percentage1.warning).toBeUndefined();

    assert(result.metadata);
    expect(result.metadata.owner).toBe("Example");
    expect(result.metadata.contractName).toBe(
      "Example Array Iteration Contract",
    );
    expect(result.metadata.info).toEqual({
      url: "https://example.io/",
      deploymentDate: "2017-11-28T12:41:21Z",
    });

    expect(result.rawCalldataFallback).toBeUndefined();

    // interpolatedIntent expands array paths with " and " joining
    expect(result.interpolatedIntent).toBe(
      `Distribute fees 99.01% and 0.99% among recipients Recipient 0 ${RECIPIENT_1_NAME} and Recipient 1 ${RECIPIENT_2_NAME}`,
    );
    expect(result.warnings).toBeUndefined();
  });

  it("returns EMPTY_ARRAY warning for distribute with empty arrays", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      from: "0xcccccccccccccccccccccccccccccccccccccccc",
      data: DISTRIBUTE_EMPTY_CALLDATA,
      value: 0n,
    };

    const opts = buildOpts();
    const result = await format(tx, opts);

    expect(result.intent).toBe("Distribute fees among recipients");

    assert(result.fields);
    // Total Distributed Amount (flat) + 1 empty DisplayFieldGroup
    expect(result.fields).toHaveLength(2);

    const amountField = result.fields[0];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Total Distributed Amount");

    const emptyGroup = result.fields[1];
    assert(isFieldGroup(emptyGroup));
    expect(emptyGroup.label).toBe("Recipients and Fees");
    expect(emptyGroup.fields).toHaveLength(0);
    assert(emptyGroup.warning);
    expect(emptyGroup.warning.code).toBe("EMPTY_ARRAY");

    assert(result.metadata);
    expect(result.rawCalldataFallback).toBeUndefined();

    // interpolatedIntent references array paths which can't be interpolated
    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "INTERPOLATION_ERROR")).toBe(
      true,
    );
  });

  it("returns BUNDLED_ARRAY_SIZE_MISMATCH for distribute with mismatched array lengths", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      from: "0xcccccccccccccccccccccccccccccccccccccccc",
      data: DISTRIBUTE_MISMATCHED_CALLDATA,
      value: 0n,
    };

    const opts = buildOpts();
    const result = await format(tx, opts);

    assert(result.warnings);
    expect(
      result.warnings.some((w) => w.code === "BUNDLED_ARRAY_SIZE_MISMATCH"),
    ).toBe(true);

    assert(result.rawCalldataFallback);
    expect(result.rawCalldataFallback.selector).toBe("0x2929abe6");
    expect(result.rawCalldataFallback.args).toEqual([
      "0000000000000000000000000000000000000000000000000000000000000040",
      "00000000000000000000000000000000000000000000000000000000000000a0",
      "0000000000000000000000000000000000000000000000000000000000000002",
      "000000000000000000000000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "000000000000000000000000bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "0000000000000000000000000000000000000000000000000000000000000001",
      "0000000000000000000000000000000000000000000000000000000000001388",
    ]);

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});
