/**
 * Tests based on the ERC-7730 spec test case: example-userops-eip712.json
 * Tests ERC-4337 PackedUserOperation EIP-712 clear signing, including the
 * embedded calldata field that recursively formats the inner account call.
 * @see https://eips.ethereum.org/EIPS/eip-7730#user-operations-eip-4337
 */

import { describe, it, expect, assert } from "vitest";
import { formatTypedData, isFieldGroup } from "../../src/index";
import type {
  DisplayModel,
  ExternalDataProvider,
  FormatOptions,
  TypedData,
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
// the descriptor bindings and address-based path resolution work end-to-end).
const SMART_ACCOUNT = "0x0000000000000000000000000000000000004337";
const SMART_ACCOUNT_NAME = "My Smart Account";
const CHAIN_ID = 1;

// USDT mainnet — has a registered descriptor in example-main.json.
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const USDT_CONTRACT_NAME = "Tether USD Contract";

const RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";
const RECIPIENT_LOCAL_NAME = "Alice";
const TRANSFER_AMOUNT = 1_000_000n; // 1 USDT (6 decimals)

const EXECUTE_SELECTOR_HEX = bytesToHex(
  selectorForSignature("execute(address,uint256,bytes)"),
);
const TRANSFER_SELECTOR_HEX = bytesToHex(
  selectorForSignature("transfer(address,uint256)"),
);

const PAYMASTER_AND_DATA =
  "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const INIT_CODE_NON_EMPTY = "0x1234567890abcdef";

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
  return (
    EXECUTE_SELECTOR_HEX +
    padAddr(to) +
    padUint(value) +
    padUint(0x60n) +
    lengthHex +
    contentHex
  );
}

const PACKED_USER_OPERATION_TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  PackedUserOperation: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
  ],
};

function buildTypedData(overrides: {
  callData: string;
  initCode?: string;
  paymasterAndData?: string;
}): TypedData {
  return {
    account: SMART_ACCOUNT,
    domain: {
      name: "Account",
      version: "1",
      chainId: CHAIN_ID,
      verifyingContract: SMART_ACCOUNT,
    },
    primaryType: "PackedUserOperation",
    types: PACKED_USER_OPERATION_TYPES,
    message: {
      sender: SMART_ACCOUNT,
      nonce: "7",
      initCode: overrides.initCode ?? "0x",
      callData: overrides.callData,
      accountGasLimits:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      preVerificationGas: "21000",
      gasFees:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      paymasterAndData: overrides.paymasterAndData ?? "0x",
    },
  };
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
  acceptedTypes,
) => {
  const lower = address.toLowerCase();
  if (lower === SMART_ACCOUNT.toLowerCase()) {
    return {
      name: SMART_ACCOUNT_NAME,
      typeMatch: acceptedTypes?.includes("contract") ?? false,
    };
  }
  if (lower === USDT_ADDRESS.toLowerCase()) {
    return { name: USDT_CONTRACT_NAME, typeMatch: true };
  }
  if (lower === RECIPIENT.toLowerCase()) {
    return { name: RECIPIENT_LOCAL_NAME, typeMatch: true };
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
      eip712DescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: SMART_ACCOUNT,
          file: "example-userops-eip712.json",
        },
      ],
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

describe("example-userops-eip712.json — PackedUserOperation", () => {
  it("formats a PackedUserOperation with an embedded execute(transfer) chain and hides zero-valued optional fields", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const innerTransfer = buildTransferCalldata(RECIPIENT, TRANSFER_AMOUNT);
    const accountCallData = buildExecuteCalldata(
      USDT_ADDRESS,
      0n,
      innerTransfer,
    );

    const typedData = buildTypedData({ callData: accountCallData });
    const result: DisplayModel = await formatTypedData(typedData, opts);

    expect(result.intent).toBe("Sign Packed User Operation");

    assert(result.fields);
    // Visible fields when initCode and paymasterAndData are empty:
    // sender (addressName), callData (calldata). Hidden: nonce, accountGasLimits,
    // preVerificationGas, gasFees (visible: "never"), plus initCode and
    // paymasterAndData which are empty bytes and hidden via { ifNotIn: [0] }.
    expect(result.fields).toHaveLength(2);

    const senderField = result.fields[0];
    assert(!isFieldGroup(senderField));
    expect(senderField.label).toBe("Sender Account");
    expect(senderField.value).toBe(SMART_ACCOUNT_NAME);
    expect(senderField.fieldType).toBe("address");
    expect(senderField.format).toBe("addressName");
    expect(senderField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(SMART_ACCOUNT)),
    );
    expect(senderField.tokenAddress).toBeUndefined();
    expect(senderField.calldataDisplay).toBeUndefined();
    expect(senderField.warning).toBeUndefined();

    const callDataField = result.fields[1];
    assert(!isFieldGroup(callDataField));
    expect(callDataField.label).toBe("Embedded Call Data");
    expect(callDataField.value).toBe(keccak256Str(accountCallData));
    expect(callDataField.fieldType).toBe("bytes");
    expect(callDataField.format).toBe("calldata");
    expect(callDataField.rawAddress).toBeUndefined();
    expect(callDataField.tokenAddress).toBeUndefined();
    expect(callDataField.warning).toBeUndefined();

    // First nested DisplayModel: the UserOperation's callData is executed on
    // the sender (the smart account), and decodes as an execute() call.
    assert(callDataField.calldataDisplay);
    const accountDisplay = callDataField.calldataDisplay;
    expect(accountDisplay.intent).toBe("Execute Transaction");

    assert(accountDisplay.fields);
    expect(accountDisplay.fields).toHaveLength(3);

    const nestedTo = accountDisplay.fields[0];
    assert(!isFieldGroup(nestedTo));
    expect(nestedTo.label).toBe("To");
    expect(nestedTo.value).toBe(USDT_CONTRACT_NAME);
    expect(nestedTo.fieldType).toBe("address");
    expect(nestedTo.format).toBe("addressName");
    expect(nestedTo.rawAddress).toBe(
      toChecksumAddress(hexToBytes(USDT_ADDRESS)),
    );
    expect(nestedTo.tokenAddress).toBeUndefined();
    expect(nestedTo.calldataDisplay).toBeUndefined();
    expect(nestedTo.warning).toBeUndefined();

    const nestedValue = accountDisplay.fields[1];
    assert(!isFieldGroup(nestedValue));
    expect(nestedValue.label).toBe("Value");
    expect(nestedValue.value).toBe("0 ETH");
    expect(nestedValue.fieldType).toBe("uint");
    expect(nestedValue.format).toBe("amount");
    expect(nestedValue.warning).toBeUndefined();

    // Inner-most: the actual ERC-20 transfer on USDT.
    const nestedData = accountDisplay.fields[2];
    assert(!isFieldGroup(nestedData));
    expect(nestedData.label).toBe("Call Data");
    expect(nestedData.value).toBe(keccak256Str(innerTransfer));
    expect(nestedData.fieldType).toBe("bytes");
    expect(nestedData.format).toBe("calldata");

    assert(nestedData.calldataDisplay);
    const transferDisplay = nestedData.calldataDisplay;
    expect(transferDisplay.intent).toBe("Send");

    assert(transferDisplay.fields);
    expect(transferDisplay.fields).toHaveLength(2);

    const transferTo = transferDisplay.fields[0];
    assert(!isFieldGroup(transferTo));
    expect(transferTo.label).toBe("To");
    expect(transferTo.value).toBe(RECIPIENT_LOCAL_NAME);
    expect(transferTo.fieldType).toBe("address");
    expect(transferTo.format).toBe("addressName");
    expect(transferTo.rawAddress).toBe(
      toChecksumAddress(hexToBytes(RECIPIENT)),
    );

    const transferAmount = transferDisplay.fields[1];
    assert(!isFieldGroup(transferAmount));
    expect(transferAmount.label).toBe("Amount");
    expect(transferAmount.value).toBe("1 USDT");
    expect(transferAmount.fieldType).toBe("uint");
    expect(transferAmount.format).toBe("tokenAmount");
    expect(transferAmount.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(USDT_ADDRESS)),
    );

    expect(transferDisplay.interpolatedIntent).toBe(
      `Send 1 USDT to ${RECIPIENT_LOCAL_NAME}`,
    );

    // Top-level interpolation uses the resolved sender name.
    expect(result.interpolatedIntent).toBe(
      `Authorize user operation from ${SMART_ACCOUNT_NAME}`,
    );

    assert(result.metadata);
    expect(result.metadata.owner).toBe("Account Abstraction");
    expect(result.metadata.contractName).toBeUndefined();
    expect(result.metadata.info).toEqual({
      url: "https://eips.ethereum.org/EIPS/eip-4337",
    });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("shows initCode and paymasterAndData as raw bytes when non-empty", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const innerTransfer = buildTransferCalldata(RECIPIENT, TRANSFER_AMOUNT);
    const accountCallData = buildExecuteCalldata(
      USDT_ADDRESS,
      0n,
      innerTransfer,
    );

    const typedData = buildTypedData({
      callData: accountCallData,
      initCode: INIT_CODE_NON_EMPTY,
      paymasterAndData: PAYMASTER_AND_DATA,
    });
    const result = await formatTypedData(typedData, opts);

    assert(result.fields);
    // sender, initCode, callData, paymasterAndData — 4 visible fields.
    expect(result.fields).toHaveLength(4);

    const labels = result.fields.map((f) => {
      assert(!isFieldGroup(f));
      return f.label;
    });
    expect(labels).toEqual([
      "Sender Account",
      "Init Code",
      "Embedded Call Data",
      "Paymaster Data",
    ]);

    const initCodeField = result.fields[1];
    assert(!isFieldGroup(initCodeField));
    expect(initCodeField.label).toBe("Init Code");
    expect(initCodeField.value).toBe(INIT_CODE_NON_EMPTY);
    expect(initCodeField.fieldType).toBe("bytes");
    expect(initCodeField.format).toBe("raw");
    expect(initCodeField.rawAddress).toBeUndefined();
    expect(initCodeField.tokenAddress).toBeUndefined();
    expect(initCodeField.calldataDisplay).toBeUndefined();
    expect(initCodeField.warning).toBeUndefined();

    const paymasterField = result.fields[3];
    assert(!isFieldGroup(paymasterField));
    expect(paymasterField.label).toBe("Paymaster Data");
    expect(paymasterField.value).toBe(PAYMASTER_AND_DATA);
    expect(paymasterField.fieldType).toBe("bytes");
    expect(paymasterField.format).toBe("raw");
    expect(paymasterField.rawAddress).toBeUndefined();
    expect(paymasterField.tokenAddress).toBeUndefined();
    expect(paymasterField.calldataDisplay).toBeUndefined();
    expect(paymasterField.warning).toBeUndefined();

    expect(result.warnings).toBeUndefined();
  });

  it("returns DOMAIN_MISMATCH when the domain name does not match the descriptor constraint", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const innerTransfer = buildTransferCalldata(RECIPIENT, TRANSFER_AMOUNT);
    const accountCallData = buildExecuteCalldata(
      USDT_ADDRESS,
      0n,
      innerTransfer,
    );

    const typedData = buildTypedData({ callData: accountCallData });
    const wrongDomain: TypedData = {
      ...typedData,
      domain: { ...typedData.domain, name: "NotAccount" },
    };

    const result = await formatTypedData(wrongDomain, opts);

    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "DOMAIN_MISMATCH")).toBe(
      true,
    );

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
  });
});
