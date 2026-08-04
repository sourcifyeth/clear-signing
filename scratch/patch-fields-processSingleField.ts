import {
  DescriptorFieldFormat,
  DisplayField,
  DisplayFieldGroup,
  DescriptorFormatSpec,
} from "./types.js";
import { resolveSwitchCase, parseSwitchCase } from "./switch.js";
import {
  parseParamList,
  decodeArguments,
  DecodedArguments,
} from "./calldata.js";

// Let's sketch it
