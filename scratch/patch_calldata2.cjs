const fs = require('fs');
let str = fs.readFileSync('src/calldata.ts', 'utf8');
str = str.replace('function parseFunctionSignatureKey(', 'export function parseFunctionSignatureKey(');
fs.writeFileSync('src/calldata.ts', str);

let intStr = fs.readFileSync('src/interaction.ts', 'utf8');
intStr = intStr.replace('import { parseParamList, renderFormat } from "./calldata.js";', 'import { parseParamList, renderFormat, parseFunctionSignatureKey } from "./calldata.js";');
intStr = intStr.replace(
  'export function findFormatBySignature(\n  display: DescriptorDisplay | undefined,\n  signature: string\n): { inputs: FunctionInput[], spec: DescriptorFormatSpec } | undefined {\n  if (!display || !display.formats) return undefined;\n  const canonicalSig = signature.replace(/\\s+/g, "");\n  const targetSelector = bytesToHex(selectorForSignature(canonicalSig));\n\n  for (const [key, spec] of Object.entries(display.formats)) {\n    const keySig = key.replace(/\\s+/g, "");\n    if (keySig.includes("(")) {\n      const inputs = parseParamList(key.slice(key.indexOf("(") + 1, key.lastIndexOf(")")));\n      const keySelector = bytesToHex(selectorForSignature(keySig));\n      if (keySelector === targetSelector) {\n        return { inputs, spec };\n      }\n    }\n  }\n  return undefined;\n}',
  'export function findFormatBySignature(\n  display: DescriptorDisplay | undefined,\n  signature: string\n): { inputs: FunctionInput[], spec: DescriptorFormatSpec } | undefined {\n  if (!display || !display.formats) return undefined;\n  const targetSelector = bytesToHex(selectorForSignature(signature));\n  for (const [key, spec] of Object.entries(display.formats)) {\n    const parsed = parseFunctionSignatureKey(key);\n    if (parsed && bytesToHex(parsed.selector) === targetSelector) {\n      return { inputs: parsed.inputs, spec };\n    }\n  }\n  return undefined;\n}'
);
fs.writeFileSync('src/interaction.ts', intStr);
