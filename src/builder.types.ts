/**
 * Types of the `builder` entry point
 * (`@ethereum-sourcify/clear-signing/builder`).
 */

import type {
  ChainClient,
  DescriptorFieldFormatParams,
  DescriptorFieldFormatType,
  DescriptorMapReference,
  DisplayModel,
  FormatOptions,
  Warning,
} from "./types.js";

/**
 * Options of `getCalldataInputModels`. The builder only resolves descriptors,
 * so it takes the descriptor source of {@link FormatOptions} and no external
 * data provider.
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
 * A `metadata.maps` lookup that depends on a value the builder does not know:
 * another input, or `@.from` / `@.value`. The param value is
 * `values[<value at keyPath>]`. Compare keys case-insensitively: address keys
 * can be checksummed.
 */
export interface InputMapReference {
  /** Path of the key value. Absolute like {@link InputField.path}. */
  keyPath: string;
  /** The entries of the map. */
  values: Record<string, string | number | boolean>;
}

/**
 * The format params of an {@link InputField}: the descriptor params with every
 * `$.metadata` value resolved. It has no `$ref`; the entries of an enum are in
 * {@link InputField.options}. A map reference is the constant it selects, or
 * an {@link InputMapReference} when its key is not known yet.
 */
export type InputFieldParams = {
  [K in Exclude<keyof DescriptorFieldFormatParams, "$ref">]?:
    | Exclude<DescriptorFieldFormatParams[K], DescriptorMapReference>
    | (DescriptorMapReference extends DescriptorFieldFormatParams[K]
        ? InputMapReference
        : never);
};

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
   * Where the value goes in the `values` object of `buildCalldata`.
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
   * Descriptor format params, with all descriptor references resolved: no
   * value starts with `$.`. Path params (keys that end in `Path`, and the
   * `keyPath` of an {@link InputMapReference}) are absolute like `path`: `#.`
   * stripped, group prefix applied. `@.` paths are unchanged.
   */
  params?: InputFieldParams;

  /**
   * The entries of an `enum` format, from the descriptor metadata: raw value
   * to label. Use them as the options of the input.
   */
  options?: Record<string, string>;

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
 * A validation error of `buildCalldata`. It is not a {@link Warning}: it
 * describes bad user input, and a UI shows it at the input that `path` names.
 */
export interface BuildInputError {
  /**
   * Concrete path of the bad value, in {@link InputField.path} syntax with
   * the array index in place of `[]`, e.g. `orders.[1].amount`.
   */
  path: string;
  /**
   * The {@link InputField.path} of the model field that takes the bad value,
   * e.g. `orders.[].amount`. Use it to show the error at that input. It is
   * the field at `path`, else the field that contains it, else the first
   * field inside it. Absent when no field of the model matches (an unknown
   * key in `values`, or an error on the whole `values` object).
   */
  fieldPath?: string;
  code: BuildInputErrorCode;
  /** Short message for the user, e.g. "Value does not fit uint8". */
  message: string;
}
