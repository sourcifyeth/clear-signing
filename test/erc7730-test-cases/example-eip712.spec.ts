/**
 * Tests based on the ERC-7730 spec test case: example-eip712.json
 * Tests EIP-712 typed data clear signing with PermitSingle and PermitBatch.
 * @see https://eips.ethereum.org/EIPS/eip-7730#test-cases
 */

import { describe, it, expect, assert } from "vitest";
import { formatTypedData, isFieldGroup } from "../../src/index";
import type { ExternalDataProvider, TypedData } from "../../src/types";
import { toChecksumAddress, hexToBytes } from "../../src/utils";
import { buildEmbeddedResolverOpts } from "../utils";

describe("example-eip712.json — PermitSingle", () => {
  const VERIFYING_CONTRACT = "0x0000000000112233445566778899aabbccddeeff";
  const CHAIN_ID = 1;

  const SPENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const TOKEN_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"; // USDC
  const SIGNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const PERMIT_SINGLE: TypedData = {
    account: SIGNER,
    domain: {
      name: "Permit2",
      chainId: CHAIN_ID,
      verifyingContract: VERIFYING_CONTRACT,
    },
    primaryType: "PermitSingle",
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      PermitSingle: [
        { name: "details", type: "PermitDetails" },
        { name: "spender", type: "address" },
        { name: "sigDeadline", type: "uint256" },
      ],
      PermitDetails: [
        { name: "token", type: "address" },
        { name: "amount", type: "uint160" },
        { name: "expiration", type: "uint48" },
        { name: "nonce", type: "uint48" },
      ],
    },
    message: {
      details: {
        token: TOKEN_ADDRESS,
        amount: "1000000", // 1 USDC
        expiration: "1735689600", // 2025-01-01 00:00:00 UTC
        nonce: "0",
      },
      spender: SPENDER,
      sigDeadline: "1735689600",
    },
  };

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (
      chainId === CHAIN_ID &&
      tokenAddress.toLowerCase() === TOKEN_ADDRESS.toLowerCase()
    ) {
      return { name: "USD Coin", symbol: "USDC", decimals: 6 };
    }
    return null;
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        eip712DescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: VERIFYING_CONTRACT,
            file: "example-eip712.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats PermitSingle with visible fields and skips hidden ones", async () => {
    const opts = buildOpts({ resolveToken });

    const result = await formatTypedData(PERMIT_SINGLE, opts);

    expect(result.intent).toBe("Authorize spending of token");

    assert(result.fields);
    // 3 visible fields: spender, amount, expiration
    // 2 hidden: nonce, sigDeadline
    expect(result.fields).toHaveLength(3);

    // Spender — raw format
    const spenderField = result.fields[0];
    assert(!isFieldGroup(spenderField));
    expect(spenderField.label).toBe("Spender");
    expect(spenderField.value).toBe(toChecksumAddress(hexToBytes(SPENDER)));
    expect(spenderField.fieldType).toBe("address");
    expect(spenderField.format).toBe("raw");
    expect(spenderField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(SPENDER)),
    );
    expect(spenderField.tokenAddress).toBeUndefined();
    expect(spenderField.calldataDisplay).toBeUndefined();
    expect(spenderField.warning).toBeUndefined();

    // Amount allowance — tokenAmount format
    const amountField = result.fields[1];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Amount allowance");
    expect(amountField.value).toBe("1 USDC");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(TOKEN_ADDRESS)),
    );
    expect(amountField.calldataDisplay).toBeUndefined();
    expect(amountField.rawAddress).toBeUndefined();
    expect(amountField.warning).toBeUndefined();

    // Approval expires — date format
    const expirationField = result.fields[2];
    assert(!isFieldGroup(expirationField));
    expect(expirationField.label).toBe("Approval expires");
    expect(expirationField.value).toBe("2025-01-01 00:00:00 UTC");
    expect(expirationField.fieldType).toBe("uint");
    expect(expirationField.format).toBe("date");
    expect(expirationField.rawAddress).toBeUndefined();
    expect(expirationField.tokenAddress).toBeUndefined();
    expect(expirationField.calldataDisplay).toBeUndefined();
    expect(expirationField.warning).toBeUndefined();

    // No interpolatedIntent defined in this descriptor
    expect(result.interpolatedIntent).toBeUndefined();

    assert(result.metadata);
    expect(result.metadata.owner).toBe("MyContract");
    expect(result.metadata.info).toEqual({ url: "https://example.org/" });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("returns UNKNOWN_TOKEN warning when token cannot be resolved", async () => {
    const opts = buildOpts();

    const result = await formatTypedData(PERMIT_SINGLE, opts);

    assert(result.fields);
    const amountField = result.fields[1];
    assert(!isFieldGroup(amountField));
    expect(amountField.label).toBe("Amount allowance");
    expect(amountField.value).toBe("1,000,000");
    expect(amountField.fieldType).toBe("uint");
    expect(amountField.format).toBe("tokenAmount");
    expect(amountField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(TOKEN_ADDRESS)),
    );
    expect(amountField.calldataDisplay).toBeUndefined();
    expect(amountField.rawAddress).toBeUndefined();
    assert(amountField.warning);
    expect(amountField.warning.code).toBe("UNKNOWN_TOKEN");

    // No interpolatedIntent defined in this descriptor
    expect(result.interpolatedIntent).toBeUndefined();

    assert(result.metadata);
    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("returns DOMAIN_MISMATCH for wrong chain", async () => {
    const wrongChainData: TypedData = {
      ...PERMIT_SINGLE,
      domain: { ...PERMIT_SINGLE.domain, chainId: 999 },
    };

    const opts = buildEmbeddedResolverOpts(__dirname, {
      eip712DescriptorFiles: [
        {
          chainId: 999,
          address: VERIFYING_CONTRACT,
          file: "example-eip712.json",
        },
      ],
    });

    const result = await formatTypedData(wrongChainData, opts);

    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "DOMAIN_MISMATCH")).toBe(
      true,
    );

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
  });

  it("returns DOMAIN_MISMATCH when domain.name does not match descriptor constraint", async () => {
    const wrongDomainData: TypedData = {
      ...PERMIT_SINGLE,
      domain: { ...PERMIT_SINGLE.domain, name: "WrongName" },
    };

    const opts = buildOpts({ resolveToken });
    const result = await formatTypedData(wrongDomainData, opts);

    assert(result.warnings);
    expect(result.warnings.some((w) => w.code === "DOMAIN_MISMATCH")).toBe(
      true,
    );

    expect(result.intent).toBeUndefined();
    expect(result.fields).toBeUndefined();
    expect(result.interpolatedIntent).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.rawCalldataFallback).toBeUndefined();
  });
});

describe("example-eip712.json — PermitBatch", () => {
  const VERIFYING_CONTRACT = "0x0000000000112233445566778899aabbccddeeff";
  const CHAIN_ID = 1;

  const SPENDER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const SIGNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F";

  const PERMIT_BATCH_TYPES = {
    EIP712Domain: [
      { name: "name", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ],
    PermitBatch: [
      { name: "details", type: "PermitDetails[]" },
      { name: "spender", type: "address" },
      { name: "sigDeadline", type: "uint256" },
    ],
    PermitDetails: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
      { name: "nonce", type: "uint48" },
    ],
  };

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    const lower = tokenAddress.toLowerCase();
    if (chainId === CHAIN_ID && lower === USDC_ADDRESS.toLowerCase()) {
      return { name: "USD Coin", symbol: "USDC", decimals: 6 };
    }
    if (chainId === CHAIN_ID && lower === DAI_ADDRESS.toLowerCase()) {
      return { name: "Dai Stablecoin", symbol: "DAI", decimals: 18 };
    }
    return null;
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        eip712DescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: VERIFYING_CONTRACT,
            file: "example-eip712.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats PermitBatch with array iteration over details", async () => {
    const permitBatch: TypedData = {
      account: SIGNER,
      domain: {
        name: "Permit2",
        chainId: CHAIN_ID,
        verifyingContract: VERIFYING_CONTRACT,
      },
      primaryType: "PermitBatch",
      types: PERMIT_BATCH_TYPES,
      message: {
        details: [
          {
            token: USDC_ADDRESS,
            amount: "1000000",
            expiration: "1735689600",
            nonce: "0",
          },
          {
            token: DAI_ADDRESS,
            amount: "2000000000000000000",
            expiration: "1767225600",
            nonce: "1",
          },
        ],
        spender: SPENDER,
        sigDeadline: "1735689600",
      },
    };

    const opts = buildOpts({ resolveToken });
    const result = await formatTypedData(permitBatch, opts);

    expect(result.intent).toBe("Authorize spending of tokens");

    assert(result.fields);
    // Spender (flat) + 1 DisplayFieldGroup with all details + sigDeadline (hidden)
    expect(result.fields).toHaveLength(2);

    // Spender — flat field
    const spenderField = result.fields[0];
    assert(!isFieldGroup(spenderField));
    expect(spenderField.label).toBe("Spender");
    expect(spenderField.value).toBe(toChecksumAddress(hexToBytes(SPENDER)));
    expect(spenderField.fieldType).toBe("address");
    expect(spenderField.format).toBe("raw");
    expect(spenderField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(SPENDER)),
    );
    expect(spenderField.tokenAddress).toBeUndefined();
    expect(spenderField.calldataDisplay).toBeUndefined();
    expect(spenderField.warning).toBeUndefined();

    // Single details group containing all 4 fields (2 per detail, nonce hidden)
    const group = result.fields[1];
    assert(isFieldGroup(group));
    expect(group.warning).toBeUndefined();
    expect(group.fields).toHaveLength(4);
    expect(group.label).toBeUndefined();

    // Detail 0 (USDC)
    const amount0 = group.fields[0];
    expect(amount0.label).toBe("Amount allowance");
    expect(amount0.value).toBe("1 USDC");
    expect(amount0.fieldType).toBe("uint");
    expect(amount0.format).toBe("tokenAmount");
    expect(amount0.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(USDC_ADDRESS)),
    );
    expect(amount0.calldataDisplay).toBeUndefined();
    expect(amount0.rawAddress).toBeUndefined();
    expect(amount0.warning).toBeUndefined();

    const exp0 = group.fields[1];
    expect(exp0.label).toBe("Approval expires");
    expect(exp0.value).toBe("2025-01-01 00:00:00 UTC");
    expect(exp0.fieldType).toBe("uint");
    expect(exp0.format).toBe("date");
    expect(exp0.rawAddress).toBeUndefined();
    expect(exp0.tokenAddress).toBeUndefined();
    expect(exp0.calldataDisplay).toBeUndefined();
    expect(exp0.warning).toBeUndefined();

    // Detail 1 (DAI)
    const amount1 = group.fields[2];
    expect(amount1.label).toBe("Amount allowance");
    expect(amount1.value).toBe("2 DAI");
    expect(amount1.fieldType).toBe("uint");
    expect(amount1.format).toBe("tokenAmount");
    expect(amount1.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(DAI_ADDRESS)),
    );
    expect(amount1.calldataDisplay).toBeUndefined();
    expect(amount1.rawAddress).toBeUndefined();
    expect(amount1.warning).toBeUndefined();

    const exp1 = group.fields[3];
    expect(exp1.label).toBe("Approval expires");
    expect(exp1.value).toBe("2026-01-01 00:00:00 UTC");
    expect(exp1.fieldType).toBe("uint");
    expect(exp1.format).toBe("date");
    expect(exp1.rawAddress).toBeUndefined();
    expect(exp1.tokenAddress).toBeUndefined();
    expect(exp1.calldataDisplay).toBeUndefined();
    expect(exp1.warning).toBeUndefined();

    expect(result.interpolatedIntent).toBeUndefined();

    assert(result.metadata);
    expect(result.metadata.owner).toBe("MyContract");
    expect(result.metadata.info).toEqual({ url: "https://example.org/" });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });

  it("returns EMPTY_ARRAY warning for PermitBatch with empty details", async () => {
    const emptyBatch: TypedData = {
      account: SIGNER,
      domain: {
        name: "Permit2",
        chainId: CHAIN_ID,
        verifyingContract: VERIFYING_CONTRACT,
      },
      primaryType: "PermitBatch",
      types: PERMIT_BATCH_TYPES,
      message: {
        details: [],
        spender: SPENDER,
        sigDeadline: "1735689600",
      },
    };

    const opts = buildOpts({ resolveToken });
    const result = await formatTypedData(emptyBatch, opts);

    expect(result.intent).toBe("Authorize spending of tokens");

    assert(result.fields);
    // Spender (flat) + 1 empty DisplayFieldGroup + sigDeadline (hidden)
    expect(result.fields).toHaveLength(2);

    // Spender — flat field
    const spenderField = result.fields[0];
    assert(!isFieldGroup(spenderField));
    expect(spenderField.label).toBe("Spender");
    expect(spenderField.value).toBe(toChecksumAddress(hexToBytes(SPENDER)));

    // Empty details group
    const emptyGroup = result.fields[1];
    assert(isFieldGroup(emptyGroup));
    expect(emptyGroup.fields).toHaveLength(0);
    assert(emptyGroup.warning);
    expect(emptyGroup.warning.code).toBe("EMPTY_ARRAY");

    expect(result.interpolatedIntent).toBeUndefined();

    assert(result.metadata);
    expect(result.metadata.owner).toBe("MyContract");
    expect(result.metadata.info).toEqual({ url: "https://example.org/" });

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
