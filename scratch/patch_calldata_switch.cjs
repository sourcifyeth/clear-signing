const fs = require('fs');

let code = fs.readFileSync('src/calldata.ts', 'utf8');

code = code.replace(
  'import {\n  bytesToAscii,',
  'import { resolveTopLevelSwitch } from "./interaction.js";\nimport {\n  bytesToAscii,'
);

const targetStr = `
  const { inputs, spec: format } = match;
  let decoded: DecodedArguments;
  try {
    decoded = decodeArguments(inputs, calldata);
  } catch {
    return {
      rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
      warnings: [
        warn(
          "CALLDATA_DECODE_ERROR",
          \`Failed to decode calldata for selector \${selectorHex}\`,
        ),
      ],
    };
  }`;

const replaceStr = targetStr + `

  if (format.switch) {
    if (!resolveCalldataDescriptor) {
       return {
         rawCalldataFallback: rawPreviewFromCalldata(selector, calldata),
         warnings: [
           warn(
             "EMBEDDED_CALLDATA_NOT_SUPPORTED",
             "Cannot evaluate top-level switch interaction because no external descriptor resolver is available",
           ),
         ],
       };
    }
    return resolveTopLevelSwitch(tx, descriptor, format.switch, decoded, resolveCalldataDescriptor, externalDataProvider, formatEmbeddedCalldata);
  }
`;

code = code.replace(targetStr, replaceStr);

fs.writeFileSync('src/calldata.ts', code);
