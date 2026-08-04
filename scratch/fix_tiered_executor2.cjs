const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');

testCode = testCode.replace(
  '    fetchDescriptor: async () => descriptorJson',
  '    fetchDescriptor: async () => ({ ...descriptorJson, context: { ...descriptorJson.context, contract: { ...descriptorJson.context?.contract, deployments: [{ chainId: 1, address: "0xexecutor" }] } } } as Descriptor)'
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
