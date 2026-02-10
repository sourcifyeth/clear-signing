/**
 * Descriptor lookup and token metadata resolution for clear signing.
 */

import { ResolverError, EngineError } from './errors.js';
import type {
  IndexEntry,
  ResolvedCall,
  ResolvedDescriptor,
  ResolvedTypedDescriptor,
  TokenMeta,
} from './types.js';
import {
  buildDescriptor,
  decodeArguments,
  determineTokenKey,
  getFormatMap,
  getFunctionDescriptors,
  resolveEffectiveField,
} from './descriptor.js';
import { lookupTokenByCaip19 } from './token-registry.js';
import { bytesEqual, normalizeAddress, nativeTokenKey } from './utils.js';

// Import assets
import indexJson from './assets/index.json' with { type: 'json' };
import indexEip712Json from './assets/index_eip712.json' with { type: 'json' };
import addressBookJson from './assets/address_book.json' with { type: 'json' };

// Descriptors
import descriptorErc20Usdt from './assets/descriptors/erc20_usdt.json' with { type: 'json' };
import descriptorErc20Usdc from './assets/descriptors/erc20_usdc.json' with { type: 'json' };
import descriptorWeth9 from './assets/descriptors/weth9.json' with { type: 'json' };
import descriptorUniswapV3RouterV1 from './assets/descriptors/uniswap_v3_router_v1.json' with { type: 'json' };
import descriptorAggregationRouterV4 from './assets/descriptors/aggregation_router_v4.json' with { type: 'json' };
import descriptor1inchAggRouterV3 from './assets/descriptors/1inch/calldata-AggregationRouterV3.json' with { type: 'json' };
import descriptor1inchAggRouterV4Eth from './assets/descriptors/1inch/calldata-AggregationRouterV4-eth.json' with { type: 'json' };
import descriptor1inchAggRouterV4 from './assets/descriptors/1inch/calldata-AggregationRouterV4.json' with { type: 'json' };
import descriptor1inchAggRouterV5 from './assets/descriptors/1inch/calldata-AggregationRouterV5.json' with { type: 'json' };
import descriptor1inchAggRouterV6 from './assets/descriptors/1inch/calldata-AggregationRouterV6.json' with { type: 'json' };
import descriptor1inchAggRouterV6Zksync from './assets/descriptors/1inch/calldata-AggregationRouterV6-zksync.json' with { type: 'json' };
import descriptor1inchNativeOrderFactory from './assets/descriptors/1inch/calldata-NativeOrderFactory.json' with { type: 'json' };
import descriptorAaveLpv2 from './assets/descriptors/aave/calldata-lpv2.json' with { type: 'json' };
import descriptorAaveLpv3 from './assets/descriptors/aave/calldata-lpv3.json' with { type: 'json' };
import descriptorAaveWethGatewayV3 from './assets/descriptors/aave/calldata-WrappedTokenGatewayV3.json' with { type: 'json' };
import descriptorWalletconnectStakeweight from './assets/descriptors/walletconnect/calldata-stakeweight.json' with { type: 'json' };

// Includes
import includeCommonTestRouter from './assets/descriptors/common-test-router.json' with { type: 'json' };
import include1inchCommonV4 from './assets/descriptors/1inch/common-AggregationRouterV4.json' with { type: 'json' };
import include1inchCommonV6 from './assets/descriptors/1inch/common-AggregationRouterV6.json' with { type: 'json' };
import includeUniswapCommonEip712 from './assets/descriptors/uniswap/uniswap-common-eip712.json' with { type: 'json' };

// EIP-712 descriptors
import descriptor1inchLimitOrder from './assets/descriptors/1inch/eip712-1inch-limit-order.json' with { type: 'json' };
import descriptor1inchAggRouterV6Eip712 from './assets/descriptors/1inch/eip712-AggregationRouterV6.json' with { type: 'json' };
import descriptorUniswapPermit2 from './assets/descriptors/uniswap/eip712-uniswap-permit2.json' with { type: 'json' };

// ABIs
import abiErc20 from './assets/abis/erc20.json' with { type: 'json' };
import abiUniswapV3RouterV1 from './assets/abis/uniswap_v3_router_v1.json' with { type: 'json' };
import abiWeth9 from './assets/abis/weth9.json' with { type: 'json' };
import abi1inchAggRouterV3 from './assets/abis/1inch/aggregation_router_v3.json' with { type: 'json' };
import abi1inchAggRouterV4 from './assets/abis/1inch/aggregation_router_v4.json' with { type: 'json' };
import abi1inchAggRouterV5 from './assets/abis/1inch/aggregation_router_v5.json' with { type: 'json' };
import abi1inchAggRouterV6 from './assets/abis/1inch/aggregation_router_v6.json' with { type: 'json' };
import abi1inchNativeOrderFactory from './assets/abis/1inch/native_order_factory.json' with { type: 'json' };
import abiAaveLpv2 from './assets/abis/aave/lpv2.json' with { type: 'json' };
import abiAaveLpv3 from './assets/abis/aave/lpv3.json' with { type: 'json' };
import abiAaveWethGatewayV3 from './assets/abis/aave/weth_gateway_v3.json' with { type: 'json' };

type IndexMap = Record<string, IndexEntry>;
type TypedIndexMap = Record<string, string>;
type ChainAddressBook = Record<string, Record<string, string>>;

const index: IndexMap = indexJson as IndexMap;
const typedIndex: TypedIndexMap = indexEip712Json as TypedIndexMap;
const addressBook: ChainAddressBook = addressBookJson as ChainAddressBook;

const descriptorMap: Record<string, unknown> = {
  'descriptors/erc20_usdt.json': descriptorErc20Usdt,
  'descriptors/erc20_usdc.json': descriptorErc20Usdc,
  'descriptors/weth9.json': descriptorWeth9,
  'descriptors/uniswap_v3_router_v1.json': descriptorUniswapV3RouterV1,
  'descriptors/aggregation_router_v4.json': descriptorAggregationRouterV4,
  'descriptors/1inch/calldata-AggregationRouterV3.json': descriptor1inchAggRouterV3,
  'descriptors/1inch/calldata-AggregationRouterV4-eth.json': descriptor1inchAggRouterV4Eth,
  'descriptors/1inch/calldata-AggregationRouterV4.json': descriptor1inchAggRouterV4,
  'descriptors/1inch/calldata-AggregationRouterV5.json': descriptor1inchAggRouterV5,
  'descriptors/1inch/calldata-AggregationRouterV6.json': descriptor1inchAggRouterV6,
  'descriptors/1inch/calldata-AggregationRouterV6-zksync.json': descriptor1inchAggRouterV6Zksync,
  'descriptors/1inch/calldata-NativeOrderFactory.json': descriptor1inchNativeOrderFactory,
  'descriptors/aave/calldata-lpv2.json': descriptorAaveLpv2,
  'descriptors/aave/calldata-lpv3.json': descriptorAaveLpv3,
  'descriptors/aave/calldata-WrappedTokenGatewayV3.json': descriptorAaveWethGatewayV3,
  'descriptors/walletconnect/calldata-stakeweight.json': descriptorWalletconnectStakeweight,
};

const typedDescriptorMap: Record<string, unknown> = {
  'descriptors/1inch/eip712-1inch-limit-order.json': descriptor1inchLimitOrder,
  'descriptors/1inch/eip712-AggregationRouterV6.json': descriptor1inchAggRouterV6Eip712,
  'descriptors/uniswap/eip712-uniswap-permit2.json': descriptorUniswapPermit2,
};

const includeMap: Record<string, unknown> = {
  'common-test-router.json': includeCommonTestRouter,
  'common-AggregationRouterV4.json': include1inchCommonV4,
  'common-AggregationRouterV6.json': include1inchCommonV6,
  'uniswap-common-eip712.json': includeUniswapCommonEip712,
};

const abiMap: Record<string, unknown> = {
  'abis/erc20.json': abiErc20,
  'abis/uniswap_v3_router_v1.json': abiUniswapV3RouterV1,
  'abis/weth9.json': abiWeth9,
  'abis/1inch/aggregation_router_v3.json': abi1inchAggRouterV3,
  'abis/1inch/aggregation_router_v4.json': abi1inchAggRouterV4,
  'abis/1inch/aggregation_router_v5.json': abi1inchAggRouterV5,
  'abis/1inch/aggregation_router_v6.json': abi1inchAggRouterV6,
  'abis/1inch/native_order_factory.json': abi1inchNativeOrderFactory,
  'abis/aave/lpv2.json': abiAaveLpv2,
  'abis/aave/lpv3.json': abiAaveLpv3,
  'abis/aave/weth_gateway_v3.json': abiAaveWethGatewayV3,
};

/**
 * Resolves a descriptor bundle for the given chain and address.
 */
export function resolve(chainId: number, to: string): ResolvedDescriptor {
  const key = `eip155:${chainId}:${normalizeAddress(to)}`;
  const entry = index[key];

  if (!entry) {
    throw ResolverError.notFound(key);
  }

  const descriptor = descriptorMap[entry.descriptor];
  if (!descriptor) {
    throw ResolverError.invalidIndex(entry.descriptor);
  }

  const descriptorJson = JSON.stringify(descriptor);
  let abiJson: string | undefined;

  if (entry.abi) {
    const abi = abiMap[entry.abi];
    if (!abi) {
      throw ResolverError.invalidIndex(entry.abi);
    }
    abiJson = JSON.stringify(abi);
  }

  const includes = extractIncludes(descriptor as Record<string, unknown>);

  return {
    descriptorJson,
    abiJson,
    includes,
  };
}

/**
 * Resolves a descriptor and fetches token metadata required for rendering.
 */
export function resolveCall(
  chainId: number,
  to: string,
  calldata: Uint8Array,
  value?: Uint8Array
): ResolvedCall {
  const resolved = resolve(chainId, to);
  const descriptor = buildDescriptor(resolved);

  const selector = calldata.slice(0, 4);
  const functions = getFunctionDescriptors(descriptor);

  const tokenMetadata = new Map<string, TokenMeta>();
  const fn = functions.find((f) => bytesEqual(f.selector, selector));

  if (fn) {
    const decoded = decodeArguments(fn, calldata).withValue(value);
    const formatMap = getFormatMap(descriptor);
    const format = formatMap.get(fn.typedSignature);

    if (format) {
      const warnings: string[] = [];
      const definitions = descriptor.display.definitions || {};

      for (const field of format.fields) {
        const effective = resolveEffectiveField(field, definitions, warnings);
        if (!effective) continue;

        if (effective.format === 'tokenAmount') {
          try {
            const key = determineTokenKey(effective, decoded, chainId, to);
            const meta = lookupTokenByCaip19(key);
            if (meta) {
              tokenMetadata.set(key, meta);
            } else {
              throw EngineError.tokenRegistry(`token registry missing entry for ${key}`);
            }
          } catch (e) {
            if (e instanceof EngineError) throw e;
            // Skip token lookup errors during resolution
          }
        } else if (effective.format === 'amount') {
          const key = nativeTokenKey(chainId);
          if (key) {
            const meta = lookupTokenByCaip19(key);
            if (meta) {
              tokenMetadata.set(key, meta);
            }
          }
        }
      }
    }
  }

  const descriptorAddressBook = getDescriptorAddressBook(descriptor);
  const registryEntries = getRegistryAddressBook(chainId);

  // Merge address books
  const addressBookMap = new Map<string, string>();
  for (const [addr, label] of Object.entries(descriptorAddressBook)) {
    addressBookMap.set(addr, label);
  }
  for (const [addr, label] of Object.entries(registryEntries)) {
    if (!addressBookMap.has(addr)) {
      addressBookMap.set(addr, label);
    }
  }

  return {
    descriptor: resolved,
    tokenMetadata,
    addressBook: addressBookMap,
  };
}

/**
 * Resolves an EIP-712 descriptor for the given chain and verifying contract.
 */
export function resolveTyped(
  chainId: number,
  verifyingContract: string
): ResolvedTypedDescriptor {
  const key = `eip155:${chainId}:${normalizeAddress(verifyingContract)}`;
  const path = typedIndex[key];

  if (!path) {
    throw ResolverError.notFound(key);
  }

  const descriptor = typedDescriptorMap[path];
  if (!descriptor) {
    throw ResolverError.invalidIndex(path);
  }

  const descriptorJson = JSON.stringify(descriptor);
  const includes = extractIncludes(descriptor as Record<string, unknown>);

  // Build address book
  const addressBookMap = new Map<string, string>();
  const descriptorValue = descriptor as Record<string, unknown>;

  const metadata = descriptorValue.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const label = getMetadataLabel(metadata);
    if (label) {
      const context = descriptorValue.context as Record<string, unknown> | undefined;
      const eip712 = context?.eip712 as Record<string, unknown> | undefined;
      const deployments = eip712?.deployments as Array<Record<string, unknown>> | undefined;

      if (deployments) {
        for (const deployment of deployments) {
          const addr = deployment.address as string | undefined;
          if (addr) {
            addressBookMap.set(normalizeAddress(addr), label);
          }
        }
      }

      addressBookMap.set(normalizeAddress(verifyingContract), label);
    }

    mergeAddressBookEntries(addressBookMap, metadata.addressBook);
  }

  // Merge registry entries
  const registryEntries = getRegistryAddressBook(chainId);
  for (const [addr, label] of Object.entries(registryEntries)) {
    if (!addressBookMap.has(addr)) {
      addressBookMap.set(addr, label);
    }
  }

  return {
    descriptorJson,
    includes,
    addressBook: addressBookMap,
  };
}

/**
 * Merge descriptor JSON with includes.
 */
export function mergedDescriptorValue(
  descriptorJson: string,
  includes: string[]
): Record<string, unknown> {
  const descriptorValue = JSON.parse(descriptorJson) as Record<string, unknown>;

  for (const includeJson of includes) {
    const includeValue = JSON.parse(includeJson) as Record<string, unknown>;
    mergeIncludeValue(descriptorValue, includeValue);
  }

  delete descriptorValue.includes;
  return descriptorValue;
}

function mergeIncludeValue(
  target: Record<string, unknown>,
  include: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(include)) {
    if (target[key] === undefined) {
      target[key] = value;
    } else if (
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key]) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
    ) {
      mergeIncludeValue(
        target[key] as Record<string, unknown>,
        value as Record<string, unknown>
      );
    }
  }
}

function extractIncludes(descriptor: Record<string, unknown>): string[] {
  const includesValue = descriptor.includes;
  if (!includesValue) return [];

  const includes: string[] = [];

  if (typeof includesValue === 'string') {
    const content = includeMap[includesValue];
    if (!content) {
      throw ResolverError.includeNotFound(includesValue);
    }
    includes.push(JSON.stringify(content));
  } else if (Array.isArray(includesValue)) {
    for (const item of includesValue) {
      if (typeof item !== 'string') {
        throw ResolverError.parse('includes entries must be strings');
      }
      const content = includeMap[item];
      if (!content) {
        throw ResolverError.includeNotFound(item);
      }
      includes.push(JSON.stringify(content));
    }
  } else {
    throw ResolverError.parse('"includes" must be string or array');
  }

  return includes;
}

function getDescriptorAddressBook(
  descriptor: ReturnType<typeof buildDescriptor>
): Record<string, string> {
  const map: Record<string, string> = {};

  const label = getDescriptorFriendlyLabel(descriptor);
  if (label) {
    for (const deployment of descriptor.context.contract.deployments) {
      map[normalizeAddress(deployment.address)] = label;
    }
  }

  mergeAddressBookEntries(new Map(Object.entries(map)), descriptor.metadata.addressBook);
  return map;
}

function getDescriptorFriendlyLabel(
  descriptor: ReturnType<typeof buildDescriptor>
): string | undefined {
  return getMetadataLabel(descriptor.metadata) ?? descriptor.context.$id;
}

function getMetadataLabel(metadata: Record<string, unknown>): string | undefined {
  const token = metadata.token as Record<string, unknown> | undefined;
  if (token) {
    const name = token.name as string | undefined;
    const symbol = token.symbol as string | undefined;
    if (name && symbol) {
      return name.toLowerCase() === symbol.toLowerCase() ? name : `${name} (${symbol})`;
    }
    return name ?? symbol;
  }

  const info = metadata.info as Record<string, unknown> | undefined;
  if (info) {
    const legalName = info.legalName as string | undefined;
    if (legalName) return legalName;
    const name = info.name as string | undefined;
    if (name) return name;
  }

  const owner = metadata.owner as string | undefined;
  if (owner) return owner;

  return undefined;
}

function mergeAddressBookEntries(
  map: Map<string, string>,
  value: unknown
): void {
  if (!value || typeof value !== 'object') return;

  const entries = value as Record<string, unknown>;
  for (const [key, labelValue] of Object.entries(entries)) {
    if (typeof labelValue === 'string') {
      if (!map.has(normalizeAddress(key))) {
        map.set(normalizeAddress(key), labelValue);
      }
    } else if (typeof labelValue === 'object' && labelValue !== null) {
      const nested = labelValue as Record<string, unknown>;
      for (const [innerKey, innerLabelValue] of Object.entries(nested)) {
        if (typeof innerLabelValue === 'string') {
          if (!map.has(normalizeAddress(innerKey))) {
            map.set(normalizeAddress(innerKey), innerLabelValue);
          }
        }
      }
    }
  }
}

function getRegistryAddressBook(chainId: number): Record<string, string> {
  const key = `eip155:${chainId}`.toLowerCase();
  const entries = addressBook[key];
  if (!entries) return {};

  const result: Record<string, string> = {};
  for (const [address, label] of Object.entries(entries)) {
    result[normalizeAddress(address)] = label;
  }
  return result;
}
