/**
 * ERC-8176 descriptor attestations.
 *
 * Auditors attest ERC-7730 descriptors with EAS offchain attestations over a
 * canonical `bytes32 descriptorHash` schema. This module implements the
 * offline parts of the ERC-8176 verification procedure: descriptor hashing,
 * attestation signature verification, and the registry's `sigs/` file
 * convention. Revocation state lives on-chain, so checking it is delegated to
 * the wallet via `AttestationOptions.checkRevocation`.
 *
 * See https://github.com/ethereum/ERCs/pull/1576 and the registry's
 * `auditors/` directory for the audit process.
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import type {
  AttestationVerificationResult,
  Descriptor,
  OffchainAttestation,
  OffchainAttestationDomain,
  OffchainAttestationMessage,
  OffchainAttestationSignature,
} from "./types.js";
import {
  bigIntToBytes,
  bytesToHex,
  coerceBigInt,
  concatBytes,
  hexToBytes,
  keccak256,
  normalizeAddress,
  toChecksumAddress,
  utf8ToBytes,
} from "./utils.js";

/** UID of the canonical ERC-8176 EAS schema (`bytes32 descriptorHash`). */
const ERC8176_SCHEMA_UID =
  "0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2";

/** The canonical EAS contract the schema is registered on (Ethereum mainnet). */
const EAS_MAINNET_ADDRESS = "0xa1207f3bba224e2c9c3c6d5af63d0eb1582ce587";
const EAS_MAINNET_CHAIN_ID = 1;

/** The EAS offchain attestation version ERC-8176 attestations use. */
const OFFCHAIN_ATTESTATION_VERSION = 2;

const EIP712_DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const ATTEST_TYPE =
  "Attest(uint16 version,bytes32 schema,address recipient,uint64 time,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,bytes32 salt)";

/**
 * Serialize a JSON value per RFC 8785 (JCS). For values produced by
 * `JSON.parse` this is `JSON.stringify` with recursively sorted object keys —
 * JCS defines number and string serialization by reference to ECMAScript's
 * `JSON.stringify`, and its key order is the UTF-16 code unit order that
 * plain string comparison yields.
 */
function canonicalizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? "null" : canonicalizeJson(item)))
      .join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Compute the ERC-8176 descriptor hash: keccak256 of the RFC 8785 (JCS)
 * canonical JSON of the fully resolved descriptor, as a lowercase 0x-hex
 * string.
 *
 * The hash is defined over the descriptor with its `includes` chain already
 * resolved and merged — pass the descriptor that
 * `resolveCalldataDescriptor` / `resolveTypedDataDescriptor` return, not a
 * raw file that still carries an `includes` key.
 */
export function computeDescriptorHash(descriptor: Descriptor): string {
  return bytesToHex(keccak256(utf8ToBytes(canonicalizeJson(descriptor))));
}

/**
 * Path of the attestation file that `attester` publishes for the descriptor
 * at `descriptorPath`, following the registry convention
 * `<dir>/sigs/<name>.eip155-1-<checksummedAttester>.json`. The path is
 * relative to the same root as `descriptorPath`.
 *
 * Accepts a lowercase or EIP-55 checksummed attester address; throws when the
 * address is not a valid 20-byte hex address.
 */
export function attestationPathForDescriptor(
  descriptorPath: string,
  attester: string,
): string {
  const address = hexToBytes(attester);
  if (address.length !== 20) {
    throw new Error(`Invalid attester address '${attester}'`);
  }
  const lastSlash = descriptorPath.lastIndexOf("/");
  const dir = descriptorPath.slice(0, lastSlash + 1);
  const filename = descriptorPath.slice(lastSlash + 1);
  const name = filename.endsWith(".json") ? filename.slice(0, -5) : filename;
  return `${dir}sigs/${name}.eip155-${EAS_MAINNET_CHAIN_ID}-${toChecksumAddress(address)}.json`;
}

/**
 * Verify a single ERC-8176 offchain attestation against a descriptor hash
 * (as computed by {@link computeDescriptorHash}). Follows the ERC's
 * verification procedure:
 *
 *   1. the schema is the canonical ERC-8176 schema,
 *   2. the attested data equals `descriptorHash`,
 *   3. the EIP-712 domain pins the canonical EAS contract on Ethereum mainnet,
 *   4. `expirationTime` (0 = never expires) has not passed,
 *   5. the EIP-712 signature recovers the attester,
 *   6. the recomputed offchain attestation UID matches the declared one, and
 *   7. the attester has not revoked the attestation — checked through
 *      `options.checkRevocation` when provided, skipped otherwise.
 *
 * Returns the recovered attester on success. Whether that attester is
 * trusted (the ERC's final step) is the caller's decision.
 *
 * Only EAS offchain attestation version 2 and EOA attesters are supported;
 * ERC-1271 contract attesters and onchain attestations need chain access and
 * are out of scope for this library.
 */
export async function verifyAttestation(
  attestation: OffchainAttestation,
  descriptorHash: string,
  options?: {
    checkRevocation?: (attester: string, uid: string) => Promise<boolean>;
  },
): Promise<AttestationVerificationResult> {
  const { domain, message, signature } = attestation.sig ?? {};
  if (!domain || !message || !signature) {
    return {
      reason:
        "malformed attestation: sig.domain, sig.message, or sig.signature is missing",
    };
  }

  if (message.version !== OFFCHAIN_ATTESTATION_VERSION) {
    return {
      reason: `unsupported offchain attestation version ${String(message.version)}`,
    };
  }
  if (
    typeof message.schema !== "string" ||
    message.schema.toLowerCase() !== ERC8176_SCHEMA_UID
  ) {
    return {
      reason: `schema ${String(message.schema)} is not the canonical ERC-8176 schema`,
    };
  }
  if (
    typeof message.data !== "string" ||
    message.data.toLowerCase() !== descriptorHash.toLowerCase()
  ) {
    return {
      reason: `attested descriptor hash ${String(message.data)} does not match the computed hash ${descriptorHash}`,
    };
  }
  if (
    typeof domain.name !== "string" ||
    typeof domain.version !== "string" ||
    Number(domain.chainId) !== EAS_MAINNET_CHAIN_ID ||
    typeof domain.verifyingContract !== "string" ||
    normalizeAddress(domain.verifyingContract) !== EAS_MAINNET_ADDRESS
  ) {
    return {
      reason:
        "attestation domain does not pin the canonical EAS contract on Ethereum mainnet",
    };
  }

  const time = coerceBigInt(message.time);
  const expirationTime = coerceBigInt(message.expirationTime);
  if (
    time === undefined ||
    expirationTime === undefined ||
    typeof message.revocable !== "boolean" ||
    typeof message.recipient !== "string" ||
    typeof message.refUID !== "string" ||
    typeof message.salt !== "string"
  ) {
    return { reason: "malformed attestation: message fields are missing" };
  }
  if (
    expirationTime !== 0n &&
    expirationTime <= BigInt(Math.floor(Date.now() / 1000))
  ) {
    return { reason: `attestation expired at ${expirationTime}` };
  }

  let attester: string;
  let uid: string;
  try {
    const digest = computeAttestDigest(domain, message, time, expirationTime);
    attester = toChecksumAddress(recoverSigner(digest, signature));
    uid = computeOffchainUid(message, time, expirationTime);
  } catch {
    return { reason: "malformed attestation: invalid signature or encoding" };
  }

  const { signer } = attestation;
  if (
    signer !== undefined &&
    (typeof signer !== "string" ||
      normalizeAddress(signer) !== normalizeAddress(attester))
  ) {
    return {
      reason: `signature recovers ${attester}, not the declared signer ${String(signer)}`,
    };
  }

  const declaredUid = attestation.sig?.uid;
  if (
    declaredUid !== undefined &&
    (typeof declaredUid !== "string" || declaredUid.toLowerCase() !== uid)
  ) {
    return {
      reason: `declared attestation uid ${String(declaredUid)} does not match the computed uid ${uid}`,
    };
  }

  if (
    options?.checkRevocation &&
    (await options.checkRevocation(attester, uid))
  ) {
    return { reason: `attestation ${uid} was revoked by ${attester}` };
  }

  return { attester };
}

/** Decode a bytes32 hex string, throwing when it is not exactly 32 bytes. */
function bytes32(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (bytes.length !== 32) throw new Error("Expected 32 bytes");
  return bytes;
}

/** ABI-encode an address as a 32-byte word (left-padded with zeros). */
function addressWord(address: string): Uint8Array {
  const bytes = hexToBytes(address);
  if (bytes.length !== 20) throw new Error("Expected a 20-byte address");
  const word = new Uint8Array(32);
  word.set(bytes, 12);
  return word;
}

/** Compute the EIP-712 signing digest of an EAS `Attest` message. */
function computeAttestDigest(
  domain: OffchainAttestationDomain,
  message: OffchainAttestationMessage,
  time: bigint,
  expirationTime: bigint,
): Uint8Array {
  const domainSeparator = keccak256(
    concatBytes(
      keccak256(utf8ToBytes(EIP712_DOMAIN_TYPE)),
      keccak256(utf8ToBytes(domain.name ?? "")),
      keccak256(utf8ToBytes(domain.version ?? "")),
      bigIntToBytes(BigInt(domain.chainId ?? 0)),
      addressWord(domain.verifyingContract ?? ""),
    ),
  );
  const structHash = keccak256(
    concatBytes(
      keccak256(utf8ToBytes(ATTEST_TYPE)),
      bigIntToBytes(BigInt(message.version ?? 0)),
      bytes32(message.schema ?? ""),
      addressWord(message.recipient ?? ""),
      bigIntToBytes(time),
      bigIntToBytes(expirationTime),
      bigIntToBytes(message.revocable ? 1n : 0n),
      bytes32(message.refUID ?? ""),
      keccak256(hexToBytes(message.data ?? "")),
      bytes32(message.salt ?? ""),
    ),
  );
  return keccak256(
    concatBytes(Uint8Array.from([0x19, 0x01]), domainSeparator, structHash),
  );
}

/** Recover the 20-byte signer address of an ECDSA signature over `digest`. */
function recoverSigner(
  digest: Uint8Array,
  signature: OffchainAttestationSignature,
): Uint8Array {
  const { r, s, v } = signature;
  if (typeof r !== "string" || typeof s !== "string" || typeof v !== "number") {
    throw new Error("Missing signature components");
  }
  const recovery = v >= 27 ? v - 27 : v;
  const publicKey = secp256k1.Signature.fromCompact(
    concatBytes(bigIntToBytes(BigInt(r)), bigIntToBytes(BigInt(s))),
  )
    .addRecoveryBit(recovery)
    .recoverPublicKey(digest)
    .toRawBytes(false);
  return keccak256(publicKey.subarray(1)).slice(-20);
}

/**
 * Recompute the deterministic EAS offchain attestation UID (version 2):
 * keccak256 of the packed encoding
 * `(uint16 version, bytes utf8(schema), address recipient, address attester,
 * uint64 time, uint64 expirationTime, bool revocable, bytes32 refUID,
 * bytes data, bytes32 salt, uint32 bump)` with the attester fixed to the
 * zero address and bump fixed to 0, matching the EAS SDK.
 *
 * Recomputing (rather than trusting the declared `sig.uid`) matters for
 * revocation: `getRevokeOffchain` is keyed by uid, so a tampered uid would
 * otherwise hide an existing revocation.
 */
function computeOffchainUid(
  message: OffchainAttestationMessage,
  time: bigint,
  expirationTime: bigint,
): string {
  return bytesToHex(
    keccak256(
      concatBytes(
        bigIntToBytes(BigInt(message.version ?? 0), 2),
        utf8ToBytes(message.schema ?? ""),
        hexToBytes(message.recipient ?? ""),
        new Uint8Array(20),
        bigIntToBytes(time, 8),
        bigIntToBytes(expirationTime, 8),
        Uint8Array.from([message.revocable ? 1 : 0]),
        bytes32(message.refUID ?? ""),
        hexToBytes(message.data ?? ""),
        bytes32(message.salt ?? ""),
        bigIntToBytes(0n, 4),
      ),
    ),
  );
}
