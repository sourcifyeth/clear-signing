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
  if (!content.includes('import { DisplayField }') && !content.includes('import { DisplayField,') && !content.includes(', DisplayField }') && content.includes('as DisplayField')) {
    // Find where types.js is imported from
    if (content.includes('from "../src/types.js"')) {
      content = content.replace(/import \{(.*?)\} from "\.\.\/src\/types\.js";/, 'import { $1, DisplayField } from "../src/types.js";');
    } else if (content.includes('from "../../src/types.js"')) {
      content = content.replace(/import \{(.*?)\} from "\.\.\/\.\.\/src\/types\.js";/, 'import { $1, DisplayField } from "../../src/types.js";');
    } else if (content.includes('from "../../../src/types.js"')) {
      content = content.replace(/import \{(.*?)\} from "\.\.\/\.\.\/\.\.\/src\/types\.js";/, 'import { $1, DisplayField } from "../../../src/types.js";');
    } else {
      content = 'import { DisplayField } from "../../src/types.js";\n' + content;
    }
    fs.writeFileSync(file, content);
  }
}
