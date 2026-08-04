const fs = require('fs');

let layout = fs.readFileSync('src/layout.ts', 'utf8');

// Replace node.type === "uint" with "uint" in node
layout = layout.replace(/node\.type === "uint"/g, '"uint" in node');
layout = layout.replace(/const \{ bytes, endian, mask \} = node;/g, 'const { bytes, endian, mask } = node.uint;');
layout = layout.replace(/node\.type === "address"/g, '"address" in node');
layout = layout.replace(/node\.type === "bool"/g, '"bool" in node');
layout = layout.replace(/node\.type === "bytes"/g, '"bytes" in node');
layout = layout.replace(/const \{ length, lengthFrom \} = node;/g, 'const { length, lengthFrom } = node.bytes;');
layout = layout.replace(/node\.type === "object"/g, '"object" in node');
layout = layout.replace(/const \{ fields \} = node;/g, 'const { fields } = node.object;');
layout = layout.replace(/node\.type === "sequence"/g, '"sequence" in node');
layout = layout.replace(/const \{ element, count, countFrom \} = node;/g, 'const { element, count, countFrom } = node.sequence;');
// Also bitfield if we have it? Let's assume we don't have bitfield tests for now, but just in case:
layout = layout.replace(/node\.type === "bitfield"/g, '"bitfield" in node');
layout = layout.replace(/const \{ bytes, endian, fields \} = node;/g, 'const { bytes, endian, fields } = node.bitfield;');

fs.writeFileSync('src/layout.ts', layout);

let types = fs.readFileSync('src/types.ts', 'utf8');
types = types.replace(/export type LayoutNode =[\s\S]*?(?=\nexport )/m, `export type LayoutNode =
  | { uint: { bytes: number; endian?: "be" | "le"; mask?: string } }
  | { bytes: { length?: string | number; lengthFrom?: string } }
  | { address: {} }
  | { bool: {} }
  | {
      bitfield: {
        bytes: number;
        endian?: "be" | "le";
        fields: Array<{ name: string; bit?: number; bits?: [number, number] }>;
      };
    }
  | { object: { fields: { name: string; schema: LayoutNode }[] } }
  | { sequence: { element: LayoutNode; count?: number | string; countFrom?: string } };
`);
fs.writeFileSync('src/types.ts', types);
