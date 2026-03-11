/**
 * Core type definitions for the clear signing library.
 */

/** Minimal display item for the clear signing preview. */
export interface DisplayItem {
  label: string;
  value: string;
}

/** Raw fallback preview details when no descriptor matches. */
export interface LegacyRawPreview {
  selector: string;
  args: string[];
}

export interface LegacyDisplayModel {
  intent: string;
  interpolatedIntent?: string;
  items: DisplayItem[];
  warnings: string[];
  raw?: LegacyRawPreview;
}

/** Token metadata from the registry. */
export interface TokenMeta {
  symbol: string;
  decimals: number;
  name: string;
}

/** @deprecated Use TypedData from the new design section instead. */
export interface LegacyTypedData {
  types: Record<string, TypeMember[]>;
  primaryType: string;
  domain: Record<string, unknown>;
  message: Record<string, unknown>;
}

/** EIP-712 type member definition. */
export interface TypeMember {
  name: string;
  type: string;
}

/** Descriptor context structure. */
export interface DescriptorContext {
  $id?: string;
  contract: DescriptorContract;
}

/** Contract definition within a descriptor. */
export interface DescriptorContract {
  deployments: ContractDeployment[];
  abi?: AbiFunction[] | string;
}

/** Contract deployment info. */
export interface ContractDeployment {
  chainId: number;
  address: string;
}

/** ABI function definition. */
export interface AbiFunction {
  name: string;
  type: string;
  inputs: FunctionInput[];
}

/** ABI function input parameter. */
export interface FunctionInput {
  name: string;
  type: string;
  internalType?: string;
  components?: FunctionInput[];
}

export interface LegacyDisplayField {
  path?: string;
  label?: string;
  format?: string;
  params?: Record<string, unknown>;
  $ref?: string;
}

/** Display format definition from descriptor. */
export interface DisplayFormat {
  intent: string;
  interpolatedIntent?: string;
  fields: LegacyDisplayField[];
  required: string[];
}

/** Resolved effective field after applying references. */
export interface EffectiveField {
  path: string;
  label: string;
  format?: string;
  params: Record<string, unknown>;
}

/** Function descriptor with computed selector. */
export interface FunctionDescriptor {
  inputs: FunctionInput[];
  typedSignature: string;
  selector: Uint8Array;
}

/** Decoded argument value. */
export interface DecodedArgument {
  index: number;
  name?: string;
  value: ArgumentValue;
  word: Uint8Array;
}

/** Argument value union type. */
export type ArgumentValue =
  | { type: "address"; bytes: Uint8Array }
  | { type: "uint"; value: bigint }
  | { type: "raw"; bytes: Uint8Array };

/** Full descriptor structure. */
export interface DescriptorObj {
  context: DescriptorContext;
  metadata: Record<string, unknown>;
  display: DescriptorDisplay;
}

/** Descriptor display section. */
export interface DescriptorDisplay {
  definitions?: Record<string, LegacyDisplayField>;
  formats?: Record<string, DisplayFormat>;
}

/** Resolved descriptor bundle. */
export interface ResolvedDescriptor {
  descriptorJson: string;
  abiJson?: string;
  includes: string[];
}

/** Resolved call bundle with token metadata. */
export interface ResolvedCall {
  descriptor: ResolvedDescriptor;
  tokenMetadata: Map<string, TokenMeta>;
  addressBook: Map<string, string>;
}

/** Resolved EIP-712 descriptor bundle. */
export interface ResolvedTypedDescriptor {
  descriptorJson: string;
  includes: string[];
}

/** GitHub registry source for fetching descriptors from the Ledger registry. */
export interface GitHubRegistrySource {
  type: "github";
  /** GitHub repo in "owner/repo" format. Defaults to "LedgerHQ/clear-signing-erc7730-registry". */
  repo?: string;
  /** Git ref (branch, tag, commit). Defaults to "master". */
  ref?: string;
}

/**
 * Inline source: a single user-provided descriptor object with optional pre-resolved includes.
 *
 * The ERC-7730 standard only allows a single file to be merged via the `includes` field.
 * Since inline descriptors have no base URL to resolve relative paths against, the `includes`
 * map requires the caller to supply the path string (matching the value of `descriptor.includes`)
 * alongside the already-fetched include object.
 */
export interface InlineDescriptorSource {
  type: "inline";
  /** The raw descriptor JSON object. Must have a valid ERC-7730 context. */
  descriptor: Record<string, unknown>;
  /**
   * Pre-resolved include files, keyed by the path string that appears in `descriptor.includes`.
   * Required because inline descriptors have no base URL for relative path resolution.
   */
  includes?: { [path: string]: Record<string, unknown> };
}

/** Descriptor source configuration. */
export type DescriptorSource = GitHubRegistrySource | InlineDescriptorSource;

/////////////////////////////
// NEW TYPES FOR NEW DESIGN
/////////////////////////////

/** Ethereum transaction to be formatted. */
export interface Transaction {
  chainId: number;
  to: string;
  /** calldata hex string */
  data: string;
  value?: bigint;
  from?: string;
}

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

export interface RawPreview {
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
  fieldType: string;
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
   * Raw fallback data when no descriptor matched,
   * or the descriptor was faulty.
   */
  raw?: LegacyRawPreview;

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

export type Descriptor = Record<string, unknown>;
