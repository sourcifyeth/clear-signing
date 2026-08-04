const fs = require('fs');

let intCode = fs.readFileSync('src/interaction.ts', 'utf8');
intCode = intCode.replace(
  'import type { ArgumentValue } from "./descriptor.js";',
  'import type { ArgumentValue, ResolvePath } from "./descriptor.js";'
);
fs.writeFileSync('src/interaction.ts', intCode);

let switchCode = fs.readFileSync('src/switch.ts', 'utf8');
switchCode = switchCode.replace(
  '    let argVal = val;\n    if (val.type === "bytes-slice") argVal = { type: "bytes", bytes: val.bytes };\n    return argVal as ArgumentValue;',
  '    let argVal = val;\n    if (val.type === "bytes-slice") argVal = { type: "bytes", bytes: val.bytes };\n    return argVal as ArgumentValue;'
);

// Wait, the error is `src/switch.ts(33,7)` which is returning `val`. Let me check line 33 of `src/switch.ts`.
