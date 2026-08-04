import { format } from "../src/index.js";
import { readFileSync } from "fs";
import { resolve } from "path";

const descriptorJson = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "test/erc7730-test-cases/example-tiered-executor.json",
    ),
    "utf8",
  ),
);

const mockResolverOptions = {
  type: "custom",
  resolver: {
    index: {
      calldataIndex: { "eip155:1:0xexecutor": "tiered-executor.json" },
      typedDataIndex: {},
    },
    fetchDescriptor: async () => ({
      ...descriptorJson,
      context: {
        ...descriptorJson.context,
        contract: {
          ...descriptorJson.context?.contract,
          deployments: [{ chainId: 1, address: "0xexecutor" }],
        },
      },
    }),
  },
};

const actionHex =
  "0000000000000000000000000000000000000000000000000000000000000001";
const addr = "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045";
const amt = "0000000000000000000000000000000000000000000000000000000000000100";
const target =
  "0000000000000000000000000000000000000000000000000000000000000000";
const calldata = "0x512ccc67" + target + actionHex + addr + amt;

format(
  { chainId: 1, to: "0xexecutor", data: calldata, value: 0n },
  { descriptorResolverOptions: mockResolverOptions },
).then((res) => console.log(JSON.stringify(res, null, 2)));
