const fs = require('fs');

let code = fs.readFileSync('src/calldata.ts', 'utf8');

const targetStr = `
  const result = await applyFieldFormats(
    format,
    definitions,
    resolvePath,
    getArrayLength,
    tx.chainId,
    descriptor.metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
  );`;

const replaceStr = `
  const result = await applyFieldFormats(
    format,
    definitions,
    resolvePath,
    getArrayLength,
    tx.chainId,
    descriptor.metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
    resolveCalldataDescriptor
  );`;

code = code.replace(targetStr.trim(), replaceStr.trim());
fs.writeFileSync('src/calldata.ts', code);
