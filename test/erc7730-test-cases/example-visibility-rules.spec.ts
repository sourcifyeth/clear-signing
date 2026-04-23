/**
 * Tests based on the ERC-7730 spec test case: example-visibility-rules.json
 * Tests the per-field `visible` rule (always / never / optional / ifNotIn / mustMatch).
 * @see https://eips.ethereum.org/EIPS/eip-7730#field-format-specification
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
  selectorForSignature,
  toChecksumAddress,
} from "../../src/utils";
import { buildEmbeddedResolverOpts } from "../utils";

const CONTRACT_ADDRESS = "0x00112233445566778899AABBCCDDEEFF00112233";
const CHAIN_ID = 1;

const RECIPIENT = "0x1234567890abcdef1234567890abcdef12345678";
const RECIPIENT_LOCAL_NAME = "Alice";
const REFERRER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REFERRER_LOCAL_NAME = "Referrer Name";
const RFU = "0x0000000000000000000000000000000000000000";

const FEE_1_ETH = 1_000_000_000_000_000_000n; // 1 ETH expressed in wei
const TRANSFER_AMOUNT = 1_000_000n; // 1 EXA (6 decimals)

const CANONICAL_SIGNATURE =
  "transfer(address,uint256,address,address,uint256,uint256)";
const SELECTOR = bytesToHex(selectorForSignature(CANONICAL_SIGNATURE));

function buildCalldata(params: {
  to: string;
  value: bigint;
  referrer: string;
  rfu: string;
  legacy: bigint;
  fee: bigint;
}): string {
  const pad32 = (hex: string) => hex.padStart(64, "0");
  const padAddr = (addr: string) => pad32(addr.toLowerCase().slice(2));
  const padInt = (n: bigint) => pad32(n.toString(16));

  return (
    SELECTOR +
    padAddr(params.to) +
    padInt(params.value) +
    padAddr(params.referrer) +
    padAddr(params.rfu) +
    padInt(params.legacy) +
    padInt(params.fee)
  );
}

const resolveToken: ExternalDataProvider["resolveToken"] = async (
  chainId,
  tokenAddress,
) => {
  if (chainId === CHAIN_ID && tokenAddress === CONTRACT_ADDRESS.toLowerCase()) {
    return { name: "Example Token", symbol: "EXA", decimals: 6 };
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
  if (lower === REFERRER.toLowerCase()) {
    return { name: REFERRER_LOCAL_NAME, typeMatch: true };
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
          address: CONTRACT_ADDRESS,
          file: "example-visibility-rules.json",
        },
      ],
    },
    externalDataProvider,
  );
}

describe("example-visibility-rules.json — transfer with visibility rules", () => {
  it("shows always/optional fields and hides never/mustMatch fields when values are as expected", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const result: DisplayModel = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT_ADDRESS,
        data: buildCalldata({
          to: RECIPIENT,
          value: TRANSFER_AMOUNT,
          referrer: REFERRER,
          rfu: RFU,
          legacy: 0n, // mustMatch [0] → matches, hidden without warning
          fee: FEE_1_ETH, // ifNotIn [0] → not in, shown
        }),
      },
      opts,
    );

    expect(result.intent).toBe("Send");

    assert(result.fields);
    // Displayed: To (always), Amount (always), Referrer (optional), Fee (ifNotIn, value != 0)
    // Hidden:    RFU (never), Legacy (mustMatch with matching value)
    expect(result.fields).toHaveLength(4);

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
    expect(amountField.value).toBe("1 EXA");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(CONTRACT_ADDRESS)),
    );
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.calldataDisplay).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    const referrerField = result.fields[2];
    assert(!isFieldGroup(referrerField));
    expect(referrerField.label).toBe("Referrer");
    expect(referrerField.value).toBe(REFERRER_LOCAL_NAME);
    expect(referrerField.fieldType).toBe("address");
    expect(referrerField.format).toBe("addressName");
    expect(referrerField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(REFERRER)),
    );
    expect(referrerField.tokenAddress).toBeUndefined();
    expect(referrerField.calldataDisplay).toBeUndefined();
    expect(referrerField.warning).toBeUndefined();

    const feeField = result.fields[3];
    assert(!isFieldGroup(feeField));
    expect(feeField.label).toBe("Fee Amount");
    expect(feeField.value).toBe("1 ETH");
    expect(feeField.fieldType).toBe("uint");
    expect(feeField.format).toBe("amount");
    expect(feeField.tokenAddress).toBeUndefined();
    expect(feeField.rawAddress).toBeUndefined();
    expect(feeField.calldataDisplay).toBeUndefined();
    expect(feeField.warning).toBeUndefined();

    expect(result.interpolatedIntent).toBe(
      `Send 1 EXA to ${RECIPIENT_LOCAL_NAME}`,
    );

    assert(result.metadata);
    expect(result.metadata.owner).toBe("Example");
    expect(result.metadata.contractName).toBeUndefined();
    expect(result.metadata.info).toEqual({ url: "https://example.io/" });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("hides the fee field when its value matches ifNotIn [0]", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT_ADDRESS,
        data: buildCalldata({
          to: RECIPIENT,
          value: TRANSFER_AMOUNT,
          referrer: REFERRER,
          rfu: RFU,
          legacy: 0n,
          fee: 0n, // ifNotIn [0] → matches, hidden
        }),
      },
      opts,
    );

    assert(result.fields);
    // Hidden: RFU (never), Legacy (mustMatch match), Fee (ifNotIn match)
    expect(result.fields).toHaveLength(3);

    const labels = result.fields.map((f) => {
      assert(!isFieldGroup(f));
      return f.label;
    });
    expect(labels).toEqual(["To", "Amount", "Referrer"]);

    expect(result.interpolatedIntent).toBe(
      `Send 1 EXA to ${RECIPIENT_LOCAL_NAME}`,
    );
    expect(result.warnings).toBeUndefined();
  });

  it("excludes the rfu field unconditionally (visible: never), even if value is non-zero", async () => {
    const NONZERO_RFU = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT_ADDRESS,
        data: buildCalldata({
          to: RECIPIENT,
          value: TRANSFER_AMOUNT,
          referrer: REFERRER,
          rfu: NONZERO_RFU,
          legacy: 0n,
          fee: FEE_1_ETH,
        }),
      },
      opts,
    );

    assert(result.fields);
    const labels = result.fields.map((f) => {
      assert(!isFieldGroup(f));
      return f.label;
    });
    expect(labels).not.toContain("RFU Field");
    // No UNKNOWN_ADDRESS warning should be emitted for the hidden rfu field.
    expect(result.warnings).toBeUndefined();
  });

  it("falls back to rawCalldataFallback when a mustMatch field value does not match", async () => {
    const opts = buildOpts({
      resolveToken,
      resolveLocalName,
      resolveChainInfo,
    });

    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT_ADDRESS,
        data: buildCalldata({
          to: RECIPIENT,
          value: TRANSFER_AMOUNT,
          referrer: REFERRER,
          rfu: RFU,
          legacy: 42n, // violates mustMatch: [0]
          fee: FEE_1_ETH,
        }),
      },
      opts,
    );

    // A violation is treated as a malformed tx: bail out to raw calldata.
    assert(result.rawCalldataFallback);
    expect(result.rawCalldataFallback.selector).toBe(SELECTOR);
    expect(result.rawCalldataFallback.args).toEqual([
      `000000000000000000000000${RECIPIENT.slice(2)}`,
      "00000000000000000000000000000000000000000000000000000000000f4240",
      `000000000000000000000000${REFERRER.slice(2)}`,
      `000000000000000000000000${RFU.slice(2)}`,
      "000000000000000000000000000000000000000000000000000000000000002a",
      "0000000000000000000000000000000000000000000000000de0b6b3a7640000",
    ]);

    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "MUSTMATCH_VIOLATION")).toBe(
      true,
    );

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });
});
