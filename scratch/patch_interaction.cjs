const fs = require('fs');
let code = fs.readFileSync('src/interaction.ts', 'utf8');
code = code.replace(
  'import { Descriptor, DescriptorInteraction, DisplayField, Transaction, Warning, ArgumentValue, DisplayModel, FormatCalldata } from "./types.js";',
  'import { Descriptor, DescriptorInteraction, DisplayField, Transaction, Warning, ArgumentValue, DisplayModel, FormatCalldata } from "./types.js";\nimport { ResolvePath } from "./descriptor.js";'
);
code = code.replace(
  '  resolvePath: (path: string) => ArgumentValue | undefined,',
  '  resolvePath: ResolvePath,'
);
fs.writeFileSync('src/interaction.ts', code);
