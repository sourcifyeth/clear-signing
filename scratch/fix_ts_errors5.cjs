const fs = require('fs');

let intCode = fs.readFileSync('src/interaction.ts', 'utf8');
intCode = intCode.replace(
  '        syntheticValues.set(inputName, val);',
  '        syntheticValues.set(inputName, val.type === "bytes-slice" ? { type: "bytes", bytes: val.bytes } : val);'
);
fs.writeFileSync('src/interaction.ts', intCode);

