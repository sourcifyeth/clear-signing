/**
 * Tests based on the ERC-7730 spec test case: example-array-iteration.json
 * Tests calldata formatting with bundled array iteration (distribute function).
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index";
import type { DisplayModel, ExternalDataProvider } from "../../src/types";
import {
  bytesToHex,
  hexToBytes,
  keccak256Str,
  selectorForSignature,
  toChecksumAddress,
} from "../../src/utils";
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

  const resolveChainInfo: ExternalDataProvider["resolveChainInfo"] = async (
    chainId,
  ) => {
    if (chainId === CHAIN_ID) {
      return {
        name: "Ethereum Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      };
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
      resolveChainInfo,
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
    expect(amountField.calldataDisplay).toBeUndefined();
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
    expect(recipient0.calldataDisplay).toBeUndefined();
    expect(recipient0.warning).toBeUndefined();

    const percentage0 = group.fields[1];
    assert(!isFieldGroup(percentage0));
    expect(percentage0.label).toBe("Percentages");
    expect(percentage0.value).toBe("99.01%");
    expect(percentage0.fieldType).toBe("uint");
    expect(percentage0.format).toBe("unit");
    expect(percentage0.rawAddress).toBeUndefined();
    expect(percentage0.tokenAddress).toBeUndefined();
    expect(percentage0.calldataDisplay).toBeUndefined();
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
    expect(recipient1.calldataDisplay).toBeUndefined();
    expect(recipient1.warning).toBeUndefined();

    const percentage1 = group.fields[3];
    assert(!isFieldGroup(percentage1));
    expect(percentage1.label).toBe("Percentages");
    expect(percentage1.value).toBe("0.99%");
    expect(percentage1.fieldType).toBe("uint");
    expect(percentage1.format).toBe("unit");
    expect(percentage1.rawAddress).toBeUndefined();
    expect(percentage1.tokenAddress).toBeUndefined();
    expect(percentage1.calldataDisplay).toBeUndefined();
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

describe("example-array-iteration.json — batchExecute", () => {
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
    if (lower === RECIPIENT_1.toLowerCase())
      return { name: RECIPIENT_1_NAME, typeMatch: true };
    if (lower === RECIPIENT_2.toLowerCase())
      return { name: RECIPIENT_2_NAME, typeMatch: true };
    return null;
  };

  const resolveChainInfo: ExternalDataProvider["resolveChainInfo"] = async (
    chainId,
  ) => {
    if (chainId === CHAIN_ID) {
      return {
        name: "Ethereum Mainnet",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      };
    }
    return null;
  };

  const BATCH_SELECTOR = bytesToHex(
    selectorForSignature("batchExecute(address[],bytes[],uint256[])"),
  );

  // Inner distribute calldata: distribute([RECIPIENT_1], [10000])
  // 10000 with decimals=2 and base="%" → "100%"
  const INNER_DISTRIBUTE_1 =
    "2929abe6" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "0000000000000000000000000000000000000000000000000000000000000080" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "000000000000000000000000" +
    RECIPIENT_1.slice(2) +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000000000000000002710";

  // Inner distribute calldata: distribute([RECIPIENT_2], [10000])
  const INNER_DISTRIBUTE_2 =
    "2929abe6" +
    "0000000000000000000000000000000000000000000000000000000000000040" +
    "0000000000000000000000000000000000000000000000000000000000000080" +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "000000000000000000000000" +
    RECIPIENT_2.slice(2) +
    "0000000000000000000000000000000000000000000000000000000000000001" +
    "0000000000000000000000000000000000000000000000000000000000002710";

  // 28 bytes of zero-padding to pad 196-byte calldata to 224 bytes (7 words)
  const BYTES_PADDING =
    "00000000000000000000000000000000000000000000000000000000";

  // batchExecute([CONTRACT_ADDRESS], [distribute_1], [0])
  //
  // Head:       3 offsets (96 bytes)
  // targets:    length=1 + 1 addr (64 bytes, at 96)
  // datas:      length=1 + 1 offset + bytes_len + 196 padded to 224 (320 bytes, at 160)
  // values:     length=1 + 1 uint (64 bytes, at 480)
  const BATCH_ONE_CALLDATA =
    BATCH_SELECTOR +
    "0000000000000000000000000000000000000000000000000000000000000060" + // targets at 96
    "00000000000000000000000000000000000000000000000000000000000000a0" + // datas at 160
    "00000000000000000000000000000000000000000000000000000000000001e0" + // values at 480
    "0000000000000000000000000000000000000000000000000000000000000001" + // targets.length = 1
    "000000000000000000000000" +
    CONTRACT_ADDRESS.slice(2) +
    "0000000000000000000000000000000000000000000000000000000000000001" + // datas.length = 1
    "0000000000000000000000000000000000000000000000000000000000000020" + // offset[0] = 32
    "00000000000000000000000000000000000000000000000000000000000000c4" + // bytes[0].length = 196
    INNER_DISTRIBUTE_1 +
    BYTES_PADDING +
    "0000000000000000000000000000000000000000000000000000000000000001" + // values.length = 1
    "0000000000000000000000000000000000000000000000000000000000000000"; // values[0] = 0

  // batchExecute([CONTRACT_ADDRESS, CONTRACT_ADDRESS], [distribute_1, distribute_2], [0, 0])
  //
  // Head:       3 offsets (96 bytes)
  // targets:    length=2 + 2 addrs (96 bytes, at 96)
  // datas:      length=2 + 2 offsets + 2*(len_word + 224 bytes) = 608 bytes, at 192
  // values:     length=2 + 2 uints (96 bytes, at 800)
  const BATCH_TWO_CALLDATA =
    BATCH_SELECTOR +
    "0000000000000000000000000000000000000000000000000000000000000060" + // targets at 96
    "00000000000000000000000000000000000000000000000000000000000000c0" + // datas at 192
    "0000000000000000000000000000000000000000000000000000000000000320" + // values at 800
    "0000000000000000000000000000000000000000000000000000000000000002" + // targets.length = 2
    "000000000000000000000000" +
    CONTRACT_ADDRESS.slice(2) +
    "000000000000000000000000" +
    CONTRACT_ADDRESS.slice(2) +
    "0000000000000000000000000000000000000000000000000000000000000002" + // datas.length = 2
    "0000000000000000000000000000000000000000000000000000000000000040" + // offset[0] = 64
    "0000000000000000000000000000000000000000000000000000000000000140" + // offset[1] = 320
    "00000000000000000000000000000000000000000000000000000000000000c4" + // bytes[0].length = 196
    INNER_DISTRIBUTE_1 +
    BYTES_PADDING +
    "00000000000000000000000000000000000000000000000000000000000000c4" + // bytes[1].length = 196
    INNER_DISTRIBUTE_2 +
    BYTES_PADDING +
    "0000000000000000000000000000000000000000000000000000000000000002" + // values.length = 2
    "0000000000000000000000000000000000000000000000000000000000000000" + // values[0] = 0
    "0000000000000000000000000000000000000000000000000000000000000000"; // values[1] = 0

  // batchExecute([], [], [])
  const BATCH_EMPTY_CALLDATA =
    BATCH_SELECTOR +
    "0000000000000000000000000000000000000000000000000000000000000060" + // targets at 96
    "0000000000000000000000000000000000000000000000000000000000000080" + // datas at 128
    "00000000000000000000000000000000000000000000000000000000000000a0" + // values at 160
    "0000000000000000000000000000000000000000000000000000000000000000" + // targets.length = 0
    "0000000000000000000000000000000000000000000000000000000000000000" + // datas.length = 0
    "0000000000000000000000000000000000000000000000000000000000000000"; // values.length = 0

  // batchExecute([ADDR, ADDR], [distribute_1, distribute_2], [0])
  // targets=2, datas=2, values=1 → PARAM_ARRAY_SIZE_MISMATCH
  const BATCH_MISMATCH_CALLDATA =
    BATCH_SELECTOR +
    "0000000000000000000000000000000000000000000000000000000000000060" + // targets at 96
    "00000000000000000000000000000000000000000000000000000000000000c0" + // datas at 192
    "0000000000000000000000000000000000000000000000000000000000000320" + // values at 800
    "0000000000000000000000000000000000000000000000000000000000000002" + // targets.length = 2
    "000000000000000000000000" +
    CONTRACT_ADDRESS.slice(2) +
    "000000000000000000000000" +
    CONTRACT_ADDRESS.slice(2) +
    "0000000000000000000000000000000000000000000000000000000000000002" + // datas.length = 2
    "0000000000000000000000000000000000000000000000000000000000000040" + // offset[0] = 64
    "0000000000000000000000000000000000000000000000000000000000000140" + // offset[1] = 320
    "00000000000000000000000000000000000000000000000000000000000000c4" + // bytes[0].length = 196
    INNER_DISTRIBUTE_1 +
    BYTES_PADDING +
    "00000000000000000000000000000000000000000000000000000000000000c4" + // bytes[1].length = 196
    INNER_DISTRIBUTE_2 +
    BYTES_PADDING +
    "0000000000000000000000000000000000000000000000000000000000000001" + // values.length = 1
    "0000000000000000000000000000000000000000000000000000000000000000"; // values[0] = 0

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

  /** Assert the shape of a nested distribute DisplayModel for one recipient at 100%. */
  function assertNestedDistribute(
    nested: DisplayModel,
    recipientAddr: string,
    recipientName: string,
  ) {
    expect(nested.intent).toBe("Distribute fees among recipients");

    assert(nested.fields);
    expect(nested.fields).toHaveLength(2);

    // Total Distributed Amount — @.value with amount format (inner tx value = 0)
    const amountField = nested.fields[0];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Total Distributed Amount");
    expect(amountField.value).toBe("0 ETH");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("amount");
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.tokenAddress).toBeUndefined();
    expect(amountField.calldataDisplay).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    // Recipients and Fees group
    const group = nested.fields[1];
    assert(isFieldGroup(group));
    expect(group.label).toBe("Recipients and Fees");
    expect(group.warning).toBeUndefined();
    expect(group.fields).toHaveLength(2);

    const recipient = group.fields[0];
    assert(!isFieldGroup(recipient));
    expect(recipient.label).toBe("Recipients");
    expect(recipient.value).toBe(`Recipient 0 ${recipientName}`);
    expect(recipient.fieldType).toBe("address");
    expect(recipient.format).toBe("addressName");
    expect(recipient.rawAddress).toBe(
      toChecksumAddress(hexToBytes(recipientAddr)),
    );
    expect(recipient.tokenAddress).toBeUndefined();
    expect(recipient.calldataDisplay).toBeUndefined();
    expect(recipient.warning).toBeUndefined();

    const percentage = group.fields[1];
    assert(!isFieldGroup(percentage));
    expect(percentage.label).toBe("Percentages");
    expect(percentage.value).toBe("100%");
    expect(percentage.fieldType).toBe("uint");
    expect(percentage.format).toBe("unit");
    expect(percentage.rawAddress).toBeUndefined();
    expect(percentage.tokenAddress).toBeUndefined();
    expect(percentage.calldataDisplay).toBeUndefined();
    expect(percentage.warning).toBeUndefined();

    assert(nested.metadata);
    expect(nested.metadata.owner).toBe("Example");
    expect(nested.metadata.contractName).toBe(
      "Example Array Iteration Contract",
    );
    expect(nested.metadata.info).toEqual({
      url: "https://example.io/",
      deploymentDate: "2017-11-28T12:41:21Z",
    });

    expect(nested.rawCalldataFallback).toBeUndefined();

    expect(nested.interpolatedIntent).toBe(
      `Distribute fees 100% among recipients Recipient 0 ${recipientName}`,
    );
    expect(nested.warnings).toBeUndefined();
  }

  it("formats batchExecute with one nested distribute call", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      data: BATCH_ONE_CALLDATA,
    };

    const opts = buildOpts({ resolveLocalName, resolveChainInfo });
    const result = await format(tx, opts);

    expect(result.intent).toBe("Execute batch calls to targets");

    assert(result.fields);
    expect(result.fields).toHaveLength(1);

    // Top-level .[] field produces a DisplayFieldGroup
    const group = result.fields[0];
    assert(isFieldGroup(group));
    expect(group.label).toBe("Nested Calls");
    expect(group.warning).toBeUndefined();
    expect(group.fields).toHaveLength(1);

    const calldataField = group.fields[0];
    assert(!isFieldGroup(calldataField));
    expect(calldataField.label).toBe("Nested Calls");
    expect(calldataField.value).toBe(
      `Transaction 0 ${keccak256Str(INNER_DISTRIBUTE_1)}`,
    );
    expect(calldataField.fieldType).toBe("bytes");
    expect(calldataField.format).toBe("calldata");
    expect(calldataField.rawAddress).toBeUndefined();
    expect(calldataField.tokenAddress).toBeUndefined();
    expect(calldataField.warning).toBeUndefined();

    assert(calldataField.calldataDisplay);
    assertNestedDistribute(
      calldataField.calldataDisplay,
      RECIPIENT_1,
      RECIPIENT_1_NAME,
    );

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

    // interpolatedIntent fails because {targets} and {values} are not in fields
    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "INTERPOLATION_ERROR")).toBe(
      true,
    );
  });

  it("formats batchExecute with two nested distribute calls", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      data: BATCH_TWO_CALLDATA,
    };

    const opts = buildOpts({ resolveLocalName, resolveChainInfo });
    const result = await format(tx, opts);

    expect(result.intent).toBe("Execute batch calls to targets");

    assert(result.fields);
    expect(result.fields).toHaveLength(1);

    const group = result.fields[0];
    assert(isFieldGroup(group));
    expect(group.label).toBe("Nested Calls");
    expect(group.warning).toBeUndefined();
    expect(group.fields).toHaveLength(2);

    // First nested call
    const field0 = group.fields[0];
    assert(!isFieldGroup(field0));
    expect(field0.label).toBe("Nested Calls");
    expect(field0.value).toBe(
      `Transaction 0 ${keccak256Str(INNER_DISTRIBUTE_1)}`,
    );
    expect(field0.fieldType).toBe("bytes");
    expect(field0.format).toBe("calldata");
    expect(field0.rawAddress).toBeUndefined();
    expect(field0.tokenAddress).toBeUndefined();
    expect(field0.warning).toBeUndefined();

    assert(field0.calldataDisplay);
    assertNestedDistribute(
      field0.calldataDisplay,
      RECIPIENT_1,
      RECIPIENT_1_NAME,
    );

    // Second nested call
    const field1 = group.fields[1];
    assert(!isFieldGroup(field1));
    expect(field1.label).toBe("Nested Calls");
    expect(field1.value).toBe(
      `Transaction 1 ${keccak256Str(INNER_DISTRIBUTE_2)}`,
    );
    expect(field1.fieldType).toBe("bytes");
    expect(field1.format).toBe("calldata");
    expect(field1.rawAddress).toBeUndefined();
    expect(field1.tokenAddress).toBeUndefined();
    expect(field1.warning).toBeUndefined();

    assert(field1.calldataDisplay);
    assertNestedDistribute(
      field1.calldataDisplay,
      RECIPIENT_2,
      RECIPIENT_2_NAME,
    );

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

    // interpolatedIntent fails because {targets} and {values} are not in fields
    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "INTERPOLATION_ERROR")).toBe(
      true,
    );
  });

  it("returns EMPTY_ARRAY warning for batchExecute with empty arrays", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      data: BATCH_EMPTY_CALLDATA,
    };

    const opts = buildOpts();
    const result = await format(tx, opts);

    expect(result.intent).toBe("Execute batch calls to targets");

    assert(result.fields);
    expect(result.fields).toHaveLength(1);

    const group = result.fields[0];
    assert(isFieldGroup(group));
    expect(group.label).toBe("Nested Calls");
    expect(group.fields).toHaveLength(0);
    assert(group.warning);
    expect(group.warning.code).toBe("EMPTY_ARRAY");

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

    // interpolatedIntent fails because {targets} and {values} are not in fields
    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "INTERPOLATION_ERROR")).toBe(
      true,
    );
  });

  it("returns PARAM_ARRAY_SIZE_MISMATCH for mismatched calleePath/amountPath lengths", async () => {
    const tx = {
      chainId: CHAIN_ID,
      to: CONTRACT_ADDRESS,
      data: BATCH_MISMATCH_CALLDATA,
    };

    const opts = buildOpts();
    const result = await format(tx, opts);

    assert(result.warnings);
    expect(
      result.warnings.some((w) => w.code === "PARAM_ARRAY_SIZE_MISMATCH"),
    ).toBe(true);

    // Compute expected args: split calldata (minus 4-byte selector) into 32-byte hex chunks
    const calldataHex = BATCH_MISMATCH_CALLDATA.replace(/^0x/, "");
    const argsHex = calldataHex.slice(8); // skip 4-byte selector
    const expectedArgs: string[] = [];
    for (let i = 0; i < argsHex.length; i += 64) {
      expectedArgs.push(argsHex.slice(i, i + 64));
    }

    expect(result.rawCalldataFallback).toEqual({
      selector: BATCH_SELECTOR,
      args: expectedArgs,
    });

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});
