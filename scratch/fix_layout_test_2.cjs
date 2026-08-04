const fs = require('fs');

let content = fs.readFileSync('test/layout.spec.ts', 'utf8');

// Replace { object: { fields: ... } } with { type: "object", fields: ... }
content = content.replace(/\{ object: \{ fields:/g, '{ type: "object", fields:');
content = content.replace(/\{ address: \{\} \}\)/g, '{ type: "address" })');

// Replace { sequence: { element: ... } } with { type: "sequence", element: ... }
// We have to match the closing brace carefully, but since the keys are unique we can just replace the start
content = content.replace(/\{ sequence: \{ element:/g, '{ type: "sequence", element:');

// Replace the closing braces for object and sequence
// Actually it's easier to just regex the exact lines from the error messages:

// test/layout.spec.ts(106,7)
// test/layout.spec.ts(127,7)
// test/layout.spec.ts(151,7)
// test/layout.spec.ts(175,7)
// test/layout.spec.ts(209,13)

// Let's just do it manually with file replace since there are only 5 errors left.
content = content.replace(/\{ object: \{\n\s*fields/g, '{ type: "object",\n      fields');
content = content.replace(/\{ sequence: \{\n\s*element/g, '{ type: "sequence",\n      element');

// Remove extra closing brace for those nodes.
// Or we can just use a proper JS parser, but this is a test file, so I'll just write a quick script.
