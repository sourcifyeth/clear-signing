/**
 * Types of the `builder` entry point
 * (`@ethereum-sourcify/clear-signing/builder`).
 */

import type {
  DescriptorFieldFormatParams,
  DescriptorFieldFormatType,
  DisplayModel,
  TypedDataDomain,
  Warning,
} from "./types.js";

/**
 * One input of an {@link InputModel}, from the `builder` entry point
 * (`@ethereum-sourcify/clear-signing/builder`). It mirrors a descriptor field,
 * or an ABI input / EIP-712 member that no descriptor field covers.
 */
export interface InputField {
  /**
   * Descriptor label. For a field without a label (an appended input, or a
   * descriptor field that declares none), the ABI parameter or EIP-712 member
   * name.
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
   * Solidity type (calldata) or EIP-712 type of the value. Set on every field
   * with a `path`, e.g. `uint256`, `address[]`, `(address token,uint256 amount)`
   * for a calldata tuple, or `Part[]` for an EIP-712 struct array.
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
 * The inputs of one function (calldata) or one primary type (EIP-712), in
 * descriptor display order. Pass it with the user input to `buildCalldata`
 * or `buildTypedData` from the `builder` entry point.
 */
export interface InputModel {
  /**
   * The `display.formats` key: the function signature (calldata) or the
   * EIP-712 `encodeType` string.
   */
  signature: string;
  /** 4-byte function selector as hex. Calldata only. */
  selector?: string;
  /**
   * EIP-712 only: `chainId` and `verifyingContract` of the request, plus
   * `name`, `version` and `salt` when the descriptor declares them.
   */
  domain?: TypedDataDomain;
  metadata?: DisplayModel["metadata"];
  intent?: string | Record<string, string>;
  /**
   * Descriptor fields in display order, then the inputs that no field
   * covers.
   */
  fields: (InputField | InputFieldGroup)[];
}

/** Result of `getCalldataInputModels` / `getTypedDataInputModels`. */
export interface InputModels {
  models?: InputModel[];
  warnings?: Warning[];
}

/** Machine-readable code of a {@link BuildInputError}. */
export type BuildInputErrorCode =
  | "MISSING_VALUE" // no value for an argument / member
  | "INVALID_TYPE" // wrong JS shape, bad hex, not an integer, not a boolean
  | "OUT_OF_RANGE" // integer does not fit uintN / intN
  | "INVALID_LENGTH" // address / bytesN byte length, fixed array length
  | "UNKNOWN_FIELD" // values has a key the function / type does not declare
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
