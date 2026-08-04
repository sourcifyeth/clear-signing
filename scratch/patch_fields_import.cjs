const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  'import { evaluateSwitchExpression, matchSwitchCase } from "./switch.js";',
  'import { evaluateSwitchExpression, matchSwitchCase } from "./switch.js";\nimport { resolveInteraction } from "./interaction.js";'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
