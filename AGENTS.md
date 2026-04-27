# AGENTS.md - AI Agent Guide

This file provides context for AI coding assistants working on this codebase.

## Project Overview

This is a TypeScript implementation of [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) - Structured Data Clear Signing Format. It transforms Ethereum transaction calldata and EIP-712 typed data into human-readable display models for wallet clear signing UIs.

## Architecture

```
src/
├── index.ts                    # Public API: format(), formatTypedData(), formatEip5792Batch()
├── types.ts                    # TypeScript interfaces and types
├── utils.ts                    # Crypto & formatting utilities
├── descriptor.ts               # Shared descriptor logic: binding checks, path resolution, field merging
├── fields.ts                   # Field processing pipeline: applyFieldFormats() loop and field groups
├── formatters.ts               # Individual format handlers: renderField(), formatRaw(), etc.
├── calldata.ts                 # Calldata path: formatCalldata(), signature parsing, ABI decoding
├── eip712.ts                   # EIP-712 path: formatEip712(), encodeType matching, type resolution
├── resolver.ts                 # Descriptor lookup, includes resolution, and descriptor merging
├── github-registry-client.ts   # I/O layer: GitHub raw/API URL construction and fetch helpers
└── github-registry-index.ts    # In-memory index built from the GitHub registry file tree
```

### Module responsibilities

- **`descriptor.ts`** — Shared descriptor utilities used by both calldata and EIP-712 paths:
  descriptor binding checks (`isCalldataDescriptorBoundTo`, `isEip712DescriptorBoundTo`),
  path resolution (`resolveTransactionPath`, `resolveTypedDataPath`),
  value conversion (`ArgumentValue`, `BytesSliceValue`, `toArgumentValue`,
  `argumentValueToBytes`, `argumentValueEquals`), format-to-type mapping
  (`fieldTypeForFormat`, `bytesSliceToFieldType`),
  field/definition merging (`mergeDefinitions`, `resolveFieldValue`),
  metadata resolution (`resolveMetadataValue`), and template interpolation (`interpolateTemplate`).
  Defines the `BaseResolvePath` (returns `ArgumentValue`) and `ResolvePath`
  (returns `ArgumentValue | BytesSliceValue`) type aliases.

- **`fields.ts`** — The field processing pipeline. Primary entry point is `applyFieldFormats()`,
  which iterates format fields, merges definitions, resolves values, and renders each field.
  Handles field groups with array iteration (group-level and child-level patterns, sequential
  and bundled modes). Delegates individual field rendering to `formatters.ts`.
  Contains byte slice support: `parseByteSlice`, `applyByteSlice`, `buildSliceResolvePath`
  (wraps a `BaseResolvePath` to handle slice paths transparently), and
  `bytesSliceToArgumentValue` (converts `BytesSliceValue` to `ArgumentValue` using the
  field format's expected type).

- **`formatters.ts`** — Individual format handlers dispatched by `renderField()`.
  Includes `formatRaw`, `formatTimestamp`, `renderTokenAmount`, `formatNftName`,
  `formatDuration`, `formatUnit`, `formatAddressName`, `formatTokenTicker`,
  `formatChainId`, `formatNativeAmount`, `resolveEnumLabel`, `isSenderAddress`,
  `isNativeCurrencyAddress`, etc. Also defines `FieldFormatOptions` and `RenderFieldResult`
  types. Handlers are exported for unit testing. Most format handlers delegate
  `$.metadata.*` path resolution to the `resolvePath` closure rather than calling
  `resolveMetadataValue` directly — only `resolveEnumLabel` uses it since it needs
  an object value that `toArgumentValue` cannot represent.

- **`calldata.ts`** — Everything specific to calldata formatting. Contains the top-level
  `formatCalldata()` entry point, function signature parsing (`parseFunctionSignatureKey`),
  selector-to-format lookup (`findFormatBySelector`), and a unified recursive ABI decoder
  (`decodeArguments` → `decodeComponents`/`decodeValue`) supporting all ABI types: static
  and dynamic tuples, dynamic arrays (`T[]`), fixed-size arrays (`T[k]`), nested arrays,
  `bytes`/`string`, and `bytesN`. All parsing/decoding internals are module-private.

- **`eip712.ts`** — Everything specific to EIP-712 typed data formatting. Contains the
  top-level `formatEip712()` entry point, `encodeType` computation and matching
  (`findFormatSpec`, `computeEncodeType`), message value navigation (`getMessageValue`),
  and type resolution (`resolveFieldType`). All internals are module-private.

## Key Data Flow

1. **Transaction formatting:**

   ```
   format(tx, opts?)
   → DescriptorResolver.resolveCalldataDescriptor()
   → calldata.formatCalldata(tx, descriptor, externalDataProvider?)
       → findFormatBySelector() matches selector to a display.formats entry
       → decodeArguments() decodes calldata into { values, arrayLengths } maps
       → applyFieldFormats() (from fields.ts) renders each field
   → returns DisplayModel
   ```

2. **EIP-712 formatting:**

   ```
   formatTypedData(typedData, opts?)
   → DescriptorResolver.resolveTypedDataDescriptor()
   → eip712.formatEip712(typedData, descriptor, externalDataProvider?)
       → findFormatSpec() matches display.formats key via encodeType string
       → applyFieldFormats() (from fields.ts) renders each field
   → returns DisplayModel
   ```

3. **EIP-5792 batch formatting:**
   ```
   formatEip5792Batch(batch, opts?)
   → for each call in batch.calls:
       → skip with BATCH_VALUE_TRANSFER warning if call.data is absent
       → skip with BATCH_CONTRACT_CREATION warning if call.to is absent
       → format({ chainId, to, data, value, from }, opts)
   → join interpolatedIntent strings with " and "
       (or emit BATCH_INTERPOLATION_INCOMPLETE if any call lacks one)
   → returns BatchDisplayModel
   ```

Both calldata and EIP-712 paths share the same field processing pipeline in `fields.ts` via `applyFieldFormats()`.
Each builds a `BaseResolvePath` closure that handles `@.`, `$.`, `#.`, and bare path resolution
for its domain (calldata args vs. EIP-712 message fields). `applyFieldFormats()` internally
wraps it with `buildSliceResolvePath` to handle byte slice paths (e.g. `srcToken.[-20:]`).

## Descriptor Sources

The resolver accepts `GitHubResolverOptions` or `EmbeddedResolverOptions` to control where descriptors come from.

### `GitHubResolverOptions`

Fetches descriptors lazily from the [Ledger clear-signing registry](https://github.com/LedgerHQ/clear-signing-erc7730-registry) via the GitHub API. This is the default when no options are specified.

```typescript
const opts: FormatOptions = {
  descriptorResolverOptions: {
    type: "github",
    repo: "LedgerHQ/clear-signing-erc7730-registry", // optional, default
    ref: "master", // optional, default
    index: myPrebuiltIndex, // optional: skip GitHub API call
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
    index: myIndex, // RegistryIndex with CAIP-10 → path mappings
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

The merge is implemented in `mergeDescriptors(including, included)` (internal to `resolver.ts`) and follows the EIP-7730 spec:

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

**`context.contract.abi` is deprecated and removed from the current ERC-7730 spec.** The library
ignores it. Function descriptors are derived entirely from `display.formats` keys via
`parseFunctionSignatureKey()` in `calldata.ts`.

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

Supported: `raw`, `amount`, `tokenAmount`, `nftName`, `date`, `duration`, `unit`, `enum`, `addressName`, `tokenTicker`, `chainId`

Not yet implemented: `calldata`, `interoperableAddressName`

**Spec-compliance notes:**

- All numeric formats (`date`, `tokenAmount`, `amount`, `enum`, `duration`, `nftName`, `chainId`) accept both `uint` and `int` field types.
- `date` format supports `params.encoding` of `"timestamp"` (unix seconds) and `"blockheight"` (resolved via `ExternalDataProvider.resolveBlockTimestamp`). Falls back to raw with `UNKNOWN_ENCODING` warning for missing or unsupported encodings.
- `tokenAmount` supports optional `chainId`/`chainIdPath` params to override the container chain ID for cross-chain scenarios (same as `tokenTicker`).
- `tokenAmount` message defaults to `"Unlimited"` when `params.threshold` is set but `params.message` is omitted.
- `nftName` resolves collection name via `ExternalDataProvider.resolveNftCollectionName(chainId, address)`.
- `tokenTicker` accepts only `address` type; supports optional `chainId`/`chainIdPath` params to override the container chain ID for cross-chain scenarios.
- `chainId` converts an integer chain ID to a human-readable chain name via `ExternalDataProvider.resolveChainInfo`. Falls back to raw with `UNKNOWN_CHAIN` warning when resolution fails.
- `amount` displays a value as native currency using `ExternalDataProvider.resolveChainInfo` for decimals and ticker. Falls back to raw with `UNKNOWN_CHAIN` warning when resolution fails.
- `tokenAmount` with `nativeCurrencyAddress` also resolves native currency metadata via `resolveChainInfo`.
- `addressName` supports the `senderAddress` param: when the field value matches a `senderAddress`, it displays `"Sender"` and substitutes `rawAddress` with `@.from`. Checked via `isSenderAddress()`.
- `resolveLocalName` and `resolveEnsName` receive `acceptedTypes?: DescriptorAddressType[]` (from `params.types`). The parameter is absent when the descriptor defines no `types`. Callers should check membership with `acceptedTypes?.includes(...)`. The library emits `ADDRESS_TYPE_MISMATCH` when the resolver returns `typeMatch: false`.
- Raw address rendering always uses EIP-55 checksum format (not lowercase hex).

### Token Resolution

Token metadata is resolved entirely via `ExternalDataProvider.resolveToken(chainId, address)`. There is no embedded token registry. When `resolveToken` is absent or returns `null`, the library emits a `UNKNOWN_TOKEN` warning and falls back to the raw value.

### Chain Info Resolution

Chain metadata (name, native currency) is resolved via `ExternalDataProvider.resolveChainInfo(chainId)`. This is used by the `chainId` format (to display chain names), the `amount` format (to display native currency amounts with correct decimals and ticker), and the `tokenAmount` format when `nativeCurrencyAddress` matches. There is no embedded chain registry. When `resolveChainInfo` is absent or returns `null`, the library emits an `UNKNOWN_CHAIN` warning and falls back to the raw value.

### Address Name Resolution

Address names are resolved via `ExternalDataProvider.resolveLocalName` and/or `resolveEnsName`. Which sources are consulted is controlled by `field.params.sources` in the descriptor (`"local"`, `"ens"`). When resolution fails, the library returns the checksum address with an `UNKNOWN_ADDRESS` warning.

There is no built-in address book. All name resolution is delegated to the wallet.

### Path Resolution

ERC-7730 defines multiple path prefixes:

| Prefix         | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| _(none)_       | Calldata argument name / EIP-712 message field name     |
| `#.`           | Absolute structured data root (equivalent to bare name) |
| `@.`           | Container path (transaction or typed data metadata)     |
| `$.metadata.*` | Descriptor metadata field                               |

#### EVM Transaction container paths (`@.` prefix)

| Path        | Value                                  |
| ----------- | -------------------------------------- |
| `@.from`    | Sender address (`tx.from`)             |
| `@.value`   | Native currency value (`tx.value`)     |
| `@.to`      | Destination contract address (`tx.to`) |
| `@.chainId` | Chain ID (`tx.chainId`)                |

#### EIP-712 typed data container paths (`@.` prefix)

| Path        | Value                                                     |
| ----------- | --------------------------------------------------------- |
| `@.from`    | Signer account address (`typedData.account`)              |
| `@.to`      | Verifying contract (`typedData.domain.verifyingContract`) |
| `@.chainId` | Domain chain ID (`typedData.domain.chainId`)              |

Container paths are resolved by `resolveTransactionPath()` and `resolveTypedDataPath()` in `descriptor.ts`.

### Warnings

Non-fatal warnings are returned in the `DisplayModel.warnings` array and on individual `DisplayField.warning`. All warning codes are the `WarningCode` string literal union defined in `types.ts`. Use the `warn(code, message)` helper from `utils.ts` to create them. **Never use out-parameters for warnings — always return them in the result object.**

## Common Tasks

### Adding a new field format

1. Add a new case to `renderField()` switch in `src/formatters.ts`
2. Implement the format handler as a module-private function in the same file
3. Add the new `WarningCode` value to `types.ts` if the format can emit new warnings

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

## Before Committing

Always run `npm run fix` before committing to auto-fix lint and formatting issues.

## Testing

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
```

Tests live in `test/`. Current test files:

- `test/formatters.spec.ts` — unit tests for all field format handlers in `formatters.ts`
- `test/fields.spec.ts` — unit tests for the field processing pipeline (groups, iteration, slices, separators)
- `test/github-registry-client.spec.ts` — unit tests for the GitHub client I/O layer
- `test/erc7730-test-cases/example-main.spec.ts` — ERC-7730 spec test cases using `example-main.json` descriptor (co-located in same directory), including EIP-5792 batch formatting tests
- `test/erc7730-test-cases/example-array-iteration.spec.ts` — bundled/sequential array iteration tests
- `test/registry-cases/1inch/1inch.spec.ts` — 1inch AggregationRouterV6: swap + clipperSwap (byte slice paths)
- `test/registry-cases/paraswap/paraswap.spec.ts` — Paraswap AugustusSwapper v6.2: RFQ batch fill (tuple array decoding) + BalancerV2 (dynamic bytes + byte range slices)

### Test guidelines

- **Be consistent** with the style and patterns of existing tests in the same file.
- **Test all properties** of the returned `DisplayModel` and its nested objects:
  `intent`, `interpolatedIntent`, `fields`, `metadata` (including `owner`, `contractName`, `info`),
  `rawCalldataFallback`, `warnings`.
- **Test all properties** of each `DisplayField`:
  `label`, `value`, `fieldType`, `format`, `warning`, `rawAddress`, `tokenAddress`, `calldataDisplay`.
  Assert that properties not expected to be present are `undefined`.
- **Test nested `DisplayModel`s** (e.g. `calldataDisplay`) with the same thoroughness.
  Extract a helper function (e.g. `assertNestedDistribute`) when the same nested structure
  is verified in multiple tests.
- **Each test should verify the actual value**, not just that something exists.
  Use `toBe`/`toEqual` with computed expected values rather than loose regex patterns.

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
const w = warn("UNKNOWN_TOKEN", "Token could not be resolved");
```

All `WarningCode` values are defined as a string literal union in `types.ts`.

### Functions that produce warnings

**Pattern:** return warnings in the result object, never via out-parameters.

```typescript
function doSomething(input): { result: string; warnings: string[] } {
  // ...
}
```

### Field format return type

All individual format handlers in `formatters.ts` return `RenderFieldResult`:

```typescript
type RenderFieldResult = {
  rendered: string;
  warning?: Warning;
  tokenAddress?: string;
  rawAddress?: string;
};
```

`rawAddress` is returned by format handlers that deal with addresses (`formatRaw` for address
values, `formatAddressName`). When present, `processSingleField` uses it as the `DisplayField.rawAddress`.

When a field value has the wrong type, use `typeMismatch(value, expected)` which returns a
`RenderFieldResult` with the raw value and an `ARGUMENT_TYPE_MISMATCH` warning.

### Byte manipulation

```typescript
import { hexToBytes, bytesToHex } from "./utils";
```

`keccak256` is module-private in `utils.ts`; use `selectorForSignature(canonical)` to compute a 4-byte function selector.

### BigInt for token amounts

All token amounts use native `bigint`. Formatting:

```typescript
import { formatAmountWithDecimals } from "./utils";
const display = formatAmountWithDecimals(1000000n, 6); // "1"
```

## Gotchas

1. **JSON imports require assertion:** `import data from './file.json' with { type: 'json' };`
2. **All imports need `.js` extension** (ESM requirement)
3. **Selector matching is case-sensitive** on function names
4. **Address normalization:** Always lowercase for comparisons
5. **Minimize exports:** Only export symbols that are imported by other modules. Keep internal helpers module-private.
6. **Check `utils.ts` before writing helpers:** Always check if `utils.ts` already has a function for what you need (e.g. `hexToBytes`, `bytesToHex`, `bytesToAscii`, `asciiToBytes`, `bigIntToBytes`, `bytesToBigInt`, etc.) before writing a new one — in both `src/` and `test/` files.
7. **Argument value conversion:** To turn a JS literal (descriptor constant, EIP-712 message value, `ifNotIn`/`mustMatch` candidate) into an `ArgumentValue`, use `toArgumentValue` from `descriptor.ts` — it infers the type from the value shape. Compare two `ArgumentValue`s with `argumentValueEquals` (cross-matches `uint`/`int` via bigint). Prefer these over bespoke per-type matching helpers.

## Descriptor Type — Defensive Programming

All fields in `Descriptor` and its nested types (`DescriptorContext`, `DescriptorMetadata`, `DescriptorDisplay`, etc.) are **optional**. This is intentional:

- Descriptors come from external sources (GitHub registry, user-supplied inline objects) with no runtime schema validation.
- Making every field optional forces callers to null-check before accessing values, preventing crashes on partial or malformed descriptors.
- The `[key: string]: unknown` index signature on `Descriptor` allows the merge algorithm in `resolver.ts` to iterate over arbitrary top-level keys while preserving proper types for known fields.

When writing code that reads descriptor fields, always guard: `descriptor.context?.contract?.deployments?.forEach(...)`.

## Not Yet Implemented (from EIP-7730 spec)

- `calldata` format (nested function calls)
- `interoperableAddressName` format (ERC-7930)
- Pre-built registry index (GitHub index is not yet wired up; currently returns empty index)
