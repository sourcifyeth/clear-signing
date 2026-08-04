import { parseFunctionSignatureKey } from "../src/calldata.js";
console.log(
  parseFunctionSignatureKey("invoke(bytes32[] actions,bytes[] data)"),
);
