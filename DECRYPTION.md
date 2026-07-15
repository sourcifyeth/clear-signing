# Decrypting Encrypted Fields

ERC-7730 lets a descriptor mark a field's value as encrypted. This page is the
guide to implementing `ExternalDataProvider.resolveDecryptedValue`, which is how
a wallet decrypts those values so the library can display them.

**This is optional.** Encrypted transactions format fine without it — encrypted
fields simply render their descriptor's `fallbackLabel` (e.g.
`"[Encrypted Amount]"`) while every other field formats as usual. Implement it
only if your wallet wants to show users the actual decrypted values.

The spec defines encryption _schemes_, and a descriptor names the one it uses.
**Today ERC-7730 defines exactly one: `fhevm`**, the fully homomorphic encryption
scheme used by [Zama Protocol](https://www.zama.org/)'s confidential tokens. The
first half of this page is the scheme-agnostic contract; the second is what
`fhevm` specifically requires.

This page assumes you already have an `ExternalDataProvider` — see
[GUIDE.md §4](GUIDE.md#4-build-the-externaldataprovider).

## What the descriptor declares

A descriptor marks a field's value as encrypted, telling your wallet to decrypt
it and the library how to render the result:

```jsonc
{
  "path": "encryptedAmount",
  "label": "Amount",
  "format": "tokenAmount",
  "params": { "tokenPath": "@.to" },
  "encryption": {
    "scheme": "fhevm",
    "plaintextType": "uint64",
    "fallbackLabel": "[Encrypted Amount]",
  },
}
```

The library calls `resolveDecryptedValue`, then renders the plaintext with the
field's regular `format` — so this field shows `"1 cUSDC"` once decrypted. If you
return `null`, it shows `"[Encrypted Amount]"` with a `DECRYPTION_FAILED`
warning (or a generic `"[Encrypted]"` when a descriptor declares no
`fallbackLabel`). The raw handle is always reported on
`DisplayField.rawEncryptedValue`, which the spec RECOMMENDS showing — fully or
truncated — beside the placeholder.

The division of labour: **your wallet decrypts and reports; the library
interprets and renders.**

## The callback contract

- **Dispatch on `params.scheme`** and return `null` for anything you don't
  handle. `null` is a normal outcome, not an error — including when the user
  declines a signature or access is denied. The field falls back cleanly.
- **`encryptedValue`** is 0x-hex of the raw field value.
  **`params.contractAddress`** is the container's `@.to`, the contract the value
  belongs to. It is absent when an EIP-712 domain declares no
  `verifyingContract`.
- **Return `value` as 0x-prefixed hex** of the plaintext's big-endian bytes —
  never a `bigint` or `boolean`. See [Encoding the result](#encoding-the-result).
- **Don't cast to the descriptor's `plaintextType`** — that's why it isn't passed
  to you. Decryption yields bytes; typing them is the library's job.

Decryption sits in the wallet rather than the library because schemes generally
need a live connection, a signature from the user, and an access-control check —
none of which belong in a formatting library. `fhevm` needs all three.

# The `fhevm` scheme (Zama Protocol)

Everything below is specific to `fhevm`, currently the only scheme ERC-7730
defines.

## What the encrypted value actually is

For `fhevm`, the `bytes32` in the calldata is **not a ciphertext**. It's a
**handle** — a pointer into the coprocessor's off-chain ciphertext store. The
real ciphertext is far too large to live in calldata, so the chain only ever
moves these 32-byte references around.

That means decryption is a network round-trip, not a local computation, and the
handle is what you hand to the SDK.

## Implementing the callback

Zama's relayer SDK handles the round-trip:

```bash
npm install @zama-fhe/relayer-sdk
```

```typescript
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import type { ExternalDataProvider } from "@ethereum-sourcify/clear-signing";

const instance = await createInstance(SepoliaConfig);

const resolveDecryptedValue: ExternalDataProvider["resolveDecryptedValue"] =
  async (chainId, encryptedValue, { scheme, contractAddress }) => {
    // Decline anything this wallet doesn't handle — the field then renders
    // its fallbackLabel. `contractAddress` is required for the ACL check.
    if (scheme !== "fhevm" || !contractAddress) return null;

    const { publicKey, privateKey } = instance.generateKeypair();
    const extraData = await instance.getExtraData();
    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 1;

    // The grant covers a set of contracts for a time window and contains no
    // handles — so this signature can be cached and reused (see below).
    const eip712 = instance.createEIP712(
      publicKey,
      [contractAddress],
      startTimestamp,
      durationDays,
      extraData,
    );
    const signature = await signer.signTypedData(
      eip712.domain,
      {
        UserDecryptRequestVerification:
          eip712.types.UserDecryptRequestVerification,
      },
      eip712.message,
    );

    const results = await instance.userDecrypt(
      [{ handle: encryptedValue, contractAddress }],
      privateKey,
      publicKey,
      signature,
      [contractAddress],
      userAddress,
      startTimestamp,
      durationDays,
      extraData,
    );

    const clear = results[encryptedValue]; // bigint | boolean | `0x${string}`
    if (clear === undefined) return null;
    return { value: toHexPlaintext(clear) };
  };
```

For values that are publicly decryptable, `instance.publicDecrypt(handles)`
needs no keypair or signature and returns `{ clearValues, … }` keyed by handle.

## Encoding the result

`DecryptedValueResult.value` must be **0x-prefixed hex of the plaintext's
big-endian bytes** — the SDK's `bigint`/`boolean` results need converting. The
library re-interprets those bytes using the descriptor's `plaintextType`.

```typescript
function toHexPlaintext(clear: bigint | boolean | string): string {
  if (typeof clear === "string") return clear; // already hex (address, bytes, bytesN)
  const n = typeof clear === "boolean" ? (clear ? 1n : 0n) : clear;
  const hex = n.toString(16);
  // Pad to even length — `"0x" + n.toString(16)` alone is a common bug:
  // 1000000n → "0xf4240" is odd-length and rejected as a failed decryption.
  // Leading zeros are insignificant here.
  return "0x" + (hex.length % 2 ? "0" + hex : hex);
}
```

Convert only the encoding, never the type — which is why `plaintextType` isn't
passed to the callback. `userDecrypt` already returns a correctly typed value
(the handle encodes its FHE type); hex-encode it as-is and let the library
interpret it from the descriptor.

## Signatures and batching

The callback fires **once per encrypted field**, but that does not mean one
prompt per field: `createEIP712` takes **no handles**, so a single signature
covers every handle for those contracts until it expires. Cache the
signature/keypair per `(contracts, window)` and reuse it. Memoizing decrypted
values by handle avoids repeat round-trips within a transaction.

## Reference

- [Zama Protocol documentation](https://docs.zama.org/protocol)
- [Relayer SDK](https://github.com/zama-ai/relayer-sdk)
- [Registry descriptor](https://github.com/ethereum/clear-signing-erc7730-registry)
  — `registry/zama/calldata-ConfidentialWrapper.json`
