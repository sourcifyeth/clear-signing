const fs = require('fs');
let testCode = fs.readFileSync('test/layout.spec.ts', 'utf8');
testCode = testCode.replace(/type: "INVALID_DESCRIPTOR"/g, 'code: "INVALID_DESCRIPTOR"');
fs.writeFileSync('test/layout.spec.ts', testCode);
