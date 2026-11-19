/**
 * Builder tests with the Ekubo MEVCaptureRouter descriptor in
 * `../registry-cases/ekubo/`: a function that lists the components of a
 * tuple array and then the whole element with `visible: "never"`.
 */

import { describe, it, expect, assert } from "vitest";
import { buildCalldata, getCalldataInputModels } from "../../src/builder.js";
import { buildFilesystemResolverOpts, pad32, padAddr } from "../utils.js";

describe("builder — Ekubo MEVCaptureRouter", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0xd26f20001a72a18C002b00e6710000d68700ce00";
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const DAI = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const CONFIG = "0x" + "00".repeat(31) + "01";

  it("keeps one input for each route component of multihopSwap", async () => {
    const { descriptorResolverOptions } = buildFilesystemResolverOpts(
      `${__dirname}/../registry-cases/ekubo`,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-MEVCaptureRouter.json",
          },
        ],
      },
    );

    const result = await getCalldataInputModels(CHAIN_ID, CONTRACT, {
      descriptorResolverOptions,
    });
    expect(result.warnings).toBeUndefined();
    assert(result.models);
    const model = result.models.find((m) => m.selector === "0x6d0cb613");
    assert(model);

    expect(model).toEqual({
      signature:
        "multihopSwap((((address token0, address token1, bytes32 config) poolKey, uint96 sqrtRatioLimit, uint256 skipAhead)[] route, (address token, int128 amount) tokenAmount) s, int256 calculatedAmountThreshold)",
      selector: "0x6d0cb613",
      metadata: {
        owner: "Ekubo Protocol",
        contractName: "Ekubo Swap Router",
        info: undefined,
      },
      intent: "Multihop swap on Ekubo",
      fields: [
        {
          label: "Specified amount",
          path: "s.tokenAmount.amount",
          type: "int128",
          format: "tokenAmount",
          params: { tokenPath: "s.tokenAmount.token" },
        },
        {
          label: "Amount threshold",
          path: "calculatedAmountThreshold",
          type: "int256",
          format: "raw",
        },
        {
          label: "Route token 0",
          path: "s.route.[].poolKey.token0",
          type: "address",
          format: "addressName",
          params: { types: ["token"] },
        },
        {
          label: "Route token 1",
          path: "s.route.[].poolKey.token1",
          type: "address",
          format: "addressName",
          params: { types: ["token"] },
        },
        {
          label: "Price limit",
          path: "s.route.[].sqrtRatioLimit",
          type: "uint96",
          format: "raw",
        },
        {
          label: "Skip ahead",
          path: "s.route.[].skipAhead",
          type: "uint256",
          format: "raw",
        },
        {
          label: "Pool config",
          path: "s.route.[].poolKey.config",
          type: "bytes32",
          format: "raw",
        },
        // The descriptor also has the hidden field "Route" for the whole
        // element "s.route.[]". It has other fields inside it, so it is
        // left out.
        { label: "token", path: "s.tokenAmount.token", type: "address" },
      ],
    });

    // The fields give every value that the function needs.
    const built = buildCalldata(model, {
      s: {
        route: [
          {
            poolKey: { token0: USDC, token1: DAI, config: CONFIG },
            sqrtRatioLimit: 7,
            skipAhead: 0,
          },
        ],
        tokenAmount: { token: USDC, amount: 1_000_000n },
      },
      calculatedAmountThreshold: -5,
    });
    assert("data" in built);
    expect(built.data).toBe(
      "0x6d0cb613" +
        pad32("40") + // offset of s
        "f".repeat(63) +
        "b" + // calculatedAmountThreshold = -5
        // s: head
        pad32("60") + // offset of route
        padAddr(USDC) + // tokenAmount.token
        pad32("f4240") + // tokenAmount.amount = 1,000,000
        // s.route
        pad32("1") + // length
        padAddr(USDC) + // poolKey.token0
        padAddr(DAI) + // poolKey.token1
        CONFIG.slice(2) + // poolKey.config
        pad32("7") + // sqrtRatioLimit
        pad32("0"), // skipAhead
    );
  });
});
