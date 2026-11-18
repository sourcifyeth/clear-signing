# Builder Guide

The `builder` entry point works in the opposite direction of `format()`. A
builder UI (for example a block explorer) has a chain ID and a contract
address and lets the user call the contract. The builder:

1. resolves the ERC-7730 descriptor of the contract and returns an **input
   model** for each function (or EIP-712 message type): the inputs to render,
   with the clear signing labels and format hints of the descriptor;
2. **builds** the calldata (or the EIP-712 typed data) from the user input,
   and returns errors that the UI can show next to each bad input.

No formatting runs, and no `ExternalDataProvider` resolver is called.

```typescript
import {
  getCalldataInputModels,
  buildCalldata,
  getTypedDataInputModels,
  buildTypedData,
} from "@ethereum-sourcify/clear-signing/builder";
```

The builder is a separate entry point. Integrators that only format carry
none of its code.

## Walkthrough: build a contract call

The example is a vault with this descriptor format:

```json
"deposit(uint256 assets,address receiver)": {
  "intent": "Deposit",
  "fields": [
    {
      "path": "assets",
      "label": "Amount",
      "format": "tokenAmount",
      "params": { "token": "0xA0b86991c6218b36c1d19D4a2E9Eb0cE3606eB48" }
    },
    { "path": "receiver", "label": "Receiver", "format": "addressName" }
  ]
}
```

### Step 1: Get the input models and list the functions

```typescript
const { models, warnings } = await getCalldataInputModels(
  chainId,
  vaultAddress,
  opts, // optional, the same FormatOptions as for format()
);

if (!models) {
  // No usable descriptor: warnings says why (e.g. NO_DESCRIPTOR).
  showFallbackAbiForm();
  return;
}

for (const model of models) {
  // model.intent: "Deposit"; model.signature: the function signature.
  addFunctionTab(model.intent ?? model.signature, model);
}
```

`opts` resolves the descriptor exactly as in `format()`: use the same
registry index, `trustedTokens` and attestation policy. Of the
`externalDataProvider`, only `chainClient` is used, for the attestation
revocation read. A function whose format is broken (e.g. a bad `$ref`) gets
no model and adds a warning; the other functions still get their models.

### Step 2: Render the input fields

`model.fields` lists the descriptor fields in display order, then the
function inputs that no descriptor field covers. For the example:

```typescript
[
  {
    label: "Amount",
    path: "assets",
    type: "uint256",
    format: "tokenAmount",
    params: { token: "0xA0b8...eB48" },
  },
  {
    label: "Receiver",
    path: "receiver",
    type: "address",
    format: "addressName",
  },
];
```

Render one input per field:

```typescript
import type { InputField } from "@ethereum-sourcify/clear-signing/builder";

for (const item of model.fields) {
  if ("fields" in item) {
    // An InputFieldGroup.
    renderSection(item.label, item.fields.map(renderInput));
  } else {
    renderInput(item);
  }
}

function renderInput(field: InputField) {
  if (field.constant !== undefined)
    return renderReadOnly(field.label, field.constant);
  if (field.path === "@.value") return renderNativeAmount(field.label);
  // Use type, format and params to pick the control, e.g. a token amount
  // input with decimals for "tokenAmount", an address book for "addressName".
  return renderControl(field.label, field.type, field.format, field.params, {
    advanced: field.hidden, // visible: "never": still needed, show collapsed
  });
}
```

- `label` is the descriptor label. A field without one uses the ABI
  parameter name.
- `type` is the Solidity type of the input. A tuple is spelled out with its
  component names, e.g. `(address token,uint256 amount)[]`.
- `format` and `params` are the descriptor values. They are hints for a
  better input control. Path params (e.g. `tokenPath`) are absolute like
  `path`, so they name another input of the same `values` object.
  `metadata.maps` references in `params` are not resolved.
- A **constant** field (`constant` set, no `path`) shows a fixed value from the
  descriptor. It takes no input. A constant without a label and without a
  `$.metadata` path has the label `""`.
- `@.value` is the native value of the transaction, not a function argument.
- `hidden: true` marks a field the descriptor hides in the wallet
  (`visible: "never"`). The function still needs the value.

### Step 3: Collect the user input into `values`

`values` mirrors the function arguments. Each field's `path` says where its
value goes:

| `path`             | goes to                    |
| ------------------ | -------------------------- |
| `receiver`         | `values.receiver`          |
| `order.fee`        | `values.order.fee`         |
| `orders.[].amount` | `values.orders[i].amount`  |
| `recipients.[]`    | `values.recipients[i]`     |
| `@.value`          | the transaction, see below |

The values are **raw**. The UI converts display input itself, for example a
decimal token amount with the token decimals:

```typescript
const values = {
  assets: parseUnits(amountInput, 6), // your helper: 1.5 USDC → 1500000n
  receiver: receiverInput, // "0x..."
};
```

### Step 4: Build the calldata

```typescript
const result = buildCalldata(model, values);
```

`buildCalldata` is synchronous and never throws. It validates every value and
returns either `{ data }` or `{ errors }`.

### Step 5: Show the errors, or send the transaction

```typescript
if ("errors" in result) {
  for (const error of result.errors) {
    // error.path is the concrete path, e.g. "orders.[1].amount".
    markInput(error.path, error.message);
  }
  return;
}

await wallet.sendTransaction({
  to: vaultAddress,
  data: result.data,
  value: nativeAmount, // the @.value input, if the model has one
});
```

All errors are returned at once, so the form can mark every bad input. The
wallet can then clear sign the transaction with `format()` as usual.

## Walkthrough: build an EIP-712 message

The steps are the same. The schema of the message comes from the descriptor:
each `display.formats` key is the full EIP-712 `encodeType` string.

```typescript
const { models, warnings } = await getTypedDataInputModels(
  chainId,
  verifyingContract,
  opts,
);

// Render model.fields and collect values as above. values is the message.
const result = buildTypedData(model, account, values, {
  // Only needed when the descriptor does not declare them:
  name: "MyProtocol",
  version: "1",
});

if ("errors" in result) {
  // Show the errors as above. "@.from" names a bad account.
} else {
  await wallet.signTypedData(result.typedData);
}
```

- All descriptors indexed for the address are resolved, so the models can
  come from several descriptors. Each model has its own `metadata`.
- Each descriptor is resolved on its own. When one descriptor fails (e.g. its
  fetch throws), the models of the other descriptors are still returned. The
  warning of a failed descriptor names its path, e.g.
  `Descriptor 'eip712-mail.json': ...`.
- `model.domain` holds `chainId` and `verifyingContract`, plus `name`,
  `version` and `salt` when the descriptor's `context.eip712.domain` declares
  them. The `domain` argument of `buildTypedData` is merged over it.
- The result has `account`, `primaryType`, `types` (with an `EIP712Domain`
  entry for the domain fields that are set), `domain` and `message`.
  `message` is `values`, unchanged.
- A struct member has the EIP-712 type as `type`, e.g. `Part[]`. Look up its
  members in the `encodeType` string of `model.signature` if you need them.

## Reference

### Functions

```typescript
getCalldataInputModels(chainId: number, to: string, opts?: FormatOptions): Promise<InputModels>
buildCalldata(model: InputModel, values: Record<string, unknown>): { data: string } | { errors: BuildInputError[] }

getTypedDataInputModels(chainId: number, verifyingContract: string, opts?: FormatOptions): Promise<InputModels>
buildTypedData(model: InputModel, account: string, values: Record<string, unknown>, domain?: TypedDataDomain): { typedData: TypedData } | { errors: BuildInputError[] }
```

The `get*InputModels` functions never throw. The build functions are
synchronous, need no descriptor and never throw.

### Types

```typescript
interface InputModels {
  models?: InputModel[];
  warnings?: Warning[];
}

interface InputModel {
  signature: string; // display.formats key: function signature or encodeType
  selector?: string; // calldata only
  domain?: TypedDataDomain; // EIP-712 only
  metadata?: {
    owner?: string;
    contractName?: string;
    info?: { deploymentDate?: string; url?: string };
  };
  intent?: string | Record<string, string>;
  fields: (InputField | InputFieldGroup)[];
}

interface InputField {
  label: string;
  path?: string; // absent for constants
  type?: string; // set on every field with a path
  format?: DescriptorFieldFormatType;
  params?: DescriptorFieldFormatParams;
  constant?: string | number | boolean;
  hidden?: boolean;
}

interface InputFieldGroup {
  label?: string;
  path?: string;
  fields: InputField[];
}

interface BuildInputError {
  path: string;
  code: BuildInputErrorCode;
  message: string;
}
```

### How fields are treated

| Descriptor field                                                     | Input model                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `path` names an argument / member (`#.` prefix optional)             | input field with `path` and `type`                                          |
| `value` set, or `path` starts with `$.`                              | constant field, `constant` resolved from the descriptor metadata, no `path` |
| `path: "@.value"`                                                    | input field with `path: "@.value"` and `type: "uint256"`                    |
| other `@.` paths (`@.from`, `@.to`, `@.chainId`)                     | left out: the container sets them                                           |
| `path` with a byte slice (`data.[:4]`) or a fixed index (`list.[0]`) | left out: it names no whole input. The input is appended as uncovered       |
| `path` that names no argument / member (e.g. a typo)                 | left out. The inputs are appended as uncovered                              |
| path params (`tokenPath`, map `keyPath`, ...)                        | absolute like `path`: `#.` stripped, group prefix applied                   |
| `visible: "never"`                                                   | input field with `hidden: true`                                             |
| no `label`                                                           | the ABI parameter / member name (the last name in `path`) is the label      |
| `$ref`                                                               | merged with its definition first                                            |
| field group                                                          | `InputFieldGroup`; child paths get the group prefix, as in `format()`       |
| nested field group                                                   | the function gets no model: `UNSUPPORTED_NESTED_FIELD_GROUP` warning        |

After the descriptor fields, every input that no field covers is appended,
with its name as label. An input with no covered path at, above or under it is
appended whole. Of a partly covered tuple or tuple array, only the uncovered
components are appended, e.g. `order.fee` or `orders.[].fee`. An unnamed
argument uses the name `param<i>` (also its key in `values`).

### The `values` shape and raw value types

- Keys are argument names. A tuple / struct is an object keyed by component
  name. An array is a JS array.
- Integers (`uintN`, `intN`): `bigint`, a safe-integer number, or a decimal or
  `0x` hex string.
- `address`, `bytes`, `bytesN`: `0x` hex string.
- `bool`: boolean. `string`: string.
- Constants and `@.value` are not part of `values`.

### `BuildInputError` codes

| Code                | Meaning                                                                |
| ------------------- | ---------------------------------------------------------------------- |
| `MISSING_VALUE`     | No value for an argument, member or array element                      |
| `INVALID_TYPE`      | Wrong JS shape, bad hex, not an integer, not a boolean                 |
| `OUT_OF_RANGE`      | The integer does not fit `uintN` / `intN`                              |
| `INVALID_LENGTH`    | Wrong byte length of an `address` / `bytesN`, wrong fixed array length |
| `UNKNOWN_FIELD`     | `values` has a key that the function or type does not declare          |
| `INVALID_SIGNATURE` | `model.signature` cannot be parsed, or it uses an unsupported type     |

`path` is in the `InputField.path` syntax with the concrete array index in
place of `[]`, e.g. `orders.[1].amount`. The root object is `""`, and
`buildTypedData` reports a bad `account` at `@.from`. `message` is short and
can be shown to the user.

These errors describe bad user input. They are not `Warning`s, which describe
the descriptor or the formatting.

### Warnings

`InputModels.warnings` uses the `WarningCode`s of `format()`:

| Code                                      | When                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `NO_DESCRIPTOR`                           | Nothing is indexed for the address (and no trusted token matches)                                       |
| `NO_TRUSTED_ATTESTATION`                  | The attestation policy rejects the descriptor                                                           |
| `ATTESTATION_OPTIONS_INCOMPLETE`          | A policy is set without `chainClient` or `fetchAttestation`                                             |
| `CYCLIC_INCLUDES`                         | The `includes` chain of the descriptor is cyclic                                                        |
| `DESCRIPTOR_FETCH_ERROR`                  | Fetching the descriptor (or the revocation read) failed. EIP-712: per descriptor; the other models stay |
| `DEPLOYMENT_MISMATCH` / `DOMAIN_MISMATCH` | The descriptor is not bound to the chain and address                                                    |
| `UNSUPPORTED_DOMAIN`                      | EIP-712: no valid chain ID or verifying contract                                                        |
| `NO_FORMAT_MATCH`                         | EIP-712: a legacy format key that is only a primary type name                                           |
| `DEFINITIONS_RESOLUTION_ERROR`            | A `$ref` cannot be resolved; that function gets no model                                                |
| `UNSUPPORTED_NESTED_FIELD_GROUP`          | A nested field group; that function gets no model                                                       |
| `UNEXPECTED_LIB_ERROR`                    | A bug in the library                                                                                    |
