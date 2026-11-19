/**
 * Builder input models of the bundled ERC-20 descriptor, resolved through
 * `trustedTokens`, and calldata built from them.
 */

import { describe, it, expect, assert } from "vitest";
import { buildCalldata, getCalldataInputModels } from "../../src/builder.js";
import type { FormatOptions, TrustedTokens } from "../../src/types.js";
import { padAddr, padInt } from "../utils.js";

const CHAIN_ID = 1;
const TOKEN = "0xA0b86991c6218b36c1d19D4a2E9Eb0cE3606eB48";
const ALICE = "0x1234567890abcdef1234567890abcdef12345678";

const TRUSTED_ERC20: TrustedTokens = {
  [CHAIN_ID]: { [TOKEN.toLowerCase()]: "erc20" },
};

/** FormatOptions with an empty registry index (no network) + a trusted-token list. */
function opts(trustedTokens: TrustedTokens): FormatOptions {
  return {
    descriptorResolverOptions: {
      type: "github",
      index: { calldataIndex: {}, typedDataIndex: {} },
      trustedTokens,
    },
  };
}

describe("builder — bundled ERC-20 via trustedTokens", () => {
  it("lists the bundled ERC-20 functions as input models", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      TOKEN,
      opts(TRUSTED_ERC20),
    );

    expect(result).toEqual({
      models: [
        {
          signature: "transfer(address _to, uint256 _value)",
          selector: "0xa9059cbb",
          intent: "Send",
          fields: [
            {
              label: "Amount",
              path: "_value",
              type: "uint256",
              format: "tokenAmount",
              params: { tokenPath: "@.to" },
            },
            {
              label: "To",
              path: "_to",
              type: "address",
              format: "addressName",
              params: { types: ["eoa"], sources: ["local", "ens"] },
            },
          ],
        },
        {
          signature: "approve(address _spender, uint256 _value)",
          selector: "0x095ea7b3",
          intent: "Approve",
          fields: [
            {
              label: "Spender",
              path: "_spender",
              type: "address",
              format: "addressName",
              params: { types: ["eoa", "contract"] },
            },
            {
              label: "Amount",
              path: "_value",
              type: "uint256",
              format: "tokenAmount",
              params: {
                tokenPath: "@.to",
                threshold:
                  "0x8000000000000000000000000000000000000000000000000000000000000000",
              },
            },
          ],
        },
      ],
    });
    // The bundled template carries no metadata.
    expect(result.models?.[0].metadata).toBeUndefined();
  });

  it("builds transfer calldata from the input model", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      TOKEN,
      opts(TRUSTED_ERC20),
    );
    const model = result.models?.find((m) => m.selector === "0xa9059cbb");
    assert(model);

    const built = buildCalldata(model, { _to: ALICE, _value: 1_000_000n });
    assert("data" in built);
    expect(built.data).toBe("0xa9059cbb" + padAddr(ALICE) + padInt(1_000_000n));
  });

  it("returns NO_DESCRIPTOR when the token is not trusted", async () => {
    const result = await getCalldataInputModels(CHAIN_ID, TOKEN, opts({}));
    expect(result).toEqual({
      warnings: [
        {
          code: "NO_DESCRIPTOR",
          message: `No descriptor found for chain ${CHAIN_ID} and address ${TOKEN}`,
        },
      ],
    });
  });
});
