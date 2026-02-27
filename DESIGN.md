# Clear Signing TypeScript Library Design

## Overview

`@sourcifyeth/clear-signing` is a TypeScript library that implements [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) — the Structured Data Clear Signing Format for Ethereum. It transforms raw transaction calldata and EIP-712 typed data into human-readable display models that wallets can show to users before they sign.

## Goals

This library is a reference implementation intended to be used directly in web-based wallets.

1. **Usable out of the box** — connecting to the GitHub registry requires zero configuration.
2. **Flexible descriptor sources** — by default the library indexes the GitHub registry to resolve descriptors at runtime, but wallets can provide their own descriptors at build time or at runtime. The registry index itself can also be pre-built and bundled to avoid the initial network round-trip.
3. **Minimal dependencies** — only `@noble/hashes` for keccak256. No Node.js-only APIs; targets modern browser environments.
4. **Clear, typed output** — the `DisplayModel` type is the single return value for both calldata and EIP-712 formatting. Wallets consume it directly with no further parsing.
5. **Graceful degradation** — when no descriptor exists, the library returns a raw fallback preview rather than throwing, so wallets can always show _something_.
6. **Full ERC-7730 field format coverage** — all field formats defined in the ERC-7730 spec will be implemented.
7. **Transpilable** — the implementation serves as a well-structured source for AI-assisted transpilation into other languages (Rust, Swift, Kotlin, etc.) used by native wallet clients.

## Usage Flow

```
Wallet code
    │
    ▼
format(tx) / formatTypedData(typedData)   ← async: resolves descriptor + formats
    │
    ▼
DisplayModel  →  Wallet UI
```

## Public API

### Formatting Functions

#### `format(tx, opts?)`

Resolves the descriptor for a transaction and returns a `DisplayModel` with human-readable information.

```typescript
async function format(
  tx: Transaction,
  opts?: FormatOptions,
): Promise<DisplayModel>;
```

#### `formatTypedData(typedData, opts?)`

Resolves the descriptor for an EIP-712 message and returns a `DisplayModel` with human-readable information.

```typescript
async function formatTypedData(
  typedData: TypedData,
  opts?: FormatOptions,
): Promise<DisplayModel>;
```

### Display Types

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
   * */
  intent?: string | Record<string, string>;

  /**
   * Ordered list of fields to show to the user,
   * formatted according to their field format specification.
   */
  fields?: DisplayField[];

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
   * Raw fallback data when no descriptor matched,
   * or the descriptor was faulty.
   */
  raw?: RawPreview;

  /**
   * Non-fatal warnings providing additional context, e.g. why
   * interpolation failed or why a field could not be formatted.
   */
  warnings?: Warning[];
}

/** A single labeled field to display to the user. */
interface DisplayField {
  label: string; // e.g. "Spender"
  value: string; // e.g. "vitalik.eth"

  /**
   * For example for externally resolved data, wallets should display
   * a warning when encountering unknown entities.
   */
  warning?: Warning;

  /**
   * For formatted addresses, wallets should also display the raw
   * value in some form.
   */
  rawAddress?: string;
}

interface RawPreview {
  selector: string; // "0x095ea7b3"
  args: string[]; // hex-encoded ABI arguments
}

interface Warning {
  code: string; // machine-readable warning code
  message: string; // human-readable warning message
}
```

### Container Types

```typescript
interface Transaction {
  chainId: number;
  to: string;
  data: string; // calldata to be formatted as hex string
  value?: bigint;
  from?: string;
}

interface TypedData {
  account: string;
  domain: TypedDataDomain;
  types: Record<string, TypeMember[]>;
  primaryType: string;
  message: Record<string, unknown>;
}
```

### Options

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
   * Will also allow to pass descriptors directly.
   */
  resolver?: unknown; // to be defined

  /**
   * For proxy contracts: the resolved implementation address to use for
   * descriptor lookup. If present the library will use this address to
   * resolve the descriptor instead of `tx.to`.
   * This leaves proxy detection up to the user of the library.
   */
  resolvedImplementationAddress?: string;
}

interface ExternalDataProvider {
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
  resolveLocalName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;

  /** Resolution for tokenAmount formats. */
  resolveToken?: (
    chainId: number,
    tokenAddress: string,
  ) => Promise<{ name: string; symbol: string; decimals: number } | null>;

  /** Resolution for nftName formats. */
  resolveNftCollectionName?: (
    collectionAddress: string,
  ) => Promise<NftCollectionNameResult | null>;
}
```
