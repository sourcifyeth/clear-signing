const fs = require('fs');

let code = fs.readFileSync('src/calldata.ts', 'utf8');

const matchStr = `
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
  );

  if ("warnings" in result) {
    return { warnings: result.warnings };
  }
  return { title: format.intent, fields: result.fields };`;

if (code.includes(matchStr.trim())) {
  code = code.replace(matchStr.trim(), `
  return renderFormat(format, decoded, tx, descriptor, externalDataProvider, formatEmbeddedCalldata, resolveCalldataDescriptor);
`);
} else {
  console.log("MATCH STR NOT FOUND!");
}

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

code = code.replace('export function formatCalldata', renderFormatStr + '\nexport function formatCalldata');

// Also do the other replacements
code = code.replace(
  'export function decodeArguments(\n  inputs: FunctionInput[],\n  calldata: Uint8Array,\n): DecodedArguments {',
  'export function decodeArguments(\n  inputs: FunctionInput[],\n  calldata: Uint8Array,\n  hasSelector: boolean = true,\n): DecodedArguments {'
);

code = code.replace(
  '  if (calldata.length < 4 + headSize) {\n    throw new Error(\n      `calldata length ${calldata.length} too small (expected at least ${4 + headSize} bytes)`,\n    );\n  }',
  '  const offset = hasSelector ? 4 : 0;\n  if (calldata.length < offset + headSize) {\n    throw new Error(\n      `calldata length ${calldata.length} too small (expected at least ${offset + headSize} bytes)`,\n    );\n  }'
);

code = code.replace(
  '  // Skip the 4-byte selector; offsets in data are relative to params start.\n  const data = calldata.slice(4);',
  '  // Skip the 4-byte selector (if present); offsets in data are relative to params start.\n  const data = hasSelector ? calldata.slice(4) : calldata;'
);

code = code.replace(
  '  if (prefix !== undefined) {\n    return trimmed.length === 0 ? prefix : `${prefix}.${trimmed}`;\n  }',
  '  if (prefix !== undefined) {\n    if (trimmed.length === 0) return prefix;\n    return trimmed.startsWith("[") ? `${prefix}${trimmed}` : `${prefix}.${trimmed}`;\n  }'
);

code = code.replace(
  'function parseFunctionSignatureKey',
  'export function parseFunctionSignatureKey'
);

fs.writeFileSync('src/calldata.ts', code);
