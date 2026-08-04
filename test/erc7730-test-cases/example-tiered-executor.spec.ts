import { describe, it, expect } from "vitest";
import { format } from "../../src/index.js";
import type {
  FormatOptions,
  Descriptor,
  Transaction,
} from "../../src/types.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const descriptorJson = JSON.parse(
  readFileSync(resolve(__dirname, "example-tiered-executor.json"), "utf8"),
) as Descriptor;
const targetDescriptorJson = JSON.parse(
  readFileSync(resolve(__dirname, "example-target-descriptor.json"), "utf8"),
) as Descriptor;

const mockResolverOptions: FormatOptions["descriptorResolverOptions"] = {
  type: "custom",
  resolver: {
    index: {
      calldataIndex: {
        "eip155:1:0xexecutor": "tiered-executor.json",
        "eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045":
          "target-descriptor.json",
      },
      typedDataIndex: {},
    },
    fetchDescriptor: async (path) =>
      path === "target-descriptor.json"
        ? targetDescriptorJson
        : ({
            ...descriptorJson,
            context: {
              ...descriptorJson.context,
              contract: {
                ...descriptorJson.context?.contract,
                deployments: [{ chainId: 1, address: "0xexecutor" }],
              },
            },
          } as Descriptor),
  },
};

describe("example-tiered-executor (Top-level Switch & Interaction)", () => {
  it("resolves interaction for grantReward", async () => {
    // We need to encode the call to execute(uint8 action, bytes data)
    // action = 0 -> grantReward
    // data = encode(address, uint256)

    // We can just construct a synthetic calldata hex.
    // execute(uint8,bytes) selector = 0xb61d27f6
    const actionHex =
      "0000000000000000000000000000000000000000000000000000000000000001";
    const addr =
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045";
    const amt =
      "0000000000000000000000000000000000000000000000000000000000000100";

    const target =
      "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045";
    const calldata = "0x512ccc67" + target + actionHex + addr + amt;

    const tx: Transaction = {
      chainId: 1,
      to: "0xexecutor",
      data: calldata,
      value: 0n,
    };

    const result = await format(tx, {
      descriptorResolverOptions: mockResolverOptions,
    });
    expect(result.warnings).toBeUndefined();
    expect(result.intent).toBe("Grant Reward");
    expect(result.fields).toBeDefined();
    expect(
      result.fields?.[1] && "value" in result.fields[1]
        ? result.fields[1].value
        : undefined,
    ).toBe("1000000000000000000");
    expect(
      result.fields?.[0] && "value" in result.fields[0]
        ? result.fields[0].value
        : undefined,
    ).toBe("0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  });
});
