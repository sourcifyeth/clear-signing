const fs = require('fs');

let calldataCode = fs.readFileSync('src/calldata.ts', 'utf8');

calldataCode = calldataCode.replace(
  'export function decodeArguments(\n  inputs: FunctionInput[],\n  calldata: Uint8Array,\n): DecodedArguments {',
  'export function decodeArguments(\n  inputs: FunctionInput[],\n  calldata: Uint8Array,\n  hasSelector = true,\n): DecodedArguments {'
);

calldataCode = calldataCode.replace(
  '  if (calldata.length < 4 + headSize) {\n    throw new Error(\n      `calldata length ${calldata.length} too small (expected at least ${4 + headSize} bytes)`,\n    );\n  }',
  '  const offset = hasSelector ? 4 : 0;\n  if (calldata.length < offset + headSize) {\n    throw new Error(\n      `calldata length ${calldata.length} too small (expected at least ${offset + headSize} bytes)`,\n    );\n  }'
);

calldataCode = calldataCode.replace(
  '  // Skip the 4-byte selector; offsets in data are relative to params start.\n  const data = calldata.slice(4);',
  '  // Skip the 4-byte selector (if present); offsets in data are relative to params start.\n  const data = hasSelector ? calldata.slice(4) : calldata;'
);

fs.writeFileSync('src/calldata.ts', calldataCode);

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  'const decoded = decodeArguments(inputs, calldataBytes);',
  'const decoded = decodeArguments(inputs, calldataBytes, false);'
);
fs.writeFileSync('src/fields.ts', fieldsCode);
