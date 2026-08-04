const fs = require('fs');
let content = fs.readFileSync('src/fields.ts', 'utf8');
content = content.replace(
  'const extracted = extractLayoutFields(merged.layout, defPath, ctx.layoutResolvedValues);',
  'console.log("defPath:", defPath, "keys:", Array.from(ctx.layoutResolvedValues.keys()));\n      const extracted = extractLayoutFields(merged.layout, defPath, ctx.layoutResolvedValues);'
);
fs.writeFileSync('src/fields.ts', content);
