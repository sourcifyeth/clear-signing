const fs = require('fs');
let str = fs.readFileSync('src/fields.ts', 'utf8');
str = str.replace(
  'console.log("LAYOUT:", JSON.stringify(merged.layout, null, 2));\n      console.log("KEYS:", Array.from(ctx.layoutResolvedValues.keys()));\n      const extracted = extractLayoutFields(merged.layout, defPath, ctx.layoutResolvedValues);\n      console.log("EXTRACTED LENGTH:", extracted.length);',
  'require("fs").appendFileSync("debug_out.txt", "KEYS: " + Array.from(ctx.layoutResolvedValues.keys()).join(",") + "\\nEXTRACTED LENGTH: " + extractLayoutFields(merged.layout, defPath, ctx.layoutResolvedValues).length + "\\n");\n      const extracted = extractLayoutFields(merged.layout, defPath, ctx.layoutResolvedValues);'
);
fs.writeFileSync('src/fields.ts', str);
