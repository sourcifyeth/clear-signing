const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  '    ...(field.params',
  `    ...(field.switch ? { 
      switch: { 
        ...field.switch, 
        expression: { 
          ...field.switch.expression, 
          path: typeof field.switch.expression === "string" 
            ? field.switch.expression.replace(/\\.?\\[\\]/g, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`).replace(/\\$index/g, index.toString())
            : field.switch.expression.path.replace(/\\.?\\[\\]/g, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`).replace(/\\$index/g, index.toString())
        } 
      } 
    } : {}),
    ...(field.params`
);

fs.writeFileSync('src/fields.ts', fieldsCode);
