import { selectorForSignature, bytesToHex } from "../src/utils.js";
console.log(
  bytesToHex(
    selectorForSignature("executeOperation(address,uint8,address,uint256)"),
  ),
);
