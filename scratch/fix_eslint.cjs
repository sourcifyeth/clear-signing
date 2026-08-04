const fs = require('fs');

// fields.ts
let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  'resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<any>,',
  'resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: import("./types.js").Descriptor; warning?: import("./types.js").Warning }>,'
);
fieldsCode = fieldsCode.replace(
  '  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<any>;',
  '  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: import("./types.js").Descriptor; warning?: import("./types.js").Warning }>;'
);
fs.writeFileSync('src/fields.ts', fieldsCode);

// interaction.ts
let intCode = fs.readFileSync('src/interaction.ts', 'utf8');
intCode = intCode.replace(
  'import { parseParamList, renderFormat, parseFunctionSignatureKey } from "./calldata.js";',
  'import { renderFormat, parseFunctionSignatureKey } from "./calldata.js";'
);
fs.writeFileSync('src/interaction.ts', intCode);

// example-tiered-executor.spec.ts
let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');
testCode = testCode.replace(
  'import { selectorForSignature, bytesToHex } from "../../src/utils.js";',
  ''
);
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
testCode = testCode.replace(
  'expect(result.fields![0].label).toBe("Account");',
  'expect((result.fields?.[0] as any)?.label).toBe("Account");'
);
testCode = testCode.replace(
  'expect((result.fields![0] as any).value).toBe("0x0000000000000000000000000000000000000000");',
  'expect((result.fields?.[0] as any)?.value).toBe("0x0000000000000000000000000000000000000000");'
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);

