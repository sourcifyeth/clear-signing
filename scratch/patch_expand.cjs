const fs = require('fs');
let code = fs.readFileSync('src/fields.ts', 'utf8');

code = code.replace(
  'path: field.path?.replace(".[]", `.[${index}]`),',
  'path: field.path?.replace(/\\.?\\[\\]/, (m) => m === ".[]" ? `.[${index}]` : `[${index}]`),'
);

code = code.replace(
  '  if (params.types) {',
  `  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") {
      (params as any)[key] = value.replace(/\\.?\\[\\]/, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`);
    }
  }
  if (params.types) {`
);

fs.writeFileSync('src/fields.ts', code);
