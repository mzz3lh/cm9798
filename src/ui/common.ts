// Pieces several screens share: club colours for title bars, position codes
// as the original wrote them, the date tag and the status tags on squad lists.

import { shortDate } from '../engine/calendar';
import type { Player, Position, Team } from '../engine/types';
import type { GameState } from '../engine/world';
import { C, W, type Screen } from './retro/screen';
import { ui } from './state';

/** Title bar colours for a club: its main colour, with its second colour or white for the text. */
export function teamBar(t: Team, home?: Team) {
  // The original's palette was a little darker than today's kit colours.
  // In a match, an away side whose colour clashes with the home side's swaps to its second colour.
  const clash = !!home && home.id !== t.id && colourDistance(home.colours.primary, t.colours.primary) < 120;
  const main = clash ? t.colours.secondary : t.colours.primary;
  const other = clash ? t.colours.primary : t.colours.secondary;
  const bg = toHex(darkenBy(main, 0.8));
  const fg = contrast(bg, other) > 3 ? other : contrast(bg, '#ffffff') > contrast(bg, '#000000') ? '#ffffff' : '#000000';
  return { bg, fg };
}
function colourDistance(a: string, b: string) {
  const x = darkenBy(a, 1), y = darkenBy(b, 1);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
function darkenBy(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v * f));
}
const toHex = (rgb: number[]) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Position letters as the original showed them, e.g. "D/M L" or "AM/F C". */
export function positionCode(p: Player): string {
  const lineOf = (pos: Position) => pos === 'GK' ? 'GK' : pos === 'DM' ? 'DM' : pos.startsWith('AM') ? 'AM' : pos === 'ST' ? 'S' : pos[0];
  const side = (pos: Position) => pos === 'GK' || pos === 'ST' || pos === 'DM' ? '' : pos.slice(-1);
  const lines = [...new Set(p.positions.map(lineOf))];
  const sides = [...new Set(p.positions.map(side).filter(Boolean))];
  if (lines.includes('GK')) return 'GK';
  return `${lines.join('/')}${sides.length ? ' ' + sides.join('') : lines.includes('S') || lines.includes('DM') ? ' C' : ''}`;
}

/** Goalkeepers first, then defenders, midfielders and forwards, as the original listed them. */
export function sortSquad(squad: Player[]): Player[] {
  const order: Position[] = ['GK', 'DR', 'DC', 'DL', 'DM', 'MR', 'MC', 'ML', 'AMR', 'AMC', 'AML', 'ST'];
  return [...squad].sort((a, b) => order.indexOf(a.positions[0]) - order.indexOf(b.positions[0]) || b.ability - a.ability);
}

/** "Sullivan N": surname first, then the initial, as the original's lists did. */
export function listName(p: Player): string {
  const parts = p.name.split(' ');
  return parts.length > 1 ? `${parts.slice(1).join(' ')} ${parts[0][0]}` : p.name;
}

/** The date in the top right corner. */
export function dateTag(s: Screen) {
  if (ui.game) s.tag(shortDate(ui.game.date), W - 4, 0);
}

/** The small tag beside a player in a squad list: Inj, Sus, Lst, Off (an offer in), as in the original. */
export function statusTag(g: GameState, p: Player): { text: string; colour: string } | undefined {
  const st = g.players[p.id];
  if (!st) return undefined;
  if (st.injury) return { text: 'Inj', colour: '#c00000' };
  if (st.banned > 0) return { text: 'Sus', colour: '#c00000' };
  if (g.talks.some(t => t.playerId === p.id && t.from === g.humanClubId && t.stage === 'bid' && !t.renewal)) return { text: 'Off', colour: C.grey };
  if (st.listed) return { text: 'Lst', colour: C.grey };
  return undefined;
}

/** A small bevelled tag box. */
export function tagBox(s: Screen, text: string, x: number, y: number, colour: string) {
  s.bevel(x, y, 26, 16, colour, '#a0a0a0', '#202020');
  s.text(text, x + 13, y + 2, { font: 'MY1', colour: C.white, align: 'center' });
}

export const cap = (w: string) => w[0].toUpperCase() + w.slice(1);
