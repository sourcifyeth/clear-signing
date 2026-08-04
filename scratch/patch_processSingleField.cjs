const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  '  const resolvedValue = resolveFieldValue(merged, ctx.resolvePath);',
  `
  if (merged.interaction) {
    if (ctx.formatEmbeddedCalldata) {
      const nestedModel = await resolveInteraction(
        { chainId: ctx.chainId || 1, to: "0x0000000000000000000000000000000000000000", data: "0x", value: 0n },
        merged.interaction,
        ctx.resolvePath,
        null as any, // Not used inside if formatEmbeddedCalldata is provided and resolveCalldataDescriptor isn't needed? wait!
        ctx.externalDataProvider,
        ctx.formatEmbeddedCalldata
      );
      return {
        field: {
          label: merged.label ?? "",
          value: "",
          embeddedCalldata: {
            callee: "0x0",
            chainId: ctx.chainId || 1,
            display: nestedModel
          }
        }
      };
    }
    return { field: null };
  }

  const resolvedValue = resolveFieldValue(merged, ctx.resolvePath);`
);

fs.writeFileSync('src/fields.ts', fieldsCode);
