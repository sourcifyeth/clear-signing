const fs = require('fs');
let code = fs.readFileSync('src/calldata.ts', 'utf8');

code = code.replace(
  'export function parseFunctionSignatureKey(',
  'export function parseFunctionSignatureKey('
); // this is already done if I patched it again, let's just make it export

// Wait, I can extract renderFormat
code += `

export async function renderFormat(
  formatSpec: import("./types.js").DescriptorFormatSpec,
  decoded: DecodedArguments,
  tx: import("./types.js").Transaction,
  descriptor: import("./types.js").Descriptor,
  externalDataProvider?: import("./types.js").ExternalDataProvider,
  formatEmbeddedCalldata?: import("./types.js").FormatCalldata,
  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: import("./types.js").Descriptor; warning?: import("./types.js").Warning }>,
): Promise<import("./types.js").DisplayModel> {
  const { resolveTransactionPath, resolveMetadataValue, toArgumentValue } = require("./descriptor.js");
  const { applyFieldFormats } = require("./fields.js");
  
  const resolvePath = (path: string) => {
    if (path.startsWith("@.")) return resolveTransactionPath(path, tx);
    if (path.startsWith("$.")) return toArgumentValue(resolveMetadataValue(descriptor.metadata, path));
    const val = decoded.values.get(path);
    if (val) return val;
    return undefined;
  };
  
  const getArrayLength = (path: string) => {
    const len = decoded.arrayLengths.get(path);
    return len !== undefined ? len : 0;
  };
  
  const result = await applyFieldFormats(
    formatSpec,
    descriptor.definitions,
    resolvePath,
    getArrayLength,
    tx.chainId,
    descriptor.metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
    resolveCalldataDescriptor
  );
  
  if ("warnings" in result) return { warnings: result.warnings };
  return { title: formatSpec.intent, fields: result.fields };
}
`;

fs.writeFileSync('src/calldata.ts', code);
