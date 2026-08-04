const fs = require('fs');
let str = fs.readFileSync('src/types.ts', 'utf8');

str = str.replace(
  'export type SwitchCase =\n  | { type: "format"; format: string; params?: DescriptorFieldFormatParams }\n  | { type: "reject" }\n  | { type: "terminal"; intent?: string; label?: string }\n  | { type: "tuple"; intent?: string; tupleSig: string; fields: (DescriptorFieldFormat | DescriptorFieldGroup)[] }\n  | { type: "layout"; layout: LayoutNode; fields?: (DescriptorFieldFormat | DescriptorFieldGroup)[] };',
  'export type SwitchCase =\n  | { type: "format"; format: string; params?: DescriptorFieldFormatParams }\n  | { type: "reject" }\n  | { type: "terminal"; intent?: string; label?: string }\n  | { type: "tuple"; intent?: string; tupleSig: string; fields: (DescriptorFieldFormat | DescriptorFieldGroup)[] }\n  | { type: "layout"; layout: LayoutNode; fields?: (DescriptorFieldFormat | DescriptorFieldGroup)[] }\n  | { type: "interaction"; interaction: Interaction };\n\nexport interface Interaction {\n  to: string;\n  signature: string;\n  args: Array<{ path: string } | { value: any }>;\n}'
);

str = str.replace(
  'export interface DescriptorFormatSpec {',
  'export interface DescriptorFormatSpec {\n  /**\n   * Alternate entry point: top-level switch dispatch\n   */\n  switch?: DescriptorSwitch;\n'
);

str = str.replace(
  'export interface FieldContext {',
  'export interface FieldContext {\n  resolveCalldataDescriptor?: (chainId: number, to: string) => Promise<{ descriptor?: any, warning?: any }>;\n'
);

fs.writeFileSync('src/types.ts', str);
