const { decodeArguments, parseFunctionSignatureKey } = require('../dist/calldata.js');
const { hexToBytes, bytesToHex } = require('../dist/utils.js');
const corpus = require('../test/fixtures/bulker-corpus.json');

const sig = parseFunctionSignatureKey("invoke(bytes32[] actions,bytes[] data)");
const data = hexToBytes(corpus[0].input);
const decoded = decodeArguments(sig.inputs, data, true);

console.log("ACTIONS length:", decoded.arrayLengths.get("actions"));
for (let i = 0; i < decoded.arrayLengths.get("actions"); i++) {
  console.log(`actions[${i}]:`, Buffer.from(decoded.values.get(`actions[${i}]`).bytes).toString('utf8').replace(/\0/g, ''));
}
