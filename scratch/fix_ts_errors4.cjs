const fs = require('fs');

let switchCode = fs.readFileSync('src/switch.ts', 'utf8');
switchCode = switchCode.replace(
  '      if (expr.mask && argVal.type === "uint") {\n        return { type: "uint", value: argVal.value & BigInt(expr.mask) };\n      }\n      return argVal;\n    }',
  '      if (expr.mask && argVal.type === "uint") {\n        return { type: "uint", value: argVal.value & BigInt(expr.mask) };\n      }\n      return argVal as ArgumentValue;\n    }'
);
fs.writeFileSync('src/switch.ts', switchCode);
