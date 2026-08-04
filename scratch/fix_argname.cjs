const fs = require('fs');

let calldataCode = fs.readFileSync('src/calldata.ts', 'utf8');

calldataCode = calldataCode.replace(
  '    return trimmed.length === 0 ? prefix : `${prefix}.${trimmed}`;',
  '    if (trimmed.length === 0) return prefix;\n    return trimmed.startsWith("[") ? `${prefix}${trimmed}` : `${prefix}.${trimmed}`;'
);

fs.writeFileSync('src/calldata.ts', calldataCode);
