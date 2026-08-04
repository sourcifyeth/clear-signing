const fs = require('fs');

let layout = fs.readFileSync('src/layout.ts', 'utf8');

layout = layout.replace(/"uint" in node/g, 'node.type === "uint"');
layout = layout.replace(/const \{ bytes, endian, mask \} = node.uint;/g, 'const { bytes, endian, mask } = node;');

layout = layout.replace(/"address" in node/g, 'node.type === "address"');
layout = layout.replace(/"bool" in node/g, 'node.type === "bool"');

layout = layout.replace(/"bytes" in node/g, 'node.type === "bytes"');
layout = layout.replace(/const \{ length, lengthFrom \} = node.bytes;/g, 'const { length, lengthFrom } = node;');

layout = layout.replace(/"object" in node/g, 'node.type === "object"');
layout = layout.replace(/const \{ fields \} = node.object;/g, 'const { fields } = node;');

layout = layout.replace(/"sequence" in node/g, 'node.type === "sequence"');
layout = layout.replace(/const \{ element, count, countFrom \} = node.sequence;/g, 'const { element, count, countFrom } = node;');

layout = layout.replace(/"bitfield" in node/g, 'node.type === "bitfield"');
layout = layout.replace(/"switch" in node/g, 'node.type === "switch"');

fs.writeFileSync('src/layout.ts', layout);
