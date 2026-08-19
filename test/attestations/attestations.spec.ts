/**
 * ERC-8176 descriptor attestations: descriptor hashing (RFC 8785 JCS +
 * keccak256), offchain attestation verification, and the trusted-attester
 * policy on the descriptor resolvers.
 *
 * The fixtures are the registry's Tether USD descriptor (`calldata-usdt.json`)
 * and its real attestation from the registry's `sigs/` directory, so the hash
 * and signature checks run against production data. Edge cases use
 * attestations generated with a test key via an independent mirror of the EAS
 * EIP-712 encoding.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect, assert, vi } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  attestationPathForDescriptor,
  computeDescriptorHash,
  format,
  isFieldGroup,
  resolveCalldataDescriptor,
  resolveTypedDataDescriptor,
  verifyAttestation,
} from "../../src/index.js";
import type {
  AttestationOptions,
  Descriptor,
  DescriptorResolver,
  DisplayModel,
  ExternalDataProvider,
  FormatOptions,
  OffchainAttestation,
  OffchainAttestationDomain,
  OffchainAttestationMessage,
  TrustedTokens,
} from "../../src/types.js";
import {
  asciiToBytes,
  bigIntToBytes,
  bytesToHex,
  concatBytes,
  hexToBytes,
  keccak256,
  toChecksumAddress,
  utf8ToBytes,
} from "../../src/utils.js";
import { buildFilesystemResolverOpts } from "../utils.js";

const CHAIN_ID = 1;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CYFRIN_ATTESTER = "0x3846c3A30E62075Fa916216b35EF04B8F53931f6";
const ALICE = "0x1234567890abcdef1234567890abcdef12345678";

const checksum = (addr: string) => toChecksumAddress(hexToBytes(addr));
const word = (hex: string) => hex.padStart(64, "0");
const addrWord = (addr: string) => word(addr.slice(2).toLowerCase());

const descriptor = JSON.parse(
  readFileSync(`${__dirname}/calldata-usdt.json`, "utf-8"),
) as Descriptor;
const registryAttestation = JSON.parse(
  readFileSync(
    `${__dirname}/sigs/calldata-usdt.eip155-1-${CYFRIN_ATTESTER}.json`,
    "utf-8",
  ),
) as OffchainAttestation;
const descriptorHash = computeDescriptorHash(descriptor);

// ---------------------------------------------------------------------------
// Test attestation generation — an independent mirror of the EAS EIP-712
// encoding and offchain UID derivation, signed with a fixed test key.
// ---------------------------------------------------------------------------

const SCHEMA_UID =
  "0xe023eef113c1670774801c34b377fdf612dd8a4d2fa92fe382e15bd91fafb5c2";
const ATTEST_TYPE =
  "Attest(uint16 version,bytes32 schema,address recipient,uint64 time,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,bytes32 salt)";
const EIP712_DOMAIN_TYPE =
  "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const EAS_DOMAIN: OffchainAttestationDomain = {
  name: "EAS Attestation",
  version: "0.26",
  chainId: "1",
  verifyingContract: "0xA1207F3BBa224E2c9c3c6D5aF63D0eb1582Ce587",
};
const FAR_FUTURE = "253402300799"; // 9999-12-31T23:59:59Z

const TEST_PRIVATE_KEY = hexToBytes("0x" + "01".repeat(32));
const TEST_ATTESTER = toChecksumAddress(
  keccak256(secp256k1.getPublicKey(TEST_PRIVATE_KEY, false).subarray(1)).slice(
    -20,
  ),
);

function attestMessage(
  dataHash: string,
  overrides: Partial<OffchainAttestationMessage> = {},
): OffchainAttestationMessage {
  return {
    version: 2,
    schema: SCHEMA_UID,
    recipient: "0x0000000000000000000000000000000000000000",
    time: "1785288536",
    expirationTime: "0",
    revocable: true,
    refUID: "0x" + "00".repeat(32),
    data: dataHash,
    salt: "0x" + "11".repeat(32),
    ...overrides,
  };
}

function leftPadAddress(address: string): Uint8Array {
  return concatBytes(new Uint8Array(12), hexToBytes(address));
}

function attestDigest(
  domain: OffchainAttestationDomain,
  message: OffchainAttestationMessage,
): Uint8Array {
  const domainSeparator = keccak256(
    concatBytes(
      keccak256(utf8ToBytes(EIP712_DOMAIN_TYPE)),
      keccak256(utf8ToBytes(domain.name ?? "")),
      keccak256(utf8ToBytes(domain.version ?? "")),
      bigIntToBytes(BigInt(domain.chainId ?? 0)),
      leftPadAddress(domain.verifyingContract ?? ""),
    ),
  );
  const structHash = keccak256(
    concatBytes(
      keccak256(utf8ToBytes(ATTEST_TYPE)),
      bigIntToBytes(BigInt(message.version ?? 0)),
      hexToBytes(message.schema ?? ""),
      leftPadAddress(message.recipient ?? ""),
      bigIntToBytes(BigInt(message.time ?? 0)),
      bigIntToBytes(BigInt(message.expirationTime ?? 0)),
      bigIntToBytes(message.revocable ? 1n : 0n),
      hexToBytes(message.refUID ?? ""),
      keccak256(hexToBytes(message.data ?? "")),
      hexToBytes(message.salt ?? ""),
    ),
  );
  return keccak256(
    concatBytes(Uint8Array.from([0x19, 0x01]), domainSeparator, structHash),
  );
}

function offchainUid(message: OffchainAttestationMessage): string {
  return bytesToHex(
    keccak256(
      concatBytes(
        bigIntToBytes(BigInt(message.version ?? 0), 2),
        utf8ToBytes(message.schema ?? ""),
        hexToBytes(message.recipient ?? ""),
        new Uint8Array(20), // attester placeholder — always zero offchain
        bigIntToBytes(BigInt(message.time ?? 0), 8),
        bigIntToBytes(BigInt(message.expirationTime ?? 0), 8),
        Uint8Array.from([message.revocable ? 1 : 0]),
        hexToBytes(message.refUID ?? ""),
        hexToBytes(message.data ?? ""),
        hexToBytes(message.salt ?? ""),
        new Uint8Array(4), // bump
      ),
    ),
  );
}

function signAttestation(
  message: OffchainAttestationMessage,
  domain: OffchainAttestationDomain = EAS_DOMAIN,
): OffchainAttestation {
  const signature = secp256k1.sign(
    attestDigest(domain, message),
    TEST_PRIVATE_KEY,
  );
  return {
    sig: {
      version: 2,
      uid: offchainUid(message),
      domain,
      primaryType: "Attest",
      message,
      signature: {
        v: 27 + (signature.recovery ?? 0),
        r: bytesToHex(bigIntToBytes(signature.r)),
        s: bytesToHex(bigIntToBytes(signature.s)),
      },
    },
    signer: TEST_ATTESTER,
  };
}

// ---------------------------------------------------------------------------
// computeDescriptorHash
// ---------------------------------------------------------------------------

describe("computeDescriptorHash", () => {
  it("matches the descriptor hash attested in the registry", () => {
    expect(descriptorHash).toBe(registryAttestation.sig?.message?.data);
  });

  it("canonicalizes per RFC 8785: sorted keys, JS numbers, UTF-8 strings", () => {
    // Known answer computed with an independent JCS implementation. Exercises
    // key sorting, number formatting (1e21 → "1e+21"), null/bool literals,
    // and 2-, 3-, and 4-byte UTF-8 sequences.
    const value = {
      b: 2,
      a: ["x", 1.5, null, true],
      unicode: "Dürer ☺ 𝄞",
      nested: { z: 1e21, y: 10000000 },
    } as Descriptor;
    expect(computeDescriptorHash(value)).toBe(
      "0xfccf25db4416defbd0c33f31039232d791df215ab38e2ebe1e2a761fb4f1ba24",
    );
  });

  it("is independent of object key order", () => {
    const reordered = {
      display: descriptor.display,
      metadata: descriptor.metadata,
      context: descriptor.context,
      $schema: descriptor.$schema,
    } as Descriptor;
    expect(computeDescriptorHash(reordered)).toBe(descriptorHash);
  });
});

// ---------------------------------------------------------------------------
// attestationPathForDescriptor
// ---------------------------------------------------------------------------

describe("attestationPathForDescriptor", () => {
  it("builds the sigs/ path next to the descriptor", () => {
    expect(
      attestationPathForDescriptor(
        "registry/tether/calldata-usdt.json",
        CYFRIN_ATTESTER,
      ),
    ).toBe(
      `registry/tether/sigs/calldata-usdt.eip155-1-${CYFRIN_ATTESTER}.json`,
    );
  });

  it("checksums a lowercase attester address", () => {
    expect(
      attestationPathForDescriptor(
        "calldata-usdt.json",
        CYFRIN_ATTESTER.toLowerCase(),
      ),
    ).toBe(`sigs/calldata-usdt.eip155-1-${CYFRIN_ATTESTER}.json`);
  });

  it("throws on an invalid attester address", () => {
    expect(() =>
      attestationPathForDescriptor("calldata-usdt.json", "0x1234"),
    ).toThrow(/Invalid attester address/);
  });
});

// ---------------------------------------------------------------------------
// verifyAttestation
// ---------------------------------------------------------------------------

describe("verifyAttestation", () => {
  it("verifies the real registry attestation and recovers the attester", async () => {
    const result = await verifyAttestation(registryAttestation, descriptorHash);
    expect(result).toEqual({ attester: CYFRIN_ATTESTER });
  });

  it("verifies a generated attestation with a bounded expiration", async () => {
    const attestation = signAttestation(
      attestMessage(descriptorHash, { expirationTime: FAR_FUTURE }),
    );
    const result = await verifyAttestation(attestation, descriptorHash);
    expect(result).toEqual({ attester: TEST_ATTESTER });
  });

  it("accepts an attestation without the optional uid and signer fields", async () => {
    const attestation = signAttestation(attestMessage(descriptorHash));
    delete attestation.sig?.uid;
    delete attestation.signer;
    const result = await verifyAttestation(attestation, descriptorHash);
    expect(result).toEqual({ attester: TEST_ATTESTER });
  });

  it("passes the recovered attester and recomputed uid to checkRevocation", async () => {
    const checkRevocation = vi.fn(async () => false);
    const result = await verifyAttestation(
      registryAttestation,
      descriptorHash,
      {
        checkRevocation,
      },
    );
    expect(result).toEqual({ attester: CYFRIN_ATTESTER });
    expect(checkRevocation).toHaveBeenCalledExactlyOnceWith(
      CYFRIN_ATTESTER,
      registryAttestation.sig?.uid,
    );
  });

  it("rejects a revoked attestation", async () => {
    const result = await verifyAttestation(
      registryAttestation,
      descriptorHash,
      {
        checkRevocation: async () => true,
      },
    );
    assert("reason" in result);
    expect(result.reason).toContain("revoked");
  });

  it("rejects an expired attestation", async () => {
    const attestation = signAttestation(
      attestMessage(descriptorHash, { expirationTime: "1000000000" }),
    );
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain("expired");
  });

  it("rejects a non-canonical schema", async () => {
    const attestation = signAttestation(
      attestMessage(descriptorHash, { schema: "0x" + "ab".repeat(32) }),
    );
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain("not the canonical ERC-8176 schema");
  });

  it("rejects when the attested hash differs from the computed hash", async () => {
    const otherHash = "0x" + "cd".repeat(32);
    const attestation = signAttestation(attestMessage(otherHash));
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain(
      `attested descriptor hash ${otherHash} does not match`,
    );
  });

  it("rejects an unsupported offchain attestation version", async () => {
    const attestation = signAttestation(
      attestMessage(descriptorHash, { version: 1 }),
    );
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain(
      "unsupported offchain attestation version 1",
    );
  });

  it("rejects a domain that is not the canonical EAS contract on mainnet", async () => {
    const attestation = signAttestation(attestMessage(descriptorHash), {
      ...EAS_DOMAIN,
      chainId: "11155111",
    });
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain("canonical EAS contract");
  });

  it("rejects a tampered message (signature recovers a different address)", async () => {
    const attestation = signAttestation(attestMessage(descriptorHash));
    assert(attestation.sig?.message);
    attestation.sig.message.time = "1785288537"; // +1s after signing
    // Keep the uid consistent with the tampered message so the signature
    // check is what fails.
    attestation.sig.uid = offchainUid(attestation.sig.message);
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain(`not the declared signer ${TEST_ATTESTER}`);
  });

  it("rejects a tampered uid", async () => {
    const attestation = signAttestation(attestMessage(descriptorHash));
    assert(attestation.sig);
    attestation.sig.uid = "0x" + "ee".repeat(32);
    const result = await verifyAttestation(attestation, descriptorHash);
    assert("reason" in result);
    expect(result.reason).toContain("does not match the computed uid");
  });

  it("rejects a structurally incomplete attestation", async () => {
    const result = await verifyAttestation(
      { signer: TEST_ATTESTER },
      descriptorHash,
    );
    assert("reason" in result);
    expect(result.reason).toContain("malformed attestation");
  });
});

// ---------------------------------------------------------------------------
// Attestation policy — end to end through format()
// ---------------------------------------------------------------------------

const externalData: ExternalDataProvider = {
  resolveToken: async (chainId, address) =>
    chainId === CHAIN_ID && address === USDT.toLowerCase()
      ? { name: "Tether USD", symbol: "USDT", decimals: 6 }
      : null,
  resolveLocalName: async (address) =>
    address.toLowerCase() === ALICE.toLowerCase()
      ? { name: "Alice", typeMatch: true }
      : null,
};

const TRANSFER = "0xa9059cbb" + addrWord(ALICE) + word("f4240"); // 1 USDT

function tetherOpts(attestations?: AttestationOptions): FormatOptions {
  const fsOpts = buildFilesystemResolverOpts(
    __dirname,
    {
      calldataDescriptorFiles: [
        { chainId: CHAIN_ID, address: USDT, file: "calldata-usdt.json" },
      ],
    },
    externalData,
  );
  if (!attestations) return fsOpts;
  const resolverOptions = fsOpts.descriptorResolverOptions;
  assert(resolverOptions);
  return {
    ...fsOpts,
    descriptorResolverOptions: { ...resolverOptions, attestations },
  };
}

function assertTetherTransfer(result: DisplayModel) {
  expect(result.intent).toBe("Send");
  expect(result.interpolatedIntent).toBeUndefined();
  expect(result.rawCalldataFallback).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  expect(result.metadata).toEqual({
    owner: "Tether Limited",
    contractName: "Tether USD",
    info: { url: "https://tether.to/", deploymentDate: "2017-11-28T12:41:21Z" },
  });

  assert(result.fields);
  expect(result.fields).toHaveLength(2);

  const amount = result.fields[0];
  assert(!isFieldGroup(amount));
  expect(amount.label).toBe("Amount");
  expect(amount.value).toBe("1 USDT");
  expect(amount.fieldType).toBe("uint");
  expect(amount.format).toBe("tokenAmount");
  expect(amount.tokenAddress).toBe(USDT);
  expect(amount.rawAddress).toBeUndefined();
  expect(amount.embeddedCalldata).toBeUndefined();
  expect(amount.warning).toBeUndefined();

  const to = result.fields[1];
  assert(!isFieldGroup(to));
  expect(to.label).toBe("To");
  expect(to.value).toBe("Alice");
  expect(to.fieldType).toBe("address");
  expect(to.format).toBe("addressName");
  expect(to.rawAddress).toBe(checksum(ALICE));
  expect(to.tokenAddress).toBeUndefined();
  expect(to.embeddedCalldata).toBeUndefined();
  expect(to.warning).toBeUndefined();
}

describe("attestation policy — format() with the filesystem resolver", () => {
  const tx = { chainId: CHAIN_ID, to: USDT, data: TRANSFER };

  it("formats when a trusted attester has a valid attestation", async () => {
    const result = await format(
      tx,
      tetherOpts({ trustedAttesters: [CYFRIN_ATTESTER] }),
    );
    assertTetherTransfer(result);
  });

  it("accepts a lowercase trusted attester address", async () => {
    const result = await format(
      tx,
      tetherOpts({ trustedAttesters: [CYFRIN_ATTESTER.toLowerCase()] }),
    );
    assertTetherTransfer(result);
  });

  it("skips trusted attesters without an attestation file", async () => {
    const result = await format(
      tx,
      tetherOpts({ trustedAttesters: [ALICE, CYFRIN_ATTESTER] }),
    );
    assertTetherTransfer(result);
  });

  it("formats without any attestation check when no policy is set (testing only)", async () => {
    const result = await format(tx, tetherOpts());
    assertTetherTransfer(result);
  });

  it("falls back to raw calldata when no trusted attester has an attestation", async () => {
    const result = await format(tx, tetherOpts({ trustedAttesters: [ALICE] }));
    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("NO_TRUSTED_ATTESTATION");
    assert(result.rawCalldataFallback);
    expect(result.rawCalldataFallback.selector).toBe("0xa9059cbb");
    expect(result.rawCalldataFallback.args).toEqual([
      addrWord(ALICE),
      word("f4240"),
    ]);
  });

  it("falls back to raw calldata when the trusted attester list is empty", async () => {
    const result = await format(tx, tetherOpts({ trustedAttesters: [] }));
    expect(result.warnings?.[0].code).toBe("NO_TRUSTED_ATTESTATION");
    expect(result.rawCalldataFallback?.selector).toBe("0xa9059cbb");
  });

  it("reports an invalid trusted attester address in the warning", async () => {
    const result = await format(
      tx,
      tetherOpts({ trustedAttesters: ["not-an-address"] }),
    );
    expect(result.warnings?.[0].code).toBe("NO_TRUSTED_ATTESTATION");
    expect(result.warnings?.[0].message).toContain(
      "invalid attester address 'not-an-address'",
    );
  });

  it("rejects the descriptor when the attestation was revoked", async () => {
    const result = await format(
      tx,
      tetherOpts({
        trustedAttesters: [CYFRIN_ATTESTER],
        checkRevocation: async () => true,
      }),
    );
    expect(result.warnings?.[0].code).toBe("NO_TRUSTED_ATTESTATION");
    expect(result.warnings?.[0].message).toContain("revoked");
    expect(result.rawCalldataFallback?.selector).toBe("0xa9059cbb");
  });

  it("formats when checkRevocation reports the attestation as not revoked", async () => {
    const checkRevocation = vi.fn(async () => false);
    const result = await format(
      tx,
      tetherOpts({ trustedAttesters: [CYFRIN_ATTESTER], checkRevocation }),
    );
    assertTetherTransfer(result);
    expect(checkRevocation).toHaveBeenCalledExactlyOnceWith(
      CYFRIN_ATTESTER,
      registryAttestation.sig?.uid,
    );
  });

  it("returns ATTESTATIONS_NOT_SUPPORTED for a resolver without fetchAttestation", async () => {
    const resolver: DescriptorResolver = {
      index: {
        calldataIndex: {
          [`eip155:${CHAIN_ID}:${USDT.toLowerCase()}`]: "calldata-usdt.json",
        },
        typedDataIndex: {},
      },
      fetchDescriptor: async () => descriptor,
    };
    const result = await format(tx, {
      descriptorResolverOptions: {
        type: "custom",
        resolver,
        attestations: { trustedAttesters: [CYFRIN_ATTESTER] },
      },
      externalDataProvider: externalData,
    });
    assert(result.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("ATTESTATIONS_NOT_SUPPORTED");
    expect(result.rawCalldataFallback?.selector).toBe("0xa9059cbb");
  });

  it("does not gate bundled trusted-token descriptors", async () => {
    const trustedTokens: TrustedTokens = {
      [CHAIN_ID]: { [USDT.toLowerCase()]: "erc20" },
    };
    const result = await format(tx, {
      descriptorResolverOptions: {
        type: "github",
        index: { calldataIndex: {}, typedDataIndex: {} },
        trustedTokens,
        // No attestation exists for the bundled descriptor, but the wallet
        // vouches for the token directly, so formatting must still work.
        attestations: { trustedAttesters: [CYFRIN_ATTESTER] },
      },
      externalDataProvider: externalData,
    });
    expect(result.intent).toBe("Send");
    expect(result.warnings).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Attestation policy — includes are resolved before hashing
// ---------------------------------------------------------------------------

describe("attestation policy — includes resolution", () => {
  const CONTRACT = "0x9876543210987654321098765432109876543210";
  const including: Descriptor = {
    includes: "./common-included.json",
    context: {
      contract: {
        deployments: [{ chainId: CHAIN_ID, address: CONTRACT }],
      },
    },
    metadata: { owner: "Including Owner" },
  };
  const included: Descriptor = {
    display: {
      formats: {
        "transfer(address to,uint256 value)": {
          intent: "Included Send",
          fields: [{ path: "to", label: "Recipient", format: "raw" }],
        },
      },
    },
  };

  function buildResolver(
    attestations: Record<string, OffchainAttestation>,
  ): DescriptorResolver {
    return {
      index: {
        calldataIndex: {
          [`eip155:${CHAIN_ID}:${CONTRACT}`]: "registry/test/calldata-a.json",
        },
        typedDataIndex: {},
      },
      fetchDescriptor: async (path) => {
        if (path === "registry/test/calldata-a.json") return including;
        if (path === "registry/test/common-included.json") return included;
        throw new Error(`Unexpected path ${path}`);
      },
      fetchAttestation: async (path, attester) =>
        attestations[attestationPathForDescriptor(path, attester)] ?? null,
    };
  }

  it("accepts an attestation over the merged (includes-resolved) descriptor", async () => {
    // Resolve once without a policy to obtain the merged descriptor and its hash.
    const resolved = await resolveCalldataDescriptor(CHAIN_ID, CONTRACT, {
      type: "custom",
      resolver: buildResolver({}),
    });
    assert("descriptor" in resolved);
    expect(resolved.descriptor.includes).toBeUndefined();
    const mergedHash = computeDescriptorHash(resolved.descriptor);

    const attestation = signAttestation(attestMessage(mergedHash));
    const sigsPath = `registry/test/sigs/calldata-a.eip155-1-${TEST_ATTESTER}.json`;
    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT,
        data: "0xa9059cbb" + addrWord(ALICE) + word("1"),
      },
      {
        descriptorResolverOptions: {
          type: "custom",
          resolver: buildResolver({ [sigsPath]: attestation }),
          attestations: { trustedAttesters: [TEST_ATTESTER] },
        },
      },
    );

    expect(result.intent).toBe("Included Send");
    expect(result.metadata?.owner).toBe("Including Owner");
    expect(result.warnings).toBeUndefined();
  });

  it("rejects an attestation over the raw including file", async () => {
    const rawHash = computeDescriptorHash(including);
    const attestation = signAttestation(attestMessage(rawHash));
    const sigsPath = `registry/test/sigs/calldata-a.eip155-1-${TEST_ATTESTER}.json`;
    const result = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT,
        data: "0xa9059cbb" + addrWord(ALICE) + word("1"),
      },
      {
        descriptorResolverOptions: {
          type: "custom",
          resolver: buildResolver({ [sigsPath]: attestation }),
          attestations: { trustedAttesters: [TEST_ATTESTER] },
        },
      },
    );

    assert(result.warnings);
    expect(result.warnings[0].code).toBe("NO_TRUSTED_ATTESTATION");
    expect(result.warnings[0].message).toContain(
      "does not match the computed hash",
    );
  });
});

// ---------------------------------------------------------------------------
// Attestation policy — typed-data resolution
// ---------------------------------------------------------------------------

describe("attestation policy — resolveTypedDataDescriptor", () => {
  const VERIFYING_CONTRACT = "0x5555555555555555555555555555555555555555";
  const ENCODE_TYPE = "Mail(address to)";
  const eip712Descriptor: Descriptor = {
    context: {
      eip712: {
        deployments: [{ chainId: CHAIN_ID, address: VERIFYING_CONTRACT }],
      },
    },
    display: {
      formats: {
        [ENCODE_TYPE]: {
          intent: "Send mail",
          fields: [{ path: "to", label: "To", format: "raw" }],
        },
      },
    },
  };
  const typedData = {
    account: ALICE,
    domain: { chainId: CHAIN_ID, verifyingContract: VERIFYING_CONTRACT },
    types: { Mail: [{ name: "to", type: "address" }] },
    primaryType: "Mail",
    message: { to: ALICE },
  };

  function buildResolver(
    attestations: Record<string, OffchainAttestation>,
  ): DescriptorResolver {
    return {
      index: {
        calldataIndex: {},
        typedDataIndex: {
          [`eip155:${CHAIN_ID}:${VERIFYING_CONTRACT}`]: {
            Mail: [
              {
                path: "eip712-mail.json",
                encodeTypeHashes: [
                  bytesToHex(keccak256(asciiToBytes(ENCODE_TYPE))),
                ],
              },
            ],
          },
        },
      },
      fetchDescriptor: async () => eip712Descriptor,
      fetchAttestation: async (path, attester) =>
        attestations[attestationPathForDescriptor(path, attester)] ?? null,
    };
  }

  it("resolves when a trusted attester attested the descriptor", async () => {
    const attestation = signAttestation(
      attestMessage(computeDescriptorHash(eip712Descriptor)),
    );
    const result = await resolveTypedDataDescriptor(typedData, {
      type: "custom",
      resolver: buildResolver({
        [`sigs/eip712-mail.eip155-1-${TEST_ATTESTER}.json`]: attestation,
      }),
      attestations: { trustedAttesters: [TEST_ATTESTER] },
    });
    assert("descriptor" in result);
    expect(result.descriptor).toEqual(eip712Descriptor);
  });

  it("fails with NO_TRUSTED_ATTESTATION when no attestation exists", async () => {
    const result = await resolveTypedDataDescriptor(typedData, {
      type: "custom",
      resolver: buildResolver({}),
      attestations: { trustedAttesters: [TEST_ATTESTER] },
    });
    assert("warning" in result);
    expect(result.warning.code).toBe("NO_TRUSTED_ATTESTATION");
    expect(result.warning.message).toContain("eip712-mail.json");
  });
});
