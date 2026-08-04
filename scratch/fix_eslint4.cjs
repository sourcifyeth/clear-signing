const fs = require('fs');

let switchCode = fs.readFileSync('src/switch.ts', 'utf8');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\.layout/g, '(caseVal as {layout: LayoutNode}).layout');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\.switch/g, '(caseVal as {switch: DescriptorFieldSwitch}).switch');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\.format/g, '(caseVal as {format: string}).format');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\.params/g, '(caseVal as {params: DescriptorFieldFormatParams}).params');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\.label/g, '(caseVal as {label: string}).label');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\.intent/g, '(caseVal as {intent: "info" | "warning"}).intent');
switchCode = switchCode.replace(/\(caseVal as Record<string, any>\)\[keys\[0\]\]/g, '(caseVal as Record<string, any>)[keys[0]]'); // wait, the last one is still any
fs.writeFileSync('src/switch.ts', switchCode);
