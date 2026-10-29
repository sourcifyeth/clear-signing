/**
 * Tests for Across Ethereum SpokePool descriptor:
 * - deposit: addressName and tokenTicker on bytes32 values that hold
 *   zero-padded EVM addresses, with the destination chain from chainIdPath
 * - depositNow to Solana: tokenTicker on a bytes32 that is not an EVM address
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type {
  DisplayField,
  DisplayFieldGroup,
  DisplayModel,
  ExternalDataProvider,
} from "../../../src/types.js";
import {
  bytesToHex,
  hexToBytes,
  selectorForSignature,
  toChecksumAddress,
} from "../../../src/utils.js";
import { buildFilesystemResolverOpts, padAddr, padInt } from "../../utils.js";

describe("Across Ethereum SpokePool", () => {
  const CHAIN_ID = 1;
  const ARBITRUM_CHAIN_ID = 42161;
  const SOLANA_CHAIN_ID = 34268394551451;
  const CONTRACT = "0x5c7BCd6E7De5423a257D81B442095A1a6ced35C5";
  const DEPOSITOR = "0x07fa033371cde9b7ce587c135fd6acc575f1af11";
  const RECIPIENT = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
  const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
  const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
  const ARBITRUM_WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1";
  // Solana USDC mint and a Solana recipient, as 32-byte keys
  const SOLANA_USDC =
    "c6fa7af3bedbad3a3d65f36aabc97431b1bbe4c2d2f6e0e47ca60203452f5d61";
  const SOLANA_RECIPIENT =
    "0e5a3c9f4b8d7e6f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7081";
  // Offset of the dynamic `message` argument and its zero length
  const EMPTY_MESSAGE = padInt(0n);

  const checksum = (addr: string) => toChecksumAddress(hexToBytes(addr));

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    address,
  ) => {
    if (chainId === CHAIN_ID && address === WETH) {
      return { name: "Wrapped Ether", symbol: "WETH", decimals: 18 };
    }
    if (chainId === CHAIN_ID && address === USDC) {
      return { name: "USD Coin", symbol: "USDC", decimals: 6 };
    }
    if (chainId === ARBITRUM_CHAIN_ID && address === ARBITRUM_WETH) {
      return { name: "Wrapped Ether", symbol: "WETH", decimals: 18 };
    }
    return null;
  };

  const resolveChainInfo: ExternalDataProvider["resolveChainInfo"] = async (
    chainId,
  ) => {
    const nativeCurrency = { name: "Ether", symbol: "ETH", decimals: 18 };
    if (chainId === CHAIN_ID) return { name: "Ethereum", nativeCurrency };
    if (chainId === ARBITRUM_CHAIN_ID) {
      return { name: "Arbitrum One", nativeCurrency };
    }
    return null;
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-Ethereum_SpokePool.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  function assertField(
    field: DisplayField | DisplayFieldGroup | undefined,
    expected: Pick<DisplayField, "label" | "value" | "fieldType" | "format"> &
      Partial<Pick<DisplayField, "tokenAddress" | "rawAddress">> & {
        warningCode?: string;
      },
  ) {
    assert(field && !isFieldGroup(field));
    expect(field.label).toBe(expected.label);
    expect(field.value).toBe(expected.value);
    expect(field.fieldType).toBe(expected.fieldType);
    expect(field.format).toBe(expected.format);
    expect(field.tokenAddress).toBe(expected.tokenAddress);
    expect(field.rawAddress).toBe(expected.rawAddress);
    expect(field.embeddedCalldata).toBeUndefined();
    expect(field.warning?.code).toBe(expected.warningCode);
  }

  function assertMetadata(result: DisplayModel) {
    assert(result.metadata);
    expect(result.metadata.owner).toBe("Across Protocol");
    expect(result.metadata.contractName).toBe("Ethereum SpokePool");
    expect(result.metadata.info).toEqual({ url: "https://across.to/" });
  }

  // =========================================================================
  // deposit
  // =========================================================================
  describe("deposit", () => {
    const SELECTOR = bytesToHex(
      selectorForSignature(
        "deposit(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,uint32,bytes)",
      ),
    );

    const DEPOSIT_CALLDATA =
      SELECTOR +
      padAddr(DEPOSITOR) + // depositor
      padAddr(RECIPIENT) + // recipient
      padAddr(WETH) + // inputToken
      padAddr(ARBITRUM_WETH) + // outputToken
      padInt(1_000_000_000_000_000_000n) + // inputAmount = 1 WETH
      padInt(999_000_000_000_000_000n) + // outputAmount = 0.999 WETH
      padInt(BigInt(ARBITRUM_CHAIN_ID)) + // destinationChainId
      padInt(0n) + // exclusiveRelayer
      padInt(1_699_990_000n) + // quoteTimestamp
      padInt(1_700_000_000n) + // fillDeadline
      padInt(0n) + // exclusivityParameter
      padInt(12n * 32n) + // message offset
      EMPTY_MESSAGE;

    it("resolves zero-padded bytes32 addresses for addressName and tokenTicker", async () => {
      const opts = buildOpts({
        resolveToken,
        resolveChainInfo,
        resolveLocalName: async (address) =>
          address === DEPOSITOR ? { name: "My Wallet", typeMatch: true } : null,
      });

      const result: DisplayModel = await format(
        { chainId: CHAIN_ID, to: CONTRACT, data: DEPOSIT_CALLDATA, value: 0n },
        opts,
      );

      expect(result.intent).toBe("Bridge tokens");
      expect(result.interpolatedIntent).toBe(
        `Bridge 1 WETH to 0x000000000000000000000000${RECIPIENT.slice(2)} on the destination chain; depositor My Wallet`,
      );

      assert(result.fields);
      expect(result.fields).toHaveLength(8);
      assertField(result.fields[0], {
        label: "Amount to Bridge",
        value: "1 WETH",
        fieldType: "uint",
        format: "tokenAmount",
        tokenAddress: checksum(WETH),
      });
      assertField(result.fields[1], {
        label: "Native Value Sent",
        value: "0 ETH",
        fieldType: "uint",
        format: "amount",
      });
      assertField(result.fields[2], {
        label: "Destination Chain",
        value: "Arbitrum One",
        fieldType: "uint",
        format: "chainId",
      });
      assertField(result.fields[3], {
        label: "Recipient",
        value: `0x000000000000000000000000${RECIPIENT.slice(2)}`,
        fieldType: "bytes",
        format: "raw",
      });
      assertField(result.fields[4], {
        label: "Relayer Must Send",
        value: "0.999 WETH",
        fieldType: "uint",
        format: "tokenAmount",
        tokenAddress: checksum(ARBITRUM_WETH),
      });
      assertField(result.fields[5], {
        label: "Output Token (dest.)",
        value: "WETH",
        fieldType: "bytes",
        format: "tokenTicker",
      });
      assertField(result.fields[6], {
        label: "Depositor",
        value: "My Wallet",
        fieldType: "bytes",
        format: "addressName",
        rawAddress: checksum(DEPOSITOR),
      });
      assertField(result.fields[7], {
        label: "Fill Deadline",
        value: "2023-11-14 22:13:20Z",
        fieldType: "uint",
        format: "date",
      });

      assertMetadata(result);
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });

  // =========================================================================
  // depositNow to Solana
  // =========================================================================
  describe("depositNow", () => {
    const SELECTOR = bytesToHex(
      selectorForSignature(
        "depositNow(bytes32,bytes32,bytes32,bytes32,uint256,uint256,uint256,bytes32,uint32,uint32,bytes)",
      ),
    );

    const DEPOSIT_NOW_CALLDATA =
      SELECTOR +
      padAddr(DEPOSITOR) + // depositor
      SOLANA_RECIPIENT + // recipient
      padAddr(USDC) + // inputToken
      SOLANA_USDC + // outputToken
      padInt(250_000_000n) + // inputAmount = 250 USDC
      padInt(249_800_000n) + // outputAmount
      padInt(BigInt(SOLANA_CHAIN_ID)) + // destinationChainId
      padInt(0n) + // exclusiveRelayer
      padInt(18_000n) + // fillDeadlineOffset = 5 hours
      padInt(0n) + // exclusivityParameter
      padInt(11n * 32n) + // message offset
      EMPTY_MESSAGE;

    it("renders a non-EVM bytes32 token as hex and keeps the zero-padded depositor", async () => {
      const opts = buildOpts({ resolveToken, resolveChainInfo });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: DEPOSIT_NOW_CALLDATA,
          value: 0n,
        },
        opts,
      );

      expect(result.intent).toBe("Bridge tokens");
      expect(result.interpolatedIntent).toBe(
        `Bridge 250 USDC to 0x${SOLANA_RECIPIENT} on the destination chain; depositor ${checksum(DEPOSITOR)}`,
      );

      assert(result.fields);
      expect(result.fields).toHaveLength(8);
      assertField(result.fields[0], {
        label: "Amount to Bridge",
        value: "250 USDC",
        fieldType: "uint",
        format: "tokenAmount",
        tokenAddress: checksum(USDC),
      });
      assertField(result.fields[1], {
        label: "Native Value Sent",
        value: "0 ETH",
        fieldType: "uint",
        format: "amount",
      });
      assertField(result.fields[2], {
        label: "Destination Chain",
        value: "Solana",
        fieldType: "uint",
        format: "enum",
      });
      assertField(result.fields[3], {
        label: "Recipient",
        value: `0x${SOLANA_RECIPIENT}`,
        fieldType: "bytes",
        format: "raw",
      });
      assertField(result.fields[4], {
        label: "Relayer Must Send",
        value: "249800000",
        fieldType: "uint",
        format: "tokenAmount",
        // tokenPath slices the low 20 bytes of the Solana key
        tokenAddress: checksum(`0x${SOLANA_USDC.slice(24)}`),
        warningCode: "UNKNOWN_TOKEN",
      });
      assertField(result.fields[5], {
        label: "Output Token (dest.)",
        value: `0x${SOLANA_USDC}`,
        fieldType: "bytes",
        format: "tokenTicker",
        warningCode: "UNKNOWN_TOKEN",
      });
      assertField(result.fields[6], {
        label: "Depositor",
        value: checksum(DEPOSITOR),
        fieldType: "bytes",
        format: "addressName",
        rawAddress: checksum(DEPOSITOR),
        warningCode: "UNKNOWN_ADDRESS",
      });
      assertField(result.fields[7], {
        label: "Fill Window",
        value: "05:00:00",
        fieldType: "uint",
        format: "duration",
      });

      assertMetadata(result);
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
