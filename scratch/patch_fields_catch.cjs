const fs = require('fs');

let fieldsCode = fs.readFileSync('src/fields.ts', 'utf8');

fieldsCode = fieldsCode.replace(
  '      } catch {',
  '      } catch (err) {\n        console.error("DECODE ERROR:", err);'
);

fs.writeFileSync('src/fields.ts', fieldsCode);
