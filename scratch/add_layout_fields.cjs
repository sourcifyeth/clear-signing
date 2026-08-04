const fs = require('fs');

let fieldsStr = fs.readFileSync('src/fields.ts', 'utf8');

const extractFunc = `
function extractLayoutFields(
  node: import("./types.js").LayoutNode,
  basePath: string,
  resolvedValues: Map<string, import("./descriptor.js").ArgumentValue>
): Array<import("./types.js").DescriptorFieldFormat> {
  const result: Array<import("./types.js").DescriptorFieldFormat> = [];

  if (node.type === "object") {
    for (const field of node.fields) {
      if (field.schema) {
        const childPath = basePath ? \`\${basePath}.\${field.name}\` : field.name;
        
        if (field.label || field.format || field.params) {
          result.push({
            path: childPath,
            label: field.label,
            format: field.format as any,
            params: field.params,
          });
        }

        result.push(...extractLayoutFields(field.schema, childPath, resolvedValues));
      }
    }
  } else if (node.type === "sequence") {
    let i = 0;
    while (true) {
      const childPath = basePath ? \`\${basePath}.[\${i}]\` : \`[\${i}]\`;
      let hasChild = false;
      for (const key of resolvedValues.keys()) {
        if (key === childPath || key.startsWith(childPath + ".")) {
          hasChild = true;
          break;
        }
      }
      if (!hasChild) break;

      const elementFields = extractLayoutFields(node.element, childPath, resolvedValues);
      if (elementFields.length > 0) {
        result.push(...elementFields);
      }
      i++;
    }
  }

  return result;
}
`;

// Insert the extractFunc at the top of fields.ts
fieldsStr = fieldsStr.replace('import { decodeLayoutField', 'import { LayoutNode } from "./types.js";\n' + extractFunc + '\nimport { decodeLayoutField');

// Add layoutResolvedValues to FieldContext
fieldsStr = fieldsStr.replace(
  'formatEmbeddedCalldata: typeof formatCalldata;',
  'formatEmbeddedCalldata: typeof formatCalldata;\n  layoutResolvedValues?: Map<string, ArgumentValue>;'
);

// Pass layoutResolvedValues to FieldContext inside applyFieldFormats
fieldsStr = fieldsStr.replace(
  'externalDataProvider,\n    formatEmbeddedCalldata,\n  };',
  'externalDataProvider,\n    formatEmbeddedCalldata,\n    layoutResolvedValues,\n  };'
);

// In processSingleField, before `const effectiveFormat = merged.format ?? "raw";`:
const hookStr = `
  if (merged.layout && !merged.format) {
    if (ctx.layoutResolvedValues) {
      const extracted = extractLayoutFields(merged.layout, defPath, ctx.layoutResolvedValues);
      if (extracted.length > 0) {
        const processedExtracted = await processFlatFields(extracted, ctx);
        return [
          {
            ...(merged.label && { label: merged.label }),
            fields: processedExtracted,
          }
        ];
      }
    }
  }
  const effectiveFormat = merged.format ?? "raw";
`;

fieldsStr = fieldsStr.replace('const effectiveFormat = merged.format ?? "raw";', hookStr);

fs.writeFileSync('src/fields.ts', fieldsStr);
