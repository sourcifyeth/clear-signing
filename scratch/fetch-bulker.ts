import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { selectorForSignature, bytesToHex } from "../src/utils.js";

const API_KEY = process.env.ETHERSCAN_API_KEY;
if (!API_KEY) {
  console.error("Please set ETHERSCAN_API_KEY environment variable");
  process.exit(1);
}

const BULKER_ADDRESS = "0xa397a8C2086C554B531c02E29f3291c9704B00c7"; // Compound III Bulker on Mainnet
const SELECTOR = bytesToHex(selectorForSignature("invoke(bytes32[],bytes[])"));

async function fetchCorpus(chainId: number) {
  const corpus: any[] = [];
  console.log(
    `Fetching txs for ${BULKER_ADDRESS} on chain ${chainId} with selector ${SELECTOR}...`,
  );
  const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist&address=${BULKER_ADDRESS}&startblock=0&endblock=99999999&page=1&offset=200&sort=desc&apikey=${API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "1") {
    console.warn(`API Error: ${data.message} - ${data.result}`);
    return corpus;
  }

  for (const tx of data.result) {
    if (tx.isError === "0" && tx.input.startsWith(SELECTOR)) {
      corpus.push({
        chainId,
        hash: tx.hash,
        to: tx.to,
        input: tx.input,
      });
    }
  }
  return corpus;
}

async function main() {
  const mainnet = await fetchCorpus(1);
  const allTxs = [...mainnet];
  allTxs.sort(() => Math.random() - 0.5);
  const selected = allTxs.slice(0, 40);

  const outPath = resolve(process.cwd(), "test/fixtures/bulker-corpus.json");
  await writeFile(outPath, JSON.stringify(selected, null, 2));
  console.log(`Saved ${selected.length} transactions to ${outPath}`);
}

main().catch(console.error);
