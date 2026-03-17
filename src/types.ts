/** Ethereum transaction to be formatted. */
export interface Transaction {
  chainId: number;
  to: string;
  /** calldata hex string */
  data: string;
  value?: bigint;
  from?: string;
}

/** EIP-712 type member definition. */
export interface TypeMember {
  name: string;
  type: string;
}

/**
 * ERC-7730 field type category — the base Solidity type that determines
 * which display formats can be applied:
 *   - address → addressName, tokenTicker, interoperableAddressName, raw
 *   - uint/int → amount, tokenAmount, nftName, date, duration, unit, enum, chainId, raw
 *   - bytes   → calldata, raw
 *   - string  → raw
 *   - bool    → raw
 * Struct and array reference types have no ERC-7730 format mapping.
 */
export type FieldType =
  | "address"
  | "bool"
  | "string"
  | "bytes"
  | "uint"
  | "int";

/** EIP-712 typed data domain. */
export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
  salt?: string;
}

/** EIP-712 typed data input. */
export interface TypedData {
  account: string; // Needed for @.from references
  types: Record<string, TypeMember[]>;
  primaryType: string;
  domain: TypedDataDomain;
  message: Record<string, unknown>;
}

/** Non-fatal warning from formatting. */
export interface Warning {
  /** machine-readable warning code */
  code: string;
  /** human-readable warning message */
  message: string;
}

export interface RawCalldataFallback {
  /** function selector, e.g. "0x095ea7b3" */
  selector: string;
  /** hex-encoded ABI arguments */
  args: string[];
}

/**
 * A single labeled field to display to the user.
 *
 * When clear-signing transactions with embedded calldata (nested
 * transactions), value will be another `DisplayModel` which is
 * formatted via resolving a descriptor file for the embedded
 * calldata.
 */
export interface DisplayField {
  /** Label to show in the UI for this field. */
  label: string;
  /** Value to show in the UI for this field */
  value: string | DisplayModel;

  /**
   * The fieldType and format properties can be used to show type-specific
   * components. For example, for a fieldType of "address" the wallet can
   * display an address copy button.
   *
   * The fieldType corresponds to the underlying Solidity type.
   */
  fieldType: FieldType;
  /**
   * The format corresponds to the specific display format as per ERC-7730.
   */
  format: string;

  /**
   * For example for externally resolved data, wallets should display
   * a warning when encountering unknown entities.
   */
  warning?: Warning;

  /**
   * For formatted addresses, wallets should also display the raw
   * value in some form.
   */
  rawAddress?: string;
}

/**
 * The complete display model produced by the library.
 *
 * According to ERC-7730, wallets have two display options:
 *   1. Show `intent` as an explanation what the contract call does, and
 *      `fields` as a list of labeled values representing the calldata parameters.
 *   2. Show `interpolatedIntent` as a short string presentation of intent and fields,
 *      which already has formatted field values embedded in it — in this case
 *      `fields` can be omitted or shown as supplementary detail.
 *
 * When interpolation fails or is not defined, wallets should fall back to Option 1.
 */
export interface DisplayModel {
  /**
   * The intent from the resolved descriptor, representing a short
   * description of the operation, e.g. "Approve token spending".
   * Two possible forms:
   *   - A simple human-readable string
   *   - A list of human-readable key-value pairs
   */
  intent?: string | Record<string, string>;

  /**
   * Ordered list of fields to show to the user,
   * formatted according to their field format specification.
   */
  fields?: DisplayField[];

  /**
   * Full sentence with formatted field values interpolated in, e.g.
   * "Approve USDC spending up to 1,000 USDC for Uniswap V3".
   * Absent when the descriptor does not define an interpolatedIntent,
   * or when interpolation fails.
   */
  interpolatedIntent?: string;

  /**
   * Additional metadata directly from the resolved descriptor.
   * Wallets may choose to display these items to provide additional
   * context about the contract being interacted with.
   */
  metadata?: {
    owner?: string;
    contractName?: string;
    info?: { deploymentDate?: string; url?: string };
  };

  /**
   * Raw calldata fallback when no descriptor matched or the descriptor was faulty.
   * Only present for calldata formatting — not applicable to EIP-712 typed data.
   */
  rawCalldataFallback?: RawCalldataFallback;

  /**
   * Non-fatal warnings providing additional context, e.g. why
   * interpolation failed or why a field could not be formatted.
   */
  warnings?: Warning[];
}

/** Result of resolving an address name (ENS or local). */
export interface AddressNameResult {
  name: string;
  /** Whether the resolved address type matches the expected type. */
  typeMatch: boolean;
}

/** Result of resolving a token address */
export interface TokenResult {
  name: string;
  symbol: string;
  decimals: number;
}

/** Result of resolving an NFT collection name. */
export interface NftCollectionNameResult {
  name: string;
}

/** Wallet-provided async resolvers for external data. */
export interface ExternalDataProvider {
  /**
   * Resolution for addressName formats. The wallet must verify if the
   * address matches the provided type (e.g., "eoa", "contract", ...)
   * if able to. If the type does not match, the wallet should indicate
   * this in the result, such that the library can include a warning
   * about the resolved field in the DisplayModel.
   */
  resolveEnsName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;
  /**
   * Resolution for addressName formats. The wallet must verify if the
   * address matches the provided type (e.g., "eoa", "contract", ...)
   * if able to. If the type does not match, the wallet should indicate
   * this in the result, such that the library can include a warning
   * about the resolved field in the DisplayModel.
   */
  resolveLocalName?: (
    address: string,
    type: string,
  ) => Promise<AddressNameResult | null>;

  /** Resolution for tokenAmount formats. */
  resolveToken?: (
    chainId: number,
    tokenAddress: string,
  ) => Promise<TokenResult | null>;

  /** Resolution for nftName formats. */
  resolveNftCollectionName?: (
    collectionAddress: string,
  ) => Promise<NftCollectionNameResult | null>;
}

export interface FormatOptions {
  /**
   * Wallets should provide an object with async methods to resolve
   * external data like ENS names, token metadata, and NFT collection
   * names. The provided functions may use RPC calls or fetch data
   * from internal sources. This allows the library to remain
   * agnostic about how this data is fetched. If absent, the library
   * will fall back to raw formats for the corresponding fields.
   */
  externalDataProvider?: ExternalDataProvider;

  /**
   * Controls where descriptors are fetched from.
   * Defaults to the GitHub registry when omitted.
   * Will also allow to pass descriptors directly.
   */
  descriptorResolverOptions?: GitHubResolverOptions | EmbeddedResolverOptions;

  /**
   * For proxy contracts: the resolved implementation address to use for
   * descriptor lookup. If present the library will use this address to
   * resolve the descriptor instead of `tx.to`.
   * This leaves proxy detection up to the user of the library.
   */
  resolvedImplementationAddress?: string;
}

export type GitHubResolverOptions = {
  type: "github";
  index?: RegistryIndex; // defaults to a prebuilt GitHub registry index
  githubSource?: Partial<GitHubSource>; // only used when type is "github", ignored otherwise
};

export type EmbeddedResolverOptions = {
  type: "embedded";
  index: RegistryIndex; // must be provided for embedded resolvers
  descriptorDirectory: string;
};

export interface RegistryIndex {
  /**
   * Maps CAIP-10 identifiers ("eip155:{chainId}:{address}") to paths.
   * The type of path depends on the index strategy.
   */
  calldataIndex: Record<string, string>;
  typedDataIndex: Record<string, string>;
}

export interface GitHubSource {
  repo: string;
  ref: string;
}

export type DescriptorFieldFormatType =
  | "raw"
  | "amount"
  | "tokenAmount"
  | "nftName"
  | "date"
  | "duration"
  | "unit"
  | "enum"
  | "chainId"
  | "addressName"
  | "tokenTicker"
  | "calldata"
  | "interoperableAddressName";

export type DescriptorAddressType =
  | "wallet"
  | "eoa"
  | "contract"
  | "token"
  | "collection";

export type DescriptorAddressSource = "local" | "ens";

export interface DescriptorFieldEncryption {
  scheme?: string;
  plaintextType?: string;
  fallbackLabel?: string;
}

export interface DescriptorFieldFormatParams {
  tokenPath?: string;
  token?: string;
  nativeCurrencyAddress?: string | string[];
  threshold?: string | number;
  message?: string;
  chainIdPath?: string;
  chainId?: number;
  encoding?: "timestamp" | "blockheight";
  base?: string;
  decimals?: number;
  prefix?: boolean;
  $ref?: string;
  collectionPath?: string;
  collection?: string;
  calleePath?: string;
  callee?: string;
  selectorPath?: string;
  selector?: string;
  amountPath?: string;
  amount?: string;
  spenderPath?: string;
  spender?: string;
  types?: DescriptorAddressType[];
  sources?: DescriptorAddressSource[];
  senderAddress?: string | string[];
}

export interface DescriptorFieldFormat {
  $id?: string;
  path?: string;
  value?: unknown;
  label?: string;
  format?: DescriptorFieldFormatType;
  params?: DescriptorFieldFormatParams;
  visible?: "never" | "always" | "optional" | Record<string, unknown>;
  separator?: string;
  encryption?: DescriptorFieldEncryption;
  $ref?: string;
}

export interface DescriptorFieldGroup {
  path?: string;
  label?: string;
  fields?: Array<DescriptorFieldFormat | DescriptorFieldGroup>;
  iteration?: "sequential" | "bundled";
}

export interface DescriptorFormatSpec {
  $id?: string;
  intent?: string | Record<string, string>;
  interpolatedIntent?: string;
  fields?: Array<DescriptorFieldFormat | DescriptorFieldGroup>;
}

export interface DescriptorDisplay {
  definitions?: Record<string, DescriptorFieldFormat>;
  formats?: Record<string, DescriptorFormatSpec>;
}

export interface DescriptorDeployment {
  chainId?: number;
  address?: string;
}

export interface DescriptorContractFactory {
  deployEvent?: string;
  deployments?: DescriptorDeployment[];
}

export interface DescriptorContractContext {
  deployments?: DescriptorDeployment[];
  factory?: DescriptorContractFactory;
}

export interface DescriptorEip712Context {
  $id?: string;
  domain?: Record<string, unknown>;
  deployments?: DescriptorDeployment[];
  domainSeparator?: string;
}

export interface DescriptorContext {
  $id?: string;
  contract?: DescriptorContractContext;
  eip712?: DescriptorEip712Context;
}

export interface DescriptorMetadataInfo {
  deploymentDate?: string;
  url?: string;
}

export interface DescriptorMetadataToken {
  name?: string;
  ticker?: string;
  decimals?: number;
}

export interface DescriptorMetadata {
  owner?: string;
  contractName?: string;
  info?: DescriptorMetadataInfo;
  token?: DescriptorMetadataToken;
  constants?: Record<string, string | number | boolean>;
  maps?: Record<string, unknown>;
  enums?: Record<string, Record<string, string>>;
}

export interface Descriptor {
  $schema?: string;
  includes?: string;
  context?: DescriptorContext;
  metadata?: DescriptorMetadata;
  display?: DescriptorDisplay;
  // Required for the merge algorithm in resolver.ts to iterate over arbitrary keys.
  [key: string]: unknown;
}
