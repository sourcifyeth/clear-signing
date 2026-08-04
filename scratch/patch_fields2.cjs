const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  '    } else if (fieldSpec.path?.includes(".[]")) {',
  '    } else if (fieldSpec.path?.includes("[]")) {'
);

fieldsCode = fieldsCode.replace(
  '    if (!isFieldGroup(child) && child.path?.includes(".[]")) return true;',
  '    if (!isFieldGroup(child) && child.path?.includes("[]")) return true;'
);

fieldsCode = fieldsCode.replace(
  '    if (isFieldGroup(child) || !child.path?.includes(".[]")) continue;',
  '    if (isFieldGroup(child) || !child.path?.includes("[]")) continue;'
);

fieldsCode = fieldsCode.replace(
  /function parseGroupBasePath\(path: string \| undefined\): string \{\n  if \(!path\) return "";\n  const idx = path.indexOf\("\.\[\]"\);\n  if \(idx === -1\) return path;\n  return path.slice\(0, idx\);\n\}/,
  `function parseGroupBasePath(path: string | undefined): string {
  if (!path) return "";
  let idx = path.indexOf(".[]");
  if (idx !== -1) return path.slice(0, idx);
  idx = path.indexOf("[]");
  if (idx !== -1) return path.slice(0, idx);
  return path;
}`
);

fs.writeFileSync('src/fields.ts', fieldsCode);
