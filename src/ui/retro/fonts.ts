// The original's bitmap fonts (MY1-MY7.FNT), drawn pixel for pixel. The build
// decodes them from the original game files and puts them on the page as
// window.CM_ASSETS. Without them, text falls back to a similar system font.

export type FontName = 'MY1' | 'MY2' | 'MY3' | 'MY4' | 'MY5' | 'MY6' | 'MY7';

/** One font as packed by scripts/original-assets.mjs. */
export interface PackedFont {
  face: string;
  height: number;
  ascent: number;
  firstChar: number;
  widths: number[];
  /** Base64 bits: per glyph, each row is ceil(width / 8) bytes, high bit first. */
  bits: string;
}

export interface OriginalAssets {
  fonts: Record<FontName, PackedFont>;
  backdrops: Record<string, string>;
}

declare global {
  interface Window { CM_ASSETS?: OriginalAssets }
}

interface Glyph { w: number; offset: number }

interface LoadedFont {
  packed: PackedFont;
  bytes: Uint8Array;
  glyphs: Glyph[];
  /** One canvas per colour, holding every glyph in a row. */
  atlases: Map<string, { canvas: HTMLCanvasElement; xs: number[] }>;
}

/** Point sizes and faces of the original fonts, for the fallback. */
const FALLBACK: Record<FontName, string> = {
  MY1: '11px', MY2: '13px', MY3: '16px', MY4: '19px', MY5: '24px', MY6: '27px', MY7: 'bold 27px',
};
const FALLBACK_FACE = '"MS Sans Serif", "Microsoft Sans Serif", Tahoma, Arial, sans-serif';

const loaded = new Map<FontName, LoadedFont>();
let measureCtx: CanvasRenderingContext2D | undefined;

function font(name: FontName): LoadedFont | undefined {
  const packed = window.CM_ASSETS?.fonts[name];
  if (!packed) return undefined;
  let f = loaded.get(name);
  if (!f) {
    const bytes = Uint8Array.from(atob(packed.bits), c => c.charCodeAt(0));
    const glyphs: Glyph[] = [];
    let offset = 0;
    for (const w of packed.widths) {
      glyphs.push({ w, offset });
      offset += Math.ceil(w / 8) * packed.height;
    }
    f = { packed, bytes, glyphs, atlases: new Map() };
    loaded.set(name, f);
  }
  return f;
}

function glyphIndex(f: LoadedFont, ch: string): number {
  const code = cp1252(ch);
  const i = code - f.packed.firstChar;
  return i >= 0 && i < f.glyphs.length ? i : '?'.charCodeAt(0) - f.packed.firstChar;
}

/** The fonts are Windows-1252; map the few characters that differ from Latin-1. */
function cp1252(ch: string): number {
  const c = ch.charCodeAt(0);
  const extra: Record<number, number> = { 0x2013: 0x96, 0x2014: 0x97, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2026: 0x85, 0x20ac: 0x80 };
  if (extra[c]) return extra[c];
  if (c < 256) return c;
  // Letters with marks the font lacks lose the mark, e.g. "ć" becomes "c".
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return plain.charCodeAt(0) < 256 ? plain.charCodeAt(0) : 63;
}

function atlas(f: LoadedFont, colour: string) {
  let a = f.atlases.get(colour);
  if (a) return a;
  const { height } = f.packed;
  const total = f.glyphs.reduce((s, g) => s + g.w, 0);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, total);
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(canvas.width, height);
  const n = parseInt(toHex(colour).slice(1), 16);
  const xs: number[] = [];
  let x0 = 0;
  for (const g of f.glyphs) {
    xs.push(x0);
    const rowBytes = Math.ceil(g.w / 8);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < g.w; x++) {
        const byte = f.bytes[g.offset + y * rowBytes + (x >> 3)];
        if ((byte >> (7 - (x & 7))) & 1) {
          const p = (y * canvas.width + x0 + x) * 4;
          img.data[p] = (n >> 16) & 255; img.data[p + 1] = (n >> 8) & 255; img.data[p + 2] = n & 255; img.data[p + 3] = 255;
        }
      }
    }
    x0 += g.w;
  }
  ctx.putImageData(img, 0, 0);
  a = { canvas, xs };
  f.atlases.set(colour, a);
  return a;
}

function toHex(colour: string): string {
  if (colour.startsWith('#') && colour.length === 7) return colour;
  if (colour.startsWith('#') && colour.length === 4) return '#' + [...colour.slice(1)].map(c => c + c).join('');
  const m = colour.match(/\d+/g);
  if (m) return '#' + m.slice(0, 3).map(v => Number(v).toString(16).padStart(2, '0')).join('');
  return '#ffffff';
}

export function textWidth(s: string, name: FontName): number {
  const f = font(name);
  if (f) {
    let w = 0;
    for (const ch of s) w += f.glyphs[glyphIndex(f, ch)].w;
    return w;
  }
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${FALLBACK[name]} ${FALLBACK_FACE}`;
  return Math.ceil(measureCtx.measureText(s).width);
}

/** Draws text with its top-left corner at (x, y). */
export function drawText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, name: FontName, colour: string) {
  const f = font(name);
  if (!f) {
    ctx.font = `${FALLBACK[name]} ${FALLBACK_FACE}`;
    ctx.fillStyle = colour;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText(s, x, y);
    return;
  }
  const a = atlas(f, colour);
  let cx = Math.round(x);
  for (const ch of s) {
    const i = glyphIndex(f, ch);
    const g = f.glyphs[i];
    if (g.w) ctx.drawImage(a.canvas, a.xs[i], 0, g.w, f.packed.height, cx, Math.round(y), g.w, f.packed.height);
    cx += g.w;
  }
}

export function wrapText(s: string, width: number, name: FontName): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of s.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, name) > width) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Shortens text with an ellipsis-free cut, as the original did, to fit a width. */
export function fit(s: string, width: number, name: FontName): string {
  if (textWidth(s, name) <= width) return s;
  let t = s;
  while (t.length > 1 && textWidth(t, name) > width) t = t.slice(0, -1);
  return t;
}
