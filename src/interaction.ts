import type {
  Descriptor,
  DescriptorInteraction,
  DescriptorTopLevelSwitch,
  DisplayModel,
  ExternalDataProvider,
  FormatCalldata,
  Transaction,
  Warning,
  DescriptorFormatSpec,
  DescriptorDisplay,
} from "./types.js";
import {
  resolveTransactionPath,
  resolveMetadataValue,
  toArgumentValue,
} from "./descriptor.js";
import { renderFormat, parseFunctionSignatureKey } from "./calldata.js";
import type { DecodedArguments, FunctionInput } from "./calldata.js";
import type { ArgumentValue, ResolvePath } from "./descriptor.js";
import { warn, bytesToHex, selectorForSignature } from "./utils.js";
import { evaluateSwitchExpression, matchSwitchCase } from "./switch.js";

/**
 * Resolves a top-level switch, recursively evaluating nested switches until
 * it hits a 'reject' or an 'interaction'.
 */
export async function resolveTopLevelSwitch(
  tx: Transaction,
  descriptor: Descriptor,
  switchDef: DescriptorTopLevelSwitch,
  decoded: DecodedArguments,
  resolveCalldataDescriptor: (
    chainId: number,
    to: string,
  ) => Promise<{ descriptor?: Descriptor; warning?: Warning }>,
  externalDataProvider?: ExternalDataProvider,
  formatEmbeddedCalldata?: FormatCalldata,
): Promise<DisplayModel> {
  const resolvePath = (path: string) => {
    if (path.startsWith("@.")) return resolveTransactionPath(path, tx);
    if (path.startsWith("$."))
      return toArgumentValue(resolveMetadataValue(descriptor.metadata, path));
    const val = decoded.values.get(path);
    if (val) return val;
    return undefined;
  };

  const exprValue = evaluateSwitchExpression(switchDef.expression, {
    resolvePath,
  });
  if (!exprValue) {
    return {
      warnings: [
        warn(
          "INVALID_DESCRIPTOR",
          "Top-level switch expression could not be resolved",
        ),
      ],
    };
  }

  let caseMatch: (typeof switchDef.cases)[string] | undefined = undefined;
  for (const [caseKey, caseValue] of Object.entries(switchDef.cases)) {
    if (caseKey === "$default") continue;
    if (matchSwitchCase(exprValue, caseKey)) {
      caseMatch = caseValue;
      break;
    }
  }
  if (caseMatch === undefined && "$default" in switchDef.cases) {
    caseMatch = switchDef.cases["$default"];
  }

  if (caseMatch === undefined) {
    return {
      warnings: [
        warn("INVALID_DESCRIPTOR", "Top-level switch failed to match any case"),
      ],
    };
  }

  if (caseMatch === "reject") {
    return {
      warnings: [warn("REJECTED", "Transaction rejected by top-level switch")],
    };
  }

  if (typeof caseMatch === "object" && caseMatch !== null) {
    if ("switch" in caseMatch) {
      return resolveTopLevelSwitch(
        tx,
        descriptor,
        caseMatch.switch,
        decoded,
        resolveCalldataDescriptor,
        externalDataProvider,
        formatEmbeddedCalldata,
      );
    }
    if ("interaction" in caseMatch) {
      return resolveInteraction(
        tx,
        caseMatch.interaction,
        resolvePath,
        resolveCalldataDescriptor,
        externalDataProvider,
        formatEmbeddedCalldata,
      );
    }
  }

  return {
    warnings: [
      warn("INVALID_DESCRIPTOR", "Invalid top-level switch case result"),
    ],
  };
}

export function findFormatBySignature(
  display: DescriptorDisplay | undefined,
  signature: string,
): { inputs: FunctionInput[]; spec: DescriptorFormatSpec } | undefined {
  if (!display || !display.formats) return undefined;
  const targetSelector = bytesToHex(selectorForSignature(signature));
  for (const [key, spec] of Object.entries(display.formats)) {
    const parsed = parseFunctionSignatureKey(key);
    if (parsed && bytesToHex(parsed.selector) === targetSelector) {
      return { inputs: parsed.inputs, spec };
    }
  }
  return undefined;
}

export async function resolveInteraction(
  tx: Transaction,
  interaction: DescriptorInteraction,
  resolvePath: ResolvePath,
  resolveCalldataDescriptor: (
    chainId: number,
    to: string,
  ) => Promise<{ descriptor?: Descriptor; warning?: Warning }>,
  externalDataProvider?: ExternalDataProvider,
  formatEmbeddedCalldata?: FormatCalldata,
): Promise<DisplayModel> {
  const toArg = resolvePath(interaction.to);
  let toAddress = tx.to;
  if (toArg && toArg.type === "address") {
    toAddress = bytesToHex(toArg.bytes);
  } else if (toArg && toArg.type === "string") {
    toAddress = toArg.value;
  }

  const { descriptor: targetDescriptor, warning } =
    await resolveCalldataDescriptor(tx.chainId, toAddress);
  if (warning) {
    return { warnings: [warning] };
  }
  if (!targetDescriptor) {
    return {
      warnings: [
        warn(
          "NO_DESCRIPTOR",
          `No descriptor found for interaction target ${toAddress}`,
        ),
      ],
    };
  }

  const match = findFormatBySignature(
    targetDescriptor.display,
    interaction.signature,
  );
  if (!match) {
    return {
      warnings: [
        warn(
          "NO_FORMAT_MATCH",
          `No format match for signature ${interaction.signature}`,
        ),
      ],
    };
  }

  const { inputs, spec } = match;

  const syntheticValues = new Map<string, ArgumentValue>();
  const syntheticArrayLengths = new Map<string, number>();

  for (let i = 0; i < interaction.args.length; i++) {
    const argDef = interaction.args[i];
    const inputName = inputs[i]?.name;
    if (!inputName) continue;

    if ("path" in argDef) {
      const val = resolvePath(argDef.path);
      if (val) {
        syntheticValues.set(
          inputName,
          val.type === "bytes-slice"
            ? { type: "bytes", bytes: val.bytes }
            : val,
        );
      }
    } else if ("value" in argDef) {
      // Handle literal values (basic scalar coercion)
      const val = argDef.value;
      if (typeof val === "string") {
        syntheticValues.set(inputName, { type: "string", value: val });
      } else if (typeof val === "number" || typeof val === "bigint") {
        syntheticValues.set(inputName, { type: "uint", value: BigInt(val) });
      } else if (typeof val === "boolean") {
        syntheticValues.set(inputName, { type: "bool", value: val });
      }
    }
  }

  const decoded = {
    values: syntheticValues,
    arrayLengths: syntheticArrayLengths,
  };

  return renderFormat(
    spec,
    decoded,
    tx,
    targetDescriptor,
    externalDataProvider,
    formatEmbeddedCalldata,
  );
}
