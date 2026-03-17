# AGENTS.md - AI Agent Guide

This file provides context for AI coding assistants working on this codebase.

## Project Overview

This is a TypeScript implementation of [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) - Structured Data Clear Signing Format. It transforms Ethereum transaction calldata and EIP-712 typed data into human-readable display models for wallet clear signing UIs.

## Architecture

```
src/
├── index.ts                    # Public API: format(), formatTypedData()
├── types.ts                    # TypeScript interfaces and types
├── utils.ts                    # Crypto & formatting utilities
├── descriptor.ts               # Descriptor parsing, ABI decoding, calldata decoding
├── formatters.ts               # Shared field formatting logic (used by engine + eip712)
├── engine.ts                   # Display formatting logic for transactions (calldata)
├── eip712.ts                   # Display formatting logic for EIP-712 typed data
├── resolver.ts                 # Descriptor lookup, includes resolution, and descriptor merging
├── github-registry-client.ts   # I/O layer: GitHub raw/API URL construction and fetch helpers
└── github-registry-index.ts    # In-memory index built from the GitHub registry file tree
```

## Key Data Flow

1. **Transaction formatting:**

   ```
   format(tx: Transaction, opts?)
   → DescriptorResolver.resolveCalldataDescriptor() fetches descriptor
   → engine.formatCalldata(tx, descriptor, externalDataProvider?)
       → getFormatsBySelector() builds selector→format map from display.formats keys
       → decodeArguments() decodes calldata
       → applyDisplayFormat() renders each field
   → returns DisplayModel
   ```

2. **EIP-712 formatting:**
   ```
   formatTypedData(typedData, opts?)
   → DescriptorResolver.resolveTypedDataDescriptor() fetches descriptor by (chainId, verifyingContract)
   → eip712.formatEip712(typedData, descriptor, externalDataProvider?)
       → findFormatSpec() matches display.formats key to primaryType via encodeType
       → iterates format.fields, resolves paths in typedData.message
       → renderField() formats each value
   → returns DisplayModel
   ```

## Descriptor Sources

The resolver accepts `GitHubResolverOptions` or `EmbeddedResolverOptions` to control where descriptors come from.

### `GitHubResolverOptions`

Fetches descriptors lazily from the [Ledger clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) via the GitHub API. This is the default when no options are specified.

```typescript
const opts: FormatOptions = {
  descriptorResolverOptions: {
    type: "github",
    repo: "LedgerHQ/clear-signing-erc7730-registry", // optional, default
    ref: "master",                                     // optional, default
    index: myPrebuiltIndex,                            // optional: skip GitHub API call
  },
};
```

**How it works:**

1. `github-registry-index.ts` fetches the GitHub Git Trees API once and indexes all `calldata-*.json` and `eip712-*.json` descriptor files.
2. Each descriptor is indexed by CAIP-10 key (`eip155:{chainId}:{address}`) into two maps:
   - `calldataIndex` — keyed by `context.contract.deployments[].{chainId, address}`
   - `typedDataIndex` — keyed by `context.eip712.deployments[].{chainId, address}`
3. Lookups return a repo-relative path; the `GitHubPathResolver` fetches and parses the descriptor.

**Known limitation — EIP-712 indexing:**

ERC-7730 defines several ways to identify an EIP-712 descriptor: `deployments` (chain + address array), `domain` (key-value domain match), and `domainSeparator` (pre-computed hash). The index only keys on `context.eip712.deployments`, because the other forms cannot be cheaply pre-indexed without access to a live domain. Descriptors that rely solely on `domain` or `domainSeparator` for binding will not be discoverable through the GitHub index. Additionally, only one descriptor per `(chainId, verifyingContract)` pair can be indexed — the first one encountered wins.

### `EmbeddedResolverOptions`

Loads descriptors from a local directory using dynamic `import()`. Useful for bundled/offline builds.

```typescript
const opts: FormatOptions = {
  descriptorResolverOptions: {
    type: "embedded",
    index: myIndex,               // RegistryIndex with CAIP-10 → path mappings
    descriptorDirectory: "./descriptors",
  },
};
```

### GitHub client module (`github-registry-client.ts`)

Pure I/O layer with no caching. Exports:

- `fetchRegistryFilePaths(source)` — returns repo-relative paths of all descriptor files
- `fetchRegistryFile(path, source)` — fetches and parses a single descriptor file
- `DEFAULT_REPO` / `DEFAULT_REF` constants live in `github-registry-index.ts`

### GitHub index module (`github-registry-index.ts`)

- `createGitHubRegistryIndex(source?)` — async factory; fetches all descriptors and builds a `RegistryIndex`
- `DEFAULT_REPO` / `DEFAULT_REF` — default registry constants used by `DescriptorResolver`

## Descriptor Includes & Merging

ERC-7730 descriptors may reference another descriptor file via a top-level `includes` field containing a relative path. `DescriptorResolver` automatically fetches and merges the included file before returning the descriptor.

The merge is implemented in `mergeDescriptors(including, included)` (exported from `resolver.ts`) and follows the EIP-7730 spec:

- **General keys:** the including descriptor's value wins; nested objects are deep-merged recursively.
- **`display.formats[*].fields` arrays:** merged by `path` value — fields from the including descriptor override matching entries in the included descriptor, and new `path` values are appended.
- **`includes` key:** dropped from the merged result.

Include path resolution uses `new URL(relative, base)` in the resolver.

## Important Concepts

### Descriptors (EIP-7730)

JSON files that define how to display contract interactions:

- `context.contract.deployments` — chain/address bindings
- `display.formats` — per-function display rules with field formatting. **Keys are the full function
  signatures including parameter names**, e.g. `"approve(address spender,uint256 value)"`.
  These keys are the sole source of function selector computation and calldata decoding — no
  separate ABI field is needed or used.
- `metadata` — constants, owner info, etc.

**`context.contract.abi` is deprecated and removed from the current ERC-7730 spec.** The engine
ignores it. Function descriptors are derived entirely from `display.formats` keys via
`parseFunctionSignatureKey()` in `descriptor.ts`.

**`required` and `excluded` arrays on format entries are also legacy** and not part of the current
spec. Do not add them to `DescriptorFormatSpec`.

**Function signature key rules (from spec):**
- Keys MUST include parameter names: `"transfer(address to,uint256 value)"` not `"transfer(address,uint256)"`
- Commas MUST NOT be followed by spaces
- Exactly one space between type and parameter name
- Only canonical Solidity types (`uint256`, not `uint`)

### EIP-712 Descriptor Keys

**Current ERC-7730 spec:**
- `display.formats` keys are the **full EIP-712 `encodeType` string**, e.g.
  `"PermitSingle(PermitDetails details,address spender,uint256 sigDeadline)PermitDetails(address token,uint160 amount,uint48 expiration,uint48 nonce)"`.
- `context.eip712.schemas` is **deprecated** — do not add to new descriptors.
- `context.eip712.deployments` and `context.eip712.domain` are the correct binding mechanisms.

`eip712.ts` supports both formats: tries `encodeType` match first, falls back to bare primary type name.

### Field Formats

Supported: `tokenAmount`, `amount`, `date`, `addressName`, `enum`, `raw`

Not yet implemented: `duration`, `unit`, `nftName`, `chainId`, `calldata`, `interoperableAddressName`

### Token Resolution

Token metadata is resolved entirely via `ExternalDataProvider.resolveToken(chainId, address)`. There is no embedded token registry. When `resolveToken` is absent or returns `null`, the library emits a `TOKEN_NOT_FOUND` warning and falls back to the raw value.

### Address Name Resolution

Address names are resolved via `ExternalDataProvider.resolveLocalName` and/or `resolveEnsName`. Which sources are consulted is controlled by `field.params.sources` in the descriptor (`"local"`, `"ens"`). When resolution fails, the library returns the checksum address with an `ADDRESS_NOT_RESOLVED` warning.

There is no built-in address book. All name resolution is delegated to the wallet.

### Path Resolution

ERC-7730 defines multiple path prefixes:

| Prefix | Meaning |
|--------|---------|
| _(none)_ | Calldata argument name / EIP-712 message field name |
| `#.` | Absolute structured data root (equivalent to bare name) |
| `@.` | Container path (transaction or typed data metadata) |
| `$.metadata.*` | Descriptor metadata field |

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
| `@.to` | Verifying contract (`typedData.domain.verifyingContract`) |
| `@.chainId` | Domain chain ID (`typedData.domain.chainId`) |

Container paths are resolved by `resolveTransactionPath()` and `resolveTypedDataPath()` in `descriptor.ts`.

### Warnings

Non-fatal warnings are returned in the `DisplayModel.warnings` array and on individual `DisplayField.warning`. All warning codes are the `WarningCode` string literal union defined in `types.ts`. Use the `warn(code, message)` helper from `utils.ts` to create them. **Never use out-parameters for warnings — always return them in the result object.**

## Common Tasks

### Adding a new field format

1. Add format handler in `src/engine.ts` → `renderField()` switch
2. Add corresponding handler in `src/eip712.ts` → `renderField()` switch
3. Add shared formatting logic to `src/formatters.ts` if reusable between both
4. Add the new `WarningCode` value to `types.ts` if the format can emit new warnings

### Testing with a custom descriptor

Use `GitHubResolverOptions` with a manually built `RegistryIndex` and mock `fetch` in tests:

```typescript
const index: RegistryIndex = {
  calldataIndex: { "eip155:1:0xcontract...": "path/to/descriptor.json" },
  typedDataIndex: {},
};
const opts: FormatOptions = {
  descriptorResolverOptions: { type: "github", index },
};
```

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests live in `test/`. Current test files:
- `test/github-registry-client.spec.ts` — unit tests for the GitHub client I/O layer
- `test/erc7730-test-cases.spec.ts` — ERC-7730 spec test cases (in progress)

## Build

```bash
npm run build    # Compiles to dist/
npm run clean    # Removes dist/
```

Output is ESM with TypeScript declarations.

## Dependencies

- `@noble/hashes` — Keccak256 (browser + Node compatible)
- `typescript` (dev)
- `vitest` (dev)

## Code Patterns

### Error handling

All errors use plain `new Error(message)`. No custom error classes.

### Warnings

```typescript
import { warn } from "./utils";
// warn() returns a Warning with a typed WarningCode
const w = warn("TOKEN_NOT_FOUND", "Token could not be resolved");
```

All `WarningCode` values are defined as a string literal union in `types.ts`.

### Functions that produce warnings

**Pattern:** return warnings in the result object, never via out-parameters.

```typescript
function resolveField(field, defs): { resolved: ResolvedField | undefined; warnings: string[] } {
  // ...
}
const { resolved, warnings } = resolveField(fieldSpec, definitions);
warnings.push(...warnings.map((msg) => warn("FIELD_RESOLUTION", msg)));
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
- Array/slice path selectors (`array.[0]`, `array.[start:end]`)
- Pre-built registry index (GitHub index is not yet wired up; currently returns empty index)
