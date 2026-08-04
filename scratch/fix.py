import re
import sys

def process(content):
    content = content.replace('{ uint: { bytes: 4 } }', '{ type: "uint", bytes: 4 }')
    content = content.replace('{ uint: { bytes: 4, endian: "le" } }', '{ type: "uint", bytes: 4, endian: "le" }')
    content = content.replace('{ uint: { bytes: 4, mask: "0x00ff00ff" } }', '{ type: "uint", bytes: 4, mask: "0x00ff00ff" }')
    content = content.replace('object: {', 'type: "object",')
    content = content.replace('sequence: {', 'type: "sequence",')
    content = content.replace('schema: { uint: { bytes: 1 } }', 'schema: { type: "uint", bytes: 1 }')
    content = content.replace('element: { uint: { bytes: 1 } }', 'element: { type: "uint", bytes: 1 }')
    content = content.replace('schema: { address: {} }', 'schema: { type: "address" }')
    content = content.replace('sequence: { element: { uint: { bytes: 1 } }, countFrom: "len" }', 'type: "sequence", element: { type: "uint", bytes: 1 }, countFrom: "len"')
    return content

with open('test/layout.spec.ts', 'r') as f:
    c = f.read()

c = process(c)

with open('test/layout.spec.ts', 'w') as f:
    f.write(c)
