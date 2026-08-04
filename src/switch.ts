import type { ArgumentValue, ResolvePath } from "./descriptor.js";
import type {
  DescriptorFieldSwitch,
  SwitchCaseValue,
  LayoutNode,
  DescriptorFieldFormat,
  DescriptorFieldGroup,
  DescriptorFieldFormatParams,
} from "./types.js";
import { parseBigInt, hexToBytes, bytesEqual } from "./utils.js";

export interface SwitchContext {
  resolvePath: ResolvePath;
  payloadBuffer?: Uint8Array;
}

/**
 * Evaluates a switch expression string (path or layout slice) to an ArgumentValue.
 */
export function evaluateSwitchExpression(
  expr: DescriptorFieldSwitch["expression"],
  context: SwitchContext,
): ArgumentValue | undefined {
  if (typeof expr !== "string") {
    if ("path" in expr && typeof expr.path === "string") {
      const val = context.resolvePath(expr.path);
      if (!val) return undefined;
      let argVal = val;
      if (val.type === "bytes-slice")
        argVal = { type: "bytes", bytes: val.bytes };
      if (expr.mask && argVal.type === "uint") {
        return { type: "uint", value: argVal.value & BigInt(expr.mask) };
      }
      return argVal as ArgumentValue;
    }
    return undefined;
  }

  if (expr.startsWith("@.") || expr.startsWith("$.") || expr.startsWith("#.")) {
    const val = context.resolvePath(expr);
    if (!val) return undefined;
    if (val.type === "bytes-slice") {
      return { type: "bytes", bytes: val.bytes };
    }
    return val;
  }

  if (expr.startsWith(".[")) {
    if (!context.payloadBuffer) return undefined;
    const match = expr.match(/^\.\[(\d+)(?::(\d+))?\]$/);
    if (!match) return undefined;

    const start = parseInt(match[1], 10);
    const endStr = match[2];

    if (endStr !== undefined) {
      const end = parseInt(endStr, 10);
      if (start >= end) return { type: "bytes", bytes: new Uint8Array(0) };
      return { type: "bytes", bytes: context.payloadBuffer.slice(start, end) };
    } else {
      return {
        type: "bytes",
        bytes: context.payloadBuffer.slice(start, start + 1),
      };
    }
  }

  return undefined;
}

/**
 * Matches an evaluated switch expression value against a single case value.
 */
export function matchSwitchCase(
  exprValue: ArgumentValue,
  caseValue: string,
): boolean {
  const caseStr = caseValue;

  if (exprValue.type === "uint" || exprValue.type === "int") {
    const val = parseBigInt(caseStr);
    return val !== undefined && val === exprValue.value;
  } else if (exprValue.type === "bool") {
    const lower = caseStr.toLowerCase();
    const isTrue = lower === "true" || lower === "1";
    const isFalse = lower === "false" || lower === "0";
    if (isTrue) return exprValue.value === true;
    if (isFalse) return exprValue.value === false;
    return false;
  } else if (exprValue.type === "address") {
    try {
      const caseBytes = hexToBytes(
        caseStr.startsWith("0x") ? caseStr : "0x" + caseStr,
      );
      return bytesEqual(caseBytes, exprValue.bytes);
    } catch {
      return false;
    }
  } else if (exprValue.type === "bytes") {
    try {
      const caseBytes = hexToBytes(
        caseStr.startsWith("0x") ? caseStr : "0x" + caseStr,
      );
      return bytesEqual(caseBytes, exprValue.bytes);
    } catch {
      return false;
    }
  } else if (exprValue.type === "string") {
    return exprValue.value === caseStr;
  }

  return false;
}

/**
 * Evaluates a switch definition and returns the matching SwitchCaseValue.
 */
export function resolveSwitchCase(
  switchDef: DescriptorFieldSwitch,
  context: SwitchContext,
): SwitchCaseValue | undefined {
  const exprValue = evaluateSwitchExpression(switchDef.expression, context);
  if (!exprValue) return undefined;

  for (const [caseKey, caseValue] of Object.entries(switchDef.cases)) {
    if (caseKey === "$default") continue;
    if (matchSwitchCase(exprValue, caseKey)) {
      return caseValue;
    }
  }

  if ("$default" in switchDef.cases) {
    return switchDef.cases["$default"];
  }

  return undefined;
}

export type ParsedSwitchCase =
  | { type: "reject" }
  | { type: "layout"; layout: LayoutNode }
  | { type: "switch"; switchDef: DescriptorFieldSwitch }
  | { type: "format"; format: string; params?: DescriptorFieldFormatParams }
  | { type: "terminal"; label: string; intent?: "info" | "warning" }
  | {
      type: "tuple";
      tupleSig: string;
      fields: Array<DescriptorFieldFormat | DescriptorFieldGroup>;
      intent?: "info" | "warning";
    };

export function parseSwitchCase(
  caseVal: SwitchCaseValue,
): ParsedSwitchCase | undefined {
  if (caseVal === "reject") return { type: "reject" };
  if (typeof caseVal === "object" && caseVal !== null) {
    if ("layout" in caseVal)
      return {
        type: "layout",
        layout: (caseVal as { layout: LayoutNode }).layout,
      };
    if ("switch" in caseVal)
      return {
        type: "switch",
        switchDef: (caseVal as { switch: DescriptorFieldSwitch }).switch,
      };
    if ("format" in caseVal)
      return {
        type: "format",
        format: (caseVal as { format: string }).format,
        params: (caseVal as { params: DescriptorFieldFormatParams }).params,
      };
    if ("label" in caseVal)
      return {
        type: "terminal",
        label: (caseVal as { label: string }).label,
        intent: (caseVal as { intent: "info" | "warning" }).intent,
      };

    const keys = Object.keys(caseVal);
    if (keys.length === 1 && keys[0].startsWith("(")) {
      const val = (
        caseVal as Record<
          string,
          | {
              fields?: Array<DescriptorFieldFormat | DescriptorFieldGroup>;
              intent?: "info" | "warning";
            }
          | undefined
        >
      )[keys[0]];
      return {
        type: "tuple",
        tupleSig: keys[0],
        fields: val?.fields ?? [],
        intent: val?.intent,
      };
    }
  }
  return undefined;
}
