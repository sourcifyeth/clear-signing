import { selectorForSignature, bytesToHex } from "../src/utils.js";
console.log(bytesToHex(selectorForSignature("invoke(bytes32[],bytes[])")));
