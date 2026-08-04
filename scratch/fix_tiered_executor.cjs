const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');

testCode = testCode.replace(
  '  resolver: {\n    resolveCalldataDescriptor: async () => ({ descriptor: descriptorJson })\n  }',
  '  resolver: {\n    index: { calldataIndex: { "eip155:1:0xexecutor": "tiered-executor.json" }, typedDataIndex: {} },\n    fetchDescriptor: async () => descriptorJson\n  }'
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
