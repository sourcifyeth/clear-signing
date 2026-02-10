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
  | { type: 'address'; bytes: Uint8Array }
  | { type: 'uint'; value: bigint }
  | { type: 'raw'; bytes: Uint8Array };

/** Full descriptor structure. */
export interface Descriptor {
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
  addressBook: Map<string, string>;
}

/** Index entry for descriptor lookup. */
export interface IndexEntry {
  descriptor: string;
  abi?: string;
}
