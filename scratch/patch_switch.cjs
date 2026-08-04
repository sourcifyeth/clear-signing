const fs = require('fs');

let switchCode = fs.readFileSync('src/switch.ts', 'utf8');

switchCode = switchCode.replace(
  '  if (typeof expr !== "string") {\n    // Stage 4 layout switch handling\n    return undefined;\n  }',
  `  if (typeof expr !== "string") {
    if ("path" in expr && typeof expr.path === "string") {
      const val = context.resolvePath(expr.path);
      if (!val) return undefined;
      let argVal = val;
      if (val.type === "bytes-slice") argVal = { type: "bytes", bytes: val.bytes };
      if (expr.mask && argVal.type === "uint") {
        return { type: "uint", value: argVal.value & BigInt(expr.mask) };
      }
      return argVal;
    }
    return undefined;
  }`
);

fs.writeFileSync('src/switch.ts', switchCode);
