const fs = require('fs');
let str = fs.readFileSync('src/index.ts', 'utf8');

str = str.replace(
  '    return formatCalldata(\n      tx,\n      descriptor,\n      opts?.externalDataProvider,\n      formatEmbeddedCalldata,\n    );',
  '    return formatCalldata(\n      tx,\n      descriptor,\n      (chainId, to) => resolveCalldataDescriptor(chainId, to, opts?.descriptorResolverOptions),\n      opts?.externalDataProvider,\n      formatEmbeddedCalldata,\n    );'
);

fs.writeFileSync('src/index.ts', str);
