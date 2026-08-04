const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', 'utf8');

testCode = testCode.replace(
  'const descriptorJson = JSON.parse(readFileSync(resolve(__dirname, "example-tiered-executor.json"), "utf8")) as Descriptor;',
  'const descriptorJson = JSON.parse(readFileSync(resolve(__dirname, "example-tiered-executor.json"), "utf8")) as Descriptor;\nconst targetDescriptorJson = JSON.parse(readFileSync(resolve(__dirname, "example-target-descriptor.json"), "utf8")) as Descriptor;'
);

testCode = testCode.replace(
  '    fetchDescriptor: async () => ({ ...descriptorJson, context: { ...descriptorJson.context, contract: { ...descriptorJson.context?.contract, deployments: [{ chainId: 1, address: "0xexecutor" }] } } } as Descriptor)',
  '    fetchDescriptor: async (path) => path === "target-descriptor.json" ? targetDescriptorJson : ({ ...descriptorJson, context: { ...descriptorJson.context, contract: { ...descriptorJson.context?.contract, deployments: [{ chainId: 1, address: "0xexecutor" }] } } } as Descriptor)'
);

testCode = testCode.replace(
  'calldataIndex: { "eip155:1:0xexecutor": "tiered-executor.json", "eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045": "tiered-executor.json" }',
  'calldataIndex: { "eip155:1:0xexecutor": "tiered-executor.json", "eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045": "target-descriptor.json" }'
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);
