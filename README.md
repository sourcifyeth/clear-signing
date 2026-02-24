# @sourcifyeth/clear-signing

A TypeScript implementation of [ERC-7730: Structured Data Clear Signing Format](https://eips.ethereum.org/EIPS/eip-7730) for Ethereum transactions and EIP-712 typed data.

This library transforms raw transaction calldata and typed data into human-readable display models, enabling wallets to show users exactly what they're signing.

## Installation

```bash
npm install @sourcifyeth/clear-signing
```

## Quick Start

```typescript
import {
  format,
  formatTypedData,
  hexToBytes,
} from "@sourcifyeth/clear-signing";

// Format an ERC-20 approve transaction
const calldata = hexToBytes(
  "0x095ea7b3" + // approve(address,uint256) selector
    "000000000000000000000000e592427a0aece92de3edee1f18e0157c05861564" + // spender
    "00000000000000000000000000000000000000000000000000000000000f4240", // amount
);

const result = format(
  1, // chainId (Ethereum mainnet)
  "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT contract
  calldata,
);

console.log(result.intent); // "Approve USDT spending"
console.log(result.items); // [{ label: "Spender", value: "Uniswap V3 Router" }, { label: "Amount", value: "1 USDT" }]
```

## API Reference

### `format(chainId, to, calldata)`

Formats a transaction for clear signing display.

| Parameter  | Type         | Description                                     |
| ---------- | ------------ | ----------------------------------------------- |
| `chainId`  | `number`     | EIP-155 chain ID (e.g., 1 for Ethereum mainnet) |
| `to`       | `string`     | Target contract address                         |
| `calldata` | `Uint8Array` | Transaction calldata                            |

**Returns:** `DisplayModel`

```typescript
const result = format(
  1,
  "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  calldata,
);
```

### `formatWithValue(chainId, to, value, calldata)`

Formats a transaction including native token value (e.g., ETH being sent).

| Parameter  | Type                      | Description               |
| ---------- | ------------------------- | ------------------------- |
| `chainId`  | `number`                  | EIP-155 chain ID          |
| `to`       | `string`                  | Target contract address   |
| `value`    | `Uint8Array \| undefined` | Native token value in wei |
| `calldata` | `Uint8Array`              | Transaction calldata      |

**Returns:** `DisplayModel`

```typescript
const value = hexToBytes("0x0de0b6b3a7640000"); // 1 ETH
const result = formatWithValue(
  1,
  "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  value,
  calldata,
);
```

### `formatTypedData(data)`

Formats EIP-712 typed data for clear signing display.

| Parameter | Type        | Description                  |
| --------- | ----------- | ---------------------------- |
| `data`    | `TypedData` | EIP-712 typed data structure |

**Returns:** `DisplayModel`

```typescript
const typedData = {
  types: {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  },
  primaryType: "Permit",
  domain: {
    name: "MyToken",
    chainId: 1,
    verifyingContract: "0x...",
  },
  message: {
    owner: "0x...",
    spender: "0x...",
    value: "1000000",
    nonce: 0,
    deadline: 1234567890,
  },
};

const result = formatTypedData(typedData);
```

### Utility Functions

```typescript
import {
  hexToBytes,
  bytesToHex,
  toChecksumAddress,
} from "@sourcifyeth/clear-signing";

// Convert hex string to bytes
const bytes = hexToBytes("0x1234abcd");

// Convert bytes to hex string
const hex = bytesToHex(new Uint8Array([0x12, 0x34])); // '0x1234'

// Generate EIP-55 checksum address
const checksum = toChecksumAddress(addressBytes);
```

## Display Model

All format functions return a `DisplayModel`:

```typescript
interface DisplayModel {
  intent: string; // Human-readable intent (e.g., "Approve USDT spending")
  interpolatedIntent?: string; // Intent with interpolated values (e.g., "Approve Uniswap V3 Router to spend 1 USDT")
  items: DisplayItem[]; // Labeled field values
  warnings: string[]; // Any warnings during formatting
  raw?: RawPreview; // Raw fallback if no descriptor matches
}

interface DisplayItem {
  label: string; // Field label (e.g., "Spender", "Amount")
  value: string; // Formatted value (e.g., "Uniswap V3 Router", "1 USDT")
}

interface RawPreview {
  selector: string; // Function selector (e.g., "0x095ea7b3")
  args: string[]; // Raw argument words as hex
}
```

## Supported Contracts

The library includes descriptors for popular contracts:

| Protocol          | Contracts                                        |
| ----------------- | ------------------------------------------------ |
| **ERC-20 Tokens** | USDT, USDC (multiple chains)                     |
| **Uniswap**       | V3 Router, Permit2 (EIP-712)                     |
| **1inch**         | Aggregation Router V3-V6, Limit Orders (EIP-712) |
| **Aave**          | Lending Pool V2/V3, WETH Gateway                 |
| **WETH**          | WETH9 (wrap/unwrap)                              |
| **WalletConnect** | Staking contracts                                |

### Supported Chains

- Ethereum Mainnet (1)
- Optimism (10)
- Polygon (137)
- Arbitrum (42161)
- Base (8453)
- And more...

## Field Formats

The library supports these EIP-7730 field formats:

| Format        | Description                           | Example Output                               |
| ------------- | ------------------------------------- | -------------------------------------------- |
| `tokenAmount` | Token amount with decimals and symbol | `1,000.5 USDT`                               |
| `amount`      | Native currency amount                | `1.5 ETH`                                    |
| `date`        | Unix timestamp                        | `2024-01-15 12:30:00 UTC`                    |
| `address`     | EIP-55 checksum address               | `0xdAC17F958D2ee523a2206206994597C13D831ec7` |
| `addressName` | Resolved name or checksum             | `Uniswap V3 Router`                          |
| `enum`        | Mapped enum value                     | `Buy` (from `0`)                             |
| `number`      | Plain number                          | `42`                                         |
| `raw`         | Raw hex or string                     | `0x1234...`                                  |

## Error Handling

The library throws typed errors:

```typescript
import {
  ResolverError,
  EngineError,
  Eip712Error,
} from "@sourcifyeth/clear-signing";

try {
  const result = format(1, "0x...", calldata);
} catch (e) {
  if (e instanceof ResolverError) {
    // No descriptor found for this contract
    console.log("Unknown contract:", e.message);
  } else if (e instanceof EngineError) {
    // Calldata decoding or formatting failed
    console.log("Format error:", e.message);
  }
}
```

## Browser & Node.js Support

This library works in both environments:

- **Node.js**: >= 18.0.0
- **Browsers**: All modern browsers (ES2020 support required)

No Node.js-specific APIs are used. Cryptographic operations use [@noble/hashes](https://github.com/paulmillr/noble-hashes) which is browser-compatible.

## Descriptor Sources

By default, the library fetches descriptors from the [Ledger clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) on GitHub. You can customise this or provide descriptors inline.

### GitHub Registry (default)

```typescript
import { format } from "@sourcifyeth/clear-signing";
import type { GitHubRegistrySource } from "@sourcifyeth/clear-signing";

const source: GitHubRegistrySource = {
  type: "github",
  repo: "LedgerHQ/clear-signing-erc7730-registry", // optional
  ref: "master",                                     // optional
};

const result = format(1, "0x...", calldata, { source });
```

On first use, the library fetches the full file tree from the GitHub API and indexes all `calldata-*.json` and `eip712-*.json` descriptor files. Subsequent calls within the same process use the in-memory index.

### Inline Descriptors

Supply a descriptor directly without any network I/O — useful for testing and self-contained integrations:

```typescript
import type { InlineDescriptorSource } from "@sourcifyeth/clear-signing";

const source: InlineDescriptorSource = {
  type: "inline",
  descriptor: myDescriptor,
  // Optional: provide include files referenced by descriptor.includes
  includes: {
    "../../ercs/calldata-erc20-tokens.json": includeDescriptor,
  },
};
```

### Known Limitation — EIP-712 Index Coverage

ERC-7730 supports three ways for an EIP-712 descriptor to declare which contracts it applies to:

- `context.eip712.deployments` — an array of `{ chainId, address }` pairs
- `context.eip712.domain` — key-value domain constraints (e.g. `name`, `version`)
- `context.eip712.domainSeparator` — a pre-computed domain separator hash

The GitHub registry index only keys on `context.eip712.deployments`. Descriptors that rely solely on `domain` or `domainSeparator` for binding cannot be pre-indexed without access to a live EIP-712 domain. Additionally, only one descriptor per `(chainId, verifyingContract)` pair is indexed — the first one encountered wins.

## Adding Custom Descriptors

The library ships with embedded descriptors. To add support for additional contracts, you would need to:

1. Create an EIP-7730 compliant descriptor JSON
2. Add the descriptor and ABI to the assets
3. Update the resolver index

See the [EIP-7730 specification](https://eips.ethereum.org/EIPS/eip-7730) for descriptor format details.

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode for tests
npm run test:watch
```

## Related

- [EIP-7730 Specification](https://eips.ethereum.org/EIPS/eip-7730)
- [Original Rust Implementation](https://github.com/reown-com/yttrium/tree/main/crates/yttrium/src/clear_signing)

## License

MIT
