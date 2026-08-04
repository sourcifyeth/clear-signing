const fs = require('fs');

let content = fs.readFileSync('test/layout.spec.ts', 'utf8');
content = content.replace(/\{ uint: \{ bytes: (\d+) \} \}/g, '{ type: "uint", bytes: $1 }');
content = content.replace(/\{ uint: \{ bytes: (\d+), endian: "(.*?)" \} \}/g, '{ type: "uint", bytes: $1, endian: "$2" }');
content = content.replace(/\{ uint: \{ bytes: (\d+), mask: "(.*?)" \} \}/g, '{ type: "uint", bytes: $1, mask: "$2" }');
content = content.replace(/\{ sequence: \{ element: /g, '{ type: "sequence", element: ');
content = content.replace(/, count: (\d+) \} \}/g, ', count: $1 }');
content = content.replace(/, countFrom: "(.*?)" \} \}/g, ', countFrom: "$2" }');
content = content.replace(/\}; \} \}/g, '} }'); // match sequence closing? Actually let's just regex replace the key object and sequence manually.

// Since object is complex, let's just do simple replacements.
content = content.replace(/\{ object: \{ fields: /g, '{ type: "object", fields: ');
content = content.replace(/\} \}\]; \} \}/g, '} }]; }');
// sequence without count
content = content.replace(/\{ sequence: \{ element: (.*?)\} \}/g, '{ type: "sequence", element: $1 }');

fs.writeFileSync('test/layout.spec.ts', content);
