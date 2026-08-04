const fs = require('fs');
let str = fs.readFileSync('src/fields.ts', 'utf8');
str = str.replace(
  'layoutResolvedValues?: Map<string, ArgumentValue | BytesSliceValue>;',
  'layoutResolvedValues?: Map<string, ArgumentValue>;'
);
fs.writeFileSync('src/fields.ts', str);
