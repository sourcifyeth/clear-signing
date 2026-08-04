const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (fullPath.endsWith('.spec.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk('test');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('DisplayField') && !content.includes('DisplayFieldGroup')) continue;
  
  if (!content.includes('import { DisplayField }') && !content.includes('import { DisplayField,') && !content.includes(', DisplayField }') && !content.includes('import { type DisplayField }')) {
    
    // figure out depth
    const depth = file.split('/').length - 1; // test/a.spec.ts -> 1, test/a/b.spec.ts -> 2
    let prefix = '../';
    for (let i = 1; i < depth; i++) prefix += '../';
    
    if (content.match(/import \{(.*?)\} from ["']\.\.\/.*?src\/types\.js["'];/)) {
      content = content.replace(/import \{(.*?)\} from ["'](\.\.\/.*?src\/types\.js)["'];/, 'import { $1, DisplayField } from "$2";');
    } else {
      content = `import { DisplayField } from "${prefix}src/types.js";\n` + content;
    }
    fs.writeFileSync(file, content);
  }
}
