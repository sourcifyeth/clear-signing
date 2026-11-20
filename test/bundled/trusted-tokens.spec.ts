/**
 * Trusted-token bundled descriptors: when no registry descriptor resolves for
 * a contract, a wallet-supplied `trustedTokens` list lets the library render
 * the transaction from a bundled ERC-20 / ERC-721 template, and an ERC-2612
 * Permit message from the bundled Permit template.
 */

import { describe, it, expect, assert } from "vitest";
import {
  format,
  formatTypedData,
  isFieldGroup,
  resolveTypedDataDescriptor,
} from "../../src/index.js";
import type {
  DisplayModel,
  ExternalDataProvider,
  BaseResolverOptions,
  ChainClient,
  FormatOptions,
  TrustedTokens,
  TypedData,
  TypedDataIndexEntry,
} from "../../src/types.js";
import { erc2612PermitDescriptor } from "../../src/bundled/erc2612-permit.js";
import { hexToBytes, toChecksumAddress } from "../../src/utils.js";
import { buildFilesystemResolverOpts, padAddr, padInt } from "../utils.js";

const CHAIN_ID = 1;
const TOKEN = "0xA0b86991c6218b36c1d19D4a2E9Eb0cE3606eB48";
const COLLECTION = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
const ALICE = "0x1234567890abcdef1234567890abcdef12345678";
const ALICE_NAME = "Alice";
const OPERATOR = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
const ATTESTER = "0x0000000000000000000000000000000000000001";
const MAX_UINT256 =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const checksum = (addr: string) => toChecksumAddress(hexToBytes(addr));

const externalData: ExternalDataProvider = {
  resolveToken: async (chainId, address) =>
    chainId === CHAIN_ID && address === TOKEN.toLowerCase()
      ? { name: "Test Token", symbol: "TKN", decimals: 6 }
      : null,
  resolveLocalName: async (address) =>
    address.toLowerCase() === ALICE.toLowerCase()
      ? { name: ALICE_NAME, typeMatch: true }
      : null,
  resolveNftCollectionName: async (chainId, address) =>
    chainId === CHAIN_ID && address.toLowerCase() === COLLECTION.toLowerCase()
      ? { name: "Cool Cats" }
      : null,
};

const TRUSTED_ERC20: TrustedTokens = {
  [CHAIN_ID]: { [TOKEN.toLowerCase()]: "erc20" },
};
const TRUSTED_ERC721: TrustedTokens = {
  [CHAIN_ID]: { [COLLECTION.toLowerCase()]: "erc721" },
};
const TRUSTED_ERC2612: TrustedTokens = {
  [CHAIN_ID]: { [TOKEN.toLowerCase()]: "erc2612" },
};

/** FormatOptions with an empty registry index (no network) + a trusted-token list. */
function opts(
  trustedTokens: TrustedTokens,
  externalDataProvider: ExternalDataProvider = externalData,
): FormatOptions {
  return {
    descriptorResolverOptions: {
      type: "github",
      index: { calldataIndex: {}, typedDataIndex: {} },
      trustedTokens,
    },
    externalDataProvider,
  };
}

describe("trusted tokens — bundled ERC-20", () => {
  it("formats transfer(address,uint256) as Send", async () => {
    const data = "0xa9059cbb" + padAddr(ALICE) + padInt(1_000_000n);
    const result: DisplayModel = await format(
      { chainId: CHAIN_ID, to: TOKEN, data },
      opts(TRUSTED_ERC20),
    );

    expect(result.intent).toBe("Send");
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    // The bundled ERC-20 template carries no metadata.
    expect(result.metadata).toBeUndefined();

    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    const amount = result.fields[0];
    assert(!isFieldGroup(amount));
    expect(amount.label).toBe("Amount");
    expect(amount.value).toBe("1 TKN");
    expect(amount.fieldType).toBe("uint");
    expect(amount.format).toBe("tokenAmount");
    expect(amount.tokenAddress).toBe(checksum(TOKEN));
    expect(amount.rawAddress).toBeUndefined();
    expect(amount.embeddedCalldata).toBeUndefined();
    expect(amount.warning).toBeUndefined();

    const to = result.fields[1];
    assert(!isFieldGroup(to));
    expect(to.label).toBe("To");
    expect(to.value).toBe(ALICE_NAME);
    expect(to.fieldType).toBe("address");
    expect(to.format).toBe("addressName");
    expect(to.rawAddress).toBe(checksum(ALICE));
    expect(to.tokenAddress).toBeUndefined();
    expect(to.embeddedCalldata).toBeUndefined();
    expect(to.warning).toBeUndefined();
  });

  it("formats approve(address,uint256) over threshold as Unlimited", async () => {
    const data = "0x095ea7b3" + padAddr(OPERATOR) + MAX_UINT256;
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data },
      opts(TRUSTED_ERC20),
    );

    expect(result.intent).toBe("Approve");
    expect(result.warnings).toBeUndefined();
    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    const spender = result.fields[0];
    assert(!isFieldGroup(spender));
    expect(spender.label).toBe("Spender");
    expect(spender.value).toBe(checksum(OPERATOR));
    expect(spender.fieldType).toBe("address");
    expect(spender.format).toBe("addressName");
    expect(spender.rawAddress).toBe(checksum(OPERATOR));
    expect(spender.tokenAddress).toBeUndefined();
    expect(spender.embeddedCalldata).toBeUndefined();
    // OPERATOR is not resolvable by the mock provider.
    expect(spender.warning?.code).toBe("UNKNOWN_ADDRESS");

    const amount = result.fields[1];
    assert(!isFieldGroup(amount));
    expect(amount.label).toBe("Amount");
    expect(amount.value).toBe("Unlimited TKN");
    expect(amount.fieldType).toBe("uint");
    expect(amount.format).toBe("tokenAmount");
    expect(amount.tokenAddress).toBe(checksum(TOKEN));
    expect(amount.rawAddress).toBeUndefined();
    expect(amount.embeddedCalldata).toBeUndefined();
    expect(amount.warning).toBeUndefined();
  });
});

describe("trusted tokens — bundled ERC-721", () => {
  it("formats safeTransferFrom(address,address,uint256) as Send NFT", async () => {
    const data =
      "0x42842e0e" + padAddr(ALICE) + padAddr(OPERATOR) + padInt(1337n);
    const result = await format(
      { chainId: CHAIN_ID, to: COLLECTION, data },
      opts(TRUSTED_ERC721),
    );

    expect(result.intent).toBe("Send NFT");
    expect(result.warnings).toBeUndefined();
    assert(result.fields);
    expect(result.fields).toHaveLength(3);

    const from = result.fields[0];
    assert(!isFieldGroup(from));
    expect(from.label).toBe("From");
    expect(from.value).toBe(ALICE_NAME);
    expect(from.format).toBe("addressName");
    expect(from.fieldType).toBe("address");
    expect(from.rawAddress).toBe(checksum(ALICE));
    expect(from.warning).toBeUndefined();

    const to = result.fields[1];
    assert(!isFieldGroup(to));
    expect(to.label).toBe("To");
    expect(to.value).toBe(checksum(OPERATOR));
    expect(to.format).toBe("addressName");
    expect(to.rawAddress).toBe(checksum(OPERATOR));
    expect(to.warning?.code).toBe("UNKNOWN_ADDRESS");

    const nft = result.fields[2];
    assert(!isFieldGroup(nft));
    expect(nft.label).toBe("NFT");
    expect(nft.value).toBe("Cool Cats #1337");
    expect(nft.format).toBe("nftName");
    expect(nft.fieldType).toBe("uint");
    expect(nft.tokenAddress).toBeUndefined();
    expect(nft.rawAddress).toBeUndefined();
    expect(nft.embeddedCalldata).toBeUndefined();
    expect(nft.warning).toBeUndefined();
  });

  it("formats setApprovalForAll(address,bool) with the bool rendered as an enum", async () => {
    const data = "0xa22cb465" + padAddr(OPERATOR) + padInt(1n); // approved = true
    const result = await format(
      { chainId: CHAIN_ID, to: COLLECTION, data },
      opts(TRUSTED_ERC721),
    );

    expect(result.intent).toBe("Manage operator rights for");
    assert(result.fields);
    expect(result.fields).toHaveLength(3);

    const collection = result.fields[0];
    assert(!isFieldGroup(collection));
    expect(collection.label).toBe("Collection");
    expect(collection.value).toBe(checksum(COLLECTION));
    expect(collection.format).toBe("addressName");
    expect(collection.rawAddress).toBe(checksum(COLLECTION));
    expect(collection.warning?.code).toBe("UNKNOWN_ADDRESS");

    const operator = result.fields[1];
    assert(!isFieldGroup(operator));
    expect(operator.label).toBe("Operator");
    expect(operator.value).toBe(checksum(OPERATOR));
    expect(operator.format).toBe("addressName");

    // The bundled descriptor models access rights as an enum over a bool; the
    // bool `true` resolves against the capitalized "True" key.
    const rights = result.fields[2];
    assert(!isFieldGroup(rights));
    expect(rights.label).toBe("Access rights");
    expect(rights.value).toBe("Grant all");
    expect(rights.fieldType).toBe("bool");
    expect(rights.format).toBe("enum");
    expect(rights.rawAddress).toBeUndefined();
    expect(rights.tokenAddress).toBeUndefined();
    expect(rights.embeddedCalldata).toBeUndefined();
    expect(rights.warning).toBeUndefined();
  });

  it("formats setApprovalForAll(address,bool) with approved=false as Deny all", async () => {
    const data = "0xa22cb465" + padAddr(OPERATOR) + padInt(0n); // approved = false
    const result = await format(
      { chainId: CHAIN_ID, to: COLLECTION, data },
      opts(TRUSTED_ERC721),
    );

    assert(result.fields);
    const rights = result.fields[2];
    assert(!isFieldGroup(rights));
    expect(rights.label).toBe("Access rights");
    expect(rights.value).toBe("Deny all");
    expect(rights.fieldType).toBe("bool");
    expect(rights.format).toBe("enum");
    expect(rights.warning).toBeUndefined();
  });
});

describe("trusted tokens — selector collision (standard comes from the tag)", () => {
  // approve(address,uint256) shares selector 0x095ea7b3 across both standards.
  const APPROVE = "0x095ea7b3" + padAddr(OPERATOR) + padInt(5_000_000n);

  it("renders the third word as a token amount when tagged erc20", async () => {
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data: APPROVE },
      opts(TRUSTED_ERC20),
    );
    expect(result.intent).toBe("Approve");
    assert(result.fields);
    const amount = result.fields[1];
    assert(!isFieldGroup(amount));
    expect(amount.label).toBe("Amount");
    expect(amount.value).toBe("5 TKN");
    expect(amount.format).toBe("tokenAmount");
  });

  it("renders the same word as an NFT id when tagged erc721", async () => {
    const result = await format(
      { chainId: CHAIN_ID, to: COLLECTION, data: APPROVE },
      opts(TRUSTED_ERC721),
    );
    expect(result.intent).toBe("Approve operator for NFT");
    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    const operator = result.fields[0];
    assert(!isFieldGroup(operator));
    expect(operator.label).toBe("Operator");
    expect(operator.format).toBe("addressName");

    const nft = result.fields[1];
    assert(!isFieldGroup(nft));
    expect(nft.label).toBe("NFT");
    expect(nft.value).toBe("Cool Cats #5000000");
    expect(nft.format).toBe("nftName");
    expect(nft.fieldType).toBe("uint");
  });
});

describe("trusted tokens — precedence and fallbacks", () => {
  const TRANSFER = "0xa9059cbb" + padAddr(ALICE) + padInt(1_000_000n); // transfer 1 TKN

  it("registry descriptor takes precedence over a trusted tag", async () => {
    const fsOpts = buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          { chainId: CHAIN_ID, address: TOKEN, file: "registry-erc20.json" },
        ],
      },
      externalData,
    );
    const resolverOptions = fsOpts.descriptorResolverOptions;
    assert(resolverOptions);
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data: TRANSFER },
      {
        ...fsOpts,
        descriptorResolverOptions: {
          ...resolverOptions,
          trustedTokens: TRUSTED_ERC20,
        },
      },
    );

    // Registry "Registry Send" intent wins over the bundled "Send".
    expect(result.intent).toBe("Registry Send");
    expect(result.metadata?.owner).toBe("Registry Owner");
    assert(result.fields);
    expect(result.fields).toHaveLength(1);
    const field = result.fields[0];
    assert(!isFieldGroup(field));
    expect(field.label).toBe("Recipient");
    expect(field.format).toBe("raw");
  });

  it("uses the bundled descriptor only when the registry misses", async () => {
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data: TRANSFER },
      opts(TRUSTED_ERC20),
    );
    expect(result.intent).toBe("Send");
    expect(result.warnings).toBeUndefined();
  });

  it("returns NO_DESCRIPTOR when untrusted and unindexed", async () => {
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data: TRANSFER },
      opts({}),
    );
    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    assert(result.warnings);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].code).toBe("NO_DESCRIPTOR");
    assert(result.rawCalldataFallback);
    expect(result.rawCalldataFallback.selector).toBe("0xa9059cbb");
  });

  it("matches a trusted token keyed by its EIP-55 checksum address", async () => {
    // Key the map by the canonical checksum form rather than lowercase.
    const trusted: TrustedTokens = {
      [CHAIN_ID]: { [checksum(TOKEN)]: "erc20" },
    };
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data: TRANSFER },
      opts(trusted),
    );
    expect(result.intent).toBe("Send");
    expect(result.warnings).toBeUndefined();
  });
});

const PERMIT_ENCODE_TYPE =
  "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)";

const PERMIT_TYPES: TypedData["types"] = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

const PERMIT_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: CHAIN_ID,
  verifyingContract: TOKEN,
};

function permit(value: string, overrides: Partial<TypedData> = {}): TypedData {
  return {
    account: ALICE,
    types: PERMIT_TYPES,
    primaryType: "Permit",
    domain: PERMIT_DOMAIN,
    message: {
      owner: ALICE,
      spender: OPERATOR,
      value,
      nonce: "7",
      deadline: "1767225600", // 2026-01-01T00:00:00Z
    },
    ...overrides,
  };
}

/** Asserts the display model of the bundled Permit for `permit("5000000")`. */
function assertBundledPermit(result: DisplayModel) {
  expect(result.intent).toBe("Authorize spending of tokens");
  expect(result.interpolatedIntent).toBeUndefined();
  expect(result.rawCalldataFallback).toBeUndefined();
  expect(result.warnings).toBeUndefined();
  // The bundled Permit template carries no metadata.
  expect(result.metadata).toBeUndefined();

  assert(result.fields);
  expect(result.fields).toHaveLength(4);

  const spender = result.fields[0];
  assert(!isFieldGroup(spender));
  expect(spender.label).toBe("Spender");
  expect(spender.value).toBe(checksum(OPERATOR));
  expect(spender.fieldType).toBe("address");
  expect(spender.format).toBe("raw");
  expect(spender.rawAddress).toBe(checksum(OPERATOR));
  expect(spender.tokenAddress).toBeUndefined();
  expect(spender.embeddedCalldata).toBeUndefined();
  expect(spender.warning).toBeUndefined();

  const amount = result.fields[1];
  assert(!isFieldGroup(amount));
  expect(amount.label).toBe("Max spending amount");
  expect(amount.value).toBe("5 TKN");
  expect(amount.fieldType).toBe("uint");
  expect(amount.format).toBe("tokenAmount");
  expect(amount.tokenAddress).toBe(checksum(TOKEN));
  expect(amount.rawAddress).toBeUndefined();
  expect(amount.embeddedCalldata).toBeUndefined();
  expect(amount.warning).toBeUndefined();

  const deadline = result.fields[2];
  assert(!isFieldGroup(deadline));
  expect(deadline.label).toBe("Valid until");
  expect(deadline.value).toBe("2026-01-01 00:00:00Z");
  expect(deadline.fieldType).toBe("uint");
  expect(deadline.format).toBe("date");
  expect(deadline.tokenAddress).toBeUndefined();
  expect(deadline.rawAddress).toBeUndefined();
  expect(deadline.embeddedCalldata).toBeUndefined();
  expect(deadline.warning).toBeUndefined();

  const owner = result.fields[3];
  assert(!isFieldGroup(owner));
  expect(owner.label).toBe("Owner");
  expect(owner.value).toBe(ALICE_NAME);
  expect(owner.fieldType).toBe("address");
  expect(owner.format).toBe("addressName");
  expect(owner.rawAddress).toBe(checksum(ALICE));
  expect(owner.tokenAddress).toBeUndefined();
  expect(owner.embeddedCalldata).toBeUndefined();
  expect(owner.warning).toBeUndefined();
}

/** Asserts a display model without a descriptor and with one warning. */
function assertNoDisplay(result: DisplayModel, code: string) {
  expect(result.intent).toBeUndefined();
  expect(result.interpolatedIntent).toBeUndefined();
  expect(result.fields).toBeUndefined();
  expect(result.metadata).toBeUndefined();
  expect(result.rawCalldataFallback).toBeUndefined();
  assert(result.warnings);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0].code).toBe(code);
}

/** Filesystem options that index `registry-permit.json` for the token. */
function registryPermitOpts(
  overrides: Partial<BaseResolverOptions>,
  externalDataProvider: ExternalDataProvider = externalData,
): FormatOptions {
  const fsOpts = buildFilesystemResolverOpts(
    __dirname,
    {
      eip712DescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: TOKEN,
          file: "registry-permit.json",
          encodeTypes: [PERMIT_ENCODE_TYPE],
        },
      ],
    },
    externalDataProvider,
  );
  const resolverOptions = fsOpts.descriptorResolverOptions;
  assert(resolverOptions);
  return {
    ...fsOpts,
    descriptorResolverOptions: { ...resolverOptions, ...overrides },
  };
}

/** FormatOptions with a typed-data index entry for the token. */
function indexedOpts(
  byPrimaryType: Record<string, TypedDataIndexEntry[]>,
): FormatOptions {
  return {
    descriptorResolverOptions: {
      type: "github",
      index: {
        calldataIndex: {},
        typedDataIndex: {
          [`eip155:${CHAIN_ID}:${TOKEN.toLowerCase()}`]: byPrimaryType,
        },
      },
      trustedTokens: TRUSTED_ERC2612,
    },
    externalDataProvider: externalData,
  };
}

describe("trusted tokens — bundled ERC-2612 Permit", () => {
  it("formats a Permit for a token tagged erc2612", async () => {
    const result: DisplayModel = await formatTypedData(
      permit("5000000"),
      opts(TRUSTED_ERC2612),
    );
    assertBundledPermit(result);
  });

  it("binds the bundled Permit descriptor to the token and the message domain", async () => {
    const result = await resolveTypedDataDescriptor(
      permit("5000000"),
      opts(TRUSTED_ERC2612).descriptorResolverOptions,
    );

    assert("descriptor" in result);
    expect(result.descriptor).toEqual({
      ...erc2612PermitDescriptor,
      context: {
        eip712: {
          deployments: [{ chainId: CHAIN_ID, address: TOKEN }],
          domain: PERMIT_DOMAIN,
        },
      },
    });
    expect(result.descriptor.$schema).toBeUndefined();
    expect(result.descriptor.metadata).toBeUndefined();
    expect(Object.keys(result.descriptor.display?.formats ?? {})).toEqual([
      PERMIT_ENCODE_TYPE,
    ]);
    // The resolver returns a copy. The template stays unchanged.
    expect(erc2612PermitDescriptor.context).toEqual({ eip712: {} });
  });

  it("formats a Permit value over the threshold as Unlimited", async () => {
    const result = await formatTypedData(
      permit(BigInt("0x" + MAX_UINT256).toString()),
      opts(TRUSTED_ERC2612),
    );

    expect(result.intent).toBe("Authorize spending of tokens");
    expect(result.warnings).toBeUndefined();
    assert(result.fields);
    expect(result.fields).toHaveLength(4);
    const amount = result.fields[1];
    assert(!isFieldGroup(amount));
    expect(amount.label).toBe("Max spending amount");
    expect(amount.value).toBe("Unlimited TKN");
    expect(amount.fieldType).toBe("uint");
    expect(amount.format).toBe("tokenAmount");
    expect(amount.tokenAddress).toBe(checksum(TOKEN));
    expect(amount.rawAddress).toBeUndefined();
    expect(amount.embeddedCalldata).toBeUndefined();
    expect(amount.warning).toBeUndefined();
  });

  it("formats calls to a token tagged erc2612 with the ERC-20 template", async () => {
    const data = "0xa9059cbb" + padAddr(ALICE) + padInt(1_000_000n);
    const result = await format(
      { chainId: CHAIN_ID, to: TOKEN, data },
      opts(TRUSTED_ERC2612),
    );

    expect(result.intent).toBe("Send");
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    assert(result.fields);
    expect(result.fields).toHaveLength(2);

    const amount = result.fields[0];
    assert(!isFieldGroup(amount));
    expect(amount.label).toBe("Amount");
    expect(amount.value).toBe("1 TKN");
    expect(amount.fieldType).toBe("uint");
    expect(amount.format).toBe("tokenAmount");
    expect(amount.tokenAddress).toBe(checksum(TOKEN));
    expect(amount.rawAddress).toBeUndefined();
    expect(amount.embeddedCalldata).toBeUndefined();
    expect(amount.warning).toBeUndefined();

    const to = result.fields[1];
    assert(!isFieldGroup(to));
    expect(to.label).toBe("To");
    expect(to.value).toBe(ALICE_NAME);
    expect(to.fieldType).toBe("address");
    expect(to.format).toBe("addressName");
    expect(to.rawAddress).toBe(checksum(ALICE));
    expect(to.tokenAddress).toBeUndefined();
    expect(to.embeddedCalldata).toBeUndefined();
    expect(to.warning).toBeUndefined();
  });

  it("matches a token tagged erc2612 by its EIP-55 checksum address", async () => {
    const trusted: TrustedTokens = {
      [CHAIN_ID]: { [checksum(TOKEN)]: "erc2612" },
    };
    const result = await formatTypedData(
      permit("5000000", {
        domain: {
          ...PERMIT_DOMAIN,
          chainId: "0x1",
          verifyingContract: TOKEN.toLowerCase(),
        },
      }),
      opts(trusted),
    );
    assertBundledPermit(result);
  });

  it("falls back to the bundled Permit when the registry entry has another encodeType", async () => {
    const result = await formatTypedData(
      permit("5000000"),
      indexedOpts({
        Permit: [
          {
            path: "other-permit.json",
            encodeTypeHashes: ["0x" + "00".repeat(32)],
          },
        ],
      }),
    );
    assertBundledPermit(result);
  });

  it("falls back to the bundled Permit when the registry indexes only another primary type", async () => {
    const result = await formatTypedData(
      permit("5000000"),
      indexedOpts({
        Order: [
          { path: "order.json", encodeTypeHashes: ["0x" + "00".repeat(32)] },
        ],
      }),
    );
    assertBundledPermit(result);
  });

  it("returns NO_DESCRIPTOR for a Permit of a token tagged erc20", async () => {
    const result = await formatTypedData(
      permit("5000000"),
      opts(TRUSTED_ERC20),
    );
    assertNoDisplay(result, "NO_DESCRIPTOR");
  });

  it("returns NO_DESCRIPTOR for a Permit of a token tagged erc721", async () => {
    const result = await formatTypedData(
      permit("5000000", {
        domain: { ...PERMIT_DOMAIN, verifyingContract: COLLECTION },
      }),
      opts(TRUSTED_ERC721),
    );
    assertNoDisplay(result, "NO_DESCRIPTOR");
  });

  it("returns NO_DESCRIPTOR for a Permit without a trusted token list", async () => {
    const result = await formatTypedData(permit("5000000"), {
      descriptorResolverOptions: {
        type: "github",
        index: { calldataIndex: {}, typedDataIndex: {} },
      },
      externalDataProvider: externalData,
    });
    assertNoDisplay(result, "NO_DESCRIPTOR");
  });

  it("returns NO_DESCRIPTOR for a DAI-style Permit of a token tagged erc2612", async () => {
    const result = await formatTypedData(
      permit("5000000", {
        types: {
          EIP712Domain: PERMIT_TYPES.EIP712Domain,
          Permit: [
            { name: "holder", type: "address" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "expiry", type: "uint256" },
            { name: "allowed", type: "bool" },
          ],
        },
        message: {
          holder: ALICE,
          spender: OPERATOR,
          nonce: "7",
          expiry: "1767225600",
          allowed: true,
        },
      }),
      opts(TRUSTED_ERC2612),
    );
    assertNoDisplay(result, "NO_DESCRIPTOR");
  });

  it("returns NO_DESCRIPTOR for a Permit without a types object", async () => {
    const typedData = permit("5000000");
    const result = await formatTypedData(
      { ...typedData, types: undefined } as unknown as TypedData,
      opts(TRUSTED_ERC2612),
    );
    assertNoDisplay(result, "NO_DESCRIPTOR");
  });

  it("returns NO_DESCRIPTOR for a Permit on another chain", async () => {
    const result = await formatTypedData(
      permit("5000000", { domain: { ...PERMIT_DOMAIN, chainId: 10 } }),
      opts(TRUSTED_ERC2612),
    );
    assertNoDisplay(result, "NO_DESCRIPTOR");
  });

  it("registry descriptor takes precedence over a trusted erc2612 tag", async () => {
    const result = await formatTypedData(
      permit("5000000"),
      registryPermitOpts({ trustedTokens: TRUSTED_ERC2612 }),
    );

    expect(result.intent).toBe("Registry Permit");
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
    expect(result.metadata).toEqual({ owner: "Registry Owner" });
    assert(result.fields);
    expect(result.fields).toHaveLength(1);

    const field = result.fields[0];
    assert(!isFieldGroup(field));
    expect(field.label).toBe("Registry Spender");
    expect(field.value).toBe(checksum(OPERATOR));
    expect(field.fieldType).toBe("address");
    expect(field.format).toBe("raw");
    expect(field.rawAddress).toBe(checksum(OPERATOR));
    expect(field.tokenAddress).toBeUndefined();
    expect(field.embeddedCalldata).toBeUndefined();
    expect(field.warning).toBeUndefined();
  });

  it("does not fall back to the bundled Permit when the registry descriptor has no trusted attestation", async () => {
    const chainClient: ChainClient = {
      call: async () => {
        throw new Error("no revocation read expected");
      },
    };
    const result = await formatTypedData(
      permit("5000000"),
      registryPermitOpts(
        {
          trustedTokens: TRUSTED_ERC2612,
          attestations: { trustedAttesters: [ATTESTER] },
        },
        { ...externalData, chainClient },
      ),
    );

    assertNoDisplay(result, "NO_TRUSTED_ATTESTATION");
    assert(result.warnings);
    expect(result.warnings[0].message).toBe(
      "No valid attestation from a trusted attester found for descriptor 'registry-permit.json'",
    );
  });

  it("does not apply the attestation policy to the bundled Permit descriptor", async () => {
    const result = await formatTypedData(permit("5000000"), {
      descriptorResolverOptions: {
        type: "github",
        index: { calldataIndex: {}, typedDataIndex: {} },
        trustedTokens: TRUSTED_ERC2612,
        attestations: { trustedAttesters: [ATTESTER] },
      },
      externalDataProvider: externalData,
    });
    assertBundledPermit(result);
  });
});
