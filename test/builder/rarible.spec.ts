/**
 * Builder tests with the Rarible ERC-721 lazy mint descriptor (EIP-712) in
 * `../registry-cases/rarible/`: the input model from the descriptor's
 * encodeType, and typed data built from it.
 */

import { describe, it, expect, assert } from "vitest";
import { buildTypedData, getTypedDataInputModels } from "../../src/builder.js";
import type { TypedData } from "../../src/types.js";
import type { BuilderOptions } from "../../src/builder.types.js";
import {
  buildFilesystemResolverOpts,
  computeEncodeTypeOrThrow,
} from "../utils.js";

describe("builder — Rarible ERC-721 lazy mint", () => {
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

  function buildOpts(): BuilderOptions {
    const { descriptorResolverOptions } = buildFilesystemResolverOpts(
      `${__dirname}/../registry-cases/rarible`,
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
    );
    return { descriptorResolverOptions };
  }

  it("lists the input model and builds the same typed data from it", async () => {
    const result = await getTypedDataInputModels(
      CHAIN_ID,
      COLLECTION,
      buildOpts(),
    );
    expect(result.warnings).toBeUndefined();
    assert(result.models);
    expect(result.models).toEqual([
      {
        signature:
          "Mint721(uint256 tokenId,string tokenURI,Part[] creators,Part[] royalties)Part(address account,uint96 value)",
        // name and version come from the descriptor's domain binding.
        domain: {
          name: "Rarible",
          version: "2",
          chainId: CHAIN_ID,
          verifyingContract: COLLECTION,
        },
        metadata: {
          owner: "Rarible ERC-721 Collection",
          contractName: undefined,
          info: undefined,
        },
        intent: "Lazy Mint ERC-721",
        fields: [
          {
            label: "Token ID",
            path: "tokenId",
            type: "uint256",
            format: "raw",
          },
          {
            label: "Token URI",
            path: "tokenURI",
            type: "string",
            format: "raw",
          },
          {
            label: "Creator account address",
            path: "creators.[].account",
            type: "address",
            format: "raw",
          },
          {
            label: "Creator value (10000 = 100%)",
            path: "creators.[].value",
            type: "uint96",
            format: "raw",
          },
          {
            label: "Royalties account address",
            path: "royalties.[].account",
            type: "address",
            format: "raw",
          },
          {
            label: "Royalties value (10000 = 100%)",
            path: "royalties.[].value",
            type: "uint96",
            format: "raw",
          },
        ],
      },
    ]);

    const built = buildTypedData(result.models[0], SIGNER, MINT.message);
    assert("typedData" in built);
    expect(built.typedData).toEqual(MINT);
  });
});
