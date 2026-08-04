const fs = require('fs');

let content = fs.readFileSync('src/fields.ts', 'utf8');

// Update imports
if (!content.includes('parseSwitchCase')) {
  content = content.replace(/resolveSwitchCase,/, 'resolveSwitchCase,\n  parseSwitchCase,');
}
if (!content.includes('parseParamList')) {
  content = content.replace(/import \{.*?\} from "\.\/calldata\.js";/, "import { parseParamList, decodeArguments, FormatCalldata } from \"./calldata.js\";");
}

// Change return type
content = content.replace(
  /: Promise<\{ field: DisplayField \| null \} \| \{ warnings: Warning\[\] \}>/g,
  ': Promise<{ fields: Array<DisplayField | DisplayFieldGroup> } | { warnings: Warning[] }>'
);

// update return { field: null } to return { fields: [] }
content = content.replace(/return \{ field: null \}/g, 'return { fields: [] }');

// update return { field: { ... } } to return { fields: [{ ... }] }
// But only for the specific ones:
content = content.replace(/return \{\s*field: \{\s*label: caseMatch\.label,\s*value: "",\s*fieldType: "string",\s*format: "raw",\s*\.\.\.\(warning && \{ warning \}\),\s*\},\s*\};/g,
  '// REMOVED old label handling');

// Also update the final return
content = content.replace(/return \{\s*field: \{\s*\.\.\.renderResult\.field,\s*\.\.\.separator,\s*\},\s*\};/g,
  'return { fields: [{ ...renderResult.field, ...separator }] };');
content = content.replace(/return \{\s*field: \{\s*label: merged\.label,\s*value: rendered,\s*fieldType: argValue\.type,\s*format: effectiveFormat,\s*\.\.\.\(embeddedCalldata && \{ embeddedCalldata \}\),\s*\.\.\.\(fieldWarning && \{ warning: fieldWarning \}\),\s*\.\.\.\(tokenAddress && \{ tokenAddress \}\),\s*\.\.\.\(rawAddress && \{ rawAddress \}\),\s*\.\.\.(separator ? \{ separator \} : \{\}),\s*\},\s*\};/g,
  'return { fields: [{ label: merged.label, value: rendered, fieldType: argValue.type, format: effectiveFormat, ...(embeddedCalldata && { embeddedCalldata }), ...(fieldWarning && { warning: fieldWarning }), ...(tokenAddress && { tokenAddress }), ...(rawAddress && { rawAddress }), ...(separator ? { separator } : {}) }] };');

// Update calls to processSingleField
content = content.replace(/if \("warnings" in result\) return result;\s*if \(result\.field\) fields\.push\(result\.field\);/g,
  'if ("warnings" in result) return result;\n      fields.push(...result.fields);');
content = content.replace(/if \("warnings" in result\) return result;\s*if \(result\.field\) allFields\.push\(result\.field\);/g,
  'if ("warnings" in result) return result;\n      allFields.push(...result.fields);');

// Save it temporarily so we can do surgical replacements with string manipulation in JS.
fs.writeFileSync('src/fields.ts', content);
