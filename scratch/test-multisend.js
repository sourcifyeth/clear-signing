import { format } from "../src/index.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFilesystemResolverOpts } from "../test/utils.js";

async function main() {
  const corpus = JSON.parse(
    readFileSync("test/fixtures/multisend-corpus.json", "utf-8"),
  );

  const opts = buildFilesystemResolverOpts(
    resolve(process.cwd(), "test/erc7730-test-cases"),
    {
      calldataDescriptorFiles: [
        {
          chainId: 1,
          address: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
          file: "example-safe-multisend.json",
        },
        {
          chainId: 1,
          address: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761",
          file: "example-safe-multisend.json",
        },
        {
          chainId: 42161,
          address: "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D",
          file: "example-safe-multisend.json",
        },
        {
          chainId: 42161,
          address: "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761",
          file: "example-safe-multisend.json",
        },
      ],
    },
  );

  const result = await format(
    {
      chainId: corpus[0].chainId,
      to: corpus[0].to,
      data: corpus[0].input,
    },
    opts,
  );
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);
