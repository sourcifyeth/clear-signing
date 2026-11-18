/**
 * Tests for Paraswap AugustusSwapper v6.2 descriptor:
 * - swapOnAugustusRFQTryBatchFill: tuple array decoding + array index access
 * - swapExactAmountOutOnBalancerV2: dynamic bytes + byte slices
 * - swapExactAmountInOnCurveV1: static tuple with relative tokenPath
 * - input models of these functions, and calldata built from them
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import { buildCalldata, getCalldataInputModels } from "../../../src/builder.js";
import type {
  DisplayModel,
  ExternalDataProvider,
  InputModel,
} from "../../../src/types.js";
import { toChecksumAddress, hexToBytes } from "../../../src/utils.js";
import { buildFilesystemResolverOpts, padAddr } from "../../utils.js";

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

  const METADATA = {
    owner: "Velora",
    contractName: "AugustusSwapperV6.2",
    info: { url: "https://www.velora.xyz/" },
  };
  const NATIVE_CURRENCY = [
    "$.metadata.constants.addressAsEth",
    "$.metadata.constants.addressAsNull",
  ];
  const BENEFICIARY_PARAMS = {
    senderAddress: "$.metadata.constants.addressAsNull",
  };

  /** Get the input model of one function from the descriptor. */
  async function inputModel(selector: string): Promise<InputModel> {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      CONTRACT,
      buildOpts(),
    );
    expect(result.warnings).toBeUndefined();
    assert(result.models);
    // One model per display.formats entry of the descriptor.
    expect(result.models).toHaveLength(11);
    const model = result.models.find((m) => m.selector === selector);
    assert(model);
    return model;
  }

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
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

    function assertBalancerSwap(result: DisplayModel) {
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
      expect(selectorField.embeddedCalldata).toBeUndefined();
      expect(selectorField.rawAddress).toBeUndefined();
      expect(selectorField.warning).toBeUndefined();

      // Field 1: Maximum to Send — tokenPath from data.[292:324]
      const sendField = result.fields[1];
      assert(!isFieldGroup(sendField));
      expect(sendField.label).toBe("Maximum to Send");
      expect(sendField.value).toBe("2000000000000 USDC");
      expect(sendField.fieldType).toBe("uint");
      expect(sendField.format).toBe("tokenAmount");
      expect(sendField.tokenAddress).toBe(toChecksumAddress(hexToBytes(USDC)));
      expect(sendField.embeddedCalldata).toBeUndefined();
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
      expect(receiveField.embeddedCalldata).toBeUndefined();
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
      expect(beneficiaryField.embeddedCalldata).toBeUndefined();
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
    }

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

      assertBalancerSwap(result);
    });

    it("lists the input model and builds the same calldata from it", async () => {
      const model = await inputModel("0xd6ed22e6");
      expect(model).toEqual({
        signature:
          "swapExactAmountOutOnBalancerV2((uint256 fromAmount, uint256 toAmount, uint256 quotedAmount, bytes32 metadata, uint256 beneficiaryAndApproveFlag) balancerData, uint256 partnerAndFee, bytes permit, bytes data)",
        selector: "0xd6ed22e6",
        metadata: METADATA,
        intent: "Swap",
        fields: [
          // The data.[:1] slice and the beneficiaryAndApproveFlag.[-20:]
          // slice name no whole input, so both inputs are appended below.
          {
            label: "Maximum to Send",
            path: "balancerData.fromAmount",
            type: "uint256",
            format: "tokenAmount",
            params: {
              nativeCurrencyAddress: NATIVE_CURRENCY,
              tokenPath: "data.[292:324]",
            },
          },
          {
            label: "Amount to Receive",
            path: "balancerData.toAmount",
            type: "uint256",
            format: "tokenAmount",
            params: {
              nativeCurrencyAddress: NATIVE_CURRENCY,
              tokenPath: "data.[324:356]",
            },
          },
          {
            label: "Balancer Data Metadata",
            path: "balancerData.metadata",
            type: "bytes32",
            hidden: true,
          },
          {
            label: "Balancer Data Quoted Amount",
            path: "balancerData.quotedAmount",
            type: "uint256",
            hidden: true,
          },
          { label: "Permit", path: "permit", type: "bytes", hidden: true },
          {
            label: "Partner And Fee",
            path: "partnerAndFee",
            type: "uint256",
            hidden: true,
          },
          {
            label: "beneficiaryAndApproveFlag",
            path: "balancerData.beneficiaryAndApproveFlag",
            type: "uint256",
          },
          { label: "data", path: "data", type: "bytes" },
        ],
      });

      const built = buildCalldata(model, {
        balancerData: {
          fromAmount: 2_000_000_000_000_000_000n,
          toAmount: 1_500_000_000_000_000_000n,
          quotedAmount: "0x136dcc951d8c0000",
          metadata: "0x" + "00".repeat(32),
          beneficiaryAndApproveFlag: BigInt(BENEFICIARY),
        },
        partnerAndFee: 0,
        permit: "0x",
        data: "0x52" + "00".repeat(291) + padAddr(USDC) + padAddr(DAI),
      });
      assert("data" in built);
      expect(built.data).toBe(BALANCER_CALLDATA);

      const opts = buildOpts({ resolveToken, resolveLocalName });
      assertBalancerSwap(
        await format(
          { chainId: CHAIN_ID, to: CONTRACT, from: FROM, data: built.data },
          opts,
        ),
      );
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

    function assertRfqSwap(result: DisplayModel) {
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
      expect(sendField.embeddedCalldata).toBeUndefined();
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
      expect(receiveField.embeddedCalldata).toBeUndefined();
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
      expect(beneficiaryField.embeddedCalldata).toBeUndefined();
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
    }

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

      assertRfqSwap(result);
    });

    it("lists the input model and builds the same calldata from it", async () => {
      const model = await inputModel("0xda35bb0d");
      expect(model).toEqual({
        signature:
          "swapOnAugustusRFQTryBatchFill((uint256 fromAmount, uint256 toAmount, uint8 wrapApproveDirection, bytes32 metadata, address beneficiary) data, ((uint256 nonceAndMeta, uint128 expiry, address makerAsset, address takerAsset, address maker, address taker, uint256 makerAmount, uint256 takerAmount) order, bytes signature, uint256 takerTokenFillAmount, bytes permitTakerAsset, bytes permitMakerAsset)[] orders, bytes permit)",
        selector: "0xda35bb0d",
        metadata: METADATA,
        intent: "Swap",
        fields: [
          {
            label: "Amount to Send",
            path: "data.fromAmount",
            type: "uint256",
            format: "tokenAmount",
            params: {
              nativeCurrencyAddress: NATIVE_CURRENCY,
              tokenPath: "orders.[0].order.takerAsset",
            },
          },
          {
            label: "Minimum to Receive",
            path: "data.toAmount",
            type: "uint256",
            format: "tokenAmount",
            params: {
              nativeCurrencyAddress: NATIVE_CURRENCY,
              tokenPath: "orders.[0].order.makerAsset",
            },
          },
          {
            label: "Beneficiary",
            path: "data.beneficiary",
            type: "address",
            format: "addressName",
            params: BENEFICIARY_PARAMS,
          },
          {
            label: "Orders Order Expiry",
            path: "orders.[].order.expiry",
            type: "uint128",
            hidden: true,
          },
          {
            label: "Orders Order Maker",
            path: "orders.[].order.maker",
            type: "address",
            hidden: true,
          },
          {
            label: "Orders Order Taker",
            path: "orders.[].order.taker",
            type: "address",
            hidden: true,
          },
          {
            label: "Orders Order Maker Amount",
            path: "orders.[].order.makerAmount",
            type: "uint256",
            hidden: true,
          },
          {
            label: "Orders Order Taker Amount",
            path: "orders.[].order.takerAmount",
            type: "uint256",
            hidden: true,
          },
          {
            label: "Orders Taker Token Fill Amount",
            path: "orders.[].takerTokenFillAmount",
            type: "uint256",
            hidden: true,
          },
          { label: "Permit", path: "permit", type: "bytes", hidden: true },
          // Inputs that no descriptor field covers, in ABI order.
          {
            label: "wrapApproveDirection",
            path: "data.wrapApproveDirection",
            type: "uint8",
          },
          { label: "metadata", path: "data.metadata", type: "bytes32" },
          {
            label: "nonceAndMeta",
            path: "orders.[].order.nonceAndMeta",
            type: "uint256",
          },
          {
            label: "makerAsset",
            path: "orders.[].order.makerAsset",
            type: "address",
          },
          {
            label: "takerAsset",
            path: "orders.[].order.takerAsset",
            type: "address",
          },
          { label: "signature", path: "orders.[].signature", type: "bytes" },
          {
            label: "permitTakerAsset",
            path: "orders.[].permitTakerAsset",
            type: "bytes",
          },
          {
            label: "permitMakerAsset",
            path: "orders.[].permitMakerAsset",
            type: "bytes",
          },
        ],
      });

      const built = buildCalldata(model, {
        data: {
          fromAmount: 1_000_000n,
          toAmount: 950_000_000_000_000_000n,
          wrapApproveDirection: 0,
          metadata: "0x" + "00".repeat(32),
          beneficiary: BENEFICIARY,
        },
        orders: [
          {
            order: {
              nonceAndMeta: 1,
              expiry: 0x6553f100,
              makerAsset: DAI,
              takerAsset: USDC,
              maker: "0x1111111111111111111111111111111111111111",
              taker: "0x2222222222222222222222222222222222222222",
              makerAmount: 950_000_000_000_000_000n,
              takerAmount: 1_000_000n,
            },
            signature: "0x",
            takerTokenFillAmount: 1_000_000n,
            permitTakerAsset: "0x",
            permitMakerAsset: "0x",
          },
        ],
        permit: "0x",
      });
      assert("data" in built);
      expect(built.data).toBe(RFQ_CALLDATA);

      const opts = buildOpts({ resolveToken, resolveLocalName });
      assertRfqSwap(
        await format(
          { chainId: CHAIN_ID, to: CONTRACT, from: FROM, data: built.data },
          opts,
        ),
      );
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
      expect(sendField.value).toBe("6781.622338330348265721 CRV");
      expect(sendField.fieldType).toBe("uint");
      expect(sendField.format).toBe("tokenAmount");
      expect(sendField.tokenAddress).toBe(toChecksumAddress(hexToBytes(CRV)));
      expect(sendField.embeddedCalldata).toBeUndefined();
      expect(sendField.rawAddress).toBeUndefined();
      expect(sendField.warning).toBeUndefined();

      // Field 1: Minimum to Receive — tokenPath = orders.[0].order.makerAsset = USDC
      const receiveField = result.fields[1];
      assert(!isFieldGroup(receiveField));
      expect(receiveField.label).toBe("Minimum to Receive");
      expect(receiveField.value).toBe("1550.108421 USDC");
      expect(receiveField.fieldType).toBe("uint");
      expect(receiveField.format).toBe("tokenAmount");
      expect(receiveField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(USDC)),
      );
      expect(receiveField.embeddedCalldata).toBeUndefined();
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
      expect(beneficiaryField.embeddedCalldata).toBeUndefined();
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
  // swapExactAmountInOnCurveV1
  // =========================================================================
  describe("swapExactAmountInOnCurveV1", () => {
    // ABI-encoded calldata:
    //   curveV1Data is a static tuple (9 static fields = 288 bytes inline)
    //   curveV1Data.srcToken = USDC
    //   curveV1Data.destToken = DAI
    //   curveV1Data.fromAmount = 1,000,000 (1 USDC)
    //   curveV1Data.toAmount = 950,000,000,000,000,000 (0.95 DAI)
    //   curveV1Data.beneficiary = BENEFICIARY
    //   partnerAndFee = 0
    //   permit = empty bytes
    // Head layout (after selector):
    //   bytes 0-287:   curveV1Data tuple (9 words)
    //   bytes 288-319: partnerAndFee
    //   bytes 320-351: permit offset = 0x160 (352)
    //   bytes 352+:    permit length (0) + content
    const CURVE_V1_CALLDATA =
      "0x1a01c532" +
      // curveV1Data tuple (9 words):
      "0000000000000000000000000000000000000000000000000000000000000000" + // curveData
      "0000000000000000000000000000000000000000000000000000000000000000" + // curveAssets
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // srcToken (USDC)
      "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" + // destToken (DAI)
      "00000000000000000000000000000000000000000000000000000000000f4240" + // fromAmount = 1e6
      "0000000000000000000000000000000000000000000000000d2f13f7789f0000" + // toAmount = 0.95e18
      "0000000000000000000000000000000000000000000000000000000000000000" + // quotedAmount
      "0000000000000000000000000000000000000000000000000000000000000000" + // metadata
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // beneficiary
      // partnerAndFee:
      "0000000000000000000000000000000000000000000000000000000000000000" +
      // permit offset (0x160 = 352):
      "0000000000000000000000000000000000000000000000000000000000000160" +
      // --- permit (length=0) ---
      "0000000000000000000000000000000000000000000000000000000000000000";

    function assertCurveSwap(result: DisplayModel) {
      expect(result.intent).toBe("Swap");

      assert(result.fields);
      // 1 unlabeled DisplayFieldGroup wrapping the curveV1Data struct fields
      expect(result.fields).toHaveLength(1);

      const curveGroup = result.fields[0];
      assert(isFieldGroup(curveGroup));
      expect(curveGroup.label).toBeUndefined();
      expect(curveGroup.warning).toBeUndefined();
      // 3 visible children: fromAmount, toAmount, beneficiary
      expect(curveGroup.fields).toHaveLength(3);

      // Child 0: Amount to Send — tokenPath = srcToken (USDC)
      const sendField = curveGroup.fields[0];
      expect(sendField.label).toBe("Amount to Send");
      expect(sendField.value).toBe("1 USDC");
      expect(sendField.fieldType).toBe("uint");
      expect(sendField.format).toBe("tokenAmount");
      expect(sendField.tokenAddress).toBe(toChecksumAddress(hexToBytes(USDC)));
      expect(sendField.embeddedCalldata).toBeUndefined();
      expect(sendField.rawAddress).toBeUndefined();
      expect(sendField.warning).toBeUndefined();

      // Child 1: Minimum to Receive — tokenPath = destToken (DAI)
      const receiveField = curveGroup.fields[1];
      expect(receiveField.label).toBe("Minimum to Receive");
      expect(receiveField.value).toBe("0.95 DAI");
      expect(receiveField.fieldType).toBe("uint");
      expect(receiveField.format).toBe("tokenAmount");
      expect(receiveField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(DAI)),
      );
      expect(receiveField.embeddedCalldata).toBeUndefined();
      expect(receiveField.rawAddress).toBeUndefined();
      expect(receiveField.warning).toBeUndefined();

      // Child 2: Beneficiary
      const beneficiaryField = curveGroup.fields[2];
      expect(beneficiaryField.label).toBe("Beneficiary");
      expect(beneficiaryField.value).toBe("vitalik.eth");
      expect(beneficiaryField.fieldType).toBe("address");
      expect(beneficiaryField.format).toBe("addressName");
      expect(beneficiaryField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(BENEFICIARY)),
      );
      expect(beneficiaryField.tokenAddress).toBeUndefined();
      expect(beneficiaryField.embeddedCalldata).toBeUndefined();
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
    }

    it("formats CurveV1 swap with relative tokenPath inside a static tuple", async () => {
      const opts = buildOpts({ resolveToken, resolveLocalName });

      const result = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          from: FROM,
          data: CURVE_V1_CALLDATA,
        },
        opts,
      );

      assertCurveSwap(result);
    });

    it("lists the input model and builds the same calldata from it", async () => {
      const model = await inputModel("0x1a01c532");
      expect(model).toEqual({
        signature:
          "swapExactAmountInOnCurveV1((uint256 curveData, uint256 curveAssets, address srcToken, address destToken, uint256 fromAmount, uint256 toAmount, uint256 quotedAmount, bytes32 metadata, address beneficiary) curveV1Data, uint256 partnerAndFee, bytes permit)",
        selector: "0x1a01c532",
        metadata: METADATA,
        intent: "Swap",
        fields: [
          {
            path: "curveV1Data",
            fields: [
              {
                label: "Amount to Send",
                path: "curveV1Data.fromAmount",
                type: "uint256",
                format: "tokenAmount",
                params: {
                  nativeCurrencyAddress: NATIVE_CURRENCY,
                  tokenPath: "curveV1Data.srcToken",
                },
              },
              {
                label: "Minimum to Receive",
                path: "curveV1Data.toAmount",
                type: "uint256",
                format: "tokenAmount",
                params: {
                  nativeCurrencyAddress: NATIVE_CURRENCY,
                  tokenPath: "curveV1Data.destToken",
                },
              },
              {
                label: "Beneficiary",
                path: "curveV1Data.beneficiary",
                type: "address",
                format: "addressName",
                params: BENEFICIARY_PARAMS,
              },
            ],
          },
          {
            label: "Curve V1 Data Curve Assets",
            path: "curveV1Data.curveAssets",
            type: "uint256",
            hidden: true,
          },
          {
            label: "Curve V1 Data Curve Data",
            path: "curveV1Data.curveData",
            type: "uint256",
            hidden: true,
          },
          {
            label: "Curve V1 Data Metadata",
            path: "curveV1Data.metadata",
            type: "bytes32",
            hidden: true,
          },
          {
            label: "Curve V1 Data Quoted Amount",
            path: "curveV1Data.quotedAmount",
            type: "uint256",
            hidden: true,
          },
          { label: "Permit", path: "permit", type: "bytes", hidden: true },
          {
            label: "Partner And Fee",
            path: "partnerAndFee",
            type: "uint256",
            hidden: true,
          },
          { label: "srcToken", path: "curveV1Data.srcToken", type: "address" },
          {
            label: "destToken",
            path: "curveV1Data.destToken",
            type: "address",
          },
        ],
      });

      const built = buildCalldata(model, {
        curveV1Data: {
          curveData: 0,
          curveAssets: 0,
          srcToken: USDC,
          destToken: DAI,
          fromAmount: 1_000_000n,
          toAmount: 950_000_000_000_000_000n,
          quotedAmount: 0,
          metadata: "0x" + "00".repeat(32),
          beneficiary: BENEFICIARY,
        },
        partnerAndFee: 0,
        permit: "0x",
      });
      assert("data" in built);
      expect(built.data).toBe(CURVE_V1_CALLDATA);

      const opts = buildOpts({ resolveToken, resolveLocalName });
      assertCurveSwap(
        await format(
          { chainId: CHAIN_ID, to: CONTRACT, from: FROM, data: built.data },
          opts,
        ),
      );
    });
  });
});
