/**
 * Tests for the Rarible ERC-721 lazy mint descriptor:
 * - EIP-712 Mint721 bound to the Rarible token contract by deployments +
 *   domain (name = "Rarible", version = "2").
 * - Exercises six visible top-level fields, four of which iterate over
 *   the `creators` and `royalties` arrays via mid-path `.[]` segments.
 */

import { describe, it, expect, assert } from "vitest";
import { formatTypedData, isFieldGroup } from "../../../src/index.js";
import type { ExternalDataProvider, TypedData } from "../../../src/types.js";
import { hexToBytes, toChecksumAddress } from "../../../src/utils.js";
import {
  buildEmbeddedResolverOpts,
  computeEncodeTypeOrThrow,
} from "../../utils.js";

describe("Rarible ERC-721 lazy mint", () => {
  const CHAIN_ID = 1;
  const COLLECTION = "0xc9154424b823b10579895ccbe442d41b9abd96ed";
  const SIGNER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const CREATOR_A = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const CREATOR_B = "0x1111111111111111111111111111111111111111";
  const ROYALTY_RECIPIENT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  const TYPES = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    Mint721: [
      { name: "tokenId", type: "uint256" },
      { name: "tokenURI", type: "string" },
      { name: "creators", type: "Part[]" },
      { name: "royalties", type: "Part[]" },
    ],
    Part: [
      { name: "account", type: "address" },
      { name: "value", type: "uint96" },
    ],
  };

  const MINT: TypedData = {
    account: SIGNER,
    domain: {
      name: "Rarible",
      version: "2",
      chainId: CHAIN_ID,
      verifyingContract: COLLECTION,
    },
    primaryType: "Mint721",
    types: TYPES,
    message: {
      tokenId: "12345",
      tokenURI: "ipfs://QmExampleTokenMetadataHash",
      creators: [
        { account: CREATOR_A, value: "5000" }, // 50%
        { account: CREATOR_B, value: "5000" }, // 50%
      ],
      royalties: [
        { account: ROYALTY_RECIPIENT, value: "1000" }, // 10%
      ],
    },
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        eip712DescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: COLLECTION,
            file: "eip712-rarible-erc-721.json",
            encodeTypes: [
              computeEncodeTypeOrThrow(MINT.primaryType, MINT.types),
            ],
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats a Mint721 lazy mint with iterated creators and royalties", async () => {
    const opts = buildOpts();

    const result = await formatTypedData(MINT, opts);

    expect(result.intent).toBe("Lazy Mint ERC-721");

    assert(result.fields);
    // Two flat fields (tokenId, tokenURI) followed by four DisplayFieldGroups,
    // one per top-level mid-path `.[]` field. Each group wraps one inner
    // DisplayField per array element — same shape as a top-level `.[]`
    // iteration that ends at `.[]`.
    expect(result.fields).toHaveLength(6);

    // Field 0: Token ID
    const tokenIdField = result.fields[0];
    assert(!isFieldGroup(tokenIdField));
    expect(tokenIdField.label).toBe("Token ID");
    expect(tokenIdField.value).toBe("12345");
    expect(tokenIdField.fieldType).toBe("uint");
    expect(tokenIdField.format).toBe("raw");
    expect(tokenIdField.rawAddress).toBeUndefined();
    expect(tokenIdField.tokenAddress).toBeUndefined();
    expect(tokenIdField.embeddedCalldata).toBeUndefined();
    expect(tokenIdField.warning).toBeUndefined();

    // Field 1: Token URI
    const tokenUriField = result.fields[1];
    assert(!isFieldGroup(tokenUriField));
    expect(tokenUriField.label).toBe("Token URI");
    expect(tokenUriField.value).toBe("ipfs://QmExampleTokenMetadataHash");
    expect(tokenUriField.fieldType).toBe("string");
    expect(tokenUriField.format).toBe("raw");
    expect(tokenUriField.rawAddress).toBeUndefined();
    expect(tokenUriField.tokenAddress).toBeUndefined();
    expect(tokenUriField.embeddedCalldata).toBeUndefined();
    expect(tokenUriField.warning).toBeUndefined();

    // Field 2: creators.[].account — group with two iterated entries
    const creatorAccountsGroup = result.fields[2];
    assert(isFieldGroup(creatorAccountsGroup));
    expect(creatorAccountsGroup.label).toBeUndefined();
    expect(creatorAccountsGroup.warning).toBeUndefined();
    expect(creatorAccountsGroup.fields).toHaveLength(2);

    const creator0AccField = creatorAccountsGroup.fields[0];
    expect(creator0AccField.label).toBe("Creator account address");
    expect(creator0AccField.value).toBe(
      toChecksumAddress(hexToBytes(CREATOR_A)),
    );
    expect(creator0AccField.fieldType).toBe("address");
    expect(creator0AccField.format).toBe("raw");
    expect(creator0AccField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(CREATOR_A)),
    );
    expect(creator0AccField.tokenAddress).toBeUndefined();
    expect(creator0AccField.embeddedCalldata).toBeUndefined();
    expect(creator0AccField.warning).toBeUndefined();

    const creator1AccField = creatorAccountsGroup.fields[1];
    expect(creator1AccField.label).toBe("Creator account address");
    expect(creator1AccField.value).toBe(
      toChecksumAddress(hexToBytes(CREATOR_B)),
    );
    expect(creator1AccField.fieldType).toBe("address");
    expect(creator1AccField.format).toBe("raw");
    expect(creator1AccField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(CREATOR_B)),
    );
    expect(creator1AccField.tokenAddress).toBeUndefined();
    expect(creator1AccField.embeddedCalldata).toBeUndefined();
    expect(creator1AccField.warning).toBeUndefined();

    // Field 3: creators.[].value — group with two iterated entries
    const creatorValuesGroup = result.fields[3];
    assert(isFieldGroup(creatorValuesGroup));
    expect(creatorValuesGroup.label).toBeUndefined();
    expect(creatorValuesGroup.warning).toBeUndefined();
    expect(creatorValuesGroup.fields).toHaveLength(2);

    const creator0ValField = creatorValuesGroup.fields[0];
    expect(creator0ValField.label).toBe("Creator value (10000 = 100%)");
    expect(creator0ValField.value).toBe("5000");
    expect(creator0ValField.fieldType).toBe("uint");
    expect(creator0ValField.format).toBe("raw");
    expect(creator0ValField.rawAddress).toBeUndefined();
    expect(creator0ValField.tokenAddress).toBeUndefined();
    expect(creator0ValField.embeddedCalldata).toBeUndefined();
    expect(creator0ValField.warning).toBeUndefined();

    const creator1ValField = creatorValuesGroup.fields[1];
    expect(creator1ValField.label).toBe("Creator value (10000 = 100%)");
    expect(creator1ValField.value).toBe("5000");
    expect(creator1ValField.fieldType).toBe("uint");
    expect(creator1ValField.format).toBe("raw");
    expect(creator1ValField.rawAddress).toBeUndefined();
    expect(creator1ValField.tokenAddress).toBeUndefined();
    expect(creator1ValField.embeddedCalldata).toBeUndefined();
    expect(creator1ValField.warning).toBeUndefined();

    // Field 4: royalties.[].account — group with one iterated entry
    const royaltyAccountsGroup = result.fields[4];
    assert(isFieldGroup(royaltyAccountsGroup));
    expect(royaltyAccountsGroup.label).toBeUndefined();
    expect(royaltyAccountsGroup.warning).toBeUndefined();
    expect(royaltyAccountsGroup.fields).toHaveLength(1);

    const royalty0AccField = royaltyAccountsGroup.fields[0];
    expect(royalty0AccField.label).toBe("Royalties account address");
    expect(royalty0AccField.value).toBe(
      toChecksumAddress(hexToBytes(ROYALTY_RECIPIENT)),
    );
    expect(royalty0AccField.fieldType).toBe("address");
    expect(royalty0AccField.format).toBe("raw");
    expect(royalty0AccField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(ROYALTY_RECIPIENT)),
    );
    expect(royalty0AccField.tokenAddress).toBeUndefined();
    expect(royalty0AccField.embeddedCalldata).toBeUndefined();
    expect(royalty0AccField.warning).toBeUndefined();

    // Field 5: royalties.[].value — group with one iterated entry
    const royaltyValuesGroup = result.fields[5];
    assert(isFieldGroup(royaltyValuesGroup));
    expect(royaltyValuesGroup.label).toBeUndefined();
    expect(royaltyValuesGroup.warning).toBeUndefined();
    expect(royaltyValuesGroup.fields).toHaveLength(1);

    const royalty0ValField = royaltyValuesGroup.fields[0];
    expect(royalty0ValField.label).toBe("Royalties value (10000 = 100%)");
    expect(royalty0ValField.value).toBe("1000");
    expect(royalty0ValField.fieldType).toBe("uint");
    expect(royalty0ValField.format).toBe("raw");
    expect(royalty0ValField.rawAddress).toBeUndefined();
    expect(royalty0ValField.tokenAddress).toBeUndefined();
    expect(royalty0ValField.embeddedCalldata).toBeUndefined();
    expect(royalty0ValField.warning).toBeUndefined();

    // Metadata
    assert(result.metadata);
    expect(result.metadata.owner).toBe("Rarible ERC-721 Collection");
    expect(result.metadata.contractName).toBeUndefined();
    expect(result.metadata.info).toBeUndefined();

    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
