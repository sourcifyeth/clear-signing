import { format } from "../src/index.js";
import { createFilesystemResolver } from "../src/filesystem.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function fetchTx(hash: string) {
  const rpcUrl = "https://eth.merkle.io";
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
    chainId: parseInt(data.result.chainId || "0x1", 16),
    to: data.result.to,
    data: data.result.input,
    value: BigInt(data.result.value),
  };
}

async function run() {
  const txHash = process.argv[2];
  if (!txHash) {
    console.log("Usage: npx tsx scratch/test-tx.ts <tx-hash>");
    return;
  }

  const tx = await fetchTx(txHash);
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
      }),
      trustedTokens: {
        [tx.chainId]: {
          "0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b": "erc20",
          "0x6b175474e89094c44da98b954eedeac495271d0f": "erc20",
          "0x3432b6a60d23ca0dfca7761b7ab56459d9c964d0": "erc20",
          "0x2e9d63788249371f1dfc918a52f8d799f4a38c94": "erc20",
          "0xa693b19d2931d498c5b318df961919bb4aee87a5": "erc20"
        }
      }
    },
    externalDataProvider: {
      async resolveToken() { 
        return { name: "MockToken", symbol: "MTK", decimals: 18 }; 
      },
      async resolveLocalName() { 
        return { name: "Mock Local Name", typeMatch: true }; 
      },
      async resolveEnsName() { 
        return { name: "mock.eth", typeMatch: true }; 
      },
      async resolveChainInfo() { 
        return { name: "Mock Chain", nativeCurrency: { name: "Mock Ether", symbol: "METH", decimals: 18 } }; 
      },
      async resolveBlockTimestamp() { 
        return 1700000000; 
      },
      async resolveNftCollectionName() { 
        return "Mock NFT Collection"; 
      },
    }
  });

  console.log("\n--- RESULT ---");
  console.log(JSON.stringify(result, (key, value) => 
    typeof value === "bigint" ? value.toString() + "n" : value
  , 2));
}

run().catch(console.error);
