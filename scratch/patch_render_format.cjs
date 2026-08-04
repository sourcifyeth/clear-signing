const fs = require('fs');

let code = fs.readFileSync('src/calldata.ts', 'utf8');

const targetStr = `  if ("warnings" in result) {
    return { warnings: result.warnings };
  }

  console.log("FORMAT INTENT IS:", format.intent); return { intent: format.intent, fields: result.fields };`;

const replaceStr = `  if ("warnings" in result) {
    return { warnings: result.warnings };
  }

  const warnings: Warning[] = [];
  let interpolatedIntent: string | undefined;
  if (format.interpolatedIntent) {
    try {
      interpolatedIntent = interpolateTemplate(
        format.interpolatedIntent,
        result.renderedValues,
      );
    } catch (e) {
      warnings.push(warn("INTERPOLATION_ERROR", (e as Error).message));
    }
  }

  const meta = descriptor.metadata;
  return {
    intent: format.intent,
    interpolatedIntent,
    fields: result.fields,
    metadata: meta
      ? {
          owner: meta.owner,
          contractName: meta.contractName,
          info: meta.info,
        }
      : undefined,
    ...(warnings.length > 0 && { warnings }),
  };`;

code = code.replace(targetStr, replaceStr);

fs.writeFileSync('src/calldata.ts', code);
