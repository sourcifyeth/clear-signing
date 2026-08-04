const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  /console\.log\("REJECTED.*?ctx\[actions\[0\]\]=", ctx\.baseResolvePath\("actions\[0\]"\)\);/,
  'console.log("REJECTED. caseMatch=", caseMatch, "expr=", merged.switch.expression, "ctx[0]=", ctx.baseResolvePath("actions[0]"), "ctx[1]=", ctx.baseResolvePath("actions[1]"));'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
