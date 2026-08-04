import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const API_KEY = process.env.ETHERSCAN_API_KEY;
if (!API_KEY) {
  console.error("Please set ETHERSCAN_API_KEY environment variable");
  process.exit(1);
}

const MULTISEND_ADDRESSES = [
  "0x40A2aCCbd92BCA938b02010E17A5b8929b49130D", // MultiSend (1.3.0)
  "0xA238CBeb142c10Ef7Ad8442C6D1f9E89e07e7761", // MultiSendCallOnly (1.3.0)
];

const MULTISEND_SELECTOR = "0x8d80ff0a"; // multiSend(bytes)

async function fetchCorpus(chainId) {
  const corpus = [];

  for (const address of MULTISEND_ADDRESSES) {
    console.log(`Fetching txs for ${address} on chain ${chainId}...`);
    const url = `https://api.etherscan.io/v2/api?chainid=${chainId}&module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=100&sort=desc&apikey=${API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "1") {
      console.warn(
        `API Error for ${address} on chain ${chainId}: ${data.message} - ${data.result}`,
      );
      continue;
    }

    for (const tx of data.result) {
      if (tx.isError === "0" && tx.input.startsWith(MULTISEND_SELECTOR)) {
        corpus.push({
          chainId,
          hash: tx.hash,
          to: tx.to,
          input: tx.input,
        });
      }
    }
  }

  return corpus;
}

async function main() {
  const mainnet = await fetchCorpus(1);
  const base = await fetchCorpus(8453);
  const arbitrum = await fetchCorpus(42161);

  const allTxs = [...mainnet, ...base, ...arbitrum];
  // Select distinct txs with varying lengths (randomized or just slice)
  // Let's just shuffle and take ~40
  allTxs.sort(() => Math.random() - 0.5);
  const selected = allTxs.slice(0, 40);

  const outPath = resolve(process.cwd(), "test/fixtures/multisend-corpus.json");
  await writeFile(outPath, JSON.stringify(selected, null, 2));
  console.log(`Saved ${selected.length} transactions to ${outPath}`);
}

main().catch(console.error);
