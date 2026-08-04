import {
  ArgumentValue,
  DescriptorFieldSwitch,
  SwitchCaseValue,
  SwitchContext,
  LayoutNode,
  DescriptorFieldFormat,
  DescriptorFieldGroup,
  DescriptorFieldFormatParams,
} from "./types.js";
import { evaluateSwitchExpression } from "./switch.js";
import { parseBigInt, bytesEqual, hexToBytes } from "./utils.js";

// I'll construct a script to patch src/switch.ts
