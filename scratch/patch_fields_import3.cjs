const fs = require('fs');
let code = fs.readFileSync('src/fields.ts', 'utf8');
code = code.replace(
  'import { parseParamList, decodeArguments } from "./calldata.js";',
  'import { parseParamList, decodeArguments } from "./calldata.js";\nimport { resolveInteraction } from "./interaction.js";'
);
fs.writeFileSync('src/fields.ts', code);
