/**
 * Tests for Paraswap AugustusSwapper v6.2 descriptor:
 * - swapOnAugustusRFQTryBatchFill: tuple array decoding + array index access
 * - swapExactAmountOutOnBalancerV2: dynamic bytes + byte slices
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index";
import type { ExternalDataProvider } from "../../../src/types";
import { toChecksumAddress, hexToBytes } from "../../../src/utils";
import { buildEmbeddedResolverOpts } from "../../utils";

describe("Paraswap AugustusSwapper v6.2", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x6a000f20005980200259b80c5102003040001068";
  const FROM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const CRV = "0xd533a949740bb3306d119cc777fa900ba034cd52";
  const BENEFICIARY = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (chainId === CHAIN_ID && tokenAddress === USDC) {
      return { name: "USD Coin", symbol: "USDC", decimals: 6 };
    }
    if (chainId === CHAIN_ID && tokenAddress === DAI) {
      return { name: "Dai Stablecoin", symbol: "DAI", decimals: 18 };
    }
    if (chainId === CHAIN_ID && tokenAddress === CRV) {
      return { name: "Curve DAO Token", symbol: "CRV", decimals: 18 };
    }
    return null;
  };

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    if (address === BENEFICIARY.toLowerCase()) {
      return { name: "vitalik.eth", typeMatch: true };
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
            address: CONTRACT,
            file: "calldata-AugustusSwapper-v6.2.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  // =========================================================================
  // swapExactAmountOutOnBalancerV2
  // =========================================================================
  describe("swapExactAmountOutOnBalancerV2", () => {
    // ABI-encoded calldata:
    //   balancerData.fromAmount = 2,000,000,000,000,000,000 (2e18)
    //   balancerData.toAmount = 1,500,000,000,000,000,000 (1.5e18)
    //   balancerData.beneficiaryAndApproveFlag = BENEFICIARY in last 20 bytes
    //   data[0] = 0x52 (82 decimal = "Single swap" enum)
    //   data[292:324] = ABI-encoded USDC address
    //   data[324:356] = ABI-encoded DAI address
    // data content layout (356 bytes total):
    //   byte 0:       0x52 (82 = "Single swap" enum)
    //   bytes 1-291:  zeros
    //   bytes 292-323: ABI-encoded USDC address (12 zero bytes + 20 address bytes)
    //   bytes 324-355: ABI-encoded DAI address (12 zero bytes + 20 address bytes)
    const BALANCER_CALLDATA =
      "0xd6ed22e6" +
      // balancerData tuple (5 words):
      "0000000000000000000000000000000000000000000000001bc16d674ec80000" + // fromAmount = 2e18
      "00000000000000000000000000000000000000000000000014d1120d7b160000" + // toAmount = 1.5e18
      "000000000000000000000000000000000000000000000000136dcc951d8c0000" + // quotedAmount
      "0000000000000000000000000000000000000000000000000000000000000000" + // metadata
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // beneficiaryAndApproveFlag
      // partnerAndFee:
      "0000000000000000000000000000000000000000000000000000000000000000" +
      // permit offset (0x100 = 256):
      "0000000000000000000000000000000000000000000000000000000000000100" +
      // data offset (0x120 = 288):
      "0000000000000000000000000000000000000000000000000000000000000120" +
      // --- permit (length=0) ---
      "0000000000000000000000000000000000000000000000000000000000000000" +
      // --- data bytes (length=356=0x164) ---
      "0000000000000000000000000000000000000000000000000000000000000164" +
      // data content (356 bytes padded to 384):
      "5200000000000000000000000000000000000000000000000000000000000000" + // bytes 0-31
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 32-63
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 64-95
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 96-127
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 128-159
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 160-191
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 192-223
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 224-255
      "0000000000000000000000000000000000000000000000000000000000000000" + // bytes 256-287
      "00000000000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce" + // bytes 288-319 (USDC starts at 292)
      "3606eb480000000000000000000000006b175474e89094c44da98b954eedeac4" + // bytes 320-351 (DAI starts at 324)
      "95271d0f00000000000000000000000000000000000000000000000000000000"; // bytes 352-383 (padded)

    it("formats BalancerV2 swap with dynamic bytes and byte slices", async () => {
      const opts = buildOpts({ resolveToken, resolveLocalName });

      const result = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          from: FROM,
          data: BALANCER_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Swap");

      assert(result.fields);
      // 4 visible fields: balancerSelector, fromAmount, toAmount, beneficiary
      expect(result.fields).toHaveLength(4);

      // Field 0: Swap type — enum from data.[:1] = 82 = "Single swap"
      const selectorField = result.fields[0];
      assert(!isFieldGroup(selectorField));
      expect(selectorField.label).toBe("Swap type");
      expect(selectorField.value).toBe("Single swap");
      expect(selectorField.fieldType).toBe("uint");
      expect(selectorField.format).toBe("enum");
      expect(selectorField.tokenAddress).toBeUndefined();
      expect(selectorField.calldataDisplay).toBeUndefined();
      expect(selectorField.rawAddress).toBeUndefined();
      expect(selectorField.warning).toBeUndefined();

      // Field 1: Maximum to Send — tokenPath from data.[292:324]
      const sendField = result.fields[1];
      assert(!isFieldGroup(sendField));
      expect(sendField.label).toBe("Maximum to Send");
      expect(sendField.value).toBe("2,000,000,000,000 USDC");
      expect(sendField.fieldType).toBe("uint");
      expect(sendField.format).toBe("tokenAmount");
      expect(sendField.tokenAddress).toBe(toChecksumAddress(hexToBytes(USDC)));
      expect(sendField.calldataDisplay).toBeUndefined();
      expect(sendField.rawAddress).toBeUndefined();
      expect(sendField.warning).toBeUndefined();

      // Field 2: Amount to Receive — tokenPath from data.[324:356]
      const receiveField = result.fields[2];
      assert(!isFieldGroup(receiveField));
      expect(receiveField.label).toBe("Amount to Receive");
      expect(receiveField.value).toBe("1.5 DAI");
      expect(receiveField.fieldType).toBe("uint");
      expect(receiveField.format).toBe("tokenAmount");
      expect(receiveField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(DAI)),
      );
      expect(receiveField.calldataDisplay).toBeUndefined();
      expect(receiveField.rawAddress).toBeUndefined();
      expect(receiveField.warning).toBeUndefined();

      // Field 3: Beneficiary — from beneficiaryAndApproveFlag.[-20:]
      const beneficiaryField = result.fields[3];
      assert(!isFieldGroup(beneficiaryField));
      expect(beneficiaryField.label).toBe("Beneficiary");
      expect(beneficiaryField.value).toBe("vitalik.eth");
      expect(beneficiaryField.fieldType).toBe("address");
      expect(beneficiaryField.format).toBe("addressName");
      expect(beneficiaryField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(BENEFICIARY)),
      );
      expect(beneficiaryField.tokenAddress).toBeUndefined();
      expect(beneficiaryField.calldataDisplay).toBeUndefined();
      expect(beneficiaryField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Velora");
      expect(result.metadata.contractName).toBe("AugustusSwapperV6.2");
      expect(result.metadata.info).toEqual({
        url: "https://www.velora.xyz/",
      });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });

  // =========================================================================
  // swapOnAugustusRFQTryBatchFill
  // =========================================================================
  describe("swapOnAugustusRFQTryBatchFill", () => {
    // ABI-encoded calldata for 1 order:
    //   data.fromAmount = 1,000,000 (1 USDC)
    //   data.toAmount = 950,000,000,000,000,000 (0.95 DAI)
    //   data.beneficiary = BENEFICIARY
    //   orders[0].order.takerAsset = USDC (what we send)
    //   orders[0].order.makerAsset = DAI (what we receive)
    const RFQ_CALLDATA =
      "0xda35bb0d" +
      "00000000000000000000000000000000000000000000000000000000000f4240" + // data.fromAmount = 1000000
      "0000000000000000000000000000000000000000000000000d2f13f7789f0000" + // data.toAmount
      "0000000000000000000000000000000000000000000000000000000000000000" + // data.wrapApproveDirection
      "0000000000000000000000000000000000000000000000000000000000000000" + // data.metadata
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // data.beneficiary
      "00000000000000000000000000000000000000000000000000000000000000e0" + // orders offset
      "0000000000000000000000000000000000000000000000000000000000000300" + // permit offset
      // --- orders array ---
      "0000000000000000000000000000000000000000000000000000000000000001" + // length = 1
      "0000000000000000000000000000000000000000000000000000000000000020" + // element 0 offset
      // order tuple (8 words):
      "0000000000000000000000000000000000000000000000000000000000000001" + // nonceAndMeta
      "000000000000000000000000000000000000000000000000000000006553f100" + // expiry
      "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" + // makerAsset (DAI)
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // takerAsset (USDC)
      "0000000000000000000000001111111111111111111111111111111111111111" + // maker
      "0000000000000000000000002222222222222222222222222222222222222222" + // taker
      "0000000000000000000000000000000000000000000000000d2f13f7789f0000" + // makerAmount
      "00000000000000000000000000000000000000000000000000000000000f4240" + // takerAmount
      // dynamic fields in element:
      "0000000000000000000000000000000000000000000000000000000000000180" + // signature offset
      "00000000000000000000000000000000000000000000000000000000000f4240" + // takerTokenFillAmount
      "00000000000000000000000000000000000000000000000000000000000001a0" + // permitTakerAsset offset
      "00000000000000000000000000000000000000000000000000000000000001c0" + // permitMakerAsset offset
      // signature (length=0)
      "0000000000000000000000000000000000000000000000000000000000000000" +
      // permitTakerAsset (length=0)
      "0000000000000000000000000000000000000000000000000000000000000000" +
      // permitMakerAsset (length=0)
      "0000000000000000000000000000000000000000000000000000000000000000" +
      // --- permit (length=0) ---
      "0000000000000000000000000000000000000000000000000000000000000000";

    it("formats RFQ batch fill with tuple array decoding", async () => {
      const opts = buildOpts({ resolveToken, resolveLocalName });

      const result = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          from: FROM,
          data: RFQ_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Swap");

      assert(result.fields);
      // 3 visible fields: fromAmount, toAmount, beneficiary
      expect(result.fields).toHaveLength(3);

      // Field 0: Amount to Send — tokenPath = orders.[0].order.takerAsset = USDC
      const sendField = result.fields[0];
      assert(!isFieldGroup(sendField));
      expect(sendField.label).toBe("Amount to Send");
      expect(sendField.value).toBe("1 USDC");
      expect(sendField.fieldType).toBe("uint");
      expect(sendField.format).toBe("tokenAmount");
      expect(sendField.tokenAddress).toBe(toChecksumAddress(hexToBytes(USDC)));
      expect(sendField.calldataDisplay).toBeUndefined();
      expect(sendField.rawAddress).toBeUndefined();
      expect(sendField.warning).toBeUndefined();

      // Field 1: Minimum to Receive — tokenPath = orders.[0].order.makerAsset = DAI
      const receiveField = result.fields[1];
      assert(!isFieldGroup(receiveField));
      expect(receiveField.label).toBe("Minimum to Receive");
      expect(receiveField.value).toBe("0.95 DAI");
      expect(receiveField.fieldType).toBe("uint");
      expect(receiveField.format).toBe("tokenAmount");
      expect(receiveField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(DAI)),
      );
      expect(receiveField.calldataDisplay).toBeUndefined();
      expect(receiveField.rawAddress).toBeUndefined();
      expect(receiveField.warning).toBeUndefined();

      // Field 2: Beneficiary
      const beneficiaryField = result.fields[2];
      assert(!isFieldGroup(beneficiaryField));
      expect(beneficiaryField.label).toBe("Beneficiary");
      expect(beneficiaryField.value).toBe("vitalik.eth");
      expect(beneficiaryField.fieldType).toBe("address");
      expect(beneficiaryField.format).toBe("addressName");
      expect(beneficiaryField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(BENEFICIARY)),
      );
      expect(beneficiaryField.tokenAddress).toBeUndefined();
      expect(beneficiaryField.calldataDisplay).toBeUndefined();
      expect(beneficiaryField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Velora");
      expect(result.metadata.contractName).toBe("AugustusSwapperV6.2");
      expect(result.metadata.info).toEqual({
        url: "https://www.velora.xyz/",
      });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });

    it("formats a real RFQ batch fill swapping CRV → USDC with zero-address beneficiary", async () => {
      // Real calldata from an on-chain swapOnAugustusRFQTryBatchFill transaction.
      // Swaps ~6781.62 CRV for ~1550.10 USDC with beneficiary = zero address.
      const REAL_RFQ_CALLDATA =
        "0xda35bb0d" +
        "00000000000000000000000000000000000000000000016fa1ea7222ea58a0f9" + // data.fromAmount
        "000000000000000000000000000000000000000000000000000000005c64c705" + // data.toAmount
        "0000000000000000000000000000000000000000000000000000000000000000" + // data.wrapApproveDirection
        "0ff7cd1a80664eca879663953f878d20000000000000000000000000017bd52a" + // data.metadata
        "0000000000000000000000000000000000000000000000000000000000000000" + // data.beneficiary = 0x0
        "00000000000000000000000000000000000000000000000000000000000000e0" + // orders offset
        "0000000000000000000000000000000000000000000000000000000000000360" + // permit offset
        // --- orders array (length=1) ---
        "0000000000000000000000000000000000000000000000000000000000000001" +
        "0000000000000000000000000000000000000000000000000000000000000020" + // element 0 offset
        // order tuple (8 words):
        "f35a3e303ac1bc1be9396eea0000000000000000000000000000000000000000" + // nonceAndMeta
        "0000000000000000000000000000000000000000000000000000000069e0e5d3" + // expiry
        "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // makerAsset (USDC)
        "000000000000000000000000d533a949740bb3306d119cc777fa900ba034cd52" + // takerAsset (CRV)
        "0000000000000000000000009ba0cf1588e1dfa905ec948f7fe5104dd40eda31" + // maker
        "0000000000000000000000006a000f20005980200259b80c5102003040001068" + // taker
        "000000000000000000000000000000000000000000000000000000005d991949" + // makerAmount
        "0000000000000000000000000000000000000000000001734f0e11ff6cb08e30" + // takerAmount
        // dynamic fields in element:
        "0000000000000000000000000000000000000000000000000000000000000180" + // signature offset
        "0000000000000000000000000000000000000000000001734f0e11ff6cb08e30" + // takerTokenFillAmount
        "0000000000000000000000000000000000000000000000000000000000000200" + // permitTakerAsset offset
        "0000000000000000000000000000000000000000000000000000000000000220" + // permitMakerAsset offset
        // signature (length=65)
        "0000000000000000000000000000000000000000000000000000000000000041" +
        "1bf0a9201d02223590dff12535379e96d1be06f04b196d8cf362ca74c4856d35" +
        "ce45274dbf6fe5c27d9c1eebf7a6ac710d3c129b678ce024307b2ad317949371" +
        // padding (31 bytes)
        "0000000000000000000000000000000000000000000000000000000000000000" +
        // permitTakerAsset (length=0)
        "0000000000000000000000000000000000000000000000000000000000000000" +
        // permitMakerAsset (length=0)
        "0000000000000000000000000000000000000000000000000000000000000000" +
        // --- permit (length=0) ---
        "0000000000000000000000000000000000000000000000000000000000000000";

      const opts = buildOpts({ resolveToken, resolveLocalName });

      const result = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          from: FROM,
          data: REAL_RFQ_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Swap");

      assert(result.fields);
      expect(result.fields).toHaveLength(3);

      // Field 0: Amount to Send — tokenPath = orders.[0].order.takerAsset = CRV
      const sendField = result.fields[0];
      assert(!isFieldGroup(sendField));
      expect(sendField.label).toBe("Amount to Send");
      expect(sendField.value).toBe("6,781.622338330348265721 CRV");
      expect(sendField.fieldType).toBe("uint");
      expect(sendField.format).toBe("tokenAmount");
      expect(sendField.tokenAddress).toBe(toChecksumAddress(hexToBytes(CRV)));
      expect(sendField.calldataDisplay).toBeUndefined();
      expect(sendField.rawAddress).toBeUndefined();
      expect(sendField.warning).toBeUndefined();

      // Field 1: Minimum to Receive — tokenPath = orders.[0].order.makerAsset = USDC
      const receiveField = result.fields[1];
      assert(!isFieldGroup(receiveField));
      expect(receiveField.label).toBe("Minimum to Receive");
      expect(receiveField.value).toBe("1,550.108421 USDC");
      expect(receiveField.fieldType).toBe("uint");
      expect(receiveField.format).toBe("tokenAmount");
      expect(receiveField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(USDC)),
      );
      expect(receiveField.calldataDisplay).toBeUndefined();
      expect(receiveField.rawAddress).toBeUndefined();
      expect(receiveField.warning).toBeUndefined();

      // Field 2: Beneficiary — zero address matches senderAddress param,
      // so per ERC-7730 it is interpreted as the sender @.from
      const beneficiaryField = result.fields[2];
      assert(!isFieldGroup(beneficiaryField));
      expect(beneficiaryField.label).toBe("Beneficiary");
      expect(beneficiaryField.value).toBe("Sender");
      expect(beneficiaryField.fieldType).toBe("address");
      expect(beneficiaryField.format).toBe("addressName");
      expect(beneficiaryField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(FROM)),
      );
      expect(beneficiaryField.tokenAddress).toBeUndefined();
      expect(beneficiaryField.calldataDisplay).toBeUndefined();
      expect(beneficiaryField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Velora");
      expect(result.metadata.contractName).toBe("AugustusSwapperV6.2");
      expect(result.metadata.info).toEqual({
        url: "https://www.velora.xyz/",
      });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
