import { format } from "../src/index.js";
import { readFileSync } from "fs";
import { resolve } from "path";
import corpus from "../test/fixtures/bulker-corpus.json";

const bulkerDescriptor = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      "test/erc7730-test-cases/example-compound-bulker.json",
    ),
    "utf8",
  ),
);
const cometDescriptor = {
  $schema: "https://eips.ethereum.org/assets/eip-7730/erc7730-v1.schema.json",
  context: {
    contract: {
      deployments: [
        { chainId: 1, address: "0xc3d688B66703497DAA19211EEdff47f25384cdc3" },
      ],
    },
  },
  display: {
    formats: {
      "supplyFrom(address from,address to,address asset,uint256 amount)": {
        intent: "Supply asset",
        fields: [{ path: "to", label: "To", format: "addressName" }],
      },
    },
  },
};

const mockResolverOptions = {
  type: "custom",
  resolver: {
    index: {
      calldataIndex: {
        "eip155:1:0xa397a8C2086C554B531c02E29f3291c9704B00c7": "bulker.json",
        "eip155:1:0xa397a8c2086c554b531c02e29f3291c9704b00c7": "bulker.json",
        "eip155:1:0xc3d688B66703497DAA19211EEdff47f25384cdc3": "comet.json",
      },
      typedDataIndex: {},
    },
    fetchDescriptor: async (path) =>
      path === "comet.json" ? cometDescriptor : bulkerDescriptor,
  },
};

const tx = { chainId: 1, to: corpus[0].to, data: corpus[0].input, value: 0n };
format(tx, { descriptorResolverOptions: mockResolverOptions }).then((res) =>
  console.log(JSON.stringify(res, null, 2)),
);
