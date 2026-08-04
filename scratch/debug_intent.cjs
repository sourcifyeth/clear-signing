const fs = require('fs');
let code = fs.readFileSync('src/calldata.ts', 'utf8');
code = code.replace(
  '  return { intent: format.intent, fields: result.fields };',
  '  console.log("FORMAT INTENT IS:", format.intent); return { intent: format.intent, fields: result.fields };'
);
fs.writeFileSync('src/calldata.ts', code);
