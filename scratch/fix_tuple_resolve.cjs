const fs = require('fs');
let content = fs.readFileSync('src/fields.ts', 'utf8');

// 1. Add baseResolvePath to FieldContext
content = content.replace(/resolvePath: ResolvePath;/, 'resolvePath: ResolvePath;\n  baseResolvePath: BaseResolvePath;');

// 2. Add it to the ctx object created in applyFieldFormats
content = content.replace(/resolvePath: sliceResolvePath,/, 'resolvePath: sliceResolvePath,\n    baseResolvePath: baseLayoutResolvePath,');

// 3. Update tupleResolvePath in processSingleField to use ctx.baseResolvePath
content = content.replace(/return ctx\.resolvePath\(path\);/g, 'return ctx.baseResolvePath(path);');

fs.writeFileSync('src/fields.ts', content);
