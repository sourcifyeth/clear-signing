const fs = require('fs');
let str = fs.readFileSync('src/fields.ts', 'utf8');
str = str.replace(
  'return [\n          {\n            ...(merged.label && { label: merged.label }),\n            fields: processedExtracted,\n          }\n        ];',
  'return { field: {\n            ...(merged.label && { label: merged.label }),\n            fields: "fields" in processedExtracted ? processedExtracted.fields : [],\n          } };'
);
fs.writeFileSync('src/fields.ts', str);
