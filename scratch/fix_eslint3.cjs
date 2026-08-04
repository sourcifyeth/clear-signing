const fs = require('fs');
let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  'import type {',
  'import type {\n  Descriptor,\n  Warning,'
);
fs.writeFileSync('src/fields.ts', fieldsCode);

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');
testCode = testCode.replace(
  'import { hexToBytes } from "viem";',
  ''
);
testCode = testCode.replace(
  '      const dataOffset = Number(\n        bytesToUnsignedBigInt(tx.data.slice(72, 104)),\n      );',
  '      // const dataOffset = Number(bytesToUnsignedBigInt(tx.data.slice(72, 104)));'
);
testCode = testCode.replace(
  '      const dataLen = Number(\n        bytesToUnsignedBigInt(tx.data.slice(104, 136)),\n      );',
  '      // const dataLen = Number(bytesToUnsignedBigInt(tx.data.slice(104, 136)));'
);
fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
