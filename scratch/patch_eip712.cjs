const fs = require('fs');

let eip712Code = fs.readFileSync('src/eip712.ts', 'utf8');

eip712Code = eip712Code.replace(
  '    externalDataProvider,\n    formatEmbeddedCalldata,\n  );',
  '    externalDataProvider,\n    formatEmbeddedCalldata,\n    undefined\n  );'
);

fs.writeFileSync('src/eip712.ts', eip712Code);
