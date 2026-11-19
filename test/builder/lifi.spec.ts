/**
 * Builder tests with the LI.FI LIFIDiamond descriptor in
 * `../registry-cases/lifi/`: the input model of
 * swapTokensMultipleV3ERC20ToERC20 (`.[]` and fixed-index paths), and calldata
 * built from it.
 */

import { describe, it, expect, assert } from "vitest";
import { buildCalldata, getCalldataInputModels } from "../../src/builder.js";
import { buildFilesystemResolverOpts } from "../utils.js";

describe("builder — LI.FI LIFIDiamond", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
  const BENEFICIARY = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
  // WETH is the intermediate hop. It appears only in the raw calldata.
  const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

  function buildOpts() {
    return buildFilesystemResolverOpts(`${__dirname}/../registry-cases/lifi`, {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: CONTRACT,
          file: "calldata-LIFIDiamond.json",
        },
      ],
    });
  }

  // =========================================================================
  // swapTokensMultipleV3ERC20ToERC20
  // =========================================================================
  describe("swapTokensMultipleV3ERC20ToERC20", () => {
    // Two-hop swap: 1000 USDC → WETH (intermediate) → DAI (min 950 DAI out).
    //
    // Signature: swapTokensMultipleV3ERC20ToERC20(
    //   bytes32 _transactionId, string _integrator, string _referrer,
    //   address _receiver, uint256 _minAmountOut,
    //   (address callTo, address approveTo, address sendingAssetId,
    //    address receivingAssetId, uint256 fromAmount, bytes callData,
    //    bool requiresDeposit)[] _swapData
    // )
    // Selector: 0x5fd9ae2e
    //
    // The tuple is dynamic (contains `bytes callData`), so the array element
    // offsets are required even though there are only two elements.
    const SWAP_CALLDATA =
      "0x5fd9ae2e" +
      // --- head (6 words) ---
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" + // _transactionId
      "00000000000000000000000000000000000000000000000000000000000000c0" + // _integrator offset = 0xc0
      "0000000000000000000000000000000000000000000000000000000000000100" + // _referrer offset = 0x100
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // _receiver
      "0000000000000000000000000000000000000000000000337fe5feaf2d180000" + // _minAmountOut = 950e18
      "0000000000000000000000000000000000000000000000000000000000000120" + // _swapData offset = 0x120
      // --- _integrator: "lifi-api" ---
      "0000000000000000000000000000000000000000000000000000000000000008" + // length = 8
      "6c6966692d617069000000000000000000000000000000000000000000000000" + // "lifi-api" padded
      // --- _referrer: "" ---
      "0000000000000000000000000000000000000000000000000000000000000000" + // length = 0
      // --- _swapData (length=2) ---
      "0000000000000000000000000000000000000000000000000000000000000002" + // length
      "0000000000000000000000000000000000000000000000000000000000000040" + // element 0 offset (from after length)
      "0000000000000000000000000000000000000000000000000000000000000140" + // element 1 offset
      // --- element 0: USDC → WETH ---
      "0000000000000000000000001111111111111111111111111111111111111111" + // callTo
      "0000000000000000000000001111111111111111111111111111111111111111" + // approveTo
      "000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" + // sendingAssetId = USDC
      "000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" + // receivingAssetId = WETH
      "000000000000000000000000000000000000000000000000000000003b9aca00" + // fromAmount = 1e9 (1000 USDC)
      "00000000000000000000000000000000000000000000000000000000000000e0" + // callData offset = 0xe0
      "0000000000000000000000000000000000000000000000000000000000000000" + // requiresDeposit = false
      "0000000000000000000000000000000000000000000000000000000000000000" + // callData length = 0
      // --- element 1: WETH → DAI ---
      "0000000000000000000000001111111111111111111111111111111111111111" + // callTo
      "0000000000000000000000001111111111111111111111111111111111111111" + // approveTo
      "000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" + // sendingAssetId = WETH
      "0000000000000000000000006b175474e89094c44da98b954eedeac495271d0f" + // receivingAssetId = DAI
      "0000000000000000000000000000000000000000000000000000000000000000" + // fromAmount = 0 (unused by display)
      "00000000000000000000000000000000000000000000000000000000000000e0" + // callData offset = 0xe0
      "0000000000000000000000000000000000000000000000000000000000000000" + // requiresDeposit = false
      "0000000000000000000000000000000000000000000000000000000000000000"; // callData length = 0

    it("lists the input model and builds the same calldata from it", async () => {
      const result = await getCalldataInputModels(
        CHAIN_ID,
        CONTRACT,
        buildOpts(),
      );
      expect(result.warnings).toBeUndefined();
      assert(result.models);
      // One model per display.formats entry of the descriptor.
      expect(result.models).toHaveLength(7);
      const model = result.models.find((m) => m.selector === "0x5fd9ae2e");
      assert(model);

      expect(model).toEqual({
        signature:
          "swapTokensMultipleV3ERC20ToERC20(bytes32 _transactionId, string _integrator, string _referrer, address _receiver, uint256 _minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] _swapData)",
        selector: "0x5fd9ae2e",
        metadata: {
          owner: "LI.FI",
          contractName: "LI.FI Service GmbH",
          info: { url: "https://li.fi" },
        },
        intent: "Swap",
        fields: [
          // "Amount to Send" has the fixed-index path _swapData.[0].fromAmount.
          // It names no whole input, so it is left out, and
          // _swapData.[].fromAmount is appended below.
          {
            label: "Minimum to Receive",
            path: "_minAmountOut",
            type: "uint256",
            format: "tokenAmount",
            params: { tokenPath: "_swapData.[-1].receivingAssetId" },
          },
          {
            label: "Recipient",
            path: "_receiver",
            type: "address",
            format: "addressName",
            params: { types: ["eoa", "contract"], sources: ["local", "ens"] },
          },
          {
            label: "Transaction Id",
            path: "_transactionId",
            type: "bytes32",
            hidden: true,
          },
          {
            label: "Integrator",
            path: "_integrator",
            type: "string",
            hidden: true,
          },
          {
            label: "Referrer",
            path: "_referrer",
            type: "string",
            hidden: true,
          },
          {
            label: "Swap Data Call Data",
            path: "_swapData.[].callData",
            type: "bytes",
            hidden: true,
          },
          {
            label: "Swap Data Call To",
            path: "_swapData.[].callTo",
            type: "address",
            hidden: true,
          },
          {
            label: "Swap Data Approve To",
            path: "_swapData.[].approveTo",
            type: "address",
            hidden: true,
          },
          {
            label: "Swap Data Requires Deposit",
            path: "_swapData.[].requiresDeposit",
            type: "bool",
            hidden: true,
          },
          {
            label: "sendingAssetId",
            path: "_swapData.[].sendingAssetId",
            type: "address",
          },
          {
            label: "receivingAssetId",
            path: "_swapData.[].receivingAssetId",
            type: "address",
          },
          {
            label: "fromAmount",
            path: "_swapData.[].fromAmount",
            type: "uint256",
          },
        ],
      });

      const hop = {
        callTo: "0x1111111111111111111111111111111111111111",
        approveTo: "0x1111111111111111111111111111111111111111",
        callData: "0x",
        requiresDeposit: false,
      };
      const built = buildCalldata(model, {
        _transactionId:
          "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        _integrator: "lifi-api",
        _referrer: "",
        _receiver: BENEFICIARY,
        _minAmountOut: 950_000_000_000_000_000_000n,
        _swapData: [
          {
            ...hop,
            sendingAssetId: USDC,
            receivingAssetId: WETH,
            fromAmount: 1_000_000_000n,
          },
          {
            ...hop,
            sendingAssetId: WETH,
            receivingAssetId: DAI,
            fromAmount: 0,
          },
        ],
      });
      assert("data" in built);
      expect(built.data).toBe(SWAP_CALLDATA);
    });
  });
});
