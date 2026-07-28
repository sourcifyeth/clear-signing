# Decrypting Encrypted Fields

ERC-7730 lets a descriptor mark a field's value as encrypted. This page is the
guide to implementing `ExternalDataProvider.resolveDecryptedValue`, which is how
a wallet decrypts those values so the library can display them.

**This is optional.** Encrypted transactions format fine without it — encrypted
fields simply render their descriptor's `fallbackLabel` (e.g.
`"[Encrypted Amount]"`) while every other field formats as usual. Implement it
only if your wallet wants to show users the actual decrypted values.

The spec defines encryption _schemes_, and a descriptor names the one it uses.
**Today ERC-7730 defines exactly one: `fhevm`**, the fully homomorphic
encryption scheme used by Zama Protocol's confidential tokens. The first half of
this page is the scheme-agnostic contract; the second is what `fhevm`
specifically requires.

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

Decryption sits in the wallet rather than the library because schemes generally
need a live connection, a signature from the user, and an access-control check —
none of which belong in a formatting library. `fhevm` needs all three. So the
library delegates through one optional method on `ExternalDataProvider`:

```typescript
interface ExternalDataProvider {
  // …the other resolvers

  resolveDecryptedValue?: (
    chainId: number,
    encryptedValue: string,
    params: {
      scheme: DescriptorFieldEncryptionScheme;
      contractAddress?: string;
    },
  ) => Promise<DecryptedValueResult | null>;
}

interface DecryptedValueResult {
  value: string;
}

// The schemes ERC-7730 defines. A union, so a wallet dispatching on it gets
// exhaustiveness checking as new schemes are added.
type DescriptorFieldEncryptionScheme = "fhevm";
```

| Parameter                | Meaning                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `chainId`                | The container's chain — the network to decrypt against.                                                                    |
| `encryptedValue`         | 0x-hex of the raw field value. For `fhevm`, the 32-byte handle.                                                            |
| `params.scheme`          | The descriptor's declared scheme. Dispatch on this.                                                                        |
| `params.contractAddress` | The contract the value belongs to (the container's `@.to`). Absent when an EIP-712 domain declares no `verifyingContract`. |
| _returns_                | `DecryptedValueResult` with the plaintext as 0x-hex, or `null` if you cannot decrypt.                                      |

Four rules:

- **Dispatch on `params.scheme`** and return `null` for anything you don't
  handle. `null` is a normal outcome, not an error — it also covers a user
  declining the signature or access being denied. The field falls back cleanly
  to its `fallbackLabel`, so never throw for these.
- **Return `value` as 0x-prefixed hex** of the plaintext's big-endian bytes —
  never a `bigint` or `boolean`. See [Encoding the result](#encoding-the-result).
- **Don't cast to the descriptor's `plaintextType`** — that's why it isn't passed
  to you. Decryption yields bytes; typing them is the library's job.
- **Expect one call per encrypted field.** Cache whatever your scheme makes
  expensive and memoize by `encryptedValue` — for `fhevm` that means reusing the
  EIP-712 signature, see [Signatures and batching](#signatures-and-batching).

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

Zama publishes a JavaScript SDK that performs the whole round-trip: given the
handle and the contract it belongs to, it has the user sign an EIP-712 grant
authorising the decryption, requests it, and returns the cleartext — unsealed
locally from an ephemeral key so it is never exposed in transit. Publicly
decryptable values need no signature at all. See the
[Zama Protocol documentation](https://docs.zama.org/) for setup and the current
API; it is the authoritative source, and the signatures change between versions.

Return `null` wherever you cannot complete this — an unsupported scheme, a
missing `contractAddress`, a declined signature, or an ACL rejection.

## Encoding the result

`DecryptedValueResult.value` must be **0x-prefixed hex of the plaintext's
big-endian bytes**. The SDK returns a typed JavaScript value — an integer, a
boolean, or a hex string depending on the handle's FHE type — so integers and
booleans need encoding before you return them.

Three things are easy to get wrong:

- **Pad to an even number of hex digits.** `"0x" + n.toString(16)` yields
  `"0xf4240"` for `1000000n`, which is odd-length and rejected as a failed
  decryption.
- **Keep the value within its declared type.** A plaintext too wide for the
  descriptor's `plaintextType` is also treated as a failed decryption, since
  rendering it would show a wrong number rather than an obviously broken one.
  Zero-padding is always safe for integers, addresses and bools — a full 32-byte
  ABI word for a `uint64` is fine, because leading zeros carry no value there.
  For `bytesN` every byte counts, so return exactly the N bytes.
- **Convert the encoding, never the type.** The SDK already returns the value at
  its correct type (the handle encodes it), and the descriptor already declares
  `plaintextType` — which is why that type is not passed to your callback.
  Hex-encode as-is and let the library interpret it.

## Signatures and batching

One call per encrypted field does **not** mean one signing prompt per field: the
EIP-712 grant is scoped to a set of contracts and a time window, not to
individual handles — so a single signature serves every handle for those
contracts until it expires. Cache the signature and ephemeral keypair per
`(contracts, window)` and reuse them. Memoizing decrypted values by handle avoids
repeat round-trips within a transaction.
