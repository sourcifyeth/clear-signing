const fs = require('fs');
let str = fs.readFileSync('src/fields.ts', 'utf8');
str = str.replace(
  'formatEmbeddedCalldata?: FormatCalldata;',
  'formatEmbeddedCalldata?: FormatCalldata;\n  layoutResolvedValues?: Map<string, ArgumentValue | BytesSliceValue>;'
);
fs.writeFileSync('src/fields.ts', str);
