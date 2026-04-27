/**
 * Tests based on the ERC-7730 spec test case: example-account-execute.json
 * Tests the smart account `execute(address,uint256,bytes)` function with
 * an embedded inner calldata (ERC-4337 / EIP-7579 style).
 * @see https://eips.ethereum.org/EIPS/eip-7730#user-operations-eip-4337
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index";
import type {
  DisplayModel,
  ExternalDataProvider,
  FormatOptions,
} from "../../src/types";
import {
  bytesToHex,
  hexToBytes,
  keccak256Str,
  selectorForSignature,
  toChecksumAddress,
} from "../../src/utils";
import { buildEmbeddedResolverOpts } from "../utils";

// Smart account implementation address — a valid 20-byte hex (the original spec
// file used "0xYourImplementationAddress" as a placeholder; swapped here so that
// address-based container paths and descriptor binding work end-to-end).
const SMART_ACCOUNT = "0x0000000000000000000000000000000000004337";
const CHAIN_ID = 1;

// USDT mainnet — has a registered descriptor in example-main.json.
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";
const RECIPIENT_LOCAL_NAME = "Alice";
const TRANSFER_AMOUNT = 1_000_000n; // 1 USDT (6 decimals)

// An arbitrary counterparty without a registered descriptor.
const UNKNOWN_CONTRACT = "0xcafecafecafecafecafecafecafecafecafecafe";

const EXECUTE_SELECTOR_HEX = bytesToHex(
  selectorForSignature("execute(address,uint256,bytes)"),
);
const TRANSFER_SELECTOR_HEX = bytesToHex(
  selectorForSignature("transfer(address,uint256)"),
);

const pad32 = (hex: string): string => hex.padStart(64, "0");
const padAddr = (addr: string): string => pad32(addr.toLowerCase().slice(2));
const padUint = (n: bigint): string => pad32(n.toString(16));
const padRight32 = (hex: string): string =>
  hex.length % 64 === 0 ? hex : hex + "0".repeat(64 - (hex.length % 64));

function buildTransferCalldata(to: string, amount: bigint): string {
  return TRANSFER_SELECTOR_HEX + padAddr(to) + padUint(amount);
}

function buildExecuteCalldata(
  to: string,
  value: bigint,
  innerData: string,
): string {
  const innerHex = innerData.startsWith("0x") ? innerData.slice(2) : innerData;
  const innerBytes = hexToBytes("0x" + innerHex);
  const lengthHex = padUint(BigInt(innerBytes.length));
  const contentHex = padRight32(innerHex);
  // offset to `data` = 3 words after selector (to, value, offset) = 0x60
  return (
    EXECUTE_SELECTOR_HEX +
    padAddr(to) +
    padUint(value) +
    padUint(0x60n) +
    lengthHex +
    contentHex
  );
}

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
  const lower = address.toLowerCase();
  if (lower === RECIPIENT.toLowerCase()) {
    return { name: RECIPIENT_LOCAL_NAME, typeMatch: true };
  }
  if (lower === USDT_ADDRESS.toLowerCase()) {
    return { name: "Tether USD Contract", typeMatch: true };
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

function buildOpts(externalDataProvider?: ExternalDataProvider): FormatOptions {
  return buildEmbeddedResolverOpts(
    __dirname,
    {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: SMART_ACCOUNT,
          file: "example-account-execute.json",
        },
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

describe("example-account-execute.json — execute(address to, uint256 value, bytes data)", () => {
  it("formats an execute() call with embedded transfer() calldata on a registered token", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const innerTransfer = buildTransferCalldata(RECIPIENT, TRANSFER_AMOUNT);
    const outerData = buildExecuteCalldata(USDT_ADDRESS, 0n, innerTransfer);

    const result: DisplayModel = await format(
      {
        chainId: CHAIN_ID,
        to: SMART_ACCOUNT,
        data: outerData,
      },
      opts,
    );

    expect(result.intent).toBe("Execute Transaction");

    assert(result.fields);
    expect(result.fields).toHaveLength(3);

    // Field 0 — `to` addressName (the callee of the inner call)
    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.label).toBe("To");
    expect(toField.value).toBe("Tether USD Contract");
    expect(toField.fieldType).toBe("address");
    expect(toField.format).toBe("addressName");
    expect(toField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(USDT_ADDRESS)),
    );
    expect(toField.tokenAddress).toBeUndefined();
    expect(toField.calldataDisplay).toBeUndefined();
    expect(toField.warning).toBeUndefined();

    // Field 1 — `value` amount (native currency, 0 wei → 0 ETH)
    const valueField = result.fields[1];
    assert(!isFieldGroup(valueField));
    expect(valueField.label).toBe("Value");
    expect(valueField.value).toBe("0 ETH");
    expect(valueField.fieldType).toBe("uint");
    expect(valueField.format).toBe("amount");
    expect(valueField.rawAddress).toBeUndefined();
    expect(valueField.tokenAddress).toBeUndefined();
    expect(valueField.calldataDisplay).toBeUndefined();
    expect(valueField.warning).toBeUndefined();

    // Field 2 — `data` calldata: nested display model for inner transfer()
    const dataField = result.fields[2];
    assert(!isFieldGroup(dataField));
    expect(dataField.label).toBe("Call Data");
    expect(dataField.value).toBe(keccak256Str(innerTransfer));
    expect(dataField.fieldType).toBe("bytes");
    expect(dataField.format).toBe("calldata");
    expect(dataField.rawAddress).toBeUndefined();
    expect(dataField.tokenAddress).toBeUndefined();
    expect(dataField.warning).toBeUndefined();

    // Nested DisplayModel produced by recursively formatting the inner calldata.
    assert(dataField.calldataDisplay);
    const nested = dataField.calldataDisplay;
    expect(nested.intent).toBe("Send");

    assert(nested.fields);
    expect(nested.fields).toHaveLength(2);

    const nestedTo = nested.fields[0];
    assert(!isFieldGroup(nestedTo));
    expect(nestedTo.label).toBe("To");
    expect(nestedTo.value).toBe(RECIPIENT_LOCAL_NAME);
    expect(nestedTo.fieldType).toBe("address");
    expect(nestedTo.format).toBe("addressName");
    expect(nestedTo.rawAddress).toBe(toChecksumAddress(hexToBytes(RECIPIENT)));
    expect(nestedTo.tokenAddress).toBeUndefined();
    expect(nestedTo.calldataDisplay).toBeUndefined();
    expect(nestedTo.warning).toBeUndefined();

    const nestedAmount = nested.fields[1];
    assert(!isFieldGroup(nestedAmount));
    expect(nestedAmount.label).toBe("Amount");
    expect(nestedAmount.value).toBe("1 USDT");
    expect(nestedAmount.fieldType).toBe("uint");
    expect(nestedAmount.format).toBe("tokenAmount");
    expect(nestedAmount.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(USDT_ADDRESS)),
    );
    expect(nestedAmount.rawAddress).toBeUndefined();
    expect(nestedAmount.calldataDisplay).toBeUndefined();
    expect(nestedAmount.warning).toBeUndefined();

    expect(nested.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );

    assert(nested.metadata);
    expect(nested.metadata.owner).toBe("Example");
    expect(nested.metadata.contractName).toBe("MyToken");
    expect(nested.metadata.info).toEqual({
      url: "https://example.io/",
      deploymentDate: "2017-11-28T12:41:21Z",
    });

    expect(nested.rawCalldataFallback).toBeUndefined();
    expect(nested.warnings).toBeUndefined();

    // Top-level metadata comes from example-account-execute.json.
    assert(result.metadata);
    expect(result.metadata.owner).toBe("Smart Account");
    expect(result.metadata.contractName).toBeUndefined();
    expect(result.metadata.info).toEqual({
      url: "https://eips.ethereum.org/EIPS/eip-4337",
    });

    expect(result.interpolatedIntent).toBe(
      `Execute transaction to Tether USD Contract with 0 ETH`,
    );
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("returns rawCalldataFallback in the nested display when the inner callee has no descriptor", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const innerData = "0xdeadbeef"; // 4 bytes — just a selector, no args
    const outerData = buildExecuteCalldata(
      UNKNOWN_CONTRACT,
      1_000_000_000_000_000_000n, // 1 ETH
      innerData,
    );

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: SMART_ACCOUNT,
        data: outerData,
      },
      opts,
    );

    expect(result.intent).toBe("Execute Transaction");

    assert(result.fields);
    expect(result.fields).toHaveLength(3);

    // `to` — unknown address, falls back to raw checksum address + UNKNOWN_ADDRESS.
    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.label).toBe("To");
    expect(toField.value).toBe(toChecksumAddress(hexToBytes(UNKNOWN_CONTRACT)));
    expect(toField.fieldType).toBe("address");
    expect(toField.format).toBe("addressName");
    expect(toField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(UNKNOWN_CONTRACT)),
    );
    assert(toField.warning);
    expect(toField.warning.code).toBe("UNKNOWN_ADDRESS");

    // `value` — 1 ETH native amount.
    const valueField = result.fields[1];
    assert(!isFieldGroup(valueField));
    expect(valueField.label).toBe("Value");
    expect(valueField.value).toBe("1 ETH");
    expect(valueField.format).toBe("amount");
    expect(valueField.warning).toBeUndefined();

    // `data` — inner display falls back to rawCalldataFallback with NO_DESCRIPTOR.
    const dataField = result.fields[2];
    assert(!isFieldGroup(dataField));
    expect(dataField.label).toBe("Call Data");
    expect(dataField.value).toBe(keccak256Str(innerData));
    expect(dataField.fieldType).toBe("bytes");
    expect(dataField.format).toBe("calldata");
    expect(dataField.rawAddress).toBeUndefined();
    expect(dataField.tokenAddress).toBeUndefined();
    expect(dataField.warning).toBeUndefined();

    assert(dataField.calldataDisplay);
    const nested = dataField.calldataDisplay;

    assert(nested.rawCalldataFallback);
    expect(nested.rawCalldataFallback.selector).toBe("0xdeadbeef");
    expect(nested.rawCalldataFallback.args).toEqual([]);

    assert(nested.warnings);
    expect(nested.warnings.some((w) => w.code === "NO_DESCRIPTOR")).toBe(true);

    expect(nested.intent).toBeUndefined();
    expect(nested.fields).toBeUndefined();
    expect(nested.interpolatedIntent).toBeUndefined();
    expect(nested.metadata).toBeUndefined();

    expect(result.rawCalldataFallback).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      `Execute transaction to ${toChecksumAddress(hexToBytes(UNKNOWN_CONTRACT))} with 1 ETH`,
    );
  });

  it("emits ADDRESS_TYPE_MISMATCH when resolveLocalName returns typeMatch: false", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName: async (address, acceptedTypes) => {
        if (address !== USDT_ADDRESS.toLowerCase()) return null;
        // descriptor requests ["wallet","eoa","contract","token"] — "collection" is absent
        return {
          name: "Suspicious Contract",
          typeMatch: acceptedTypes?.includes("collection") ?? false,
        };
      },
      resolveChainInfo,
    });

    const innerTransfer = buildTransferCalldata(RECIPIENT, TRANSFER_AMOUNT);
    const outerData = buildExecuteCalldata(USDT_ADDRESS, 0n, innerTransfer);

    const result: DisplayModel = await format(
      { chainId: CHAIN_ID, to: SMART_ACCOUNT, data: outerData },
      opts,
    );

    assert(result.fields);
    const toField = result.fields[0];
    assert(!isFieldGroup(toField));
    expect(toField.label).toBe("To");
    expect(toField.value).toBe("Suspicious Contract");
    expect(toField.fieldType).toBe("address");
    expect(toField.format).toBe("addressName");
    expect(toField.rawAddress).toBe(toChecksumAddress(hexToBytes(USDT_ADDRESS)));
    assert(toField.warning);
    expect(toField.warning.code).toBe("ADDRESS_TYPE_MISMATCH");
  });
});
