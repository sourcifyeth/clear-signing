import re

with open('src/fields.ts', 'r') as f:
    content = f.read()

# 1. Add processSequenceLayoutGroup definition at the end
sequence_func = """
async function processSequenceLayoutGroup(
  fieldSpec: DescriptorFieldFormat,
  ctx: FieldContext,
  layoutResolvedValues: Map<string, ArgumentValue>
): Promise<{ group: DisplayFieldGroup } | { warnings: Warning[] }> {
  if (!fieldSpec.layout || fieldSpec.layout.type !== "sequence") {
     return { warnings: [warn("INVALID_DESCRIPTOR", "Not a sequence layout")] };
  }
  
  const elementSchema = fieldSpec.layout.element;
  if (elementSchema.type !== "object") {
     return { warnings: [warn("INVALID_DESCRIPTOR", "Sequence layout element must be an object")] };
  }

  const items = [];
  const basePath = stripStructuredRootPrefix(fieldSpec.path ?? "");
  let i = 0;
  
  while (true) {
    const prefix = basePath ? `${basePath}.[${i}]` : `[${i}]`;
    let foundAny = false;
    for (const key of layoutResolvedValues.keys()) {
      if (key.startsWith(prefix)) {
        foundAny = true;
        break;
      }
    }
    if (!foundAny) break;

    const childFields = [];
    for (const childFieldSpec of elementSchema.fields) {
      const innerSpec: DescriptorFieldFormat = {
         ...childFieldSpec,
         path: childFieldSpec.name ? `${fieldSpec.path}.[${i}].${childFieldSpec.name}` : undefined
      };
      
      const result = await processSingleField(innerSpec, ctx);
      if ("warnings" in result) return result;
      if (result.field) childFields.push(result.field);
    }
    items.push({ fields: childFields });
    i++;
  }

  return {
    group: {
       label: fieldSpec.label,
       items
    }
  };
}
"""

if "processSequenceLayoutGroup" not in content:
    content += sequence_func

# 2. Patch applyFieldFormats loop
old_apply = """  for (const fieldSpec of format.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
      const groupResult = fieldSpec.path?.endsWith(".[]")
        ? await processGroupArrayPath(fieldSpec, ctx)
        : groupHasArrayChildren(fieldSpec)
          ? await processChildArrayPaths(fieldSpec, ctx)
          : await processStructGroup(fieldSpec, ctx);
      if ("warnings" in groupResult) return groupResult;
      fields.push(groupResult.group);
    } else if (fieldSpec.path?.includes(".[]")) {"""

new_apply = """  for (const fieldSpec of format.fields ?? []) {
    if (isFieldGroup(fieldSpec)) {
      const groupResult = fieldSpec.path?.endsWith(".[]")
        ? await processGroupArrayPath(fieldSpec, ctx)
        : groupHasArrayChildren(fieldSpec)
          ? await processChildArrayPaths(fieldSpec, ctx)
          : await processStructGroup(fieldSpec, ctx);
      if ("warnings" in groupResult) return groupResult;
      fields.push(groupResult.group);
    } else if (fieldSpec.layout?.type === "sequence") {
      const groupResult = await processSequenceLayoutGroup(fieldSpec, ctx, layoutResolvedValues);
      if ("warnings" in groupResult) return groupResult;
      fields.push(groupResult.group);
    } else if (fieldSpec.path?.includes(".[]")) {"""

content = content.replace(old_apply, new_apply)

# 3. Patch processSingleField
old_single_1 = """  if (!merged.label) {
    return {
      warnings: [
        warn(
          "INVALID_DESCRIPTOR",
          `Missing label for field '${merged.path ?? merged.value}'`,
        ),
      ],
    };
  }

  const hasFormat = merged.format !== undefined;
  const hasLayout = merged.layout !== undefined;
  const hasSwitch = merged.switch !== undefined;
  const exclusiveCount =
    (hasFormat ? 1 : 0) + (hasLayout ? 1 : 0) + (hasSwitch ? 1 : 0);"""

new_single_1 = """  if (!merged.label && !merged.format && !merged.layout && !merged.switch) {
    return { field: null };
  }

  if (!merged.label) {
    return {
      warnings: [
        warn(
          "INVALID_DESCRIPTOR",
          `Missing label for field '${merged.path ?? merged.value}'`,
        ),
      ],
    };
  }

  const effectiveFormat = merged.format ?? (!merged.layout && !merged.switch ? "raw" : undefined);
  const hasFormat = effectiveFormat !== undefined;
  const hasLayout = merged.layout !== undefined;
  const hasSwitch = merged.switch !== undefined;
  const exclusiveCount =
    (hasFormat ? 1 : 0) + (hasLayout ? 1 : 0) + (hasSwitch ? 1 : 0);"""

content = content.replace(old_single_1, new_single_1)

# Also need to replace all `merged.format` with `effectiveFormat` in processSingleField after this block
# Specifically, in the if (merged.switch) ... else if (merged.layout) ... else {
old_single_2 = """  } else {
    // Normal format handling
    const expectedType = fieldTypeForFormat(merged.format ?? "raw");
    const argValue = coerceResolvedValue(resolvedValue, expectedType);"""

new_single_2 = """  } else {
    // Normal format handling
    const expectedType = fieldTypeForFormat(effectiveFormat ?? "raw");
    const argValue = coerceResolvedValue(resolvedValue, expectedType);"""
    
content = content.replace(old_single_2, new_single_2)

old_single_3 = """      format: merged.format ?? "raw",
      params: merged.params,"""

new_single_3 = """      format: effectiveFormat ?? "raw",
      params: merged.params,"""

content = content.replace(old_single_3, new_single_3)

with open('src/fields.ts', 'w') as f:
    f.write(content)
