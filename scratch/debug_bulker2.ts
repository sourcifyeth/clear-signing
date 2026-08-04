import { decodeArguments, parseFunctionSignatureKey } from "../src/calldata.js";
import { hexToBytes } from "../src/utils.js";
import corpus from "../test/fixtures/bulker-corpus.json";

const sig = parseFunctionSignatureKey("invoke(bytes32[] actions,bytes[] data)");
const data = hexToBytes(corpus[0].input);
const decoded = decodeArguments(sig.inputs, data);
console.log(Array.from(decoded.values.keys()));
