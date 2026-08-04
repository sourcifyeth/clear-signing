import type { LayoutNode, Warning } from "./types.js";
import { warn, bytesToUnsignedBigInt, hexToBytes } from "./utils.js";
import type { ArgumentValue } from "./descriptor.js";

const MAX_LAYOUT_DEPTH = 32;

/**
 * Converts an already-decoded scalar (uint/int/bool/address/bytes) into its
 * canonical 32-byte ABI word (or variable length for bytes), for the "anchor
 * layout on an already-decoded scalar" rule.
 */
export function layoutSourceBuffer(value: ArgumentValue): Uint8Array {
  if (value.type === "bytes") {
    return value.bytes;
  }

  const buf = new Uint8Array(32);

  if (value.type === "bool") {
    buf[31] = value.value ? 1 : 0;
    return buf;
  } else if (value.type === "address") {
    buf.set(value.bytes, 32 - value.bytes.length);
    return buf;
  } else if (value.type === "uint") {
    let hex = value.value.toString(16);
    if (hex.length % 2 !== 0) hex = "0" + hex;
    const bytes = hexToBytes("0x" + hex);
    buf.set(bytes, 32 - bytes.length);
    return buf;
  } else if (value.type === "int") {
    let hex = "";
    if (value.value < 0n) {
      // Two's complement for 256 bits
      const pos = (1n << 256n) + value.value;
      hex = pos.toString(16);
    } else {
      hex = value.value.toString(16);
    }
    if (hex.length % 2 !== 0) hex = "0" + hex;
    const bytes = hexToBytes("0x" + hex);

    // Sign extension
    if (value.value < 0n) {
      buf.fill(0xff);
    }
    buf.set(bytes, 32 - bytes.length);
    return buf;
  } else if (value.type === "string") {
    const enc = new TextEncoder();
    return enc.encode(value.value);
  }

  return new Uint8Array(0);
}

export interface LayoutDecodeContext {
  buffer: Uint8Array;
  offset: number;
  depth: number;
  resolvedValues: Map<string, ArgumentValue>;
}

export function decodeLayoutField(
  node: LayoutNode,
  buffer: Uint8Array,
  pathPrefix: string,
  resolvedValues: Map<string, ArgumentValue>,
): Warning | undefined {
  const ctx: LayoutDecodeContext = {
    buffer,
    offset: 0,
    depth: 0,
    resolvedValues,
  };

  const warning = decodeNode(node, ctx, pathPrefix);
  if (warning) return warning;

  if (ctx.offset !== buffer.length) {
    return warn(
      "LAYOUT_DECODE_ERROR",
      `Layout decoded ${ctx.offset} bytes but buffer length is ${buffer.length}`,
    );
  }

  return undefined;
}

export function decodeNode(
  node: LayoutNode,
  ctx: LayoutDecodeContext,
  currentPath: string,
): Warning | undefined {
  if (ctx.depth >= MAX_LAYOUT_DEPTH) {
    return warn("RECURSION_LIMIT_EXCEEDED", "Layout depth exceeded");
  }

  if (node.type === "uint") {
    const { bytes, endian, mask } = node;
    if (ctx.offset + bytes > ctx.buffer.length) {
      return warn("LAYOUT_DECODE_ERROR", "OOB read in uint");
    }

    const slice = ctx.buffer.slice(ctx.offset, ctx.offset + bytes);
    ctx.offset += bytes;

    if (endian === "le") {
      slice.reverse();
    }

    let val = bytesToUnsignedBigInt(slice);
    if (mask) {
      const maskBigInt = BigInt(mask);
      val = val & maskBigInt;
    }

    ctx.resolvedValues.set(currentPath, { type: "uint", value: val });
  } else if (node.type === "address") {
    if (ctx.offset + 20 > ctx.buffer.length) {
      return warn("LAYOUT_DECODE_ERROR", "OOB read in address");
    }

    const slice = ctx.buffer.slice(ctx.offset, ctx.offset + 20);
    ctx.offset += 20;

    ctx.resolvedValues.set(currentPath, { type: "address", bytes: slice });
  } else if (node.type === "bool") {
    if (ctx.offset + 1 > ctx.buffer.length) {
      return warn("LAYOUT_DECODE_ERROR", "OOB read in bool");
    }

    const val = ctx.buffer[ctx.offset] !== 0;
    ctx.offset += 1;

    ctx.resolvedValues.set(currentPath, { type: "bool", value: val });
  } else if (node.type === "bytes") {
    const { length, lengthFrom } = node;
    let lenToRead = 0;

    if (length !== undefined) {
      lenToRead = typeof length === "number" ? length : parseInt(length, 10);
    } else if (lengthFrom) {
      const parentPath = getParentPath(currentPath);
      const refPath = parentPath ? `${parentPath}.${lengthFrom}` : lengthFrom;
      const refVal = ctx.resolvedValues.get(refPath);
      if (!refVal || refVal.type !== "uint") {
        return warn(
          "LAYOUT_DECODE_ERROR",
          `Invalid lengthFrom reference '${lengthFrom}'`,
        );
      }
      lenToRead = Number(refVal.value);
    } else {
      return warn(
        "INVALID_DESCRIPTOR",
        "bytes node must have length or lengthFrom",
      );
    }

    if (ctx.offset + lenToRead > ctx.buffer.length) {
      console.log("OOB bytes: ", {
        lenToRead,
        offset: ctx.offset,
        bufLen: ctx.buffer.length,
      });
      return warn("LAYOUT_DECODE_ERROR", "OOB read in bytes");
    }

    const slice = ctx.buffer.slice(ctx.offset, ctx.offset + lenToRead);
    ctx.offset += lenToRead;

    ctx.resolvedValues.set(currentPath, { type: "bytes", bytes: slice });
  } else if (node.type === "object") {
    const { fields } = node;

    for (const field of fields) {
      if (field.schema) {
        const childPath = currentPath
          ? `${currentPath}.${field.name}`
          : field.name;
        ctx.depth++;
        const warning = decodeNode(field.schema, ctx, childPath);
        ctx.depth--;
        if (warning) return warning;
      }
    }
  } else if (node.type === "sequence") {
    const { element, count, countFrom } = node;
    let len = -1;

    if (count !== undefined) {
      len = typeof count === "number" ? count : parseInt(count, 10);
    } else if (countFrom) {
      const parentPath = getParentPath(currentPath);
      const refPath = parentPath ? `${parentPath}.${countFrom}` : countFrom;
      const refVal = ctx.resolvedValues.get(refPath);
      if (!refVal || refVal.type !== "uint") {
        return warn(
          "LAYOUT_DECODE_ERROR",
          `Invalid countFrom reference '${countFrom}'`,
        );
      }
      len = Number(refVal.value);
    }

    if (len !== -1) {
      for (let i = 0; i < len; i++) {
        const childPath = currentPath ? `${currentPath}.[${i}]` : `[${i}]`;
        ctx.depth++;
        const warning = decodeNode(element, ctx, childPath);
        ctx.depth--;
        if (warning) return warning;
      }
    } else {
      // Decode until the buffer is exhausted
      let i = 0;
      while (ctx.offset < ctx.buffer.length) {
        const startOffset = ctx.offset;
        const childPath = currentPath ? `${currentPath}.[${i}]` : `[${i}]`;
        ctx.depth++;
        const warning = decodeNode(element, ctx, childPath);
        ctx.depth--;
        if (warning) return warning;
        if (ctx.offset === startOffset) {
          // Zero-length element consumed nothing but didn't error -> infinite loop guard
          return warn(
            "LAYOUT_DECODE_ERROR",
            "Zero-length sequence element caused infinite loop",
          );
        }
        i++;
      }
      // If the buffer was exactly exhausted, good. If the element decode caused an OOB error,
      // it's returned by decodeNode above.
    }
  } else if (node.type === "bitfield") {
    const { bytes, endian, fields } = node;
    if (ctx.offset + bytes > ctx.buffer.length) {
      return warn("LAYOUT_DECODE_ERROR", "OOB read in bitfield");
    }

    const slice = ctx.buffer.slice(ctx.offset, ctx.offset + bytes);
    ctx.offset += bytes;

    if (endian === "le") {
      slice.reverse();
    }

    const val = bytesToUnsignedBigInt(slice);
    const bitWidth = bytes * 8;

    for (const field of fields) {
      if (field.bit !== undefined) {
        if (field.bit < 0 || field.bit >= bitWidth) {
          return warn(
            "INVALID_DESCRIPTOR",
            `Bit ${field.bit} out of range for ${bytes}-byte bitfield`,
          );
        }
        const bitVal = (val >> BigInt(field.bit)) & 1n;
        ctx.resolvedValues.set(
          currentPath ? `${currentPath}.${field.name}` : field.name,
          { type: "bool", value: bitVal === 1n },
        );
      } else if (field.bits !== undefined) {
        const [hi, lo] = field.bits;
        if (lo < 0 || hi >= bitWidth || lo > hi) {
          return warn(
            "INVALID_DESCRIPTOR",
            `Bit range [${hi}, ${lo}] invalid for ${bytes}-byte bitfield`,
          );
        }
        const mask = (1n << BigInt(hi - lo + 1)) - 1n;
        const numVal = (val >> BigInt(lo)) & mask;
        ctx.resolvedValues.set(
          currentPath ? `${currentPath}.${field.name}` : field.name,
          { type: "uint", value: numVal },
        );
      } else {
        return warn(
          "INVALID_DESCRIPTOR",
          `Bitfield field ${field.name} must specify bit or bits`,
        );
      }
    }
  } else if (node.type === "switch") {
    // Stage 4 stub
    return warn("UNEXPECTED_LIB_ERROR", "switch layout not implemented");
  }

  return undefined;
}

function getParentPath(path: string): string {
  if (!path) return "";
  const lastDot = path.lastIndexOf(".");
  if (lastDot === -1) return "";
  return path.substring(0, lastDot);
}
