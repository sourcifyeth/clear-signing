const fs = require('fs');
let code = fs.readFileSync('src/calldata.ts', 'utf8');

code = code.replace(
  'export async function formatCalldata(\n  tx: Transaction,\n  descriptor: Descriptor,\n  externalDataProvider?: ExternalDataProvider,\n  formatEmbeddedCalldata?: FormatCalldata,\n): Promise<DisplayModel> {',
  'export async function formatCalldata(\n  tx: Transaction,\n  descriptor: Descriptor,\n  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: Descriptor; warning?: Warning }>,\n  externalDataProvider?: ExternalDataProvider,\n  formatEmbeddedCalldata?: FormatCalldata,\n): Promise<DisplayModel> {'
);

fs.writeFileSync('src/calldata.ts', code);
