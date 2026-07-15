/**
 * Tests for the Zama ConfidentialWrapper descriptor:
 * - confidentialTransfer: an fhevm-encrypted `bytes32` amount handle decrypted
 *   via the wallet's resolveDecryptedValue callback, then rendered with the
 *   field's regular tokenAmount format.
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel, ExternalDataProvider } from "../../../src/types.js";
import { toChecksumAddress, hexToBytes } from "../../../src/utils.js";
import { buildFilesystemResolverOpts } from "../../utils.js";

describe("Zama ConfidentialWrapper", () => {
  const CHAIN_ID = 1;
  // The wrapper is itself the confidential token, so `tokenPath: "@.to"`
  // resolves the token metadata to this same address.
  const CONTRACT = "0xe978F22157048E5DB8E5d07971376e86671672B2";
  const RECEIVER = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildFilesystemResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-ConfidentialWrapper.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  // =========================================================================
  // confidentialTransfer
  // =========================================================================
  describe("confidentialTransfer", () => {
    // confidentialTransfer(address to, bytes32 amount)
    //   to     = 0x7099…79C8
    //   amount = 0xabcd…6789  (an fhevm ciphertext handle, not a value)
    const HANDLE =
      "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const CONFIDENTIAL_TRANSFER_CALLDATA =
      "0x5bebed7e" +
      "00000000000000000000000070997970c51812dc3a010c7d01b50e0d17dc79c8" +
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";

    const resolveToken: ExternalDataProvider["resolveToken"] = async (
      chainId,
      tokenAddress,
    ) => {
      if (chainId === CHAIN_ID && tokenAddress === CONTRACT.toLowerCase()) {
        return { name: "Confidential USDC", symbol: "cUSDC", decimals: 6 };
      }
      return null;
    };

    const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
      address,
    ) => {
      if (address === RECEIVER) {
        return { name: "bob.eth", typeMatch: true };
      }
      return null;
    };

    it("decrypts the encrypted amount handle and renders it as a token amount", async () => {
      // The wallet returns the plaintext as hex of its big-endian bytes —
      // uint64 1000000, which the descriptor's `plaintextType: "uint64"` tells
      // the library how to re-interpret.
      const calls: Array<
        [number, string, { scheme: string; contractAddress?: string }]
      > = [];
      const resolveDecryptedValue: ExternalDataProvider["resolveDecryptedValue"] =
        async (chainId, encryptedValue, params) => {
          calls.push([chainId, encryptedValue, params]);
          if (encryptedValue === HANDLE) {
            return { value: "0x00000000000f4240" };
          }
          return null;
        };

      const opts = buildOpts({
        resolveToken,
        resolveLocalName,
        resolveDecryptedValue,
      });

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: CONFIDENTIAL_TRANSFER_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Confidential transfer");

      // The wallet is handed the raw handle and the contract to run the fhevm
      // ACL check against (the container's `@.to`).
      expect(calls).toEqual([
        [CHAIN_ID, HANDLE, { scheme: "fhevm", contractAddress: CONTRACT }],
      ]);

      assert(result.fields);
      expect(result.fields).toHaveLength(2);

      // Field 0: Amount — decrypted handle (1000000, 6 decimals) → "1 cUSDC"
      const amountField = result.fields[0];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Amount");
      expect(amountField.value).toBe("1 cUSDC");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("tokenAmount");
      expect(amountField.tokenAddress).toBe(
        toChecksumAddress(hexToBytes(CONTRACT)),
      );
      // Reported even though decryption succeeded, so the wallet can surface
      // the underlying encrypted value alongside the plaintext.
      expect(amountField.rawEncryptedValue).toBe(HANDLE);
      expect(amountField.embeddedCalldata).toBeUndefined();
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.warning).toBeUndefined();

      // Field 1: Receiver (addressName, to → bob.eth)
      const receiverField = result.fields[1];
      assert(!isFieldGroup(receiverField));
      expect(receiverField.label).toBe("Receiver");
      expect(receiverField.value).toBe("bob.eth");
      expect(receiverField.fieldType).toBe("address");
      expect(receiverField.format).toBe("addressName");
      expect(receiverField.rawAddress).toBe(
        toChecksumAddress(hexToBytes(RECEIVER)),
      );
      expect(receiverField.tokenAddress).toBeUndefined();
      expect(receiverField.embeddedCalldata).toBeUndefined();
      expect(receiverField.rawEncryptedValue).toBeUndefined();
      expect(receiverField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Zama");
      expect(result.metadata.contractName).toBe("ConfidentialWrapper");
      expect(result.metadata.info).toEqual({ url: "https://www.zama.org/" });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
