const fs = require('fs');

let calldataCode = fs.readFileSync('src/calldata.ts', 'utf8');

calldataCode = calldataCode.replace(
  '  formatEmbeddedCalldata?: FormatCalldata,\n): Promise<DisplayModel> {',
  '  formatEmbeddedCalldata?: FormatCalldata,\n  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: Descriptor; warning?: Warning }>,\n): Promise<DisplayModel> {'
);

calldataCode = calldataCode.replace(
  '          ctx.formatEmbeddedCalldata,',
  '          ctx.formatEmbeddedCalldata,\n          ctx.resolveCalldataDescriptor,'
);

calldataCode = calldataCode.replace(
  '    externalDataProvider,\n    formatEmbeddedCalldata,\n  );',
  '    externalDataProvider,\n    formatEmbeddedCalldata,\n    resolveCalldataDescriptor\n  );'
);
// Also update the call to applyFieldFormats in renderFormat
calldataCode = calldataCode.replace(
  '    externalDataProvider,\n    formatEmbeddedCalldata,\n  );\n\n  if',
  '    externalDataProvider,\n    formatEmbeddedCalldata,\n    resolveCalldataDescriptor\n  );\n\n  if'
);

fs.writeFileSync('src/calldata.ts', calldataCode);

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
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
  'null as any, // Not used inside if formatEmbeddedCalldata is provided and resolveCalldataDescriptor isn\'t needed? wait!',
  'ctx.resolveCalldataDescriptor as any'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
