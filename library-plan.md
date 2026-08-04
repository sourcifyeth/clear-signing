# Implementation Plan: Prototype `layout`/`switch`/`interaction`/`operation` in `@ethereum-sourcify/clear-signing`

## Context

This plan updates `library-prototype-plan.md` (`/Users/alexf/ERCs/library-prototype-plan.md`) after the companion ERC was renamed and substantially rewritten: `erc-draft_non_abi_dispatch.md` → `ERCS/erc-0000-custom-bytes-erc7730.md`, alongside a new full companion JSON Schema (`assets/erc-non-abi-dispatch/erc7730-non-abi-dispatch.schema.json`) and a much larger set of worked examples. The prototype's goal is unchanged — validate `layout`/`switch`/`interaction`/`operation` against the real decoder/renderer in `/Users/alexf/clear-signing` (`types.ts`, `fields.ts`, `descriptor.ts`, `calldata.ts`, `formatters.ts`) before pushing further as a standards proposal — but several normative shapes changed and the spec's own Test Cases section now points at different, more numerous proof cases. `/Users/alexf/clear-signing` currently has no prototype work started (`src/` has no `layout.ts`/`switch.ts`/`interaction.ts`, no uncommitted source changes) — this plan still starts from a clean slate.

**What changed since the last plan, and why it matters here:**

- `pointer`/`initCode`/`$fallback` remain dropped — no change needed to that scope call.
- `EAS attestation` example was dropped entirely (`03cdc48b`). Stage 4's old real-tx proof case no longer exists in the spec.
- `sequence`'s `tillEnd` was replaced by `count`/`countFrom` (`c2957039`) — a sibling-field-sized count (e.g. Wormhole VAA's `numSignatures`), not "read until EOF" as the sole option (that's still available: an element with no `count`/`countFrom` decodes until the buffer is exhausted).
- `switch`'s case-value vocabulary changed shape: the old `{abiType}` form is **gone from the schema entirely** — replaced by a **tuple-signature-key shorthand** (`{"(address a,uint256 b)": {intent, fields}}`) as the sole structured-data case form. No stub is needed for a form that no longer exists.
- `switch` gained a `mask` on expressions (`{path, mask}` or a `uint`/layout-node expression's own `mask`), a `payloadFrom` inline form (layout-tree switch reading a sibling ABI array at the current `sequence` index), and a formal **`$index`** mechanism with its own spec section — used for real by the ERC's own flagship examples (Universal Router, Compound Bulker), so it can no longer be deferred as "no proof case needs it."
- `operation` is a full standalone value now: `"CALL"|"DELEGATECALL"|"CREATE"|"CREATE2"|"CALLCODE"` or `{expression, cases}` where `expression` is a bare path string or `{path}` (not a full `SwitchExpression`+`mask`), and `cases` map to that same 5-value enum (uppercase) — narrower and more literal than the old plan's `"call"|"delegatecall"|{...}` sketch.
- A **top-level `switch`** (`topLevelSwitch` in the schema) now exists, replacing a format's `intent`/`fields` entirely to redirect a whole call before any field-level decoding — the `TieredExecutor` proof case (still present, still the interaction proof case) now requires this to be represented at all, per its own committed example JSON.
- The schema's closing `$comment` confirms `layout`/`switch`/`interaction` are spliced into the base `field` schema in place, so they are technically available inside nested `fieldGroup`/`reference` fields too, not only top-level `format.fields` — worth a narrower scope note, not a behavior change.
- The Test Cases section grew substantially: Safe MultiSend, Uniswap v4 Universal Router, ERC-7579 `execute`, Balancer Relayer (`joinPool`/`exitPool` + nested `userData` switch), ERC-7683 `open`, Uniswap v4 `PoolManager.initialize` (WIP), Compound III `Bulker.invoke` (WIP), Wormhole Token Bridge `completeTransfer`, and the synthetic `TieredExecutor`. This plan does not attempt all of them — see per-stage proof case choices below, confirmed with the user.

**Proof-case decisions confirmed with the user for this revision:**

1. Stage 4 (`switch`) proof cases: **ERC-7683 `open`** (clean, isolated sibling-path switch, tuple-signature cases, no `layout` needed — the closest replacement for EAS's old role) **plus Uniswap v4 Universal Router `execute`** (the ERC's only example combining `switch` + `mask` + `$index` against a real, heavily used contract) — both get real Etherscan corpora, matching Stage 3's methodology.
2. Stage 6 (`interaction`) gains the **top-level `switch`** construct, since the committed `TieredExecutor` example now requires it (`switch` at the format-declaration level, replacing `intent`/`fields`, with cases resolving to `reject`/nested `switch`/`interaction`).
3. Stage 6 also gains a **real Etherscan corpus for Compound III `Bulker.invoke`**, alongside the still-synthetic `TieredExecutor` case. Verified against the committed `example-compound-bulker.json`: every `interaction.to` in that example resolves via `path` into an already-ABI-decoded tuple field (even `ACTION_CLAIM_REWARD`'s `rewards` address is itself a decoded field of that action's tuple, not a hardcoded literal) — so `interaction.to` needs no literal-address form, just the existing path resolver. `@.from` (root-container reference, matching ERC-7730's own `@.value`/`@.from` convention) is used for `msg.sender` injection and needs to resolve through `interaction.args`' `{path}` entries.

## Key architecture decision (unchanged)

A `layout`-bearing field still has **no new rendering mode**. A `layout` field with no explicit `format` renders as `format:"raw"` — zero new `DisplayField` shape, reuses `formatRaw()` untouched (confirmed: the schema's `$format/names` list was not extended). `layout` only structures what other fields address _inside_ a buffer. Implementation-wise, `layout` is still a **path-resolution-layer wrapper**, architecturally identical to the existing `buildSliceResolvePath` (`fields.ts:740`), wired into the shared `applyFieldFormats()` (`fields.ts:77`) so it works for EIP-712 fields too, for free.

Note: `formatters.ts:816`'s `formatCalldata` (the embedded-calldata field _renderer_) is distinct from `calldata.ts:40`'s outer entry point of the same name — disambiguate as `formatters.ts:formatCalldata` throughout.

## Staged plan (checkpoint after each stage — implement, run `npm run check` + `npm test`, report, wait for go-ahead)

### Stage 0 — Types foundation

`src/types.ts`: add a `LayoutNode` union matching the companion schema's `$layout` definitions exactly:

- `uint` (`bytes: 1-32`, optional `endian: "be"|"le"`, optional `mask` — a hex/binary string pattern, applied to the raw value)
- `bytes` (`length` or `lengthFrom`, a sibling field name)
- `address`, `bool` (fixed-width, no extra params)
- `bitfield` (`bytes`, optional `endian`, `fields: {name, bit}[] | {name, bits:[hi,lo]}[]` — inclusive bit range, either a single-bit boolean flag or a multi-bit unsigned integer range)
- `object` (`fields: {name, schema, label?, format?, params?}[]` — a field's `format`/`params` resolve against paths relative to that decoded object instance's own siblings)
- `sequence` (`element`, optional `count` **or** `countFrom` — a sibling field name sized earlier in the same object; omitting both means decode until the buffer is exhausted)
- `switch` as a layout node (`expression` itself a `LayoutNode`, optional `payloadFrom`, `cases`) — distinct from the field-level `switch` key

Add `DescriptorFieldSwitch` (the field-format-spec key: `expression: string | {path, mask?} | LayoutNode`, `cases`), `SwitchCaseValue` (`"reject" | {layout} | {switch} | {format, params?} | {label, intent?: "info"|"warning"} | {"(tuple sig)": {intent?, fields}}` — no `{abiType}` form; it does not exist in the current schema), `DescriptorTopLevelSwitch` (format-declaration-level: `expression`, `cases` mapping to `"reject" | {switch: DescriptorTopLevelSwitch} | {interaction: DescriptorInteraction}`), `DescriptorInteraction` (`to: string`, `signature: string`, `args: ({path: string} | {value: unknown})[]`), and the new optional keys `layout?`/`switch?`/`interaction?` on `DescriptorFieldFormat`, plus `operation?: "CALL"|"DELEGATECALL"|"CREATE"|"CREATE2"|"CALLCODE" | {expression: string | {path: string}, cases: Record<string, "CALL"|"DELEGATECALL"|"CREATE"|"CREATE2"|"CALLCODE">}` on `DescriptorFieldFormatParams`.

Add new `WarningCode`s: `LAYOUT_DECODE_ERROR`, `UNKNOWN_SWITCH_TAG`, `SWITCH_EXPRESSION_ERROR`, `DELEGATECALL_UNRESOLVED_TARGET`, `RECURSION_LIMIT_EXCEEDED`, `INTERACTION_TARGET_UNRESOLVED`. Reuse existing `INVALID_DESCRIPTOR` for authoring-time bugs (both `format`+`layout` present, bad widths, bad bit ranges, count/countFrom both/neither where required, etc.) rather than adding a code per case.

No behavior change; `npm run check:types` clean.

### Stage 1 — `layout` core: `uint`/`bytes`/`address`/`bool`/`object`/`sequence`

New file `src/layout.ts`: `decodeNode()` recursive decoder (bounded to `MAX_LAYOUT_DEPTH = 32`, fail-closed on OOB reads / non-terminating sequences → `LAYOUT_DECODE_ERROR`), `decodeLayoutField()` top-level entry (also fails closed if the tree doesn't consume the buffer exactly), and `layoutSourceBuffer()` — converts an already-decoded scalar (`uint`/`int`/`bool`/`address`) into its canonical 32-byte ABI word, for the "anchor `layout` on an already-decoded scalar" rule. **Watch out**: don't reuse `argumentValueToBytes` naively — it returns `bool` as 1 byte and `address` as 20 bytes (correct for slicing, wrong for a 32-byte ABI word); pad correctly instead.

`uint` decoding must honor `endian` (default `"be"`, matching EVM word order) and apply `mask` post-read, before the value is exposed to path resolution or switch matching. `sequence` sizing: `count` (literal) takes priority if present; else `countFrom` looks up an already-decoded sibling field in the same enclosing `object`/root and uses its value; else decode elements until the buffer is exhausted (each element must divide the remaining bytes evenly, or fail closed with `LAYOUT_DECODE_ERROR` on a partial trailing element).

Wire into `fields.ts:applyFieldFormats` (top, before `buildSliceResolvePath`): scan top-level `format.fields` for `layout`, decode each anchored field, build a `buildLayoutResolvePath()` wrapper (checks layout-derived map, falls back to base resolver), matching the existing `sliceResolvePath` pattern. Any decode failure aborts the whole call with a warning, reusing the _existing_ `rawCalldataFallback` behavior in `calldata.ts:formatCalldata` — no new fallback plumbing needed.

Also relax `processSingleField`'s format/label guard (`fields.ts:213-222`): require `label` always, require `format XOR layout XOR switch` (not `format` alone — `switch` joins the exclusivity set here since Stage 4 needs it too), default `effectiveFormat = merged.format ?? "raw"` used everywhere `merged.format` currently is.

**Verification**: new `test/layout.spec.ts` — hand-built-bytes unit tests for `object` (mixed uint/address/uint/`lengthFrom`-sized bytes, per-field `format`/`params` resolving against sibling paths per the Safe MultiSend pattern), `sequence` (exact-multiple-of-width → correct count; `count`; `countFrom` sized from a sibling; non-multiple with neither → `LAYOUT_DECODE_ERROR`), `uint` `endian`/`mask` correctness, OOB reads, and `layoutSourceBuffer`'s 32-byte-word correctness for each scalar type. Plus one small `applyFieldFormats`-level test proving a layout-decoded sub-path resolves into a real `DisplayField`.

### Stage 2 — `operation` param on `format:"calldata"`

Moved ahead of the MultiSend e2e test (Stage 3) because the real fixture uses it.

`src/types.ts` (from Stage 0): `operation?` on `DescriptorFieldFormatParams` per the schema's `operationParam` definition — a literal `"CALL"|"DELEGATECALL"|"CREATE"|"CREATE2"|"CALLCODE"`, or `{expression, cases}` where `expression` is a bare path string or `{path}` object (no `mask` here — that's specific to `switch` expressions, not `operation`'s), `cases` mapping literal case keys to that same enum. `EmbeddedCalldata.operation?: "DELEGATECALL"` (uppercase, matching the enum).

New `src/switch.ts`: build the **shared** `matchSwitchCase()` core here (tag resolution from a path expression + exact/`$default` matching, generic over case-value type, `mask` applied when present) — Stage 4 (`switch`) extends its case-value vocabulary rather than duplicating it. `operation`'s `{expression, cases}` form reuses this same matcher with its own narrower case-value type.

`src/formatters.ts:formatCalldata` — resolve `operation` right after `callee`/`chainId`. Only `CALL`/`DELEGATECALL` recurse into a nested descriptor (the existing target-resolution path); `CREATE`/`CREATE2`/`CALLCODE` have no resolvable callee (a `CREATE` target address doesn't exist until the call executes) — display the operation label without attempting recursion. On `DELEGATECALL`, set `embeddedCalldata.operation = "DELEGATECALL"` and escalate to `DELEGATECALL_UNRESOLVED_TARGET` if the nested target has no resolvable descriptor (`NO_DESCRIPTOR`/`DEPLOYMENT_MISMATCH` in the recursive result). No `Transaction` type change needed — purely a display/warning-severity concern.

**Re-check before assuming a carryover bug**: the old plan flagged `expandParamArrayIndex` (`fields.ts:591`) needing to recurse into nested-object param values for `example-safe-multisend.json`'s `operation.expression`. Confirm during implementation whether this still applies — the current MultiSend example decodes each batched call via `layout`'s `sequence`/`object`, with `operation`'s `params` resolved as a per-element `object` field (paths relative to that decoded instance), not via `expandParamArrayIndex`'s ABI-array `.[]`-rewriting mechanism, which targets ABI `tuple[]`/array fields specifically. It may no longer be a live bug for this fixture; verify against the real code path before fixing.

**Verification**: `test/switch.spec.ts` — `matchSwitchCase()`: literal, expression-match, `$default`, unmatched-no-default (`UNKNOWN_SWITCH_TAG`), `mask` application. `test/formatters.spec.ts` — `resolveOperation`: literal, expression-match, `$default`, `CREATE`/`CREATE2`/`CALLCODE` no-recursion display, `DELEGATECALL_UNRESOLVED_TARGET` escalation.

### Stage 3 — Safe MultiSend end-to-end test, real multi-transaction corpus

This is the proof-of-viability milestone. Use the committed `assets/erc-non-abi-dispatch/example-safe-multisend.json` directly (already updated: `operation` cases are `{"0x01": "DELEGATECALL", "$default": "CALL"}`, uppercase, matching Stage 2's enum).

**Real transaction corpus, not a single tx.** Build a small scratch fetch script (not part of the library) that uses the Etherscan API (v2 unified endpoint, `chainid` param — API key to be provided) to:

1. Pull recent transactions to known MultiSend deployments (`MultiSendCallOnly` and `MultiSend`, same addresses across many chains — mainnet at minimum, plus at least one or two L2s if the corpus is thin on mainnet) via `txlist`, filtered to successful calls to `multiSend(bytes)`.
2. Select dozens (target ~30–50) of distinct, real transactions with varying record counts/operation mixes (both `CALL` and `DELEGATECALL` records if any exist in the sample).
3. Save as a committed fixture (`test/fixtures/multisend-corpus.json`: array of `{chainId, hash, to, input}`), not fetched live in CI.

**Test strategy** (mirrors `test/erc7730-test-cases/example-account-execute.spec.ts`'s pattern):

- Copy the committed example into `test/erc7730-test-cases/`.
- For **every** corpus transaction: run `format()`, assert no `LAYOUT_DECODE_ERROR`/thrown exception, assert the decoded batch-call count via `getArrayLength` matches independently re-parsing the raw `transactions` bytes length against the ABI encoding rules.
- For a **hand-picked subset** (3–5 transactions spanning different chains/record-counts/operation values): assert exact `to`/`value`/`data`/`operation` per record against Etherscan's own "Decode Input Data" view, plus full `DisplayField`/`DisplayFieldGroup` property assertions per `AGENTS.md` guidelines.
- One negative test: truncate a real corpus tx's `transactions` bytes mid-record → assert fail-closed `LAYOUT_DECODE_ERROR` + `rawCalldataFallback`, not a thrown exception.
- Register a minimal local descriptor for whatever token(s) the corpus's embedded calls actually invoke, so at least some records resolve to fully rendered nested calls, not just raw fallback.

**Verification**: `npm test -- multisend` — full corpus passes structural checks, hand-verified subset passes exact-value checks, negative test proves fail-closed behavior. `npm run check` clean.

### Stage 4 — `switch`, `$index`, `mask`: ERC-7683 + Uniswap v4 Universal Router

`src/types.ts` (from Stage 0): finalize `SwitchCaseValue` per the schema — `"reject" | {layout: LayoutNode} | {switch: DescriptorFieldSwitch} | {format, params?} | {label, intent?} | {"(tuple sig)": {intent?, fields}}`. The tuple-signature shorthand needs structural detection (single key starting with `"("`) — isolate in one `parseSwitchCase()` function in `src/switch.ts`, not inline.

Wire into `fields.ts:processSingleField`: a field with `switch` resolves its case via `matchSwitchCase()` (from Stage 2) before format/layout handling. `{layout}`/`{switch}` recurse into `layout.ts:decodeNode`'s `switch` case (bump depth, reuse `MAX_LAYOUT_DEPTH`). `{format}` applies `renderField` with that format on the already-resolved value. `{label,intent}` is terminal — add a small dedicated `DisplayField.switchTerminal?: {text: string; intent: "info"|"warning"}` field rather than overloading the existing `warning` field (an info-only label styled as an error would be a real UX regression for wallets); this covers the spec's own inline example (Balancer's "Set by an earlier step" chained-reference pattern) at the unit level — no real corpus needed for this specific case form, it's demonstrated structurally in the spec text itself.

**`$index`**: add support for `path[$index]` inside a `switch` expression's `path`/`{path}` — resolved against the position of the enclosing array field being iterated (`inputs[]`/`data[]` in the real proof cases below), reading the same-position element of a **sibling** `layout`-decoded `sequence` or ABI array. This was deferred as out-of-scope in the prior plan; it is no longer optional — both chosen proof cases below depend on it, and the ERC now gives it its own top-level spec section.

**`mask`**: add to `LayoutNode` `uint` decoding (Stage 1) and to `switch` expressions (`{path, mask}`) — applied to the raw resolved value before case matching, per Universal Router's command-byte high-bit/low-6-bits split.

**Proof case 1 — ERC-7683 `open` (Across `AcrossOriginSettler`)**: sibling-path `switch` in isolation from `layout`/`$index`/`mask` — `orderData`'s tuple-signature-keyed cases dispatch on `orderDataType` (a `bytes32` hash tag), the cleanest replacement for the old EAS proof case. Use the committed `example-erc7683-order.json` directly.

**Proof case 2 — Uniswap v4 Universal Router `execute`**: exercises `switch` + `mask` (`commands[$index]` masked with `0x3f` to strip the revert-allowed flag) + `$index` (`inputs[]` addressed elementwise by position against a `layout`-decoded `commands` sequence) together, against a real, heavily used contract. Use the committed `example-universal-router.json` directly.

**Real corpora for both**, same methodology as Stage 3 (Etherscan-sourced, committed fixtures, not fetched live in CI):

- `test/fixtures/erc7683-order-corpus.json` — `open()` calls to `AcrossOriginSettler` (chainId 8453/Base per the committed example; check other chains it's deployed on for breadth), filtered to successful calls, target ~15–25 transactions covering at least the one known `orderDataType` case plus (if any exist in the wild) an unmatched-tag negative case.
- `test/fixtures/universal-router-corpus.json` — `execute()` calls to Uniswap's `Universal Router` (mainnet at minimum), target ~30–50 transactions with varying `commands` mixes, specifically including both `0x00` (swap) and `0x04` (sweep) command bytes since those are the two cases the committed example implements; command bytes outside that set should hit `$default: "reject"` and must not throw.

**Test strategy**: mirrors Stage 3 — full-corpus structural pass (no throw, no `UNKNOWN_SWITCH_TAG`/`SWITCH_EXPRESSION_ERROR` on matched tags), hand-verified subset (3–5 txs per corpus) against Etherscan's own decode view, one negative test per corpus (an unmatched tag hits `reject`/`$default` cleanly, not a thrown exception).

**Verification**: `test/switch.spec.ts` (unit: exact/`$default`/no-match, `mask`, `$index`, tuple-shorthand parsing). `test/erc7730-test-cases/example-erc7683-order.spec.ts` and `example-universal-router.spec.ts` against their real corpora. `npm run check` clean.

### Stage 5 — `bitfield`

Fill in `layout.ts`'s `case "bitfield"` stub: extract single-bit (`{name, bit}` → `bool`) and multi-bit-range (`{name, bits: [hi, lo]}`, inclusive → unsigned integer) subfields from a fixed-width word, honoring `endian` (Stage 1's `uint` endian handling should be factored so `bitfield` reuses the same byte-order logic rather than duplicating it). Pure byte-parsing correctness, no real-tx integration needed — proof case is Uniswap v4's hook-address flags (`PoolManager.initialize`, marked WIP in the spec text — treat the committed `example-uniswap-v4-initialize.json` as the target shape but confirm it against the spec text before treating it as final), anchored on an already-ABI-decoded `address` value via `layoutSourceBuffer` from Stage 1.

**Verification**: `test/layout.spec.ts` bitfield block — single-bit, multi-bit ranges, overlapping ranges, `endian` correctness, out-of-width-range negative cases (`INVALID_DESCRIPTOR`).

### Stage 6 — `interaction` and top-level `switch`: TieredExecutor (synthetic) + Compound III Bulker (real corpus)

Refactor `calldata.ts:formatCalldata`'s post-decode tail (build `resolvePath`/`getArrayLength` → `applyFieldFormats` → interpolation/metadata assembly) into a reusable `renderFormat()` helper, so `interaction` can call it against a synthetic argument map instead of round-tripping through an ABI encoder (which doesn't exist in this codebase — only a decoder does).

New `src/interaction.ts`: `resolveInteraction()` — resolves `to` (a path into already-decoded values, confirmed against every case in the real Bulker example — no literal-address form is needed), looks up the target descriptor (needs `resolveCalldataDescriptor` threaded down into `FieldContext`, the one place this change reaches outside `fields.ts`/`formatters.ts`/new files), matches by canonical signature via a new `findFormatBySignature()` (sibling to existing `findFormatBySelector` in `calldata.ts`), binds `args` positionally (`{path}` — including `@.from` for root-container reference, reusing the existing `@.`-prefix path convention already used elsewhere in ERC-7730 — or `{value}` literals; scalar-typed args only, array/tuple-typed args out of scope), then calls `renderFormat()`.

**Top-level `switch`** (new construct, required for `TieredExecutor` as committed): a format entry can carry `switch` in place of `intent`/`fields` entirely — `{expression, cases}` where each case resolves to `"reject"`, a nested `{switch}`, or `{interaction}`. Wire this as an alternate entry point in `calldata.ts`'s per-format dispatch, checked before the normal `intent`/`fields` path. Reuses `matchSwitchCase()` from Stage 2/4.

**Proof case 1 (synthetic, unchanged from prior plan) — `TieredExecutor`**: use the committed `example-tiered-executor.json` directly — it already uses top-level `switch` dispatching to two `interaction` cases (`grantReward`/`creditAccount`, different parameter order than the source call). No real transaction exists for this construct in isolation; this remains illustrative-only, matching the ERC's own admission.

**Proof case 2 (real, new in this revision) — Compound III `Bulker.invoke`**: use the committed `example-compound-bulker.json` directly — four `switch` cases (`SUPPLY_ASSET`/`TRANSFER_ASSET`/`WITHDRAW_ASSET`/`CLAIM_REWARD`, tag-dispatched via `bytes32` action-name constants) each ending in an `interaction`, addressed via `data[]` + `actions[$index]` (same `$index` machinery as Stage 4's Universal Router case — this stage depends on Stage 4 being complete). Note the ERC still marks this example WIP; treat the committed JSON as the working target but re-diff it against the spec text before writing the corpus tests, in case it changes further.

**Real corpus**, same methodology as Stage 3/4: `test/fixtures/bulker-corpus.json` — `invoke()` calls to Compound III's `Bulker` (mainnet at minimum, check other chains Comet is deployed on for breadth), target ~20–30 transactions covering all four action types if present in the wild. Full-corpus structural pass (no throw, no `UNKNOWN_SWITCH_TAG` on matched action tags, correct `interaction`-recursion target resolution), hand-verified subset (3–5 txs) asserting the reconstructed `supplyFrom`/`transferAssetFrom`/`withdrawFrom`/`claim` calls' args match Etherscan's own decode of the real `Comet`/`CometRewards` calls those actions produce, one negative test for an unrecognized action tag (`reject`, not a thrown exception).

**Verification**: `test/interaction.spec.ts` (signature matching, positional binding incl. `@.from`, unresolved-target/-signature fallbacks). `test/switch.spec.ts` (top-level `switch` dispatch: `reject`, nested `switch`, `interaction` cases). `test/erc7730-test-cases/example-tiered-executor.spec.ts` (full recursion into both branches). `test/erc7730-test-cases/example-compound-bulker.spec.ts` against the real corpus. `npm run check` clean.

## Out of scope (explicit)

- `initCode`/`$fallback`/`pointer` — dropped from the ERC itself (a `pointer` layout node existed briefly mid-history and was removed again; confirmed absent from the current schema).
- Nested `DescriptorFieldGroup`/`reference` support for `layout`/`switch`/`interaction` — the schema's own closing `$comment` confirms these keys are structurally reachable there too (spliced into the base `field` schema, not a separate copy), but no current example exercises it and this prototype does not add dedicated tests for it. Don't claim it works without a dedicated test.
- `#.` cross-scope-boundary path resolution — `stripStructuredRootPrefix` satisfies simple cases only; do not claim genuine cross-scope resolution works without a dedicated test (none planned here).
- ERC-7579 `execute`, Balancer Relayer `joinPool`/`exitPool` (nested `switch`-in-`switch`, chained-reference masking), Wormhole Token Bridge `completeTransfer` (`countFrom` at real scale, opaque non-ABI outer buffer) — cited as spec evidence with committed example JSON, not targeted for prototyping in this pass. `countFrom` itself is still covered at the unit level in Stage 1; only the Wormhole real-corpus angle is deferred.

## Critical files

- `/Users/alexf/clear-signing/src/types.ts`
- `/Users/alexf/clear-signing/src/fields.ts`
- `/Users/alexf/clear-signing/src/layout.ts` (new)
- `/Users/alexf/clear-signing/src/switch.ts` (new)
- `/Users/alexf/clear-signing/src/formatters.ts`
- `/Users/alexf/clear-signing/src/calldata.ts`
- `/Users/alexf/clear-signing/src/interaction.ts` (new, Stage 6)
- `/Users/alexf/clear-signing/test/erc7730-test-cases/example-safe-multisend.spec.ts` (new, Stage 3)
- `/Users/alexf/clear-signing/test/erc7730-test-cases/example-erc7683-order.spec.ts` (new, Stage 4)
- `/Users/alexf/clear-signing/test/erc7730-test-cases/example-universal-router.spec.ts` (new, Stage 4)
- `/Users/alexf/clear-signing/test/erc7730-test-cases/example-tiered-executor.spec.ts` (new, Stage 6)
- `/Users/alexf/clear-signing/test/erc7730-test-cases/example-compound-bulker.spec.ts` (new, Stage 6)
- `/Users/alexf/clear-signing/test/fixtures/multisend-corpus.json` (new, Stage 3, Etherscan-sourced)
- `/Users/alexf/clear-signing/test/fixtures/erc7683-order-corpus.json` (new, Stage 4, Etherscan-sourced)
- `/Users/alexf/clear-signing/test/fixtures/universal-router-corpus.json` (new, Stage 4, Etherscan-sourced)
- `/Users/alexf/clear-signing/test/fixtures/bulker-corpus.json` (new, Stage 6, Etherscan-sourced)
- Source examples (already committed, copy into `test/erc7730-test-cases/`, do not re-author): `/Users/alexf/ERCs/assets/erc-non-abi-dispatch/example-safe-multisend.json`, `example-erc7683-order.json`, `example-universal-router.json`, `example-tiered-executor.json`, `example-compound-bulker.json`

## Verification (every stage)

```bash
cd /Users/alexf/clear-signing
npm run check   # tsc --noEmit + prettier --check + eslint
npm test        # full vitest suite — catches regressions in shared paths (applyFieldFormats, expandParamArrayIndex, processSingleField)
npm run fix     # before any commit, per AGENTS.md
```

"Done" per stage = the stage's named tests pass with real computed-value assertions (`toBe`/`toEqual`), not just "no throw" — and for Stage 3/4/6 specifically, the real Etherscan-sourced corpus (dozens of transactions where stated, multi-chain where relevant) is committed as a fixture and used, not a single hand-picked tx.
