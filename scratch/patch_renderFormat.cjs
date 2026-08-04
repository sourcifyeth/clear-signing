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

fs.writeFileSync('src/calldata.ts', calldataCode);
