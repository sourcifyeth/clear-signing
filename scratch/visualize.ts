import { format } from "../src/index.js";
import { createFilesystemResolver } from "../src/filesystem.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
import { exec } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const rpcUrls: Record<number, string> = {
  1: "https://eth.merkle.io",
  10: "https://mainnet.optimism.io",
  137: "https://polygon-rpc.com",
  8453: "https://mainnet.base.org",
  42161: "https://arb1.arbitrum.io/rpc",
  100: "https://rpc.gnosischain.com"
};

async function fetchTx(hash: string, chainId: number) {
  const rpcUrl = rpcUrls[chainId];
  if (!rpcUrl) throw new Error(`Unsupported chain ID ${chainId}. Add an RPC URL for it.`);

  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_getTransactionByHash",
      params: [hash],
      id: 1,
    }),
  });

  if (!response.ok) throw new Error(`Failed to fetch from RPC: ${response.statusText}`);

  const data = await response.json();
  if (!data.result) throw new Error(`Transaction ${hash} not found.`);

  return {
    chainId: chainId,
    to: data.result.to,
    data: data.result.input,
    value: BigInt(data.result.value),
    from: data.result.from,
  };
}

async function run() {
  const args = process.argv.slice(2);
  const txHash = args[0];
  const chainId = parseInt(args[1] || "1", 10);

  if (!txHash) {
    console.error("Usage: npm run visualize <txHash> [chainId]");
    process.exit(1);
  }

  console.log(`Fetching tx ${txHash} on chain ${chainId}...`);
  const tx = await fetchTx(txHash, chainId);
  console.log(`Formatting transaction for contract ${tx.to}...`);

  const rootDir = join(__dirname, "../");
  const result = await format(tx, {
    descriptorResolverOptions: {
      type: "custom",
      resolver: createFilesystemResolver({
        descriptorDirectory: join(rootDir, "test", "erc7730-test-cases"),
        index: {
          calldataIndex: {
            "eip155:1:0x40a2accbd92bca938b02010e17a5b8929b49130d": "example-safe-multisend.json",
            "eip155:1:0x9538d438d506fc426db37fb83dac2a0752a02757": "safe-exec.json",
            "eip155:1:0xb63cac384247597756545b500253ff8e607a8020": "stub-all.json",
            "eip155:1:0x96f98ed74639689c3a11daf38ef86e59f43417d3": "stub-all.json",
            "eip155:1:0x482258099de8de2d0bda84215864800ea7e6b03d": "stub-all.json",
          },
          typedDataIndex: {}
        }
      })
    },
    trustedTokens: {
      [tx.chainId]: {
        "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b": "erc20",
        "0x6b175474e89094c44da98b954eedeac495271d0f": "erc20",
        "0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0": "erc20",
        "0x2e9d63788249371f1dfc918a52f8d799f4a38c94": "erc20",
        "0xa693b19d2931d498c5b318df961919bb4aee87a5": "erc20"
      }
    },
    externalDataProvider: {
      async resolveToken() { return { name: "MockToken", symbol: "MTK", decimals: 18 }; },
      async resolveLocalName() { return { name: "Mock Local Name", typeMatch: true }; },
      async resolveEnsName() { return { name: "mock.eth", typeMatch: true }; },
      async resolveChainInfo() { return { name: "Mock Chain", nativeCurrency: { name: "Mock Ether", symbol: "METH", decimals: 18 } }; },
      async resolveBlockTimestamp() { return 1700000000; },
      async resolveNftCollectionName() { return "Mock NFT Collection"; },
    }
  });

  const jsonStr = JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  const dataJsPath = join(__dirname, "data.js");
  writeFileSync(dataJsPath, `window.__INCEPTION_DATA__ = ${jsonStr};`);
  console.log(`Saved output to scratch/data.js`);

  const guiPath = join(__dirname, "gui.html");
  let openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${openCmd} "file://${guiPath}"`, (err) => {
    if (err) console.error("Failed to open browser:", err);
    else console.log("Opened GUI in browser.");
  });
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
