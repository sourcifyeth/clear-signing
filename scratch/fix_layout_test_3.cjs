const fs = require('fs');

let content = fs.readFileSync('test/layout.spec.ts', 'utf8');

content = content.replace(/object: \{/g, 'type: "object",');
content = content.replace(/\{ address: \{\} \}/g, '{ type: "address" }');
content = content.replace(/sequence: \{ element:/g, 'type: "sequence", element:');

// Now we need to remove the trailing } for object and sequence, because they are no longer nested.
// E.g.
// const node: LayoutNode = {
//   type: "object",
//     fields: [ ... ]
//   },
// };
// Here we have one too many `}`.

// The easiest way is to use regex for the specific lines.
content = content.replace(/\n    \};/g, '\n    };'); // not doing much

// Let's just do an iterative string replace to remove the closing bracket.
// I'll manually match the exact closing bracket for the 5 occurrences.

// line 111
content = content.replace(/        \],\n      \},\n    \};/g, '        ],\n    };');

// line 128
content = content.replace(/      \}, count: 3 \},\n    \};/g, '      , count: 3 };');
content = content.replace(/      , count: 3 \},\n    \};/g, '      , count: 3 };');

// line 152
content = content.replace(/      \},\n    \};/g, '\n    };');

// line 185
content = content.replace(/          \},\n        \],\n      \},\n    \};/g, '          },\n        ],\n    };');

// line 211
content = content.replace(/              fields: \[\{ name: "a", schema: \{ type: "uint", bytes: 1 \} \}\],\n            \},\n          \},/g, '              fields: [{ name: "a", schema: { type: "uint", bytes: 1 } }],\n          },');


fs.writeFileSync('test/layout.spec.ts', content);
