import { format } from "../src/index.js";
import * as fs from "fs";
import { resolveCalldataDescriptor } from "../src/resolver.js";
import { createFilesystemResolver } from "@ethereum-sourcify/clear-signing/filesystem";

async function run() {
  const descriptorStr = fs.readFileSync(
    "test/erc7730-test-cases/example-safe-multisend.json",
    "utf8",
  );
  const descriptor = JSON.parse(descriptorStr);
  const tx = {
    chainId: 1,
    to: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
    data: "0x8d80ff0a0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000006900a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044a9059cbb000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa960450000000000000000000000000000000000000000000000000de0b6b3a764000000",
  };

  const result = await format(tx, {
    descriptorResolverOptions: {
      type: "custom",
      resolver: {
        resolve: async () => ({ descriptor }),
        index: null as any,
        fetchDescriptor: async () => ({ descriptor }),
      },
    },
  });

  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
