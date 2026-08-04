const fs = require('fs');

let code = fs.readFileSync('src/calldata.ts', 'utf8');

// First, find the block inside formatCalldata
const blockStart = code.indexOf('const resolvePath = (path: string)');
const blockEnd = code.indexOf('return { title: format.intent, fields: result.fields };') + 'return { title: format.intent, fields: result.fields };'.length;

const renderFormatStr = `
export async function renderFormat(
  format: DescriptorFormatSpec,
  decoded: DecodedArguments,
  tx: Transaction,
  descriptor: Descriptor,
  externalDataProvider?: ExternalDataProvider,
  formatEmbeddedCalldata?: FormatCalldata,
  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: Descriptor; warning?: Warning }>
): Promise<DisplayModel> {
  const resolvePath = (path: string): ArgumentValue | undefined => {
    if (path.startsWith("@.")) return resolveTransactionPath(path, tx);
    if (path.startsWith("$."))
      return toArgumentValue(resolveMetadataValue(descriptor.metadata, path));

    const key = normalizeNegativeIndices(
      stripStructuredRootPrefix(path),
      decoded.arrayLengths,
    );
    if (key === undefined) return undefined;
    return decoded.values.get(key);
  };

  const getArrayLength = (path: string): number => {
    const key = normalizeNegativeIndices(
      stripStructuredRootPrefix(path),
      decoded.arrayLengths,
    );
    if (key === undefined) return 0;
    return decoded.arrayLengths.get(key) ?? 0;
  };

  const definitions = descriptor.display?.definitions ?? {};
  const result = await applyFieldFormats(
    format,
    definitions,
    resolvePath,
    getArrayLength,
    tx.chainId,
    descriptor.metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
    resolveCalldataDescriptor
  );

  if ("warnings" in result) {
    return { warnings: result.warnings };
  }
  return { title: format.intent, fields: result.fields };
}
`;

code = code.substring(0, blockStart) + 'return renderFormat(format, decoded, tx, descriptor, externalDataProvider, formatEmbeddedCalldata, resolveCalldataDescriptor);\n}\n\n' + renderFormatStr + code.substring(blockEnd);

// Also I previously appended a CJS version of renderFormat at the bottom of the file which is broken.
const requireIndex = code.indexOf('const { resolveTransactionPath, resolveMetadataValue, toArgumentValue } = require("./descriptor.js");');
if (requireIndex !== -1) {
  const lastExportRenderFormatIndex = code.lastIndexOf('export async function renderFormat(');
  code = code.substring(0, lastExportRenderFormatIndex);
}

fs.writeFileSync('src/calldata.ts', code);
