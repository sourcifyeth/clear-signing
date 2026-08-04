const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');
testCode = testCode.replace(
  'const target = "0000000000000000000000000000000000000000000000000000000000000000";',
  'const target = "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045";'
);
testCode = testCode.replace(
  'calldataIndex: { "eip155:1:0xexecutor": "tiered-executor.json" }',
  'calldataIndex: { "eip155:1:0xexecutor": "tiered-executor.json", "eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045": "tiered-executor.json" }'
);
fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
