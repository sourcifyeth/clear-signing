/**
 * Tests for Figment ETH Depositor descriptor:
 * - deposit: batched validator deposits with bytes[] / bytes32[] / uint256[]
 *   arrays iterated via `#.<name>.[]` paths
 */

import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index.js";
import type { DisplayModel } from "../../../src/types.js";
import { bytesToHex, selectorForSignature } from "../../../src/utils.js";
import { buildEmbeddedResolverOpts } from "../../utils.js";

describe("Figment ETH Depositor", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x8B0d88B8Be3C15D746Feb0B1f18c883c03B6Aa62";

  function buildOpts() {
    return buildEmbeddedResolverOpts(__dirname, {
      calldataDescriptorFiles: [
        {
          chainId: CHAIN_ID,
          address: CONTRACT,
          file: "calldata-figment-batch-deposit.json",
        },
      ],
    });
  }

  // =========================================================================
  // deposit
  // =========================================================================
  describe("deposit", () => {
    // Single-validator deposit:
    //   pubkeys                = [<48 bytes of 0x11>]
    //   withdrawal_credentials = [0x01 + 11 zero bytes + 20-byte execution address]
    //   signatures             = [<96 bytes of 0x22>]
    //   deposit_data_roots     = [<32 bytes of 0x33>]
    //   amounts_gwei           = [32_000_000_000]   // 32 ETH expressed in gwei
    const PUBKEY = "11".repeat(48); // 96 hex chars = 48 bytes
    const WITHDRAWAL_CREDS =
      "010000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045";
    const SIGNATURE = "22".repeat(96); // 192 hex chars = 96 bytes
    const DEPOSIT_DATA_ROOT = "33".repeat(32); // 64 hex chars = 32 bytes
    const AMOUNT_GWEI_HEX =
      "0000000000000000000000000000000000000000000000000000000773594000"; // 32 * 10^9

    const SELECTOR = bytesToHex(
      selectorForSignature(
        "deposit(bytes[],bytes[],bytes[],bytes32[],uint256[])",
      ),
    );

    // Section sizes (relative to start after the 4-byte selector):
    //   head:                   5 offsets               = 160 bytes
    //   pubkeys:                len + off + len48 + 64  = 160 bytes (starts at 160 → 0xa0)
    //   withdrawal_credentials: len + off + len32 + 32  = 128 bytes (starts at 320 → 0x140)
    //   signatures:             len + off + len96 + 96  = 192 bytes (starts at 448 → 0x1c0)
    //   deposit_data_roots:     len + element32         =  64 bytes (starts at 640 → 0x280)
    //   amounts_gwei:           len + element32         =  64 bytes (starts at 704 → 0x2c0)
    const DEPOSIT_CALLDATA =
      SELECTOR +
      // head — 5 offsets to dynamic args
      "00000000000000000000000000000000000000000000000000000000000000a0" + // pubkeys
      "0000000000000000000000000000000000000000000000000000000000000140" + // withdrawal_credentials
      "00000000000000000000000000000000000000000000000000000000000001c0" + // signatures
      "0000000000000000000000000000000000000000000000000000000000000280" + // deposit_data_roots
      "00000000000000000000000000000000000000000000000000000000000002c0" + // amounts_gwei
      // pubkeys = [<48-byte pubkey>]
      "0000000000000000000000000000000000000000000000000000000000000001" + // length = 1
      "0000000000000000000000000000000000000000000000000000000000000020" + // element[0] offset = 32
      "0000000000000000000000000000000000000000000000000000000000000030" + // element[0] length = 48
      PUBKEY +
      "00000000000000000000000000000000" + // 48-byte content padded with 16 zero bytes
      // withdrawal_credentials = [<32-byte creds>]
      "0000000000000000000000000000000000000000000000000000000000000001" + // length = 1
      "0000000000000000000000000000000000000000000000000000000000000020" + // element[0] offset = 32
      "0000000000000000000000000000000000000000000000000000000000000020" + // element[0] length = 32
      WITHDRAWAL_CREDS +
      // signatures = [<96-byte sig>]
      "0000000000000000000000000000000000000000000000000000000000000001" + // length = 1
      "0000000000000000000000000000000000000000000000000000000000000020" + // element[0] offset = 32
      "0000000000000000000000000000000000000000000000000000000000000060" + // element[0] length = 96
      SIGNATURE +
      // deposit_data_roots = [<32-byte root>]
      "0000000000000000000000000000000000000000000000000000000000000001" + // length = 1
      DEPOSIT_DATA_ROOT +
      // amounts_gwei = [32_000_000_000]
      "0000000000000000000000000000000000000000000000000000000000000001" + // length = 1
      AMOUNT_GWEI_HEX;

    it("formats a single-validator deposit with bytes[] array iteration", async () => {
      const opts = buildOpts();

      const result: DisplayModel = await format(
        {
          chainId: CHAIN_ID,
          to: CONTRACT,
          data: DEPOSIT_CALLDATA,
        },
        opts,
      );

      expect(result.intent).toBe("Stake ETH");

      assert(result.fields);
      // 3 visible top-level array fields → 3 DisplayFieldGroups
      // (signatures and deposit_data_roots are visible: never)
      expect(result.fields).toHaveLength(3);

      // Group 0: Validator Public Key — raw bytes
      const pubkeyGroup = result.fields[0];
      assert(isFieldGroup(pubkeyGroup));
      expect(pubkeyGroup.label).toBeUndefined();
      expect(pubkeyGroup.warning).toBeUndefined();
      expect(pubkeyGroup.fields).toHaveLength(1);

      const pubkeyField = pubkeyGroup.fields[0];
      assert(!isFieldGroup(pubkeyField));
      expect(pubkeyField.label).toBe("Validator Public Key");
      expect(pubkeyField.value).toBe(`0x${PUBKEY}`);
      expect(pubkeyField.fieldType).toBe("bytes");
      expect(pubkeyField.format).toBe("raw");
      expect(pubkeyField.tokenAddress).toBeUndefined();
      expect(pubkeyField.rawAddress).toBeUndefined();
      expect(pubkeyField.embeddedCalldata).toBeUndefined();
      expect(pubkeyField.warning).toBeUndefined();

      // Group 1: Withdraw Credentials — raw bytes
      const credsGroup = result.fields[1];
      assert(isFieldGroup(credsGroup));
      expect(credsGroup.label).toBeUndefined();
      expect(credsGroup.warning).toBeUndefined();
      expect(credsGroup.fields).toHaveLength(1);

      const credsField = credsGroup.fields[0];
      assert(!isFieldGroup(credsField));
      expect(credsField.label).toBe("Withdraw Credentials");
      expect(credsField.value).toBe(`0x${WITHDRAWAL_CREDS}`);
      expect(credsField.fieldType).toBe("bytes");
      expect(credsField.format).toBe("raw");
      expect(credsField.tokenAddress).toBeUndefined();
      expect(credsField.rawAddress).toBeUndefined();
      expect(credsField.embeddedCalldata).toBeUndefined();
      expect(credsField.warning).toBeUndefined();

      // Group 2: Amount to Deposit — unit format, 32_000_000_000 gwei with decimals=9 → "32ETH"
      const amountGroup = result.fields[2];
      assert(isFieldGroup(amountGroup));
      expect(amountGroup.label).toBeUndefined();
      expect(amountGroup.warning).toBeUndefined();
      expect(amountGroup.fields).toHaveLength(1);

      const amountField = amountGroup.fields[0];
      assert(!isFieldGroup(amountField));
      expect(amountField.label).toBe("Amount to Deposit");
      expect(amountField.value).toBe("32ETH");
      expect(amountField.fieldType).toBe("uint");
      expect(amountField.format).toBe("unit");
      expect(amountField.tokenAddress).toBeUndefined();
      expect(amountField.rawAddress).toBeUndefined();
      expect(amountField.embeddedCalldata).toBeUndefined();
      expect(amountField.warning).toBeUndefined();

      // Metadata
      assert(result.metadata);
      expect(result.metadata.owner).toBe("Figment");
      expect(result.metadata.contractName).toBe("Figment ETH Depositor");
      expect(result.metadata.info).toEqual({ url: "https://figment.io/" });

      expect(result.interpolatedIntent).toBeUndefined();
      expect(result.rawCalldataFallback).toBeUndefined();
      expect(result.warnings).toBeUndefined();
    });
  });
});
