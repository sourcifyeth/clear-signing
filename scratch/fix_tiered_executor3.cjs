const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');

testCode = testCode.replace(
  'const calldata = "0xb61d27f6" + actionHex + dataOffset + dataLen + addr + amt;',
  'const target = "0000000000000000000000000000000000000000000000000000000000000000";\n    const calldata = "0x512ccc67" + target + actionHex + addr + amt;' // target + op + account + amount
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
