/**
 * Tests based on the ERC-7730 spec test case descriptors.
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { format, formatEip5792Batch, isFieldGroup } from "../../src/index";
import type {
  DisplayModel,
  ExternalDataProvider,
  FormatOptions,
} from "../../src/types";
import {
  addThousandSeparators,
  hexToBytes,
  toChecksumAddress,
} from "../../src/utils";
import { buildEmbeddedResolverOpts } from "../utils";

// USDT on mainnet (matches example-main.json deployment)
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CHAIN_ID = 1;

const RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";
const RECIPIENT_LOCAL_NAME = "Alice";
const RECIPIENT_ENS_NAME = "alice.eth";
const TRANSFER_AMOUNT = 1_000_000n; // 1 USDT
const TRANSFER_CALLDATA =
  // transfer(address,uint256) selector = 0xa9059cbb
  "0xa9059cbb" +
  `000000000000000000000000${RECIPIENT.slice(2)}` + // to
  "00000000000000000000000000000000000000000000000000000000000f4240"; // value = 1000000

const resolveToken: ExternalDataProvider["resolveToken"] = async (
  chainId,
  tokenAddress,
) => {
  if (chainId === CHAIN_ID && tokenAddress === USDT_ADDRESS.toLowerCase()) {
    return { name: "Tether USD", symbol: "USDT", decimals: 6 };
  }
  return null;
};
const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
  address,
) => {
  if (address.toLowerCase() === RECIPIENT.toLowerCase()) {
    return { name: RECIPIENT_LOCAL_NAME, typeMatch: true };
  }
  return null;
};
const resolveEnsName: ExternalDataProvider["resolveEnsName"] = async (
  address,
) => {
  if (address.toLowerCase() === RECIPIENT.toLowerCase()) {
    return { name: RECIPIENT_ENS_NAME, typeMatch: true };
  }
  return null;
};

function buildOpts(externalDataProvider?: ExternalDataProvider): FormatOptions {
  return buildEmbeddedResolverOpts(
    __dirname,
    {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: USDT_ADDRESS,
          file: "example-main.json",
        },
      ],
    },
    externalDataProvider,
  );
}

describe("example-main.json — transfer(address to, uint256 value)", () => {
  it("formats a transfer call with all DisplayModel properties", async () => {
    const opts = buildOpts({ resolveToken, resolveLocalName });

    const result: DisplayModel = await format(
      {
        chainId: CHAIN_ID,
        to: USDT_ADDRESS,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    expect(result.intent).toBe("Send");

    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.label).toBe("To");
    expect(toField.value).toBe(RECIPIENT_LOCAL_NAME);
    expect(toField.fieldType).toBe("address");
    expect(toField.format).toBe("addressName");
    expect(toField.rawAddress).toBe(toChecksumAddress(hexToBytes(RECIPIENT)));
    expect(toField.tokenAddress).toBeUndefined();
    expect(toField.calldataDisplay).toBeUndefined();
    expect(toField.warning).toBeUndefined();

    const amountField = result.fields[1];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Amount");
    expect(amountField.value).toBe("1 USDT");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(USDT_ADDRESS)),
    );
    expect(amountField.calldataDisplay).toBeUndefined();
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );

    assert(result.metadata);
    expect(result.metadata.owner).toBe("Example");
    expect(result.metadata.contractName).toBe("MyToken");
    expect(result.metadata.info).toEqual({
      url: "https://example.io/",
      deploymentDate: "2017-11-28T12:41:21Z",
    });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("returns NO_DESCRIPTOR when index has no entry for the address", async () => {
    const unknownAddress = "0x0000000000000000000000000000000000000001";
    const opts = buildOpts();

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: unknownAddress,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    assert(result.rawCalldataFallback);
    expect(result.rawCalldataFallback.selector).toBe("0xa9059cbb");
    expect(result.rawCalldataFallback.args).toEqual([
      `000000000000000000000000${RECIPIENT.slice(2)}`,
      "00000000000000000000000000000000000000000000000000000000000f4240",
    ]);
    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "NO_DESCRIPTOR")).toBe(true);

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it("returns DEPLOYMENT_MISMATCH when descriptor does not bind to chain+address", async () => {
    // Index resolves the descriptor for chain 999 + USDT address,
    // but the descriptor itself only binds to chains 1, 137, 42161
    const opts = buildEmbeddedResolverOpts(__dirname, {
      calldataDescriptorFiles: [
        {
          chainId: 999,
          address: USDT_ADDRESS,
          file: "example-main.json",
        },
      ],
    });

    const result = await format(
      {
        chainId: 999,
        to: USDT_ADDRESS,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    assert(result.rawCalldataFallback);
    expect(result.rawCalldataFallback.selector).toBe("0xa9059cbb");
    expect(result.rawCalldataFallback.args).toEqual([
      `000000000000000000000000${RECIPIENT.slice(2)}`,
      "00000000000000000000000000000000000000000000000000000000000f4240",
    ]);
    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "DEPLOYMENT_MISMATCH")).toBe(
      true,
    );

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it("returns UNKNOWN_TOKEN warning without externalDataProvider", async () => {
    const opts = buildOpts({ resolveLocalName });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: USDT_ADDRESS,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    assert(result.fields);
    const amountField = result.fields[1];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Amount");
    expect(amountField.value).toBe(
      addThousandSeparators(TRANSFER_AMOUNT.toString()),
    );
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(USDT_ADDRESS)),
    );
    expect(amountField.calldataDisplay).toBeUndefined();
    expect(amountField.rawAddress).toBeUndefined();
    assert(amountField.warning);
    expect(amountField.warning.code).toBe("UNKNOWN_TOKEN");

    expect(result.intent).toBe("Send");
    expect(result.interpolatedIntent).toBe(
      `Send ${addThousandSeparators(TRANSFER_AMOUNT.toString())} to ${RECIPIENT_LOCAL_NAME}`,
    );

    assert(result.metadata);
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("resolves address via ENS when resolveEnsName is provided", async () => {
    const opts = buildOpts({ resolveToken, resolveEnsName });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: USDT_ADDRESS,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    assert(result.fields);
    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.label).toBe("To");
    expect(toField.value).toBe(RECIPIENT_ENS_NAME);
    expect(toField.fieldType).toBe("address");
    expect(toField.format).toBe("addressName");
    expect(toField.rawAddress).toBe(toChecksumAddress(hexToBytes(RECIPIENT)));
    expect(toField.tokenAddress).toBeUndefined();
    expect(toField.calldataDisplay).toBeUndefined();
    expect(toField.warning).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_ENS_NAME}`,
    );
  });

  it("prefers local name over ENS when both resolve", async () => {
    const opts = buildOpts({ resolveToken, resolveLocalName, resolveEnsName });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: USDT_ADDRESS,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    assert(result.fields);
    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.value).toBe(RECIPIENT_LOCAL_NAME);
    expect(toField.warning).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );
  });

  it("returns UNKNOWN_ADDRESS warning when address cannot be resolved", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName: async () => null,
      resolveEnsName: async () => null,
    });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: USDT_ADDRESS,
        data: TRANSFER_CALLDATA,
      },
      opts,
    );

    assert(result.fields);
    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.label).toBe("To");
    expect(toField.value).toBe(toChecksumAddress(hexToBytes(RECIPIENT)));
    expect(toField.fieldType).toBe("address");
    expect(toField.format).toBe("addressName");
    expect(toField.rawAddress).toBe(toChecksumAddress(hexToBytes(RECIPIENT)));
    expect(toField.tokenAddress).toBeUndefined();
    expect(toField.calldataDisplay).toBeUndefined();
    assert(toField.warning);
    expect(toField.warning.code).toBe("UNKNOWN_ADDRESS");

    expect(result.interpolatedIntent).toBe(
      `Send 1 USDT to ${toChecksumAddress(hexToBytes(RECIPIENT))}`,
    );
  });
});

describe("example-main.json — EIP-5792 batch formatting", () => {
  const SECOND_RECIPIENT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  const SECOND_RECIPIENT_LOCAL_NAME = "Bob";
  const SECOND_TRANSFER_CALLDATA =
    "0xa9059cbb" +
    `000000000000000000000000${SECOND_RECIPIENT.slice(2)}` +
    "00000000000000000000000000000000000000000000000000000000001e8480"; // 2 USDT = 2_000_000

  const resolveTokenAndNamesProvider: ExternalDataProvider = {
    resolveToken,
    resolveLocalName: async (address) => {
      const lower = address.toLowerCase();
      if (lower === RECIPIENT.toLowerCase())
        return { name: RECIPIENT_LOCAL_NAME, typeMatch: true };
      if (lower === SECOND_RECIPIENT.toLowerCase())
        return { name: SECOND_RECIPIENT_LOCAL_NAME, typeMatch: true };
      return null;
    },
  };

  it("formats a batch of two transfer calls with combined interpolatedIntent", async () => {
    const opts = buildOpts(resolveTokenAndNamesProvider);

    const result = await formatEip5792Batch(
      {
        chainId: CHAIN_ID,
        from: "0x0000000000000000000000000000000000000001",
        calls: [
          { to: USDT_ADDRESS, data: TRANSFER_CALLDATA },
          { to: USDT_ADDRESS, data: SECOND_TRANSFER_CALLDATA },
        ],
      },
      opts,
    );

    expect(result.callDisplays).toHaveLength(2);

    // First call
    const first = result.callDisplays[0];
    expect(first.intent).toBe("Send");
    expect(first.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );
    assert(first.fields);
    expect(first.fields).toHaveLength(2);

    // Second call
    const second = result.callDisplays[1];
    expect(second.intent).toBe("Send");
    expect(second.interpolatedIntent).toBe(
      `Send 2 USDT to ${SECOND_RECIPIENT_LOCAL_NAME}`,
    );
    assert(second.fields);
    expect(second.fields).toHaveLength(2);

    // Combined batch intent
    expect(result.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME} and Send 2 USDT to ${SECOND_RECIPIENT_LOCAL_NAME}`,
    );
    expect(result.warnings).toBeUndefined();
  });

  it("returns BATCH_VALUE_TRANSFER when a call has no data", async () => {
    const opts = buildOpts(resolveTokenAndNamesProvider);

    const result = await formatEip5792Batch(
      {
        chainId: CHAIN_ID,
        calls: [
          { to: USDT_ADDRESS, data: TRANSFER_CALLDATA },
          { to: "0x0000000000000000000000000000000000000001", value: 1n },
        ],
      },
      opts,
    );

    expect(result.callDisplays).toHaveLength(2);

    // First call formatted normally
    expect(result.callDisplays[0].intent).toBe("Send");
    expect(result.callDisplays[0].interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );

    // Second call: value transfer warning
    const valueTransfer = result.callDisplays[1];
    expect(valueTransfer.intent).toBeUndefined();
    expect(valueTransfer.fields).toBeUndefined();
    expect(valueTransfer.interpolatedIntent).toBeUndefined();
    assert(valueTransfer.warnings);
    expect(valueTransfer.warnings).toHaveLength(1);
    expect(valueTransfer.warnings[0].code).toBe("BATCH_VALUE_TRANSFER");

    // Batch-level: no combined intent, with BATCH_INTERPOLATION_INCOMPLETE
    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("BATCH_INTERPOLATION_INCOMPLETE");
  });

  it("returns BATCH_CONTRACT_CREATION when a call has no to", async () => {
    const opts = buildOpts(resolveTokenAndNamesProvider);

    const result = await formatEip5792Batch(
      {
        chainId: CHAIN_ID,
        calls: [
          { data: "0x60806040" }, // contract creation bytecode (no `to`)
        ],
      },
      opts,
    );

    expect(result.callDisplays).toHaveLength(1);
    const creation = result.callDisplays[0];
    expect(creation.intent).toBeUndefined();
    expect(creation.fields).toBeUndefined();
    expect(creation.interpolatedIntent).toBeUndefined();
    assert(creation.warnings);
    expect(creation.warnings).toHaveLength(1);
    expect(creation.warnings[0].code).toBe("BATCH_CONTRACT_CREATION");

    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings[0].code).toBe("BATCH_INTERPOLATION_INCOMPLETE");
  });

  it("returns BATCH_INTERPOLATION_INCOMPLETE when any call lacks interpolatedIntent", async () => {
    // Use an unknown address so the call gets NO_DESCRIPTOR (no interpolatedIntent)
    const unknownAddress = "0x0000000000000000000000000000000000000099";
    const opts = buildOpts(resolveTokenAndNamesProvider);

    const result = await formatEip5792Batch(
      {
        chainId: CHAIN_ID,
        calls: [
          { to: USDT_ADDRESS, data: TRANSFER_CALLDATA },
          { to: unknownAddress, data: TRANSFER_CALLDATA },
        ],
      },
      opts,
    );

    expect(result.callDisplays).toHaveLength(2);

    // First call formatted normally
    expect(result.callDisplays[0].interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );

    // Second call: no descriptor → no interpolatedIntent
    expect(result.callDisplays[1].interpolatedIntent).toBeUndefined();
    assert(result.callDisplays[1].warnings);
    expect(
      result.callDisplays[1].warnings.some((w) => w.code === "NO_DESCRIPTOR"),
    ).toBe(true);

    // Batch-level: incomplete interpolation
    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("BATCH_INTERPOLATION_INCOMPLETE");
  });

  it("returns empty callDisplays for an empty batch", async () => {
    const opts = buildOpts();

    const result = await formatEip5792Batch(
      { chainId: CHAIN_ID, calls: [] },
      opts,
    );

    expect(result.callDisplays).toHaveLength(0);
    expect(result.interpolatedIntent).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("BATCH_EMPTY");
  });
});
