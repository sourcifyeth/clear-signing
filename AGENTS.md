# AGENTS.md - AI Agent Guide

This file provides context for AI coding assistants working on this codebase.

## Project Overview

This is a TypeScript implementation of [ERC-7730](https://eips.ethereum.org/EIPS/eip-7730) - Structured Data Clear Signing Format. It transforms Ethereum transaction calldata and EIP-712 typed data into human-readable display models for wallet clear signing UIs.

**Origin:** Direct port of the Rust implementation at [reown-com/yttrium](https://github.com/reown-com/yttrium/tree/main/crates/yttrium/src/clear_signing).

## Architecture

```
src/
├── index.ts           # Public API: format(), formatWithValue(), formatTypedData()
├── types.ts           # TypeScript interfaces and types
├── errors.ts          # Error classes: DescriptorError, EngineError, ResolverError, Eip712Error
├── utils.ts           # Crypto & formatting: keccak256, checksums, hex conversion
├── descriptor.ts      # Descriptor parsing, ABI decoding, calldata decoding
├── engine.ts          # Display formatting logic for transactions
├── eip712.ts          # Display formatting logic for EIP-712 typed data
├── resolver.ts        # Descriptor lookup by chain ID + contract address
├── token-registry.ts  # Token metadata lookup (symbol, decimals, name)
└── assets/            # Embedded JSON data (descriptors, ABIs, token registry)
```

## Key Data Flow

1. **Transaction formatting:**

   ```
   format(chainId, to, calldata)
   → resolver.resolveCall() finds descriptor + token metadata
   → engine.formatWithResolvedCall() decodes calldata and applies display rules
   → returns DisplayModel
   ```

2. **EIP-712 formatting:**
   ```
   formatTypedData(typedData)
   → resolver.resolveTyped() finds descriptor by verifyingContract
   → eip712.formatTypedData() applies display rules to message fields
   → returns DisplayModel
   ```

## Important Concepts

### Descriptors (EIP-7730)

JSON files that define how to display contract interactions:

- `context.contract.deployments` - Chain/address bindings
- `context.contract.abi` - Function definitions for calldata decoding
- `display.formats` - Per-function display rules with field formatting
- `metadata` - Constants, token info, address book entries

### Field Formats

Supported: `tokenAmount`, `amount`, `date`, `address`, `addressName`, `enum`, `number`, `raw`

### Token Lookup

Uses CAIP-19 identifiers:

- ERC-20: `eip155:{chainId}/erc20:{address}`
- Native: `eip155:{chainId}/slip44:60` (ETH)

### Path Resolution

- `@.to` - Contract address being called
- `@value` - Transaction value
- `$.metadata.*` - Descriptor metadata fields
- Direct paths like `spender`, `value`, `amount`

## Common Tasks

### Adding a new contract descriptor

1. Create descriptor JSON in `src/assets/descriptors/`
2. Add ABI JSON in `src/assets/abis/` (if not inline)
3. Add entry to `src/assets/index.json` mapping `eip155:{chainId}:{address}` to descriptor path
4. Import and register in `src/resolver.ts` (descriptorMap, abiMap)

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

## Not Yet Implemented (from EIP-7730 spec)

- `duration` format (HH:MM:ss)
- `unit` format (SI prefixes)
- `nftName` format
- `chainId` format (ID to chain name)
- `calldata` format (nested function calls)
- `interoperableAddressName` format (ERC-7930)
- Full path syntax with `#` prefix for structured data root
