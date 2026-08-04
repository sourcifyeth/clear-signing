const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');
testCode = testCode.replace(
  'const actionHex = "0000000000000000000000000000000000000000000000000000000000000000";',
  'const actionHex = "0000000000000000000000000000000000000000000000000000000000000001";'
);
fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);

let dbgCode = fs.readFileSync('scratch/debug_tiered.ts', 'utf8');
dbgCode = dbgCode.replace(
  'const actionHex = "0000000000000000000000000000000000000000000000000000000000000000";',
  'const actionHex = "0000000000000000000000000000000000000000000000000000000000000001";'
);
fs.writeFileSync('scratch/debug_tiered.ts', dbgCode);
