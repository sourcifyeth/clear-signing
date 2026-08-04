import fs from "fs";
import path from "path";

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walk(fullPath));
    } else if (fullPath.endsWith(".spec.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = walk("test");
for (const file of files) {
  let content = fs.readFileSync(file, "utf8");
  content = content.replace(
    /expect\((\w+)\.value\)/g,
    "expect(($1 as DisplayField).value)",
  );
  content = content.replace(
    /expect\((\w+)\.fieldType\)/g,
    "expect(($1 as DisplayField).fieldType)",
  );
  content = content.replace(
    /expect\((\w+)\.format\)/g,
    "expect(($1 as DisplayField).format)",
  );
  content = content.replace(
    /expect\((\w+)\.rawAddress\)/g,
    "expect(($1 as DisplayField).rawAddress)",
  );
  content = content.replace(
    /expect\((\w+)\.tokenAddress\)/g,
    "expect(($1 as DisplayField).tokenAddress)",
  );
  content = content.replace(
    /expect\((\w+)\.embeddedCalldata\)/g,
    "expect(($1 as DisplayField).embeddedCalldata)",
  );

  // also add import { DisplayField } if not present
  if (
    !content.includes("DisplayField") &&
    content.includes("as DisplayField")
  ) {
    content = content.replace(
      /import \{.*?\} from ["']\.\.\/\.\.\/src.*?["'];/,
      '$&\nimport { DisplayField } from "../../src/types.js";',
    );
  }

  fs.writeFileSync(file, content);
}
