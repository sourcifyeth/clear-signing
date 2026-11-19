/**
 * Builder input models under an ERC-8176 attestation policy. The fixtures are
 * the registry's Tether USD descriptor and its real attestation in
 * `../attestations/`, and the Rarible EIP-712 descriptor in
 * `../registry-cases/rarible/`, which has no attestation.
 */

import { describe, it, expect, assert } from "vitest";
import {
  getCalldataInputModels,
  getTypedDataInputModels,
} from "../../src/builder.js";
import type { BuilderOptions } from "../../src/builder.types.js";
import type {
  AttestationOptions,
  ChainClient,
  FormatOptions,
} from "../../src/types.js";
import { buildFilesystemResolverOpts } from "../utils.js";

const CHAIN_ID = 1;
const USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CYFRIN_ATTESTER = "0x3846c3A30E62075Fa916216b35EF04B8F53931f6";
const ALICE = "0x1234567890abcdef1234567890abcdef12345678";
const RARIBLE_COLLECTION = "0xc9154424b823b10579895ccbe442d41b9abd96ed";
const MINT_ENCODE_TYPE =
  "Mint721(uint256 tokenId,string tokenURI,Part[] creators,Part[] royalties)Part(address account,uint96 value)";

/** Chain client whose EAS reads report every attestation as not revoked. */
const notRevoked: ChainClient = { call: async () => "0x" + "00".repeat(32) };

/** Builder options from filesystem resolver options, with a policy. */
function withPolicy(
  fsOpts: FormatOptions,
  attestations: AttestationOptions,
  chainClient?: ChainClient,
): BuilderOptions {
  const resolverOptions = fsOpts.descriptorResolverOptions;
  assert(resolverOptions);
  return {
    descriptorResolverOptions: { ...resolverOptions, attestations },
    chainClient,
  };
}

/** Pass `null` as `chainClient` to omit it. */
function tetherOpts(
  attestations: AttestationOptions,
  chainClient: ChainClient | null = notRevoked,
): BuilderOptions {
  return withPolicy(
    buildFilesystemResolverOpts(`${__dirname}/../attestations`, {
      calldataDescriptorFiles: [
        { chainId: CHAIN_ID, address: USDT, file: "calldata-usdt.json" },
      ],
    }),
    attestations,
    chainClient ?? undefined,
  );
}

describe("builder — attestation policy on getCalldataInputModels", () => {
  it("lists input models when a trusted attester has a valid attestation", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      USDT,
      tetherOpts({ trustedAttesters: [CYFRIN_ATTESTER] }),
    );
    expect(result.warnings).toBeUndefined();
    expect(result.models?.map((m) => m.signature)).toEqual([
      "transfer(address _to, uint256 _value)",
      "approve(address _spender, uint256 _value)",
    ]);
  });

  it("returns NO_TRUSTED_ATTESTATION when no trusted attester has an attestation", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      USDT,
      tetherOpts({ trustedAttesters: [ALICE] }),
    );
    expect(result).toEqual({
      warnings: [
        {
          code: "NO_TRUSTED_ATTESTATION",
          message:
            "No valid attestation from a trusted attester found for descriptor 'calldata-usdt.json'",
        },
      ],
    });
  });

  it("returns ATTESTATION_OPTIONS_INCOMPLETE when the options have no chainClient", async () => {
    const result = await getCalldataInputModels(
      CHAIN_ID,
      USDT,
      tetherOpts({ trustedAttesters: [CYFRIN_ATTESTER] }, null),
    );
    expect(result).toEqual({
      warnings: [
        {
          code: "ATTESTATION_OPTIONS_INCOMPLETE",
          message:
            "An attestation policy is set but no chainClient is available for the revocation check",
        },
      ],
    });
  });
});

describe("builder — attestation policy on getTypedDataInputModels", () => {
  it("returns NO_TRUSTED_ATTESTATION when the descriptor has no attestation", async () => {
    const opts = withPolicy(
      buildFilesystemResolverOpts(`${__dirname}/../registry-cases/rarible`, {
        eip712DescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: RARIBLE_COLLECTION,
            file: "eip712-rarible-erc-721.json",
            encodeTypes: [MINT_ENCODE_TYPE],
          },
        ],
      }),
      { trustedAttesters: [CYFRIN_ATTESTER] },
      notRevoked,
    );

    const result = await getTypedDataInputModels(
      CHAIN_ID,
      RARIBLE_COLLECTION,
      opts,
    );
    expect(result).toEqual({
      warnings: [
        {
          code: "NO_TRUSTED_ATTESTATION",
          message:
            "No valid attestation from a trusted attester found for descriptor 'eip712-rarible-erc-721.json'",
        },
      ],
    });
  });
});
