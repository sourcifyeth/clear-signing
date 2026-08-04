const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');

testCode = testCode.replace('import { hexToBytes } from "../../src/utils.js";\n', '');
testCode = testCode.replace(
  '    const dataOffset =\n      "0000000000000000000000000000000000000000000000000000000000000040";',
  '    // const dataOffset =\n    //   "0000000000000000000000000000000000000000000000000000000000000040";'
);
testCode = testCode.replace(
  '    const dataLen =\n      "0000000000000000000000000000000000000000000000000000000000000040";',
  '    // const dataLen =\n    //   "0000000000000000000000000000000000000000000000000000000000000040";'
);

testCode = testCode.replace(
  'expect((result.fields?.[0] as any)?.value).toBe(',
  'expect((result.fields?.[0] as any)?.value).toBe('
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
