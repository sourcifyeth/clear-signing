const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  '    if (parsedCase.type === "reject") {',
  '    if (parsedCase.type === "reject") {\n      console.log("REJECTED. switchMatch=", switchMatch, "exprValue=", resolveSwitchCase(merged.switch, { resolvePath: ctx.baseResolvePath, payloadBuffer: anchorBuffer }), "expr=", merged.switch.expression, "ctx=", ctx.baseResolvePath("actions[0]"), ctx.baseResolvePath("actions[1]"));'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
