import type { DisplayField } from "../../src/types.js";
import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index.js";
import type { DisplayModel, FormatOptions } from "../../src/types.js";
import { buildFilesystemResolverOpts } from "../utils.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";



function buildOpts(): FormatOptions {
  return buildFilesystemResolverOpts(__dirname, {
    calldataDescriptorFiles: [
      {
        chainId: 1, // Will map properly in the mock descriptor matching for 1 and 42161 by just copying the deployments
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
  });
}

describe("example-safe-multisend.json (E2E corpus test)", () => {
  let corpus: Array<{
    chainId: number;
    hash: string;
    to: string;
    input: string;
  }>;
  try {
    const data = readFileSync(
      resolve(__dirname, "../fixtures/multisend-corpus.json"),
      "utf-8",
    );
    corpus = JSON.parse(data);
  } catch {
    corpus = [];
  }

  const opts = buildOpts();

  it("should have a corpus to test against", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const tx of corpus) {
    it(`formats tx ${tx.hash} on chain ${tx.chainId} successfully`, async () => {
      const result: DisplayModel = await format(
        {
          chainId: tx.chainId,
          to: tx.to,
          data: tx.input,
          value: 0n,
        },
        opts,
      );

      // Top level intent check
      if (result.intent !== "Execute batch") {
        console.log(JSON.stringify(result, null, 2));
      }
      expect(result.intent).toBe("Execute batch");

      // Verify that the fields parsed successfully (the sequence of batched calls)
      assert(result.fields);
      expect(result.fields.length).toBe(1);

      const transactionsField = result.fields[0];
      assert(isFieldGroup(transactionsField));
      expect(transactionsField.label).toBe("Batched calls");

      // Every element in the sequence should produce fields (like `data`)
      expect(transactionsField.fields).toBeDefined();
      expect(transactionsField.fields.length).toBeGreaterThan(0);

      // Ensure that we parsed the batched call data fields
      const dataFields = transactionsField.fields.filter(
        (f) =>
          !("fields" in f) && (f as DisplayField).label === "Batched call data",
      );
      expect(dataFields.length).toBeGreaterThan(0);
    });
  }
});
