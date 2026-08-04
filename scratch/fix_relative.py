import re

with open('src/fields.ts', 'r') as f:
    content = f.read()

old_loop = """      const innerSpec: DescriptorFieldFormat = {
         ...childFieldSpec,
         path: childFieldSpec.name ? `${fieldSpec.path}.[${i}].${childFieldSpec.name}` : undefined
      };
      
      const result = await processSingleField(innerSpec, ctx);"""

new_loop = """      const innerSpec: DescriptorFieldFormat = {
         ...childFieldSpec,
         path: childFieldSpec.name ? (fieldSpec.path ? `${fieldSpec.path}.[${i}].${childFieldSpec.name}` : `[${i}].${childFieldSpec.name}`) : undefined
      };
      
      const innerCtx: FieldContext = {
        ...ctx,
        resolvePath: (p: string) => {
           if (p.startsWith("@.") || p.startsWith("$.")) return ctx.resolvePath(p);
           const absolutePath = fieldSpec.path ? `${fieldSpec.path}.[${i}].${p}` : `[${i}].${p}`;
           const resolved = ctx.resolvePath(absolutePath);
           if (resolved !== undefined) return resolved;
           return ctx.resolvePath(p);
        }
      };
      
      const result = await processSingleField(innerSpec, innerCtx);"""

content = content.replace(old_loop, new_loop)

with open('src/fields.ts', 'w') as f:
    f.write(content)
