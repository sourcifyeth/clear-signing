const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  /console\.log\("REJECTED.*?\);/,
  'console.log("REJECTED. caseMatch=", caseMatch, "expr=", merged.switch.expression, "ctx[actions[0]]=", ctx.baseResolvePath("actions[0]"));'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
