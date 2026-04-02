# @sourcifyeth/clear-signing

This library transforms raw transaction calldata and typed data into human-readable display models, enabling wallets to show users exactly what they're signing.

<!--
## Installation

```bash
npm install @sourcifyeth/clear-signing
``` -->

## Quick Start

```typescript
import {
  format,
  formatTypedData,
  createGitHubRegistryIndex,
} from "@sourcifyeth/clear-signing";

// Build the registry index once at app build time or startup.
// This fetches the descriptor file tree from GitHub and indexes it
// so that subsequent format() calls don't need to re-fetch it.
const index = await createGitHubRegistryIndex();

// Format an ERC-20 approve transaction
const result = await format(
  {
    chainId: 1,
    to: "0xdAC17F958D2ee523a2206206994597C13D831ec7", // USDT
    data:
      "0x095ea7b3" +
      "0000000000000000000000001234567890abcdef1234567890abcdef12345678" + // spender
      "00000000000000000000000000000000000000000000000000000000000f4240", // value
  },
  {
    descriptorResolverOptions: { type: "github", index },
    externalDataProvider: {
      resolveToken: async (chainId, address) => {
        // return token metadata from your wallet's token list
        // or call the ERC-20 methods on-chain
        return { name: "Tether USD", symbol: "USDT", decimals: 6 };
      },
    },
  },
);

console.log(result.intent); // "Approve"
console.log(result.fields); // [{ label: "Spender", value: "0x1234..." }, { label: "Amount", value: "1 USDT" }]
console.log(result.interpolatedIntent); // "Approve 1 USDT to 0x1234..."
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
  to: string;
  data: string; // calldata as hex string
  value?: bigint;
  from?: string;
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

```typescript
interface TypedData {
  account: string; // signer address
  types: Record<string, TypeMember[]>;
  primaryType: string;
  domain: TypedDataDomain;
  message: Record<string, unknown>;
}
```

### `FormatOptions`

```typescript
interface FormatOptions {
  /**
   * Wallets should provide an object with async methods to resolve
   * external data like ENS names, token metadata, and NFT collection
   * names. The provided functions may use RPC calls or fetch data
   * from internal sources. This allows the library to remain
   * agnostic about how this data is fetched. If absent, the library
   * will fall back to raw formats for the corresponding fields.
   */
  externalDataProvider?: ExternalDataProvider;

  /**
   * Controls where descriptors are fetched from.
   * Defaults to the GitHub registry when omitted.
   * Also allows to pass descriptors directly via the `embedded` option.
   */
  descriptorResolverOptions?: GitHubResolverOptions | EmbeddedResolverOptions;

  /**
   * For proxy contracts: the resolved implementation address to use for
   * descriptor lookup. If present the library will use this address to
   * resolve the descriptor instead of `tx.to`.
   * This leaves proxy detection up to the user of the library.
   */
  resolvedImplementationAddress?: string;
}
```

### `ExternalDataProvider`

The library delegates all external data resolution to the wallet. The wallet may use RPC calls to resolve the data.

```typescript
interface ExternalDataProvider {
  /**
   * Resolution for addressName formats. The wallet must verify if the
   * address matches the provided type (e.g., "eoa", "contract", ...)
   * if able to. If the type does not match, the wallet should indicate
   * this in the result, such that the library can include a warning
   * about the resolved field in the DisplayModel.
   */
  resolveLocalName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;
  /**
   * Resolution for addressName formats. The wallet must verify if the
   * address matches the provided type (e.g., "eoa", "contract", ...)
   * if able to. If the type does not match, the wallet should indicate
   * this in the result, such that the library can include a warning
   * about the resolved field in the DisplayModel.
   */
  resolveEnsName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;

  /** Resolution for tokenAmount formats. */
  resolveToken?: (
    chainId: number,
    tokenAddress: string,
  ) => Promise<TokenResult | null>;

  /** Resolution for nftName formats. */
  resolveNftCollectionName?: (
    chainId: number,
    collectionAddress: string,
  ) => Promise<NftCollectionNameResult | null>;

  /** Resolution for date format with blockheight encoding. */
  resolveBlockTimestamp?: (
    chainId: number,
    blockHeight: bigint,
  ) => Promise<BlockTimestampResult | null>;
}
```

### Descriptor Sources

Descriptors are fetched from the [Ledger clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) on GitHub by default.

#### GitHub Registry (default)

```typescript
import { format } from "@sourcifyeth/clear-signing";

const result = await format(tx, {
  descriptorResolverOptions: {
    type: "github",
    githubSource: {
      repo: "LedgerHQ/clear-signing-erc7730-registry", // default
      ref: "master", // default
    },
  },
});
```

#### Embedded Descriptors

For bundled descriptors or testing, build your own index and descriptors will be loaded via JS module resolution:

```typescript
import { format } from "@sourcifyeth/clear-signing";
import type { RegistryIndex } from "@sourcifyeth/clear-signing";

const index: RegistryIndex = {
  calldataIndex: {
    "eip155:1:0xdac17f958d2ee523a2206206994597c13d831ec7":
      "path/to/descriptor.json",
  },
  typedDataIndex: {},
};

const result = await format(tx, {
  descriptorResolverOptions: {
    type: "embedded",
    index,
    descriptorDirectory: "./descriptors",
  },
});
```

### Display Model

All format functions return a `DisplayModel`:

```typescript
/**
 * The complete display model produced by the library.
 *
 * According to ERC-7730, wallets have two display options:
 *   1. Show `intent` as an explanation what the contract call does, and
 *      `fields` as a list of labeled values representing the calldata parameters.
 *   2. Show `interpolatedIntent` as a short string presentation of intent and fields,
 *      which already has formatted field values embedded in it — in this case
 *      `fields` can be omitted or shown as supplementary detail.
 *
 * When interpolation fails or is not defined, wallets should fall back to Option 1.
 */
interface DisplayModel {
  /**
   * The intent from the resolved descriptor, representing a short
   * description of the operation, e.g. "Approve token spending".
   * Two possible forms:
   *   - A simple human-readable string
   *   - A list of human-readable key-value pairs
   */
  intent?: string | Record<string, string>;

  /**
   * Ordered list of fields to show to the user,
   * formatted according to their field format specification.
   */
  fields?: (DisplayField | DisplayFieldGroup)[];

  /**
   * Full sentence with formatted field values interpolated in, e.g.
   * "Approve USDC spending up to 1,000 USDC for Uniswap V3".
   * Absent when the descriptor does not define an interpolatedIntent,
   * or when interpolation fails.
   */
  interpolatedIntent?: string;

  /**
   * Additional metadata directly from the resolved descriptor.
   * Wallets may choose to display these items to provide additional
   * context about the contract being interacted with.
   */
  metadata?: {
    owner?: string;
    contractName?: string;
    info?: { deploymentDate?: string; url?: string };
  };

  /**
   * Raw calldata fallback when no descriptor matched or the descriptor was faulty.
   * Only present for calldata formatting — not applicable to EIP-712 typed data.
   */
  rawCalldataFallback?: RawCalldataFallback;

  /**
   * Non-fatal warnings providing additional context, e.g. why
   * interpolation failed or why a field could not be formatted.
   */
  warnings?: Warning[];
}
```

See `src/types.ts` for the full type definitions.

## Known Limitation — EIP-712 Index Coverage

The GitHub index only keys EIP-712 descriptors on `context.eip712.deployments`. Descriptors that bind via `context.eip712.domain` or `context.eip712.domainSeparator` cannot be pre-indexed.

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
