/**
 * Byte-offset -> UTF-16 code-unit-offset conversion for the native parser
 * backend's compat deserializer. See docs/architecture/native-parser.md
 * section 2.3 for the full empirical derivation of this algorithm; this is
 * a direct implementation of it.
 */

/**
 * Precomputed offset tables for one parsed source file.
 * Built once per native parse (not per node, not per access) -- see
 * buildCompatTree in ./compat-node.js, which is the only caller.
 */
export interface OffsetMaps {
  byteToUtf16: Uint32Array;
  rowStartUtf16: Uint32Array;
}
/**
 * How many UTF-8 bytes and UTF-16 code units a character starting with lead
 * byte `b` occupies. Split out of buildOffsetMaps to keep that function's
 * control flow (and cognitive complexity) to just the single scanning loop.
 */
function utf8CharWidth(b: number): { byteLength: number; utf16Units: number } {
  if (b < 0x80) return { byteLength: 1, utf16Units: 1 };
  if ((b & 0xe0) === 0xc0) return { byteLength: 2, utf16Units: 1 };
  if ((b & 0xf0) === 0xe0) return { byteLength: 3, utf16Units: 1 };
  return { byteLength: 4, utf16Units: 2 }; // astral plane -> surrogate pair
}

export function buildOffsetMaps(source: string): OffsetMaps {
  const bytes = Buffer.from(source, 'utf8');
  const byteToUtf16 = new Uint32Array(bytes.length + 1);
  const rowStarts: number[] = [0];
  let byteIdx = 0;
  let utf16Idx = 0;

  while (byteIdx < bytes.length) {
    byteToUtf16[byteIdx] = utf16Idx;
    const b = bytes[byteIdx];
    if (b === 0x0a /* \n -- always single-byte, so this check is branch-independent */) {
      rowStarts.push(utf16Idx + 1);
    }
    const { byteLength, utf16Units } = utf8CharWidth(b);
    byteIdx += byteLength;
    utf16Idx += utf16Units;
  }

  byteToUtf16[bytes.length] = utf16Idx;
  return { byteToUtf16, rowStartUtf16: Uint32Array.from(rowStarts) };
}
