/**
 * EIP-712 typed data formatting for clear signing.
 */

import type {
  Descriptor,
  DescriptorFormatSpec,
  DisplayModel,
  FieldType,
  ExternalDataProvider,
  TypedData,
  TypeMember,
  Warning,
} from "./types";
import {
  type ResolvePath,
  toArgumentValue,
  rawToArgumentValue,
  interpolateTemplate,
  isEip712DescriptorBoundTo,
  resolveMetadataValue,
  resolveTypedDataPath,
} from "./descriptor";
import { warn } from "./utils";
import { applyFieldFormats } from "./formatters";

/**
 * Format EIP-712 typed data for clear signing display.
 *
 * Per ERC-7730 (current spec), display.formats keys are the full encodeType
 * string from EIP-712 (e.g. "Mail(Person from,Person to,string contents)Person(...)").
 * Old descriptor files use bare primary type names — both are supported.
 */
export async function formatEip712(
  typedData: TypedData,
  descriptor: Descriptor,
  externalDataProvider?: ExternalDataProvider,
): Promise<DisplayModel> {
  if (!isEip712DescriptorBoundTo(descriptor, typedData)) {
    return {
      warnings: [
        warn(
          "DOMAIN_MISMATCH",
          `Descriptor context does not match the typed data domain`,
        ),
      ],
    };
  }

  const format = findFormatSpec(descriptor, typedData);
  if (!format) {
    return {
      warnings: [
        warn(
          "NO_FORMAT_MATCH",
          `No display format found for primary type '${typedData.primaryType}'`,
        ),
      ],
    };
  }

  const resolvePath: ResolvePath = (path: string) => {
    if (path.startsWith("@.")) return resolveTypedDataPath(path, typedData);
    if (path.startsWith("$."))
      return toArgumentValue(resolveMetadataValue(descriptor.metadata, path));
    const key = path.startsWith("#.") ? path.slice(2) : path;
    const raw = getMessageValue(typedData.message, key);
    if (raw === undefined) return undefined;
    const ft = resolveFieldType(key, typedData.primaryType, typedData.types);
    if (!ft) return undefined;
    return rawToArgumentValue(raw, ft);
  };

  const definitions = descriptor.display?.definitions ?? {};
  const result = await applyFieldFormats(
    format,
    definitions,
    resolvePath,
    typedData.domain.chainId,
    descriptor.metadata,
    externalDataProvider,
  );

  if ("warnings" in result) {
    return { warnings: result.warnings };
  }

  const warnings: Warning[] = [];
  let interpolatedIntent: string | undefined;
  if (format.interpolatedIntent) {
    try {
      interpolatedIntent = interpolateTemplate(
        format.interpolatedIntent,
        result.renderedValues,
      );
    } catch (e) {
      warnings.push(warn("INTERPOLATION_ERROR", (e as Error).message));
    }
  }

  const meta = descriptor.metadata;
  return {
    intent: format.intent,
    interpolatedIntent,
    fields: result.fields.length > 0 ? result.fields : undefined,
    metadata: meta
      ? { owner: meta.owner, contractName: meta.contractName, info: meta.info }
      : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Locate the DescriptorFormatSpec for the incoming message's primary type.
 *
 * Per ERC-7730, display.formats keys are the full encodeType string from EIP-712
 * (e.g. "Mail(Person from,Person to,string contents)Person(...)").
 */
function findFormatSpec(
  descriptor: Descriptor,
  typedData: TypedData,
): DescriptorFormatSpec | undefined {
  const formats = descriptor.display?.formats;
  if (!formats) return undefined;

  const encodeTypeStr = computeEncodeType(
    typedData.primaryType,
    typedData.types,
  );
  if (!encodeTypeStr) return undefined;

  return formats[encodeTypeStr];
}

/**
 * Compute the EIP-712 encodeType string for a given primary type.
 *
 * encodeType(T) = "TypeName(field0Type field0Name,...)" followed by all
 * referenced struct types sorted alphabetically (EIP-712 spec).
 */
function computeEncodeType(
  primaryType: string,
  types: Record<string, TypeMember[]>,
): string | undefined {
  if (!(primaryType in types)) return undefined;

  const referenced = new Set<string>();
  collectReferencedTypes(primaryType, types, referenced);
  referenced.delete(primaryType);

  return [primaryType, ...Array.from(referenced).sort()]
    .map((typeName) => {
      const members = types[typeName] ?? [];
      return `${typeName}(${members.map((m) => `${m.type} ${m.name}`).join(",")})`;
    })
    .join("");
}

function collectReferencedTypes(
  typeName: string,
  types: Record<string, TypeMember[]>,
  result: Set<string>,
): void {
  if (result.has(typeName)) return;
  result.add(typeName);
  for (const member of types[typeName] ?? []) {
    // Strip array brackets to get the base struct name
    const baseType = member.type.replace(/(\[.*?\])+$/, "");
    if (baseType in types) {
      collectReferencedTypes(baseType, types, result);
    }
  }
}

/**
 * Navigate a dot-path in an EIP-712 message object.
 */
function getMessageValue(
  message: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = message;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Walk the EIP-712 type tree to resolve the leaf Solidity type at a dot-path.
 * Returns undefined for struct/array reference types and unresolvable paths.
 */
function resolveFieldType(
  path: string,
  primaryType: string,
  types: Record<string, TypeMember[]>,
): FieldType | undefined {
  const segments = path.split(".");
  let currentType = primaryType;
  for (let i = 0; i < segments.length; i++) {
    const members = types[currentType];
    if (!members) return undefined;
    const member = members.find((m) => m.name === segments[i]);
    if (!member) return undefined;
    if (i === segments.length - 1) {
      const baseType = member.type.replace(/(\[.*?\])+$/, "");
      // Struct references and arrays have no ERC-7730 format category
      if (baseType in types) return undefined;
      return toFieldType(baseType);
    }
    currentType = member.type.replace(/(\[.*?\])+$/, "");
  }
  return undefined;
}

/** Map an EIP-712 concrete type to its ERC-7730 FieldType category. */
function toFieldType(type: string): FieldType | undefined {
  if (type === "address") return "address";
  if (type === "bool") return "bool";
  if (type === "string") return "string";
  if (type === "bytes" || /^bytes\d+$/.test(type)) return "bytes";
  if (/^uint\d*$/.test(type)) return "uint";
  if (/^int\d*$/.test(type)) return "int";
  return undefined;
}
