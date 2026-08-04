const fs = require('fs');

// Fix fields.ts
let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

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

if (fieldsCode.includes(expandTargetStr)) {
  fieldsCode = fieldsCode.replace(expandTargetStr, expandReplaceStr);
} else {
  console.log("Failed to match expandFieldForIndex");
}

const embeddedTargetStr = `      return {
        field: {
          label: merged.label ?? "",
          value: "",
          embeddedCalldata: {
            callee: interactionModel.callee,
            chainId: interactionModel.chainId,
            display: interactionModel.display,
          },
        },
      };`;

const embeddedReplaceStr = `      return {
        field: {
          label: merged.label ?? "",
          value: "",
          fieldType: "bytes",
          format: "calldata",
          embeddedCalldata: {
            callee: interactionModel.callee,
            chainId: interactionModel.chainId,
            display: interactionModel.display,
          },
        } as DisplayField,
      };`;

if (fieldsCode.includes(embeddedTargetStr)) {
  fieldsCode = fieldsCode.replace(embeddedTargetStr, embeddedReplaceStr);
} else {
  console.log("Failed to match embeddedCalldata");
}

fs.writeFileSync('src/fields.ts', fieldsCode);

// Fix switch.ts
let switchCode = fs.readFileSync('src/switch.ts', 'utf8');

const switchTargetStr = `  if (expr.startsWith("@.") || expr.startsWith("$.") || expr.startsWith("#.")) {
    const val = context.resolvePath(expr);
    if (!val) return undefined;

    return val;
  }`;

const switchReplaceStr = `  if (expr.startsWith("@.") || expr.startsWith("$.") || expr.startsWith("#.")) {
    const val = context.resolvePath(expr);
    if (!val) return undefined;

    let argVal = val;
    if (val.type === "bytes-slice") argVal = { type: "bytes", bytes: val.bytes };
    return argVal as ArgumentValue;
  }`;

if (switchCode.includes(switchTargetStr)) {
  switchCode = switchCode.replace(switchTargetStr, switchReplaceStr);
} else {
  console.log("Failed to match switch.ts");
}
fs.writeFileSync('src/switch.ts', switchCode);

