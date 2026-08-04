const fs = require('fs');

let calldataCode = fs.readFileSync('src/calldata.ts', 'utf8');
calldataCode = calldataCode.replace('return { title: format.intent, fields: result.fields };', 'return { intent: format.intent, fields: result.fields };');
fs.writeFileSync('src/calldata.ts', calldataCode);

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');
fieldsCode = fieldsCode.replace(
  '          embeddedCalldata: {',
  '          fieldType: "bytes",\n          format: "calldata",\n          embeddedCalldata: {'
);
fieldsCode = fieldsCode.replace(
  '        },\n      };',
  '        } as DisplayField,\n      };'
);

const expandTargetStr = `function expandFieldForIndex(
  field: DescriptorFieldFormat,
  index: number,
): DescriptorFieldFormat {
  return {
    ...field,
    path: field.path?.replace(/\\.?\\[\\]/g, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`),
    ...(field.switch ? {
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
    ...(field.params
      ? { params: expandParamArrayIndex(field.params, index) }
      : {}),
  };
}`;

const expandReplaceStr = `function expandFieldForIndex(
  field: DescriptorFieldFormat,
  index: number,
): DescriptorFieldFormat {
  let switchExpanded = field.switch;
  if (field.switch) {
    if (typeof field.switch.expression === "string") {
      switchExpanded = {
        ...field.switch,
        expression: field.switch.expression
          .replace(/\\.?\\[\\]/g, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`)
          .replace(/\\$index/g, index.toString())
      };
    } else if ("path" in field.switch.expression) {
      switchExpanded = {
        ...field.switch,
        expression: {
          ...field.switch.expression,
          path: field.switch.expression.path
            .replace(/\\.?\\[\\]/g, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`)
            .replace(/\\$index/g, index.toString())
        }
      };
    }
  }

  return {
    ...field,
    path: field.path?.replace(/\\.?\\[\\]/g, (m) => m === ".[]" ? \`.[\${index}]\` : \`[\${index}]\`),
    ...(switchExpanded ? { switch: switchExpanded } : {}),
    ...(field.params
      ? { params: expandParamArrayIndex(field.params, index) }
      : {}),
  };
}`;

fieldsCode = fieldsCode.replace(expandTargetStr, expandReplaceStr);
fs.writeFileSync('src/fields.ts', fieldsCode);

let switchCode = fs.readFileSync('src/switch.ts', 'utf8');
switchCode = switchCode.replace(
  '    if (!val) return undefined;\n\n    return val;\n  }',
  '    if (!val) return undefined;\n\n    let argVal = val;\n    if (val.type === "bytes-slice") argVal = { type: "bytes", bytes: val.bytes };\n    return argVal as ArgumentValue;\n  }'
);
fs.writeFileSync('src/switch.ts', switchCode);

