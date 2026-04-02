import { describe, it, expect, assert } from "vitest";
import { format, isFieldGroup } from "../../../src/index";
import type { DisplayModel, ExternalDataProvider } from "../../../src/types";
import { toChecksumAddress, hexToBytes } from "../../../src/utils";
import { buildEmbeddedResolverOpts } from "../../utils";

describe("1inch AggregationRouterV6 swap", () => {
  const CHAIN_ID = 1;
  const CONTRACT = "0x111111125421cA6dc452d289314280a0f8842A65";
  const FROM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

  const SRC_TOKEN = "0xe6264d3cc0948675e81e59d0fa2fd8e19cebf1f0";
  const DST_TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
  const BENEFICIARY = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
  const BENEFICIARY_NAME = "vitalik.eth";

  // swap() on 1inch AggregationRouterV6 — Ethereum mainnet block 24054887
  const SWAP_CALLDATA =
    "0x07ed2379" +
    "000000000000000000000000990636ecb3ff04d33d92e970d3d588bf5cd8d086" + // executor
    "000000000000000000000000e6264d3cc0948675e81e59d0fa2fd8e19cebf1f0" + // desc.srcToken
    "000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" + // desc.dstToken
    "000000000000000000000000990636ecb3ff04d33d92e970d3d588bf5cd8d086" + // desc.srcReceiver
    "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" + // desc.dstReceiver
    "00000000000000000000000000000000000018a6e32246c99c60ad8500000000" + // desc.amount
    "0000000000000000000000000000000000000000000000004ddc0a99119f757b" + // desc.minReturnAmount
    "0000000000000000000000000000000000000000000000000000000000000000" + // desc.flags
    "0000000000000000000000000000000000000000000000000000000000000120" + // data (offset)
    "0000000000000000000000000000000000000000000000000000000000000183" + // data length
    "00000000000000000000000000000000016500014f0001050000c900004e00a0" + // data content...
    "744c8c09e6264d3cc0948675e81e59d0fa2fd8e19cebf1f0cfd59c0f530db3" +
    "6eea8ccbfe744f01fe3556925e00000000000000000000000000000000000000" +
    "327cb2734119d3b7a9000000000c20e6264d3cc0948675e81e59d0fa2fd8e1" +
    "9cebf1f077949cad6f504bbb59886423127d17687babccbf6ae4071118002d" +
    "c6c077949cad6f504bbb59886423127d17687babccbf00000000000000000000" +
    "00000000000000000000000000004d77e160fbaa3c49e6264d3cc0948675e81e" +
    "59d0fa2fd8e19cebf1f04101c02aaa39b223fe8d0a0e5c4f27ead9083c756c" +
    "c200042e1a7d4d0000000000000000000000000000000000000000000000000" +
    "00000000000000000a0f2fa6b66eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" +
    "eeee0000000000000000000000000000000000000000000000004e4033d12794" +
    "aead00000000000000000005f7744d630968c061111111125421ca6dc452d289" +
    "314280a0f8842a6500000000000000000000000000000000000000000000000000000000006963f2b1";

  const resolveToken: ExternalDataProvider["resolveToken"] = async (
    chainId,
    tokenAddress,
  ) => {
    if (chainId === CHAIN_ID && tokenAddress === SRC_TOKEN.toLowerCase()) {
      return { name: "CHUPACABRA", symbol: "CHUPA", decimals: 18 };
    }
    if (chainId === CHAIN_ID && tokenAddress === DST_TOKEN.toLowerCase()) {
      return { name: "Wrapped Ether", symbol: "WETH", decimals: 18 };
    }
    return null;
  };

  const resolveLocalName: ExternalDataProvider["resolveLocalName"] = async (
    address,
  ) => {
    if (address === BENEFICIARY.toLowerCase()) {
      return { name: BENEFICIARY_NAME, typeMatch: true };
    }
    return null;
  };

  function buildOpts(externalDataProvider?: ExternalDataProvider) {
    return buildEmbeddedResolverOpts(
      __dirname,
      {
        calldataDescriptorFiles: [
          {
            chainId: CHAIN_ID,
            address: CONTRACT,
            file: "calldata-AggregationRouterV6.json",
          },
        ],
      },
      externalDataProvider,
    );
  }

  it("formats a swap call with all DisplayModel properties", async () => {
    const opts = buildOpts({ resolveToken, resolveLocalName });

    const result: DisplayModel = await format(
      {
        chainId: CHAIN_ID,
        to: CONTRACT,
        from: FROM,
        data: SWAP_CALLDATA,
      },
      opts,
    );

    expect(result.intent).toBe("Swap");

    assert(result.fields);
    expect(result.fields).toHaveLength(3);

    // Field 0: Amount to Send (tokenAmount, desc.srcToken → frxETH)
    const sendField = result.fields[0];
    assert(!isFieldGroup(sendField));
    expect(sendField.label).toBe("Amount to Send");
    expect(sendField.value).toBe("500,000,000,000,000 CHUPA");
    expect(sendField.fieldType).toBe("uint");
    expect(sendField.format).toBe("tokenAmount");
    expect(sendField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(SRC_TOKEN)),
    );
    expect(sendField.rawAddress).toBeUndefined();
    expect(sendField.warning).toBeUndefined();

    // Field 1: Minimum to Receive (tokenAmount, desc.dstToken → ETH)
    const receiveField = result.fields[1];
    assert(!isFieldGroup(receiveField));
    expect(receiveField.label).toBe("Minimum to Receive");
    expect(receiveField.value).toBe("5.610370888338732411 ETH");
    expect(receiveField.fieldType).toBe("uint");
    expect(receiveField.format).toBe("tokenAmount");
    expect(receiveField.tokenAddress).toBe(
      toChecksumAddress(hexToBytes(DST_TOKEN)),
    );
    expect(receiveField.rawAddress).toBeUndefined();
    expect(receiveField.warning).toBeUndefined();

    // Field 2: Beneficiary (addressName, desc.dstReceiver)
    const beneficiaryField = result.fields[2];
    assert(!isFieldGroup(beneficiaryField));
    expect(beneficiaryField.label).toBe("Beneficiary");
    expect(beneficiaryField.value).toBe(BENEFICIARY_NAME);
    expect(beneficiaryField.fieldType).toBe("address");
    expect(beneficiaryField.format).toBe("addressName");
    expect(beneficiaryField.rawAddress).toBe(
      toChecksumAddress(hexToBytes(BENEFICIARY)),
    );
    expect(beneficiaryField.tokenAddress).toBeUndefined();
    expect(beneficiaryField.warning).toBeUndefined();

    // Metadata — merged from common (owner, info) and main (contractName)
    assert(result.metadata);
    expect(result.metadata.owner).toBe("1inch Network");
    expect(result.metadata.contractName).toBe("AggregationRouterV6");
    expect(result.metadata.info).toEqual({
      url: "https://1inch.io/",
      deploymentDate: "2024-02-12T03:44:35Z",
    });

    // No interpolatedIntent defined for swap
    expect(result.interpolatedIntent).toBeUndefined();

    expect(result.rawCalldataFallback).toBeUndefined();
    expect(result.warnings).toBeUndefined();
  });
});
