const fs = require('fs');

let testCode = fs.readFileSync('test/erc7730-test-cases/example-compound-bulker.spec.ts', 'utf8');
testCode = testCode.replace(
  '"eip155:1:0xa397a8C2086C554B531c02E29f3291c9704B00c7": "bulker.json"',
  '"eip155:1:0xa397a8C2086C554B531c02E29f3291c9704B00c7": "bulker.json",\n        "eip155:1:0xa397a8c2086c554b531c02e29f3291c9704b00c7": "bulker.json"'
);
fs.writeFileSync('test/erc7730-test-cases/example-compound-bulker.spec.ts', testCode);
