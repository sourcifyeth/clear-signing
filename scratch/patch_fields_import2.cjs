const fs = require('fs');
let code = fs.readFileSync('src/fields.ts', 'utf8');
code = code.replace(
  'import { decodeArguments, parseParamList } from "./calldata.js";',
  'import { decodeArguments, parseParamList } from "./calldata.js";\nimport { resolveInteraction } from "./interaction.js";'
);
fs.writeFileSync('src/fields.ts', code);
