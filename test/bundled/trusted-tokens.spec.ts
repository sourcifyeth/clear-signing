/**
 * Trusted-token bundled descriptors: when no registry descriptor resolves for
 * a contract, a wallet-supplied `trustedTokens` list lets the library render
 * the transaction from a bundled ERC-20 / ERC-721 template.
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../src/index.js";
import type {
  DisplayModel,
  ExternalDataProvider,
  FormatOptions,
  TrustedTokens,
} from "../../src/types.js";
import { hexToBytes, toChecksumAddress } from "../../src/utils.js";
import { buildFilesystemResolverOpts } from "../utils.js";

const CHAIN_ID = 1;
const TOKEN = "0xA0b86991c6218b36c1d19D4a2E9Eb0cE3606eB48";
const COLLECTION = "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D";
const ALICE = "0x1234567890abcdef1234567890abcdef12345678";
const ALICE_NAME = "Alice";
const OPERATOR = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
const MAX_UINT256 =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const checksum = (addr: string) => toChecksumAddress(hexToBytes(addr));
const word = (hex: string) => hex.padStart(64, "0");
const addrWord = (addr: string) => word(addr.slice(2).toLowerCase());

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
    const data = "0xa9059cbb" + addrWord(ALICE) + word("f4240"); // value = 1_000_000
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
    const data = "0x095ea7b3" + addrWord(OPERATOR) + MAX_UINT256;
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
      "0x42842e0e" + addrWord(ALICE) + addrWord(OPERATOR) + word("539"); // tokenId 1337
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
    const data = "0xa22cb465" + addrWord(OPERATOR) + word("1"); // approved = true
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
    const data = "0xa22cb465" + addrWord(OPERATOR) + word("0"); // approved = false
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
  const APPROVE = "0x095ea7b3" + addrWord(OPERATOR) + word("4c4b40"); // 5_000_000

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
  const TRANSFER = "0xa9059cbb" + addrWord(ALICE) + word("f4240"); // transfer 1 TKN

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
