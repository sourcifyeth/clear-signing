const fs = require('fs');
let content = fs.readFileSync('test/fields.spec.ts', 'utf8');
content = content.replace(/group\.\(fields\[(\d+)\] as DisplayField\)\./g, '(group.fields[$1] as DisplayField).');
content = content.replace(/group\.\(items\[(\d+)\] as DisplayField\)\./g, '(group.items[$1] as DisplayField).');
fs.writeFileSync('test/fields.spec.ts', content);
