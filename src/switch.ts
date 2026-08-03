import type { ArgumentValue, ResolvePath } from "./descriptor.js";
import { parseBigInt, hexToBytes, bytesEqual } from "./utils.js";

export interface SwitchContext {
  resolvePath: ResolvePath;
  payloadBuffer?: Uint8Array;
}

/**
 * Evaluates a switch expression string (path or layout slice) to an ArgumentValue.
 */
export function evaluateSwitchExpression(
  expr: string,
  context: SwitchContext,
): ArgumentValue | undefined {
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
