/**
 * Tests for Yield.xyz descriptors:
 * - POL Validator buyVoucherPOL: unit format with $.metadata.constants base interpolation
 * - USDe Vault deposit: tokenAmount with $.metadata.constants.* token address,
 *   raw field whose `value` is a $.metadata.constants.* reference,
 *   and addressName for the share recipient
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../../src/types.js";
import {
  bytesToHex,
  hexToBytes,
  selectorForSignature,
  toChecksumAddress,
} from "../../../src/utils.js";
import { buildFilesystemResolverOpts } from "../../utils.js";

describe("Yield.xyz POL Validator", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0xb929b89153fc2eed442e81e5a1add4e2fa39028f";

  function buildOpts() {
    return buildFilesystemResolverOpts(__dirname, {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: CONTRACT,
          file: "calldata-yieldxyz-pol-validator.json",
        },
      ],
    });
  }

  // =========================================================================
  // buyVoucherPOL
  // =========================================================================
  describe("buyVoucherPOL", () => {
    // buyVoucherPOL(uint256 _amount, uint256 _minSharesToMint)
    //   _amount           = 100 * 10^18  (100 POL)
    //   _minSharesToMint  = 12345
    const SELECTOR = bytesToHex(
      selectorForSignature("buyVoucherPOL(uint256,uint256)"),
    );

    const BUY_VOUCHER_CALLDATA =
      SELECTOR +
      "0000000000000000000000000000000000000000000000056bc75e2d63100000" + // _amount = 100e18
      "0000000000000000000000000000000000000000000000000000000000003039"; // _minSharesToMint = 12345

    it("renders POL stake amount with constant-based unit ticker", async () => {
      const opts = buildOpts();

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: BUY_VOUCHER_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Stake POL");

      assert(result.fields);
      expect(result.fields).toHaveLength(2);

      // Field 0: Stake amount — unit format, 100e18 with decimals=18 → "100POL"
      const amountField = result.fields[0];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Stake amount");
      expect(amountField.value).toBe("100POL");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("unit");
      expect(amountField.tokenAddress).toBeUndefined();
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.embeddedCalldata).toBeUndefined();
      expect(amountField.warning).toBeUndefined();

      // Field 1: Min shares — raw format
      const minSharesField = result.fields[1];
      assert(!isFieldGroup(minSharesField));
      expect(minSharesField.label).toBe("Min shares");
      expect(minSharesField.value).toBe("12345");
      expect(minSharesField.fieldType).toBe("uint");
      expect(minSharesField.format).toBe("raw");
      expect(minSharesField.tokenAddress).toBeUndefined();
      expect(minSharesField.rawAddress).toBeUndefined();
      expect(minSharesField.embeddedCalldata).toBeUndefined();
      expect(minSharesField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Yield.xyz");
      expect(result.metadata.contractName).toBe("YieldxyzPolValidator");
      expect(result.metadata.info).toEqual({ url: "https://yield.xyz/" });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});

describe("Yield.xyz USDe Vault", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x2D152fB171353E70e45322D32bC748F8a61d9971";
  const USDE_TOKEN = "0x4c9edd5852cd905f086c759e8383e09bff1e68b3";
  const RECEIVER = "0x2fec9b58d089447d3e5e50578b9f71321713a470";

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-yieldxyz-usde-vault.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  // =========================================================================
  // deposit
  // =========================================================================
  describe("deposit", () => {
    // deposit(uint256 _underlying, address receiver)
    //   _underlying = 100 * 10^18  (100 USDe)
    //   receiver    = 0x2fec…a470
    const SELECTOR = bytesToHex(
      selectorForSignature("deposit(uint256,address)"),
    );

    const DEPOSIT_CALLDATA =
      SELECTOR +
      "0000000000000000000000000000000000000000000000056bc75e2d63100000" + // _underlying = 100e18
      "0000000000000000000000002fec9b58d089447d3e5e50578b9f71321713a470"; // receiver

    const resolveToken: ExternalDataProvider["resolveToken"] = async (
      chainId,
      tokenAddress,
    ) => {
      if (chainId === CHAIN_ID && tokenAddress === USDE_TOKEN) {
        return { name: "USDe", symbol: "USDe", decimals: 18 };
      }
      return null;
    };

    const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
      address,
    ) => {
      if (address === RECEIVER) {
        return { name: "alice.eth", typeMatch: true };
      }
      return null;
    };

    it("renders deposit asset, share ticker constant, and recipient name", async () => {
      const opts = buildOpts({ resolveToken, resolveLocalName });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: DEPOSIT_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Deposit");

      assert(result.fields);
      expect(result.fields).toHaveLength(3);

      // Field 0: Deposit asset — tokenAmount, 100e18 with USDe decimals=18 → "100 USDe"
      const depositField = result.fields[0];
      assert(!isFieldGroup(depositField));
      expect(depositField.label).toBe("Deposit asset");
      expect(depositField.value).toBe("100 USDe");
      expect(depositField.fieldType).toBe("uint");
      expect(depositField.format).toBe("tokenAmount");
      expect(depositField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(USDE_TOKEN)),
      );
      expect(depositField.rawAddress).toBeUndefined();
      expect(depositField.embeddedCalldata).toBeUndefined();
      expect(depositField.warning).toBeUndefined();

      // Field 1: Share ticker — raw format with `value` referencing
      // $.metadata.constants.vaultTicker → "stk-USDe"
      const tickerField = result.fields[1];
      assert(!isFieldGroup(tickerField));
      expect(tickerField.label).toBe("Share ticker");
      expect(tickerField.value).toBe("stk-USDe");
      expect(tickerField.fieldType).toBe("string");
      expect(tickerField.format).toBe("raw");
      expect(tickerField.tokenAddress).toBeUndefined();
      expect(tickerField.rawAddress).toBeUndefined();
      expect(tickerField.embeddedCalldata).toBeUndefined();
      expect(tickerField.warning).toBeUndefined();

      // Field 2: Send shares to — addressName, receiver → alice.eth
      const receiverField = result.fields[2];
      assert(!isFieldGroup(receiverField));
      expect(receiverField.label).toBe("Send shares to");
      expect(receiverField.value).toBe("alice.eth");
      expect(receiverField.fieldType).toBe("address");
      expect(receiverField.format).toBe("addressName");
      expect(receiverField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(RECEIVER)),
      );
      expect(receiverField.tokenAddress).toBeUndefined();
      expect(receiverField.embeddedCalldata).toBeUndefined();
      expect(receiverField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Yield.xyz");
      expect(result.metadata.contractName).toBeUndefined();
      expect(result.metadata.info).toEqual({ url: "https://yield.xyz/" });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
