# @sourcifyeth/clear-signing

> **⚠️ Work in Progress**: This repository is currently under active development. The README was AI-generated and has not been reviewed. It might contain examples that don't work as expected and features that are not yet fully implemented. What currently works can be seen in the test folder.

A TypeScript implementation of [ERC-7730: Structured Data Clear Signing Format](https://eips.ethereum.org/EIPS/eip-7730) for Ethereum transactions and EIP-712 typed data.

This library transforms raw transaction calldata and typed data into human-readable display models, enabling wallets to show users exactly what they're signing.

## Installation

```bash
npm install @sourcifyeth/clear-signing
```

## Quick Start

```typescript
import { format, formatTypedData } from "@sourcifyeth/clear-signing";

// Format an ERC-20 transfer transaction
const result = await format(
  {
    chainId: 1,
    to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    data:
      "0xa9059cbb" +
      "000000000000000000000000ab5801a7d398351b8be11c439e05c5b3259aec9" + // to
      "00000000000000000000000000000000000000000000000000000000000f4240", // value
  },
  {
    externalDataProvider: {
      resolveToken: async (chainId, address) => {
        // return token metadata from your wallet's token list
        return { name: "Tether USD", symbol: "USDT", decimals: 6 };
      },
    },
  },
);

console.log(result.intent); // "Send"
console.log(result.fields); // [{ label: "To", value: "0xAb5..." }, { label: "Amount", value: "1 USDT" }]
console.log(result.interpolatedIntent); // "Send 1 USDT to 0xAb5..."
```

## API Reference

### `format(tx, opts?)`

Resolves the descriptor for a transaction and returns a `DisplayModel` with human-readable information.

```typescript
async function format(
  tx: Transaction,
  opts?: FormatOptions,
): Promise<DisplayModel>;
```

```typescript
interface Transaction {
  chainId: number;
  to: string; // contract address
  data: string; // calldata as hex string
  value?: bigint; // native value in wei
  from?: string; // sender address
}
```

### `formatTypedData(typedData, opts?)`

Resolves the descriptor for an EIP-712 message and returns a `DisplayModel`.

```typescript
async function formatTypedData(
  typedData: TypedData,
  opts?: FormatOptions,
): Promise<DisplayModel>;
```

### `FormatOptions`

```typescript
interface FormatOptions {
  /**
   * Provides external data resolution (token metadata, ENS names, etc.).
   * When absent the library falls back to raw display for affected fields.
   */
  externalDataProvider?: ExternalDataProvider;

  /**
   * Controls where descriptors are fetched from.
   * Defaults to the GitHub registry when omitted.
   */
  descriptorResolverOptions?: GitHubResolverOptions | EmbeddedResolverOptions;

  /**
   * For proxy contracts: the resolved implementation address for descriptor lookup.
   * Proxy detection is left to the caller.
   */
  resolvedImplementationAddress?: string;
}
```

### `ExternalDataProvider`

The library delegates all external data resolution to the wallet. None of the methods are required.

```typescript
interface ExternalDataProvider {
  /** Resolve ENS name for an address. */
  resolveEnsName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;

  /** Resolve a locally known name for an address (e.g. from contacts). */
  resolveLocalName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;

  /** Resolve token metadata (symbol, decimals) for a contract address. */
  resolveToken?: (
    chainId: number,
    tokenAddress: string,
  ) => Promise<TokenResult | null>;

  /** Resolve NFT collection name for a contract address. */
  resolveNftCollectionName?: (
    collectionAddress: string,
  ) => Promise<NftCollectionNameResult | null>;
}
```

When `resolveToken` returns `null` or is absent, the library emits a `UNKNOWN_TOKEN` warning and falls back to the raw value. When address name resolution fails, it returns the checksum address with an `ADDRESS_NOT_RESOLVED` warning.

## Display Model

All format functions return a `DisplayModel`:

```typescript
interface DisplayModel {
  /**
   * Short description of the operation, e.g. "Approve token spending".
   */
  intent?: string | Record<string, string>;

  /**
   * Ordered list of labeled fields to show to the user.
   */
  fields?: DisplayField[];

  /**
   * Full sentence with field values interpolated in, e.g.
   * "Approve USDC spending up to 1,000 USDC for Uniswap V3".
   */
  interpolatedIntent?: string;

  /**
   * Additional metadata from the descriptor (owner, contract name, info URL).
   */
  metadata?: {
    owner?: string;
    contractName?: string;
    info?: { deploymentDate?: string; url?: string };
  };

  /**
   * Raw fallback when no descriptor matched or the descriptor was invalid.
   */
  rawCalldataFallback?: RawCalldataPreview;

  /**
   * Non-fatal warnings (e.g. token not resolved, address name not found).
   */
  warnings?: Warning[];
}

interface DisplayField {
  label: string; // e.g. "Spender"
  value: string; // e.g. "0xAb5..." or "1 USDT"
  fieldType: FieldType; // Solidity type category: "address", "uint", "int", "bool", "bytes", etc.
  format: string; // ERC-7730 format: "addressName", "tokenAmount", etc.
  warning?: Warning; // field-level warning (e.g. ADDRESS_NOT_RESOLVED)
  rawAddress?: string; // EIP-55 checksum address for address fields
}

interface Warning {
  code: WarningCode; // machine-readable code
  message: string; // human-readable message
}

type WarningCode =
  | "NO_DESCRIPTOR"
  | "DEPLOYMENT_MISMATCH"
  | "NO_FORMAT_MATCH"
  | "UNSUPPORTED_FIELD_GROUP"
  | "FIELD_RESOLUTION"
  | "MISSING_FIELD_VALUE"
  | "UNRESOLVABLE_FIELD_TYPE"
  | "INTERPOLATION_ERROR"
  | "UNKNOWN_TOKEN"
  | "ADDRESS_NOT_RESOLVED"
  | "ADDRESS_TYPE_MISMATCH";
```

## Descriptor Sources

Descriptors are fetched from the [Ledger clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) on GitHub by default.

### GitHub Registry (default)

```typescript
import type { GitHubResolverOptions } from "@sourcifyeth/clear-signing";

const result = await format(tx, {
  descriptorResolverOptions: {
    type: "github",
    repo: "LedgerHQ/clear-signing-erc7730-registry", // optional
    ref: "master", // optional
  },
});
```

### Custom Index

For testing or offline use, provide a `RegistryIndex` directly:

```typescript
import type { RegistryIndex } from "@sourcifyeth/clear-signing";

const index: RegistryIndex = {
  calldataIndex: {
    "eip155:1:0xdac17f958d2ee523a2206206994597c13d831ec7":
      "path/to/descriptor.json",
  },
  typedDataIndex: {},
};

const result = await format(tx, {
  descriptorResolverOptions: { type: "github", index },
});
```

### Known Limitation — EIP-712 Index Coverage

The GitHub index only keys EIP-712 descriptors on `context.eip712.deployments`. Descriptors that bind via `context.eip712.domain` or `context.eip712.domainSeparator` cannot be pre-indexed.

## Field Formats

| Format        | Description                                | Example Output                   |
| ------------- | ------------------------------------------ | -------------------------------- |
| `tokenAmount` | Token amount with decimals and symbol      | `1,000.5 USDT`                   |
| `amount`      | Native currency amount                     | `1.5 ETH`                        |
| `date`        | Unix timestamp as UTC date string          | `2024-01-15 12:30:00 UTC`        |
| `addressName` | Resolved name or checksum address          | `vitalik.eth` or `0xd8dA6BF2...` |
| `enum`        | Mapped enum value from descriptor metadata | `Buy` (from `0`)                 |
| `raw`         | Raw hex or string fallback                 | `0x1234abcd`                     |

## Browser & Node.js Support

This library works in both environments:

- **Node.js**: >= 18.0.0
- **Browsers**: All modern browsers (ES2020+)

No Node.js-specific APIs are used. Cryptographic operations use [@noble/hashes](https://github.com/paulmillr/noble-hashes).

## Development

```bash
npm install        # Install dependencies
npm run build      # Compile to dist/
npm test           # Run tests
npm run test:watch # Watch mode
```

## Related

- [EIP-7730 Specification](https://eips.ethereum.org/EIPS/eip-7730)
- [Ledger Clear Signing Registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry)

## License

MIT
