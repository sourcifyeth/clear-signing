const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  'import { decodeArguments, parseParamList } from "./calldata.js";',
  'import { decodeArguments, parseParamList } from "./calldata.js";\nimport { resolveInteraction } from "./interaction.js";'
);

fieldsCode = fieldsCode.replace(
  '  formatEmbeddedCalldata?: FormatCalldata,\n): Promise<',
  '  formatEmbeddedCalldata?: FormatCalldata,\n  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<any>,\n): Promise<'
);
fieldsCode = fieldsCode.replace(
  '  formatEmbeddedCalldata?: FormatCalldata;',
  '  formatEmbeddedCalldata?: FormatCalldata;\n  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<any>;'
);
fieldsCode = fieldsCode.replace(
  '    formatEmbeddedCalldata,\n    layoutResolvedValues,\n  };',
  '    formatEmbeddedCalldata,\n    resolveCalldataDescriptor,\n    layoutResolvedValues,\n  };'
);

fieldsCode = fieldsCode.replace(
  '          ctx.externalDataProvider,\n          ctx.formatEmbeddedCalldata,\n        );',
  '          ctx.externalDataProvider,\n          ctx.formatEmbeddedCalldata,\n          ctx.resolveCalldataDescriptor\n        );'
);

fieldsCode = fieldsCode.replace(
  '    if (ctx.formatEmbeddedCalldata) {',
  '    if (ctx.formatEmbeddedCalldata && ctx.resolveCalldataDescriptor) {'
);

fieldsCode = fieldsCode.replace(
  'null as any, // Not used inside if formatEmbeddedCalldata is provided and resolveCalldataDescriptor isn\\'t needed? wait!',
  'ctx.resolveCalldataDescriptor as any'
);

fieldsCode = fieldsCode.replace(
  'const decoded = decodeArguments(inputs, calldataBytes);',
  'const decoded = decodeArguments(inputs, calldataBytes, false);'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
