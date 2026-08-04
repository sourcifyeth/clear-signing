const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  '      if (switchMatch.type === "format") {',
  `      if (switchMatch.type === "format") {`
);

// We need to import resolveInteraction from interaction.js in fields.ts
fieldsCode = fieldsCode.replace(
  'import { evaluateSwitchExpression } from "./switch.js";',
  'import { evaluateSwitchExpression } from "./switch.js";\nimport { resolveInteraction } from "./interaction.js";\nimport { bytesToHex } from "./utils.js";'
);

// We need to modify processSingleField to handle interaction
const interactionLogic = `
    if (fieldDef.interaction) {
      if (context.formatEmbeddedCalldata && context.resolveCalldataDescriptor) {
        const nestedModel = await resolveInteraction(
          context.tx,
          fieldDef.interaction,
          context.resolvePath,
          context.resolveCalldataDescriptor,
          context.externalDataProvider,
          context.formatEmbeddedCalldata
        );
        const toArg = context.resolvePath(fieldDef.interaction.to);
        let callee = context.tx.to;
        if (toArg) {
          if (toArg.type === "address") callee = bytesToHex(toArg.bytes);
          else if (toArg.type === "string") callee = toArg.value;
        }
        
        const displayField: DisplayField = {
          label: fieldDef.label ?? "",
          value: "",
          embeddedCalldata: {
            callee,
            chainId: context.tx.chainId,
            display: nestedModel
          }
        };
        context.displayModel.fields = context.displayModel.fields || [];
        context.displayModel.fields.push(displayField);
      }
      return;
    }
`;

fieldsCode = fieldsCode.replace(
  '  if (fieldDef.switch) {',
  interactionLogic + '\n  if (fieldDef.switch) {'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
