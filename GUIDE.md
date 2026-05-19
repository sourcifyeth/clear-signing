# Wallet Integration Guide

A concise guide for integrating `@ethereum-sourcify/clear-signing` into a wallet.

## 1. Install

```bash
npm install @ethereum-sourcify/clear-signing
```

The package ships dual ESM/CJS builds and works in Node, browsers, and React Native.

## 2. Initialize the registry index

Descriptors live in the [Ethereum clear-signing registry](https://github.com/ethereum/clear-signing-erc7730-registry) on GitHub. Before formatting anything, the library needs a `RegistryIndex` that maps `(chainId, address)` to a descriptor path.

The recommended approach is to fetch the index once at app launch with `fetchPrebuiltRegistryIndex()`, keep it in memory, and reuse it for every `format()` call:

```typescript
import {
  format,
  fetchPrebuiltRegistryIndex,
} from "@ethereum-sourcify/clear-signing";

// Fetch once at app launch.
const index = await fetchPrebuiltRegistryIndex();

const opts = {
  // Reuse the same index for every format call.
  // If `index` is omitted here, the library will re-fetch it on every format call.
  descriptorResolverOptions: { type: "github" as const, index },
  externalDataProvider: {
    /* ... */
  },
};
```

Alternatively, you can fetch at build time and bundle the resulting JSON with your wallet. This skips the startup fetch, at the cost of the index going stale until you ship a new wallet release. Or omit `index` entirely and let the library fetch on every `format()` call — this slows down formatting and isn't recommended.

### Advanced

Two advanced options you typically won't need:

- **`createGitHubRegistryIndex(source?)`** — walks the registry tree and builds the index in-process. Significantly slower than `fetchPrebuiltRegistryIndex` (one fetch per descriptor file). Use when the prebuilt indexes are stale, missing entries, or when pointing at a fork that doesn't publish them.
- **Embedded resolver** (`type: "embedded"`) — load descriptor JSON files from a local directory via dynamic `import()`. Useful for fully bundled/offline builds. See the README for the shape.

## 3. Build the `ExternalDataProvider`

The library is agnostic about how external data is fetched. To resolve token metadata, address names, NFT collections, block timestamps, and chain info, the wallet supplies an `ExternalDataProvider` — an object of async methods backed by the sources the wallet already has (RPC, token list, address book, …).

Every method is optional. If a method is missing or returns `null`, the corresponding field falls back to raw formatting and the `DisplayModel` carries an explanatory warning (e.g. `UNKNOWN_TOKEN`, `UNKNOWN_ADDRESS`, `UNKNOWN_CHAIN`).

```typescript
const externalDataProvider: ExternalDataProvider = {
  // Used by `tokenAmount` format. Resolve ERC-20 metadata from your
  // wallet's token list, or fall back to on-chain `name`/`symbol`/`decimals` calls.
  resolveToken: async (chainId, tokenAddress) => {
    const result: TokenResult | null = {
      name: "Tether USD",
      symbol: "USDT",
      decimals: 6,
    };
    // Return null if unknown — the library will emit UNKNOWN_TOKEN.
    return result;
  },

  // Used by `addressName` format with `sources: ["local"]`.
  // Resolve names from the wallet's address book / contacts.
  // `acceptedTypes` (when provided by the descriptor) lists allowed kinds —
  // any subset of "wallet" | "eoa" | "contract" | "token" | "collection".
  // Set `typeMatch: false` if the resolved address doesn't match any of
  // them so the library can warn the user.
  resolveLocalName: async (address, acceptedTypes) => {
    const result: AddressNameResult | null = {
      name: "Alice",
      typeMatch: true,
    };
    return result;
  },

  // Used by `addressName` format with `sources: ["ens"]`. Same signature
  // as resolveLocalName but for ENS / reverse records.
  resolveEnsName: async (address, acceptedTypes) => {
    const result: AddressNameResult | null = {
      name: "alice.eth",
      typeMatch: true,
    };
    return result;
  },

  // Used by `nftName` format. Resolve the collection's display name from
  // your NFT metadata source (e.g. on-chain `name()` call, marketplace API).
  resolveNftCollectionName: async (chainId, collectionAddress) => {
    const result: NftCollectionNameResult | null = {
      name: "Bored Ape Yacht Club",
    };
    return result;
  },

  // Used by `date` format with `params.encoding: "blockheight"`.
  // Resolve a block number to its unix timestamp (in seconds).
  resolveBlockTimestamp: async (chainId, blockHeight) => {
    const result: BlockTimestampResult | null = { timestamp: 1715000000 };
    return result;
  },

  // Used by `chainId` format (renders the chain name) and `amount` /
  // `tokenAmount` with `nativeCurrencyAddress` (needs decimals & ticker).
  // A good source is https://github.com/ethereum-lists/chains. Note: this
  // may be called with chain IDs other than the user's current chain
  // (e.g. for bridge / cross-chain descriptors) — resolve any known chain,
  // not only the connected one.
  resolveChainInfo: async (chainId) => {
    const result: ChainInfoResult | null = {
      name: "Ethereum Mainnet",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    };
    return result;
  },
};

// Combine with the resolver options from §2 into the FormatOptions object
// that's passed to every format call.
const opts: FormatOptions = {
  descriptorResolverOptions: { type: "github", index }, // from §2
  externalDataProvider,
};
```

See [`src/types.ts`](src/types.ts) for the exact result type definitions.

## 4. Call the format functions

Three entry points, all returning `DisplayModel` as the output:

| Function             | Input                 | When to call                                                                                                     |
| -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `format`             | `Transaction`         | When the wallet is about to display a transaction signing prompt (`eth_sendTransaction`, `eth_signTransaction`). |
| `formatTypedData`    | `TypedData` (EIP-712) | When the wallet is about to display a typed-data signing prompt (`eth_signTypedData`).                           |
| `formatEip5792Batch` | `Eip5792Batch`        | When the wallet is about to display a batched-call prompt (`wallet_sendCalls`).                                  |

Call them as soon as you have the request and before rendering the confirmation UI — they are async (descriptor fetch + external data resolution).

All three accept the same `opts` object (built in §3) as their optional second argument — reuse it across every call.

### `format`

```typescript
const tx: Transaction = {
  chainId: 1,
  to: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  data: "0x095ea7b3...", // calldata hex
  value: 0n,
  // Required if the matched descriptor references `@.from`
  // (e.g. `addressName` with `senderAddress`).
  from: "0xUserAccount...",
};

const display: DisplayModel = await format(tx, opts);
```

### `formatTypedData`

```typescript
const typedData: TypedData = {
  // Populates `@.from`.
  account: "0xUserAccount...",
  // The library currently requires both `chainId` and `verifyingContract`.
  domain: { chainId: 1, verifyingContract: "0x...", name: "...", version: "1" },
  types: {
    /* ... */
  },
  primaryType: "PermitSingle",
  message: {
    /* ... */
  },
};

const display: DisplayModel = await formatTypedData(typedData, opts);
```

### `formatEip5792Batch`

```typescript
const batch: Eip5792Batch = {
  chainId: 1,
  from: "0xUserAccount...",
  // Each call is formatted independently.
  // Calls missing `data` (native transfer) or `to` (contract creation)
  // are skipped with a per-call warning in the returned BatchDisplayModel.
  calls: [
    { to: "0x...", data: "0x...", value: 0n },
    { to: "0x...", data: "0x..." },
  ],
};

const display: BatchDisplayModel = await formatEip5792Batch(batch, opts);
```

## 5. Render the `DisplayModel`

The library returns a `DisplayModel`. Display its values to the user as the confirmation screen. The library never throws — failures surface as `warnings`.

```typescript
interface DisplayModel {
  // Short description of the operation, e.g. "Approve token spending".
  // May be a single string or a key-value map. Always present when the
  // descriptor was resolved successfully — if it's missing, there will
  // be a corresponding entry in `warnings` explaining why.
  intent?: string | Record<string, string>;

  // Full sentence with field values already substituted, e.g.
  // "Approve 1,000 USDC for Uniswap V3". Prefer this over `intent` + `fields`
  // when present. Absent when the descriptor does not define it
  // or when interpolation failed.
  interpolatedIntent?: string;

  // Ordered list of labeled values. Each item is either a single
  // DisplayField or a DisplayFieldGroup (a named section of fields,
  // e.g. one element of a Permit2 batch).
  fields?: (DisplayField | DisplayFieldGroup)[];

  // Extra context about the contract — optional to display.
  metadata?: {
    owner?: string;
    // Recommended: surface as e.g. "Interacting with <contractName>"
    // so the user knows which protocol they're signing against.
    contractName?: string;
    info?: { deploymentDate?: string; url?: string };
  };

  // Calldata only: present when no descriptor matched. Show the raw
  // selector + ABI words as a last-resort fallback so the user still
  // sees something.
  rawCalldataFallback?: RawCalldataFallback;

  // Warnings. Surface to the user; branch on `warning.code` for explicit
  // handling. For example, when no descriptor matched the transaction
  // could not be rendered.
  warnings?: Warning[];
}

// A single labeled value to render.
interface DisplayField {
  label: string; // UI label, e.g. "Amount to approve"
  value: string; // Pre-formatted display value, e.g. "1 USDC"

  // `fieldType` (the underlying Solidity type) and `format` (the ERC-7730
  // display format, e.g. "tokenAmount") drive type-specific UI components.
  // For example, for a `fieldType` of "address" the wallet can display an
  // address copy button; for a `format` of "tokenAmount" it can show the
  // token icon next to the value.
  fieldType: FieldType;
  format: string;

  warning?: Warning; // Field-level warning (e.g. UNKNOWN_TOKEN)

  // For `address`-typed fields: the checksum address. Display alongside
  // the resolved name (e.g. in a tooltip) so the user can verify the
  // underlying address.
  rawAddress?: string;

  // For `tokenAmount` fields: the underlying token address. Useful
  // when `resolveToken` returned null (warning.code === "UNKNOWN_TOKEN"),
  // or to render a link to the token (e.g. on a block explorer).
  tokenAddress?: string;

  // For `calldata` format (nested function call): the formatted inner
  // transaction. See "Nesting" below.
  embeddedCalldata?: EmbeddedCalldata;
}

// Underlying Solidity type category of a DisplayField.
type FieldType = "address" | "bool" | "string" | "bytes" | "uint" | "int";

// A named section of related fields (e.g. elements of an array argument).
// A group whose `warning.code === "EMPTY_ARRAY"` means the source array
// was empty.
interface DisplayFieldGroup {
  label?: string;
  fields: DisplayField[];
  warning?: Warning;
}

// Present on a DisplayField when `format: "calldata"`. The inner
// `display` is itself a DisplayModel — render it recursively, for
// example in a popover or modal opened from the field.
interface EmbeddedCalldata {
  display: DisplayModel;
  callee?: string; // Target address of the inner call
  chainId?: number; // Present only when it differs from the outer chain
}

// Fallback shown when no descriptor matched the transaction.
interface RawCalldataFallback {
  selector: string; // 4-byte function selector, e.g. "0x095ea7b3"
  args: string[]; // 32-byte ABI words, hex-encoded
}

interface Warning {
  code: WarningCode; // Machine-readable — branch UI on this.
  message: string; // Human-readable; safe to surface directly.
}

// Full union defined in src/types.ts — e.g. "UNKNOWN_TOKEN",
// "UNKNOWN_ADDRESS", "UNKNOWN_CHAIN", "NO_DESCRIPTOR", ...
type WarningCode = string;
```

For `formatEip5792Batch`, the return type is a `BatchDisplayModel` instead — it wraps one `DisplayModel` per call and carries a batch-level `interpolatedIntent` / `warnings`:

```typescript
interface BatchDisplayModel {
  interpolatedIntent?: string; // Joined intents of the batched calls
  warnings?: Warning[];
  callDisplays: DisplayModel[]; // Same order as the input `batch.calls`
}
```

### What to display

ERC-7730 defines two display options:

- **Option 1 (recommended) — `interpolatedIntent`:** show a single sentence with field values already substituted, e.g. _"Approve 1,000 USDC for Uniswap V3"_. Showing `fields` alongside is recommended for full context, but they may be omitted if the wallet wants a more compact UI.
- **Option 2 — `intent` + `fields`:** show `intent` as a short description of what the call does, and `fields` as the labeled list of parameter values.

`interpolatedIntent` is absent when the descriptor doesn't define it or interpolation failed — in that case fall back to Option 2. `intent` itself is always present on a successful format.

### Warnings

Surface warnings to the user. In most cases it's fine to just display the human-readable `warning.message` directly. For selected codes where a dedicated UI cue helps the user (e.g. an unverified-token banner for `UNKNOWN_TOKEN`, or a "raw calldata — proceed with caution" headline for `NO_DESCRIPTOR`), you can branch on `warning.code` for more explicit handling. The complete `WarningCode` union is defined in [`src/types.ts`](src/types.ts).

Warnings can appear at two levels:

- **`DisplayModel.warnings`** — affect the whole result. Examples: `NO_DESCRIPTOR` (no descriptor matched the transaction or typed data), `DESCRIPTOR_FETCH_ERROR` (the registry could not be reached), `INTERPOLATION_ERROR` (the interpolated intent template could not be rendered), `INVALID_CALLDATA_HEX` / `CALLDATA_DECODE_ERROR` (the calldata could not be parsed).
- **`DisplayField.warning`** / **`DisplayFieldGroup.warning`** — affect a single rendered value or group. Examples: `UNKNOWN_TOKEN` (`resolveToken` returned null), `UNKNOWN_ADDRESS` (no name resolved), `UNKNOWN_CHAIN` (`resolveChainInfo` returned null), `EMPTY_ARRAY` (an array argument was empty). If there is a warning, the field's `value` falls back to a raw representation; consider rendering a per-field badge or warning indicator.

When `DisplayModel.warnings` contains `NO_DESCRIPTOR` (calldata only), the model also carries a `rawCalldataFallback` with the function selector and raw ABI words — show it as a last-resort fallback so the user still sees _something_.

### Grouping

`DisplayModel.fields` is an ordered list of either `DisplayField` or `DisplayFieldGroup`. Use the exported `isFieldGroup` type guard to discriminate:

```typescript
import { isFieldGroup } from "@ethereum-sourcify/clear-signing";

for (const item of result.fields ?? []) {
  if (isFieldGroup(item)) {
    // Render a labeled section with item.label and item.fields[]
    // A group with item.warning?.code === "EMPTY_ARRAY" means the array
    // in the calldata was empty — render the label with an empty-state message.
  } else {
    // Render a single labeled value (item.label + item.value)
  }
}
```

Groups represent semantically related fields (e.g. elements of a `Permit2` batch) and should be rendered as a visually grouped section.

### Nesting (embedded calldata)

When a descriptor declares a field with `format: "calldata"` (e.g. a multicall target), that field has an `embeddedCalldata` property containing a fully formatted `DisplayModel` for the inner call:

```typescript
field.embeddedCalldata?.display; // recursive DisplayModel — render the same way
field.embeddedCalldata?.callee; // target address of the inner call (checksum)
field.embeddedCalldata?.chainId; // present only if it differs from the outer chain
```

Render `embeddedCalldata.display` recursively (typically as a nested/collapsible section). If the wallet does not support embedded calldata, fall back to showing a hash of the raw `field.value` so the user has something verifiable.
