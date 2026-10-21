// Decodes the original game's art from original/cm9798v2 into data the UI can draw:
// the PCX backdrops (as PNG data URLs) and the Windows 3.x .FNT bitmap fonts.
// The original files are not in git; see original/README.md for where they come from.
import { readFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

export const ORIGINAL_DIR = 'original/cm9798v2';

export function haveOriginals() {
  return existsSync(`${ORIGINAL_DIR}/MY1.FNT`);
}

// Windows 3.x FNT, version 2.00. The glyph bits are stored column by column:
// for each 8-pixel-wide byte column, one byte per row, top to bottom. This
// repacks them row by row (ceil(width / 8) bytes per row), which is what
// src/ui/retro/fonts.ts reads.
export function decodeFnt(buf) {
  const u16 = (o) => buf.readUInt16LE(o);
  if (u16(0) !== 0x200) throw new Error(`unsupported FNT version ${u16(0).toString(16)}`);
  let face = '';
  for (let i = buf.readUInt32LE(105); buf[i]; i++) face += String.fromCharCode(buf[i]);
  const height = u16(88), firstChar = buf[95], lastChar = buf[96];
  const widths = [], bytes = [];
  for (let c = 0; c <= lastChar - firstChar; c++) {
    const width = u16(118 + c * 4), off = u16(120 + c * 4);
    const cols = Math.ceil(width / 8);
    widths.push(width);
    for (let y = 0; y < height; y++) {
      for (let col = 0; col < cols; col++) bytes.push(buf[off + col * height + y]);
    }
  }
  return { face, height, ascent: u16(74), firstChar, widths, bits: Buffer.from(bytes).toString('base64') };
}

// 8-bit PCX (version 5 with a 256-colour palette at the end), RLE encoded.
export function decodePcx(buf) {
  const xmin = buf.readUInt16LE(4), ymin = buf.readUInt16LE(6);
  const w = buf.readUInt16LE(8) - xmin + 1, h = buf.readUInt16LE(10) - ymin + 1;
  const bpl = buf.readUInt16LE(66);
  const pal = buf.subarray(buf.length - 768);
  const idx = new Uint8Array(w * h);
  let p = 128;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < bpl) {
      let b = buf[p++], n = 1;
      if ((b & 0xc0) === 0xc0) { n = b & 0x3f; b = buf[p++]; }
      for (; n > 0; n--, x++) if (x < w) idx[y * w + x] = b;
    }
  }
  return { w, h, idx, pal };
}

export function pcxToPng(buf) {
  const { w, h, idx, pal } = decodePcx(buf);
  return encodePng(w, h, (x, y) => {
    const c = idx[y * w + x] * 3;
    return [pal[c], pal[c + 1], pal[c + 2]];
  });
}

function encodePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function loadFonts() {
  const fonts = {};
  for (let i = 1; i <= 7; i++) fonts[`MY${i}`] = decodeFnt(readFileSync(`${ORIGINAL_DIR}/MY${i}.FNT`));
  return fonts;
}

export function loadBackdrop(name) {
  return 'data:image/png;base64,' + pcxToPng(readFileSync(`${ORIGINAL_DIR}/${name}.PCX`)).toString('base64');
}
