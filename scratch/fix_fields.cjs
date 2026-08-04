const fs = require('fs');
let code = fs.readFileSync('src/fields.ts', 'utf8');

const target1 = `export async function applyFieldFormats(
  format: DescriptorFormatSpec,
  definitions: Record<string, DescriptorFieldDefinition>,
  resolvePath: BaseResolvePath,
  getArrayLength: (path: string) => number,
  chainId: number,
  metadata?: DescriptorMetadata,
  externalDataProvider?: ExternalDataProvider,
  formatEmbeddedCalldata?: FormatCalldata,
): Promise<`;
const replace1 = `import type { Descriptor, Warning } from "./types.js";

export async function applyFieldFormats(
  format: DescriptorFormatSpec,
  definitions: Record<string, DescriptorFieldDefinition>,
  resolvePath: BaseResolvePath,
  getArrayLength: (path: string) => number,
  chainId: number,
  metadata?: DescriptorMetadata,
  externalDataProvider?: ExternalDataProvider,
  formatEmbeddedCalldata?: FormatCalldata,
  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: Descriptor; warning?: Warning }>,
): Promise<`;

code = code.replace(target1, replace1);

const target2 = `  formatEmbeddedCalldata?: FormatCalldata;
}

/**`;
const replace2 = `  formatEmbeddedCalldata?: FormatCalldata;
  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: Descriptor; warning?: Warning }>;
}

/**`;

code = code.replace(target2, replace2);

const target3 = `  const ctx: FieldResolutionContext = {
    definitions,
    resolvePath,
    getArrayLength,
    chainId,
    metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
  };`;
const replace3 = `  const ctx: FieldResolutionContext = {
    definitions,
    resolvePath,
    getArrayLength,
    chainId,
    metadata,
    externalDataProvider,
    formatEmbeddedCalldata,
    resolveCalldataDescriptor,
  };`;

code = code.replace(target3, replace3);
fs.writeFileSync('src/fields.ts', code);
