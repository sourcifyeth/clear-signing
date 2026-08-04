const fs = require('fs');

let testCode = fs.readFileSync('test/layout.spec.ts', 'utf8');

testCode = testCode.replace(/const warning = decodeLayoutField\(node, ctx, "flags"\);\n    expect\(warning\)\.toBeUndefined\(\);\n    expect\(ctx\.resolvedValues\.get/g, 'const warning = decodeLayoutField(node, buffer, "flags", ctx.resolvedValues);\n    expect(warning).toBeUndefined();\n    expect(ctx.resolvedValues.get');

testCode = testCode.replace(/decodeLayoutField\(node, ctx, "flags"\);\n    expect\(ctx\.resolvedValues/g, 'decodeLayoutField(node, buffer, "flags", ctx.resolvedValues);\n    expect(ctx.resolvedValues');

testCode = testCode.replace(/decodeLayoutField\(nodeBE, ctxBE, "flags"\);\n    expect\(ctxBE\.resolvedValues/g, 'decodeLayoutField(nodeBE, buffer, "flags", ctxBE.resolvedValues);\n    expect(ctxBE.resolvedValues');

testCode = testCode.replace(/decodeLayoutField\(nodeLE, ctxLE, "flags"\);\n    expect\(ctxLE\.resolvedValues/g, 'decodeLayoutField(nodeLE, buffer, "flags", ctxLE.resolvedValues);\n    expect(ctxLE.resolvedValues');

testCode = testCode.replace(/decodeLayoutField\(\n        \{ type: "bitfield", bytes: 1, fields: \[\{ name: "x", bit: 8 \}\] \},\n        ctx\(\),\n        "flags"\n      \)/g, 'decodeLayoutField(\n        { type: "bitfield", bytes: 1, fields: [{ name: "x", bit: 8 }] },\n        buffer,\n        "flags",\n        new Map()\n      )');

testCode = testCode.replace(/decodeLayoutField\(\n        \{ type: "bitfield", bytes: 1, fields: \[\{ name: "x", bit: -1 \}\] \},\n        ctx\(\),\n        "flags"\n      \)/g, 'decodeLayoutField(\n        { type: "bitfield", bytes: 1, fields: [{ name: "x", bit: -1 }] },\n        buffer,\n        "flags",\n        new Map()\n      )');

testCode = testCode.replace(/decodeLayoutField\(\n        \{ type: "bitfield", bytes: 1, fields: \[\{ name: "x", bits: \[8, 0\] \}\] \},\n        ctx\(\),\n        "flags"\n      \)/g, 'decodeLayoutField(\n        { type: "bitfield", bytes: 1, fields: [{ name: "x", bits: [8, 0] }] },\n        buffer,\n        "flags",\n        new Map()\n      )');

testCode = testCode.replace(/decodeLayoutField\(\n        \{ type: "bitfield", bytes: 1, fields: \[\{ name: "x", bits: \[2, 3\] \}\] \},\n        ctx\(\),\n        "flags"\n      \)/g, 'decodeLayoutField(\n        { type: "bitfield", bytes: 1, fields: [{ name: "x", bits: [2, 3] }] },\n        buffer,\n        "flags",\n        new Map()\n      )');

testCode = testCode.replace(/decodeLayoutField\(\n        \{ type: "bitfield", bytes: 1, fields: \[\{ name: "x", bits: \[2, -1\] \}\] \},\n        ctx\(\),\n        "flags"\n      \)/g, 'decodeLayoutField(\n        { type: "bitfield", bytes: 1, fields: [{ name: "x", bits: [2, -1] }] },\n        buffer,\n        "flags",\n        new Map()\n      )');

testCode = testCode.replace(/decodeLayoutField\(\n        \{ type: "bitfield", bytes: 1, fields: \[\{ name: "x" \}\] \},\n        ctx\(\),\n        "flags"\n      \)/g, 'decodeLayoutField(\n        { type: "bitfield", bytes: 1, fields: [{ name: "x" }] },\n        buffer,\n        "flags",\n        new Map()\n      )');

fs.writeFileSync('test/layout.spec.ts', testCode);
