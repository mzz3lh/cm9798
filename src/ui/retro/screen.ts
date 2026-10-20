// A 640x480 canvas drawn the way CM 97/98 drew its screens: a dimmed photo
// backdrop, darker translucent panels, bevelled grey buttons and bitmap text
// with a one-pixel black shadow. Screens are redrawn from scratch on every
// change and register click areas as they draw.

import { drawText, textWidth, wrapText, type FontName } from './fonts';

export const W = 640;
export const H = 480;

/** Colours sampled from the original's screens. */
export const C = {
  white: '#ffffff',
  text: '#cbcbcb',
  grey: '#656565',
  greyLight: '#969696',
  greyDark: '#303030',
  greyBox: '#7d7d7d',
  yellow: '#ffff2c',
  gold: '#ffd31c',
  cyan: '#00dfdf',
  orange: '#ff8a00',
  boxBlue: '#001c7d',
  boxBlueLight: '#002cd3',
  boxBlueDark: '#001055',
  numBlue: '#0024aa',
  titleGreen: '#004100',
  titleGreenLight: '#008200',
  black: '#000000',
  pitch: '#004100',
  pitchLine: '#008200',
};

export interface Hit {
  x: number; y: number; w: number; h: number;
  onClick?: () => void;
  onRightClick?: () => void;
  /** Drag start; the handler gets the drop point. */
  onDrop?: (x: number, y: number) => void;
}

export interface Backdrop {
  image: HTMLImageElement | undefined;
}

export class Screen {
  readonly ctx: CanvasRenderingContext2D;
  hits: Hit[] = [];
  private hover: { x: number; y: number } | undefined;
  private drag: { hit: Hit; x: number; y: number } | undefined;
  /** Called before each redraw. */
  draw: (s: Screen) => void = () => {};

  constructor(readonly canvas: HTMLCanvasElement, private readonly backdrop: Backdrop) {
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('mousedown', e => this.down(e));
    canvas.addEventListener('mouseup', e => this.up(e));
    canvas.addEventListener('mousemove', e => {
      this.hover = this.point(e);
      canvas.style.cursor = this.hitAt(this.hover.x, this.hover.y) ? 'pointer' : 'default';
    });
  }

  private point(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }

  private hitAt(x: number, y: number): Hit | undefined {
    // Last drawn wins, so a dialog on top takes the click.
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) return h;
    }
    return undefined;
  }

  private down(e: MouseEvent) {
    const p = this.point(e);
    const hit = this.hitAt(p.x, p.y);
    if (!hit) return;
    if (e.button === 2) { hit.onRightClick?.(); this.render(); return; }
    if (e.button === 0) this.drag = { hit, ...p };
  }

  private up(e: MouseEvent) {
    const d = this.drag;
    this.drag = undefined;
    if (!d || e.button !== 0) return;
    const p = this.point(e);
    const moved = Math.abs(p.x - d.x) + Math.abs(p.y - d.y) > 6;
    if (moved && d.hit.onDrop) d.hit.onDrop(p.x, p.y);
    else if (!moved) d.hit.onClick?.();
    this.render();
  }

  render() {
    this.hits = [];
    this.draw(this);
  }

  // ---------------------------------------------------------------- drawing

  /** The photo, dimmed as the game dims it; plain black if there is no photo. */
  background() {
    const g = this.ctx;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (this.backdrop.image) {
      g.drawImage(this.backdrop.image, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, W, H);
    }
  }

  /** The darker see-through area that holds a screen's content. */
  panel(x: number, y: number, w: number, h: number) {
    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(x, y, w, h);
  }

  rect(x: number, y: number, w: number, h: number, fill: string) {
    this.ctx.fillStyle = fill;
    this.ctx.fillRect(x, y, w, h);
  }

  frame(x: number, y: number, w: number, h: number, colour: string) {
    this.ctx.strokeStyle = colour;
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  /** A raised box: light top and left edges, dark bottom and right. */
  bevel(x: number, y: number, w: number, h: number, face: string, light: string, dark: string) {
    const g = this.ctx;
    g.fillStyle = '#000';
    g.fillRect(x, y, w, h);
    g.fillStyle = dark;
    g.fillRect(x + 1, y + 1, w - 2, h - 2);
    g.fillStyle = light;
    g.fillRect(x + 1, y + 1, w - 3, h - 3);
    g.fillStyle = face;
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
  }

  text(s: string, x: number, y: number, opts: { font?: FontName; colour?: string; align?: 'left' | 'center' | 'right'; shadow?: boolean } = {}) {
    const font = opts.font ?? 'MY3';
    const w = textWidth(s, font);
    const left = opts.align === 'center' ? Math.round(x - w / 2) : opts.align === 'right' ? x - w : x;
    if (opts.shadow !== false) drawText(this.ctx, s, left + 1, y + 1, font, '#000');
    drawText(this.ctx, s, left, y, font, opts.colour ?? C.text);
    return w;
  }

  /** Text across one or two lines, centred in a box, as on the original's buttons. */
  label(s: string, x: number, y: number, w: number, h: number, font: FontName, colour: string) {
    const lines = s.split('\n');
    const lh = lineHeight(font);
    const top = Math.round(y + (h - lines.length * lh) / 2);
    lines.forEach((l, i) => this.text(l, x + w / 2, top + i * lh, { font, colour, align: 'center' }));
  }

  paragraph(s: string, x: number, y: number, w: number, font: FontName, colour: string) {
    const lines = wrapText(s, w, font);
    lines.forEach((l, i) => this.text(l, x, y + i * lineHeight(font), { font, colour }));
    return lines.length * lineHeight(font);
  }

  // ---------------------------------------------------------------- widgets

  /** The bar across the top: a coloured band with the title in the big bold font. */
  titleBar(title: string, bg = C.titleGreen, fg = C.yellow, x = 0, w = W) {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(x, 0, w, 54);
    this.rect(x + 2, 4, w - 4, 48, bg);
    this.rect(x + 2, 4, w - 4, 1, lighten(bg));
    this.rect(x + 2, 51, w - 4, 1, darken(bg));
    this.text(title, x + w / 2, 13, { font: 'MY7', colour: fg, align: 'center' });
  }

  /** The small grey tag in a corner, e.g. the date or "Page 1 of 3". */
  tag(s: string, x: number, y: number, align: 'left' | 'right' = 'right') {
    const w = textWidth(s, 'MY1') + 14;
    const left = align === 'right' ? x - w : x;
    this.bevel(left, y, w, 17, C.greyBox, C.greyLight, '#494949');
    this.text(s, left + w / 2, y + 2, { font: 'MY1', colour: '#000', align: 'center', shadow: false });
    return w;
  }

  button(s: string, x: number, y: number, w: number, h: number, onClick?: () => void, opts: { font?: FontName; active?: boolean; colour?: string; arrows?: boolean; onRightClick?: () => void } = {}) {
    this.bevel(x, y, w, h, C.grey, C.greyLight, C.greyDark);
    const font = opts.font ?? (s.includes('\n') ? 'MY1' : 'MY3');
    const colour = opts.colour ?? (opts.active ? C.yellow : onClick ? C.text : '#8a8a8a');
    if (opts.arrows) {
      // The ‹ › marks on a button that cycles through settings.
      this.chevron(x + 8, y + h / 2, -1);
      this.chevron(x + w - 8, y + h / 2, 1);
    }
    this.label(s, x, y, w, h, font, colour);
    if (onClick || opts.onRightClick) this.hits.push({ x, y, w, h, onClick, onRightClick: opts.onRightClick });
  }

  private chevron(cx: number, cy: number, dir: -1 | 1) {
    const g = this.ctx;
    g.strokeStyle = C.text;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - dir * 3 + 0.5, cy - 8);
    g.lineTo(cx + dir * 3 + 0.5, cy);
    g.lineTo(cx - dir * 3 + 0.5, cy + 8);
    g.stroke();
  }

  /** The blue numbered box: shirt numbers, stat values. */
  blueBox(s: string, x: number, y: number, w: number, h: number, opts: { colour?: string; font?: FontName; align?: 'left' | 'center'; onClick?: () => void; onDrop?: (x: number, y: number) => void; lit?: boolean } = {}) {
    this.rect(x, y, w, h, '#000');
    this.rect(x + 1, y + 1, w - 2, h - 2, opts.lit ? C.boxBlueLight : C.boxBlueDark);
    this.rect(x + 1, y + 1, w - 3, h - 3, opts.lit ? '#3c5cff' : C.boxBlueLight);
    this.rect(x + 2, y + 2, w - 4, h - 4, opts.lit ? C.boxBlueLight : C.boxBlue);
    const font = opts.font ?? 'MY1';
    if (s) {
      const ty = y + Math.round((h - lineHeight(font)) / 2);
      if (opts.align === 'left') this.text(s, x + 6, ty, { font, colour: opts.colour ?? C.white });
      else this.text(s, x + w / 2, ty, { font, colour: opts.colour ?? C.white, align: 'center' });
    }
    if (opts.onClick || opts.onDrop) this.hits.push({ x, y, w, h, onClick: opts.onClick, onDrop: opts.onDrop });
  }

  /** A menu tile: a dark box with a blue outline and a two-line caption. */
  tile(s: string, x: number, y: number, w: number, h: number, onClick: () => void) {
    this.panel(x, y, w, h);
    this.frame(x, y, w, h, C.boxBlueLight);
    this.label(s, x, y, w, h, 'MY4', C.text);
    this.hits.push({ x, y, w, h, onClick });
  }

  /** The full-width bar along the bottom, usually Done. */
  doneBar(s = 'Done', onClick?: () => void, x = 10, w = W - 20) {
    this.bevel(x, 446, w, 30, C.grey, C.greyLight, C.greyDark);
    this.text(s, x + w / 2, 450, { font: 'MY4', colour: onClick ? C.white : C.text, align: 'center' });
    if (onClick) this.hits.push({ x, y: 446, w, h: 30, onClick });
  }

  area(x: number, y: number, w: number, h: number, hit: Omit<Hit, 'x' | 'y' | 'w' | 'h'>) {
    this.hits.push({ x, y, w, h, ...hit });
  }
}

export function lineHeight(font: FontName): number {
  // Cell height less the font's internal leading, which is how tightly the original stacks lines.
  return { MY1: 11, MY2: 13, MY3: 16, MY4: 18, MY5: 24, MY6: 32, MY7: 32 }[font];
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
export const lighten = (hex: string) => shade(hex, 1.6);
export const darken = (hex: string) => shade(hex, 0.5);
