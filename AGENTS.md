# AGENTS.md - AI Agent Guide

This file provides context for AI coding assistants working on this codebase.

## Project Overview

This is a TypeScript implementation of [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) - Structured Data Clear Signing Format. It transforms Ethereum transaction calldata and EIP-712 typed data into human-readable display models for wallet clear signing UIs.

**Origin:** Direct port of the Rust implementation at [reown-com/yttrium](https://github.com/reown-com/yttrium/tree/main/crates/yttrium/src/clear_signing).

## Architecture

```
src/
├── index.ts                    # Public API: format(), formatWithValue(), formatTypedData()
├── types.ts                    # TypeScript interfaces and types
├── errors.ts                   # Error classes: DescriptorError, EngineError, ResolverError, Eip712Error
├── utils.ts                    # Crypto & formatting: keccak256, checksums, hex conversion
├── descriptor.ts               # Descriptor parsing, ABI decoding, calldata decoding
├── engine.ts                   # Display formatting logic for transactions
├── eip712.ts                   # Display formatting logic for EIP-712 typed data
├── resolver.ts                 # Descriptor lookup, includes resolution, and descriptor merging
├── token-registry.ts           # Token metadata lookup (symbol, decimals, name)
├── github-registry-client.ts   # I/O layer: GitHub raw/API URL construction and fetch helpers
├── github-registry-index.ts    # In-memory index built from the GitHub registry file tree
└── assets/                     # Embedded JSON data (descriptors, ABIs, token registry)
```

## Key Data Flow

1. **Transaction formatting:**

   ```
   format(tx: Transaction, opts?)
   → DescriptorResolver.resolveCalldataDescriptor() fetches descriptor
   → engine.formatCalldata(descriptor, tx, addressBook, externalDataProvider)
       → parseFunctionSignatureKey() derives FunctionDescriptors from display.formats keys
       → decodeArguments() decodes calldata
       → applyDisplayFormat() renders each field
   → returns DisplayModel
   ```

2. **EIP-712 formatting:**
   ```
   formatTypedData(typedData)
   → resolver.resolveTyped() finds descriptor by verifyingContract
   → eip712.formatTypedData() applies display rules to message fields
   → returns DisplayModel
   ```

## Descriptor Sources

The resolver accepts a `DescriptorSource` union to control where descriptors come from:

### `GitHubRegistrySource`

Fetches descriptors lazily from the [Ledger clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) via the GitHub API. This is the default when no source is specified.

```typescript
const source: GitHubRegistrySource = {
  type: "github",
  repo: "LedgerHQ/clear-signing-erc7730-registry", // optional, default
  ref: "master",                                     // optional, default
};
```

**How it works:**

1. `GitHubRegistryIndex.init()` calls the GitHub Git Trees API once to get all file paths.
2. It fetches every `calldata-*.json` and `eip712-*.json` descriptor in parallel.
3. Each descriptor is indexed by CAIP-10 key (`eip155:{chainId}:{address}`) into two maps:
   - `calldataIndexCache` — keyed by `context.contract.deployments[].{chainId, address}`
   - `eip712IndexCache` — keyed by `context.eip712.deployments[].{chainId, address}`
4. Lookups return the absolute raw URL; the resolver then fetches and parses the descriptor on demand.

**Known limitation — EIP-712 indexing:**

ERC-7730 defines several ways to identify an EIP-712 descriptor: `deployments` (chain + address array), `domain` (key-value domain match), and `domainSeparator` (pre-computed hash). The index only keys on `context.eip712.deployments`, because the other forms cannot be cheaply pre-indexed without access to a live domain. Descriptors that rely solely on `domain` or `domainSeparator` for binding will not be discoverable through the GitHub index. Additionally, only one descriptor file per `(chainId, verifyingContract)` pair can be indexed — the first one encountered wins.

### `InlineDescriptorSource`

Provides a descriptor directly in memory, bypassing all network I/O. Intended for testing and self-contained integrations.

```typescript
const source: InlineDescriptorSource = {
  type: "inline",
  descriptor: { /* EIP-7730 descriptor object */ },
  // ERC-7730 allows one include file per descriptor; the path key must
  // match the value of descriptor.includes so the resolver can find it.
  includes: {
    "../../ercs/calldata-erc20-tokens.json": { /* included descriptor */ },
  },
};
```

The `includes` map is optional. ERC-7730 only allows a single include per descriptor, but the path key is required here to match the `includes` field value inside the descriptor JSON.

### GitHub client module (`github-registry-client.ts`)

Pure I/O layer with no caching. Exports:

- `fetchRegistryFilePaths(source)` — returns repo-relative paths of all descriptor files
- `fetchRegistryFile(path, source)` — fetches and parses a single descriptor file
- `DEFAULT_REPO` / `DEFAULT_REF` constants live in `github-registry-index.ts`, not here

### GitHub index module (`github-registry-index.ts`)

- `GitHubRegistryIndex` class — one instance per `(repo, ref)` combination, created via `getIndex()` in resolver
- Constructor takes `GitHubRegistrySource | undefined`; defaults are applied from `DEFAULT_REPO` / `DEFAULT_REF`
- `init()` is idempotent (guarded by `built` boolean); called automatically from all lookup methods
- `lookupCalldataDescriptorUrl(chainId, address)` — returns URL or `undefined`
- `lookupEip712DescriptorUrl(chainId, address)` — returns URL or `undefined`

## Descriptor Includes & Merging

ERC-7730 descriptors may reference another descriptor file via a top-level `includes` field containing a relative path. `DescriptorResolver` automatically fetches and merges the included file before returning the descriptor.

The merge is implemented in `mergeDescriptors(including, included)` (exported from `resolver.ts`) and follows the EIP-7730 spec:

- **General keys:** the including descriptor's value wins; nested objects are deep-merged recursively.
- **`display.formats[*].fields` arrays:** merged by `path` value — fields from the including descriptor override matching entries in the included descriptor, and new `path` values are appended.
- **`includes` key:** dropped from the merged result.

Include path resolution uses basic segment-by-segment string logic (no `path` module, no `URL`), so it works across Node, browsers, and React Native.

## Important Concepts

### Descriptors (EIP-7730)

JSON files that define how to display contract interactions:

- `context.contract.deployments` - Chain/address bindings
- `display.formats` - Per-function display rules with field formatting. **Keys are the full function
  signatures including parameter names and types**, e.g. `"approve(address spender,uint256 value)"`.
  These keys are the sole source of function selector computation and calldata decoding — no
  separate ABI field is needed or used.
- `metadata` - Constants, token info, address book entries

**`context.contract.abi` is deprecated and removed from the current ERC-7730 spec.** Some old
descriptor files in `src/assets/` still contain it, but the engine ignores it. Function
descriptors are derived entirely from `display.formats` keys via `parseFunctionSignatureKey()`
in `descriptor.ts`.

**`required` and `excluded` arrays on format entries are also legacy** and not part of the current
spec. Do not add them to `DescriptorFormatSpec`.

### Field Formats

Supported: `tokenAmount`, `amount`, `date`, `address`, `addressName`, `enum`, `number`, `raw`

### Token Lookup

Uses CAIP-19 identifiers:

- ERC-20: `eip155:{chainId}/erc20:{address}`
- Native: `eip155:{chainId}/slip44:60` (ETH)

### Path Resolution

ERC-7730 defines two path namespaces:

- **No prefix** — refers to a calldata argument (by name) or EIP-712 message field (by name)
- **`@.` prefix** — refers to a container field (transaction or typed data properties)
- **`$.metadata.*`** — refers to descriptor metadata fields

#### EVM Transaction container paths (`@.` prefix)

| Path | Value |
|---|---|
| `@.from` | Sender address (`tx.from`) |
| `@.value` | Native currency value (`tx.value`) |
| `@.to` | Destination contract address (`tx.to`) |
| `@.chainId` | Chain ID (`tx.chainId`) |

#### EIP-712 typed data container paths (`@.` prefix)

| Path | Value |
|---|---|
| `@.from` | Signer account address (`typedData.account`) |

Container paths are resolved by `resolveTransactionPath()` and `resolveTypedDataPath()` in `descriptor.ts`.

## Common Tasks

### Adding a new contract descriptor

Descriptors are served from the GitHub registry (`LedgerHQ/clear-signing-erc7730-registry`) and
resolved at runtime. The `src/assets/` directory contains old PoC descriptors — do not extend it.
To test with a custom descriptor, use `InlineDescriptorSource` (see `FormatOptions`).

### Adding a new field format

1. Add format handler in `src/engine.ts` → `renderField()` switch
2. Add corresponding handler in `src/eip712.ts` → `renderField()` switch
3. Update types if needed

### Adding token metadata

Add entry to `src/assets/tokens-min.json` with CAIP-19 key:

```json
"eip155:1/erc20:0x...": { "symbol": "TOKEN", "decimals": 18, "name": "Token Name" }
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests are in `test/index.test.ts`. Key test patterns:

- Hex conversion utilities
- ERC-20 approve formatting (USDT)
- Max approval threshold ("All" message)
- Unknown contract handling
- Unknown function selector (raw preview fallback)
- WETH deposit with ETH value

## Build

```bash
npm run build    # Compiles to dist/
npm run clean    # Removes dist/
```

Output is ESM with TypeScript declarations.

## Dependencies

- `@noble/hashes` - Keccak256 (browser + Node compatible)
- `typescript` (dev)
- `vitest` (dev)

## Code Patterns

### Error handling

```typescript
throw DescriptorError.parse("message"); // Descriptor JSON issues
throw DescriptorError.calldata("message"); // Calldata decoding issues
throw EngineError.tokenRegistry("message"); // Missing token metadata
throw ResolverError.notFound(key); // No descriptor for contract
```

### Byte manipulation

```typescript
import { hexToBytes, bytesToHex, keccak256 } from "./utils.js";
const selector = keccak256(
  new TextEncoder().encode("transfer(address,uint256)"),
).slice(0, 4);
```

### BigInt for token amounts

All token amounts use native `bigint`. Formatting:

```typescript
import { formatAmountWithDecimals } from "./utils.js";
const display = formatAmountWithDecimals(1000000n, 6); // "1"
```

## Gotchas

1. **JSON imports require assertion:** `import data from './file.json' with { type: 'json' };`
2. **All imports need `.js` extension** (ESM requirement)
3. **Selector matching is case-sensitive** on function names
4. **Address normalization:** Always lowercase for comparisons
5. **Token registry keys are lowercase** CAIP-19 identifiers

## Descriptor Type — Defensive Programming

All fields in `Descriptor` and its nested types (`DescriptorContext`, `DescriptorMetadata`, `DescriptorDisplay`, etc.) are **optional**. This is intentional:

- Descriptors come from external sources (GitHub registry, user-supplied inline objects) with no runtime schema validation.
- Making every field optional forces callers to null-check before accessing values, preventing crashes on partial or malformed descriptors.
- The `[key: string]: unknown` index signature on `Descriptor` allows the merge algorithm in `resolver.ts` to iterate over arbitrary top-level keys while preserving proper types for known fields.

When writing code that reads descriptor fields, always guard: `descriptor.context?.contract?.deployments?.forEach(...)`.

## Not Yet Implemented (from EIP-7730 spec)

- `duration` format (HH:MM:ss)
- `unit` format (SI prefixes)
- `nftName` format
- `chainId` format (ID to chain name)
- `calldata` format (nested function calls)
- `interoperableAddressName` format (ERC-7930)
- Full path syntax with `#` prefix for structured data root
