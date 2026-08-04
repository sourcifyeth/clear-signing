const fs = require('fs');
let code = fs.readFileSync('src/calldata.ts', 'utf8');

// replace the CJS require block with proper imports? The imports are already at the top of calldata.ts!
// Let's remove the require block and use the imported functions!
// Wait, `applyFieldFormats` is NOT imported in calldata.ts!
// Wait! `formatCalldata` uses `applyFieldFormats`! Let's check!
