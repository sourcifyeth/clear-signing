/**
 * Core type definitions for the clear signing library.
 */

/** Minimal display item for the clear signing preview. */
export interface DisplayItem {
  label: string;
  value: string;
}

/** Raw fallback preview details when no descriptor matches. */
export interface RawPreview {
  selector: string;
  args: string[];
}

/** Display model produced by the clear signing engine. */
export interface DisplayModel {
  intent: string;
  interpolatedIntent?: string;
  items: DisplayItem[];
  warnings: string[];
  raw?: RawPreview;
}

/** Token metadata from the registry. */
export interface TokenMeta {
  symbol: string;
  decimals: number;
  name: string;
}

/** EIP-712 typed data structure. */
export interface TypedData {
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

/** Display field definition from descriptor. */
export interface DisplayField {
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
  fields: DisplayField[];
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
  definitions?: Record<string, DisplayField>;
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

export interface FormatOptions {
  /**
   * Wallets should provide an object with async methods to resolve
   * external data like ENS names, token metadata, and NFT collection
   * names. The provided functions may use RPC calls or fetch data
   * from internal sources. This allows the library to remain
   * agnostic about how this data is fetched. If absent, the library
   * will fall back to raw formats for the corresponding fields.
   */
  externalDataProvider?: unknown;

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
