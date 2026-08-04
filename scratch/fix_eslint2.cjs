const fs = require('fs');

// fields.ts
let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  '    descriptor?: import("./types.js").Descriptor;\n    warning?: import("./types.js").Warning;\n  }>,',
  '    descriptor?: Descriptor;\n    warning?: Warning;\n  }>,'
);
fieldsCode = fieldsCode.replace(
  '    descriptor?: import("./types.js").Descriptor;\n    warning?: import("./types.js").Warning;\n  }>;',
  '    descriptor?: Descriptor;\n    warning?: Warning;\n  }>;'
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
  'import { hexToBytes } from "viem";',
  ''
);
testCode = testCode.replace(
  'const dataOffset = Number(',
  '// const dataOffset = Number('
);
testCode = testCode.replace(
  'const dataLen = Number(',
  '// const dataLen = Number('
);
testCode = testCode.replace(
  'expect((result.fields?.[0] as any)?.label).toBe("Account");',
  'expect(result.fields?.[0] && "label" in result.fields[0] ? result.fields[0].label : undefined).toBe("Account");'
);
testCode = testCode.replace(
  'expect((result.fields?.[0] as any)?.value).toBe("0x0000000000000000000000000000000000000000");',
  'expect(result.fields?.[0] && "value" in result.fields[0] ? result.fields[0].value : undefined).toBe("0x0000000000000000000000000000000000000000");'
);
testCode = testCode.replace(
  'expect((result.fields![0] as any).value).toBe("0x0000000000000000000000000000000000000000");',
  'expect(result.fields?.[0] && "value" in result.fields[0] ? result.fields[0].value : undefined).toBe("0x0000000000000000000000000000000000000000");'
);

fs.writeFileSync('test/erc7730-test-cases/example-tiered-executor.spec.ts', testCode);

