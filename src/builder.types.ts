/**
 * Types of the `builder` entry point
 * (`@ethereum-sourcify/clear-signing/builder`).
 */

import type {
  ChainClient,
  DescriptorFieldFormatParams,
  DescriptorFieldFormatType,
  DisplayModel,
  FormatOptions,
  Warning,
} from "./types.js";

/**
 * Options of `getCalldataInputModels`. The
 * builder only resolves descriptors, so it takes the descriptor source of
 * {@link FormatOptions} and no external data provider.
 */
export interface BuilderOptions {
  /** Descriptor source. Same as {@link FormatOptions.descriptorResolverOptions}. */
  descriptorResolverOptions?: FormatOptions["descriptorResolverOptions"];

  /**
   * Read-only RPC access for the attestation revocation read. Required when
   * `descriptorResolverOptions.attestations` is set.
   */
  chainClient?: ChainClient;
}

/**
 * One input of an {@link InputModel}, from the `builder` entry point
 * (`@ethereum-sourcify/clear-signing/builder`). It mirrors a descriptor field,
 * or an ABI input that no descriptor field covers.
 */
export interface InputField {
  /**
   * Descriptor label. For a field without a label (an appended input, or a
   * descriptor field that declares none), the ABI parameter name.
   */
  label: string;

  /**
   * Where the value goes in the `values` object of the build functions.
   * Absolute, with the `#.` prefix stripped and the group prefix applied, e.g.
   * `to`, `order.fee` or `orders.[].amount` (`.[]` stands for each array
   * element). `@.value` names the transaction value, which is not part of
   * `values`. Absent for constant fields.
   */
  path?: string;

  /**
   * Solidity type of the value. Set on every field with a `path`, e.g.
   * `uint256`, `address[]`, or `(address token,uint256 amount)` for a tuple.
   */
  type?: string;

  /** Descriptor display format, a hint for the input control. */
  format?: DescriptorFieldFormatType;

  /**
   * Descriptor format params, after the `$ref` merge. Path params (keys that
   * end in `Path`, and the `keyPath` of a map reference) are absolute like
   * `path`: `#.` stripped, group prefix applied. `@.` and `$.` paths are
   * unchanged. `metadata.maps` references are not resolved.
   */
  params?: DescriptorFieldFormatParams;

  /**
   * Value of a constant field (descriptor `value`, or a `$.metadata` path),
   * resolved against the descriptor metadata. A constant field is shown
   * read-only and takes no input.
   */
  constant?: string | number | boolean;

  /**
   * True for a descriptor field with `visible: "never"`. The value is still
   * needed to build the call.
   */
  hidden?: boolean;
}

/** A descriptor field group in an {@link InputModel}. */
export interface InputFieldGroup {
  label?: string;
  /** Group path, with the `#.` prefix stripped. */
  path?: string;
  fields: InputField[];
}

/**
 * The inputs of one function, in descriptor display order. Pass it with the
 * user input to `buildCalldata`.
 */
export interface InputModel {
  /** The `display.formats` key: the function signature. */
  signature: string;
  /** 4-byte function selector as hex. */
  selector: string;
  metadata?: DisplayModel["metadata"];
  intent?: string | Record<string, string>;
  /**
   * Descriptor fields in display order, then the inputs that no field
   * covers.
   */
  fields: (InputField | InputFieldGroup)[];
}

/** Result of `getCalldataInputModels`. */
export interface InputModels {
  models?: InputModel[];
  warnings?: Warning[];
}

/** Machine-readable code of a {@link BuildInputError}. */
export type BuildInputErrorCode =
  | "MISSING_VALUE" // no value for an argument
  | "INVALID_TYPE" // wrong JS shape, bad hex, not an integer, not a boolean
  | "OUT_OF_RANGE" // integer does not fit uintN / intN
  | "INVALID_LENGTH" // address / bytesN byte length, fixed array length
  | "UNKNOWN_FIELD" // values has a key the function does not declare
  | "INVALID_SIGNATURE"; // model.signature cannot be parsed

/**
 * A validation error of the build functions. It is not a {@link Warning}: it
 * describes bad user input, and a UI shows it at the input that `path` names.
 */
export interface BuildInputError {
  /**
   * Concrete path of the bad value, in {@link InputField.path} syntax with
   * the array index in place of `[]`, e.g. `orders.[1].amount`.
   */
  path: string;
  code: BuildInputErrorCode;
  /** Short message for the user, e.g. "Value does not fit uint8". */
  message: string;
}
