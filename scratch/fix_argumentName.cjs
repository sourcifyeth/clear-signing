const fs = require('fs');

let code = fs.readFileSync('src/calldata.ts', 'utf8');

const targetStr = `function argumentName(
  prefix: string | undefined,
  input: FunctionInput,
): string | undefined {
  const trimmed = input.name.trim();
  if (prefix !== undefined) {
    if (trimmed.length === 0) return prefix;
    return trimmed.startsWith("[")
      ? \`\${prefix}\${trimmed}\`
      : \`\${prefix}.\${trimmed}\`;
  }
  return trimmed.length === 0 ? undefined : trimmed;
}`;

const replaceStr = `function argumentName(
  prefix: string | undefined,
  input: FunctionInput,
): string | undefined {
  const trimmed = input.name.trim();
  if (prefix !== undefined) {
    return trimmed.length === 0 ? prefix : \`\${prefix}.\${trimmed}\`;
  }
  return trimmed.length === 0 ? undefined : trimmed;
}`;

code = code.replace(targetStr, replaceStr);

fs.writeFileSync('src/calldata.ts', code);
