/**
 * Builder tests with the Aave Lending Pool v2 descriptor in
 * `../registry-cases/aave-lpv2/`: an input model whose params take an enum
 * and a constant from the descriptor metadata.
 */

import { describe, it, expect, assert } from "vitest";
import { getCalldataInputModels } from "../../src/builder.js";
import { buildFilesystemResolverOpts } from "../utils.js";

describe("builder — Aave Lending Pool v2", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9";

  it("resolves the enum entries and the metadata constant of repay", async () => {
    const { descriptorResolverOptions } = buildFilesystemResolverOpts(
      `${__dirname}/../registry-cases/aave-lpv2`,
      {
        calldataDescriptorFiles: [
          { chainId: CHAIN_ID, address: CONTRACT, file: "calldata-lpv2.json" },
        ],
      },
    );

    const result = await getCalldataInputModels(CHAIN_ID, CONTRACT, {
      descriptorResolverOptions,
    });
    expect(result.warnings).toBeUndefined();
    assert(result.models);
    // One model per display.formats entry of the descriptor.
    expect(result.models).toHaveLength(6);
    const model = result.models.find((m) => m.selector === "0x573ade81");

    expect(model).toEqual({
      signature:
        "repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf)",
      selector: "0x573ade81",
      metadata: {
        owner: "Aave DAO",
        contractName: "Lending Pool v2",
        info: {
          url: "https://aave.com",
          deploymentDate: "2020-11-30T09:25:48Z",
        },
      },
      intent: "Repay loan",
      fields: [
        {
          label: "Amount to repay",
          path: "amount",
          type: "uint256",
          format: "tokenAmount",
          params: {
            tokenPath: "asset",
            // The descriptor has "$.metadata.constants.max" here.
            threshold:
              "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            message: "All",
          },
        },
        {
          label: "Interest rate mode",
          path: "rateMode",
          type: "uint256",
          format: "enum",
          // The descriptor has { $ref: "$.metadata.enums.interestRateMode" }.
          options: { "1": "stable", "2": "variable" },
        },
        {
          label: "For debt holder",
          path: "onBehalfOf",
          type: "address",
          format: "addressName",
          params: { types: ["eoa"], sources: ["local", "ens"] },
        },
        { label: "asset", path: "asset", type: "address" },
      ],
    });
  });
});
