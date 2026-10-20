// The match demo, drawn as CM 97/98 drew its screens: 640x480, the photo
// backdrop, grey bevelled buttons and the original bitmap fonts. Pick your
// club and an opponent, set the team on the squad and tactics screens, then
// play the match with its one-line commentary bar. Return pauses, space
// switches between normal and fast, and half time stops on the match info
// screens, where the tactics screen makes substitutions.

import { DEMO_TEAMS } from '../data/squads';
import { autoLineup } from '../engine/lineup';
import { Match } from '../engine/match';
import { FORMATIONS } from '../engine/formations';
import {
  MENTALITY_NAMES, VISIBLE_ATTRIBUTES,
  type FormationName, type MatchEvent, type Mentality, type Player, type Position, type Run,
  type Tactic, type Team, type VisibleAttribute,
} from '../engine/types';
import { fit, textWidth } from './retro/fonts';
import { C, Screen, W, darken, lighten } from './retro/screen';

// ------------------------------------------------------------------ state

const BENCH_SIZE = 9;
const NUMBERS = 11 + BENCH_SIZE;
const SPEEDS = { normal: 1300, fast: 350 };
const DEFAULT_TACTIC: Tactic = { formation: '4-4-2', mentality: 0, passing: 'mixed', pressing: 'mid', width: 'normal', counterAttack: false, offsideTrap: false };

type View =
  | { kind: 'pickTeam'; forOpponent: boolean; page: number }
  | { kind: 'menu' }
  | { kind: 'squad'; team: 'mine' | 'theirs' }
  | { kind: 'profile'; player: Player; team: Team; back: View }
  | { kind: 'tactics' }
  | { kind: 'confirm' }
  | { kind: 'match' }
  | { kind: 'info'; tab: InfoTab }
  | { kind: 'result' };
type InfoTab = 'homeStats' | 'incidents' | 'stats' | 'ratings' | 'awayStats';

/** The team sheet: who wears 1-11 and where they play, then the substitutes. */
interface Plan {
  team: Team;
  tactic: Tactic;
  /** Starters, in formation order, with their position and runs. */
  rows: { player: Player; slot: Position; run: Run; replaceWith?: string }[];
  /** Substitutes first (the first BENCH_SIZE), then reserves. */
  bench: Player[];
}

let view: View = { kind: 'pickTeam', forOpponent: false, page: 0 };
let myTeam = DEMO_TEAMS[0];
let oppTeam = DEMO_TEAMS[1];
let atHome = true;
let plan: Plan;
let undo: string | undefined;
let match: Match | undefined;
let mySide: 0 | 1 = 0;
let speed: keyof typeof SPEEDS = 'normal';
let paused = false;
let timer: number | undefined;
let queue: MatchEvent[] = [];
/** The commentary line on screen, and whose colour it takes. */
let line: { text: string; side?: 0 | 1; type?: string } | undefined;
/** A player picked for a swap: a starter's row or a bench player. */
let picked: { row: number } | { bench: string } | undefined;

const DATE = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'numeric', year: '2-digit' }).replace(/,/g, '').replace(/\//g, '.');

function newPlan(team: Team, tactic: Tactic): Plan {
  const lu = autoLineup(team, tactic.formation);
  const slots = FORMATIONS[tactic.formation];
  return {
    team, tactic: { ...tactic },
    rows: lu.starters.map((player, i) => ({ player, slot: slots[i], run: 'normal' })),
    bench: [...lu.bench, ...team.squad.filter(p => !lu.starters.includes(p) && !lu.bench.includes(p))],
  };
}

function planFromMatch(): Plan {
  const s = match!.sides[mySide];
  return {
    team: s.setup.team, tactic: { ...s.setup.tactic },
    rows: s.pitch.map(o => ({ player: o.player, slot: o.slot, run: o.run })),
    bench: [...s.bench],
  };
}

const snapshot = () => JSON.stringify({ t: plan.tactic, r: plan.rows.map(r => [r.player.id, r.slot, r.run, r.replaceWith]), b: plan.bench.map(p => p.id) });
function restore(json: string) {
  const all = [...plan.team.squad];
  const byId = (id: string) => all.find(p => p.id === id)!;
  const s = JSON.parse(json);
  plan.tactic = s.t;
  plan.rows = s.r.map(([id, slot, run, rw]: [string, Position, Run, string | undefined]) => ({ player: byId(id), slot, run, replaceWith: rw ?? undefined }));
  plan.bench = s.b.map(byId);
}

// ------------------------------------------------------------------ team colours

/** Title bar colours for a club: its main colour, with its second colour or white for the text. */
function teamBar(t: Team) {
  // The original's palette was a little darker than today's kit colours.
  // In a match, an away side whose colour clashes with the home side's swaps to its second colour.
  const away = match?.sides[1].setup.team;
  const home = match?.sides[0].setup.team;
  const clash = !!home && away?.id === t.id && colourDistance(home.colours.primary, t.colours.primary) < 120;
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

// ------------------------------------------------------------------ shared pieces

/** Position letters as the original showed them, e.g. "D/M L" or "AM/F C". */
function positionCode(p: Player): string {
  const line = (pos: Position) => pos === 'GK' ? 'GK' : pos === 'DM' ? 'DM' : pos.startsWith('AM') ? 'AM' : pos === 'ST' ? 'S' : pos[0];
  const side = (pos: Position) => pos === 'GK' || pos === 'ST' || pos === 'DM' ? '' : pos.slice(-1);
  const lines = [...new Set(p.positions.map(line))];
  const sides = [...new Set(p.positions.map(side).filter(Boolean))];
  if (lines.includes('GK')) return 'GK';
  return `${lines.join('/')}${sides.length ? ' ' + sides.join('') : lines.includes('S') || lines.includes('DM') ? ' C' : ''}`;
}

const POSITION_WORDS: Record<Position, string> = {
  GK: 'Goalkeeper', DL: 'Defender (Left)', DC: 'Defender (Centre)', DR: 'Defender (Right)', DM: 'Defensive Midfielder',
  ML: 'Midfielder (Left)', MC: 'Midfielder (Centre)', MR: 'Midfielder (Right)', AML: 'Attacking Midfielder (Left)',
  AMC: 'Attacking Midfielder (Centre)', AMR: 'Attacking Midfielder (Right)', ST: 'Striker',
};

function scoreBars(s: Screen) {
  const [h, a] = match!.sides;
  const bar = (t: Team, goals: number, x: number) => {
    const { bg, fg } = teamBar(t);
    s.rect(x, 4, 318, 50, '#000');
    s.rect(x + 2, 6, 314, 46, bg);
    s.rect(x + 2, 6, 314, 1, lighten(bg));
    s.rect(x + 2, 51, 314, 1, darken(bg));
    s.text(fit(t.name, 250, 'MY7'), x + 12, 13, { font: 'MY7', colour: fg });
    s.rect(x + 264, 9, 48, 40, '#000');
    s.rect(x + 266, 11, 44, 36, C.white);
    s.text(String(goals), x + 288, 13, { font: 'MY7', colour: '#000', align: 'center', shadow: false });
  };
  bar(h.setup.team, h.stats.goals, 0);
  bar(a.setup.team, a.stats.goals, 320);
  s.tag(DATE, W - 4, 0);
}

function matchClock(): string {
  const m = match!;
  return m.finished ? `${m.sides[0].stats.goals}:${m.sides[1].stats.goals} FT` : m.atHalfTime ? `${m.sides[0].stats.goals}:${m.sides[1].stats.goals} HT` : '';
}

// ------------------------------------------------------------------ screens

function drawPickTeam(s: Screen, v: Extract<View, { kind: 'pickTeam' }>) {
  s.background();
  s.titleBar(v.forOpponent ? 'Select Opponent' : 'Player #1 Select Team');
  s.tag('Page 1 of 1', 4, 0, 'left');
  s.panel(20, 100, 600, 336);
  DEMO_TEAMS.forEach((t, i) => {
    const y = 112 + i * 21;
    const taken = v.forOpponent && t.id === myTeam.id;
    const chosen = v.forOpponent ? t.id === oppTeam.id : t.id === myTeam.id;
    s.text(t.name, 24, y, { font: 'MY4', colour: taken ? '#8a8a8a' : chosen ? C.yellow : C.white });
    s.text('(PR)', 210, y + 4, { font: 'MY2', colour: C.orange, align: 'right' });
    if (!taken) s.area(20, y, 200, 21, { onClick: () => {
      if (v.forOpponent) { oppTeam = t; view = { kind: 'menu' }; }
      else {
        myTeam = t;
        if (oppTeam.id === t.id) oppTeam = DEMO_TEAMS.find(x => x.id !== t.id)!;
        plan = newPlan(myTeam, plan?.team.id === t.id ? plan.tactic : DEFAULT_TACTIC);
        view = { kind: 'pickTeam', forOpponent: true, page: 0 };
      }
    } });
  });
  s.doneBar('Done', () => { if (!plan) plan = newPlan(myTeam, DEFAULT_TACTIC); view = v.forOpponent ? { kind: 'menu' } : { kind: 'pickTeam', forOpponent: true, page: 0 }; }, 10, 310);
  s.button('Premier League', 322, 446, 306, 30, undefined, { active: true, font: 'MY3', colour: C.yellow });
}

function drawMenu(s: Screen) {
  s.background();
  s.titleBar(fixtureLine());
  s.tag(DATE, W - 4, 0);
  s.text(`${myTeam.name} v ${oppTeam.name}`, W / 2, 74, { font: 'MY6', colour: C.white, align: 'center' });
  if (!atHome) s.text(`(away, at ${oppTeam.stadium})`, W / 2, 106, { font: 'MY2', colour: C.text, align: 'center' });
  s.tile('Play\nMatch', 54, 158, 130, 108, () => { view = { kind: 'confirm' }; });
  s.tile('Squad\nDetails', 188, 158, 130, 108, () => { view = { kind: 'squad', team: 'mine' }; });
  s.tile('Match\nTactics', 322, 158, 130, 108, () => { undo = snapshot(); view = { kind: 'tactics' }; });
  s.tile('Opposition\nSquad', 456, 158, 130, 108, () => { view = { kind: 'squad', team: 'theirs' }; });
  s.tile('Change\nClubs', 122, 272, 130, 108, () => { view = { kind: 'pickTeam', forOpponent: false, page: 0 }; });
  s.tile(atHome ? 'Play\nAway' : 'Play\nAt Home', 256, 272, 130, 108, () => { atHome = !atHome; });
  s.tile(`Speed:\n${speed === 'fast' ? 'Fast' : 'Normal'}`, 390, 272, 130, 108, () => { speed = speed === 'fast' ? 'normal' : 'fast'; });
  s.doneBar('Please Select');
}

function fixtureLine() {
  return atHome ? `${myTeam.shortName} v ${oppTeam.shortName}` : `${oppTeam.shortName} v ${myTeam.shortName}`;
}

function drawSquad(s: Screen, which: 'mine' | 'theirs') {
  const team = which === 'mine' ? plan.team : oppTeam;
  const { bg, fg } = teamBar(team);
  s.background();
  s.titleBar(`${team.name} Squad`, bg, fg);
  s.tag(DATE, W - 4, 0);
  const tabs: [string, (() => void) | undefined, boolean][] = which === 'mine'
    ? [['Playing\nPositions', undefined, true], ['Match\nTactics', () => { undo = snapshot(); view = { kind: 'tactics' }; }, false], ['Opposition\nSquad', () => { view = { kind: 'squad', team: 'theirs' }; }, false], ['Premier\nLeague', undefined, false]]
    : [['Playing\nPositions', undefined, true], ['Your\nSquad', () => { view = { kind: 'squad', team: 'mine' }; }, false], ['', undefined, false], ['Premier\nLeague', undefined, false]];
  tabs.forEach(([label, fn, active], i) => s.button(label, 10 + i * 155, 66, 153, 30, fn, { active, arrows: i === 0 }));

  // Who wears which number: 1-11 the team, 12-20 the substitutes.
  const numberOf = new Map<string, number>();
  if (which === 'mine') {
    plan.rows.forEach((r, i) => numberOf.set(r.player.id, i + 1));
    plan.bench.slice(0, BENCH_SIZE).forEach((p, i) => numberOf.set(p.id, 12 + i));
  } else {
    const lu = autoLineup(team, '4-2-3-1');
    lu.starters.forEach((p, i) => numberOf.set(p.id, i + 1));
    lu.bench.forEach((p, i) => numberOf.set(p.id, 12 + i));
  }
  s.panel(10, 100, 620, 312);
  const players = sortSquad(team.squad);
  players.slice(0, 32).forEach((p, i) => {
    const col = i < 16 ? 0 : 1;
    const x = 12 + col * 296, y = 104 + (i % 16) * 19;
    const n = numberOf.get(p.id);
    const isPicked = picked && (('row' in picked && plan.rows[picked.row]?.player.id === p.id) || ('bench' in picked && picked.bench === p.id));
    s.blueBox(n ? String(n) : '-', x, y, 34, 18, {
      lit: !!isPicked,
      onClick: which === 'mine' ? () => pickByPlayer(p) : undefined,
    });
    s.text(fit(p.name.split(' ').slice(-1)[0] + ' ' + p.name[0], 150, 'MY4'), x + 60, y - 4, { font: 'MY4', colour: n && n <= 11 ? C.white : C.text });
    s.text(positionCode(p), x + 216, y + 2, { font: 'MY2', colour: C.gold });
    s.area(x + 58, y, 156, 19, { onClick: () => { view = { kind: 'profile', player: p, team, back: { kind: 'squad', team: which } }; } });
  });
  if (which === 'mine') {
    s.text('Click a number, then a player, to swap them. Click a name for his profile.', W / 2, 415, { font: 'MY1', colour: C.text, align: 'center' });
  }
  s.doneBar('Done', () => { picked = undefined; view = { kind: 'menu' }; });
}

/** Goalkeepers first, then defenders, midfielders and forwards, as the original listed them. */
function sortSquad(squad: Player[]): Player[] {
  const order: Position[] = ['GK', 'DR', 'DC', 'DL', 'DM', 'MR', 'MC', 'ML', 'AMR', 'AMC', 'AML', 'ST'];
  return [...squad].sort((a, b) => order.indexOf(a.positions[0]) - order.indexOf(b.positions[0]));
}

/** Clicking numbers on the squad screen: the first click picks, the second swaps. */
function pickByPlayer(p: Player) {
  const row = plan.rows.findIndex(r => r.player.id === p.id);
  handlePick(row >= 0 ? { row } : { bench: p.id });
}

function handlePick(p: { row: number } | { bench: string }) {
  const first = picked;
  const same = first && JSON.stringify(first) === JSON.stringify(p);
  if (!first || same) { picked = same ? undefined : p; return; }
  picked = undefined;
  const inMatch = view.kind === 'tactics' && match && !match.finished;
  if ('row' in first && 'row' in p) {
    // Two players in the team swap places; the position and runs stay with the slot.
    const a = plan.rows[first.row], b = plan.rows[p.row];
    [a.player, b.player] = [b.player, a.player];
    [a.replaceWith, b.replaceWith] = [b.replaceWith, a.replaceWith];
  } else if ('bench' in first && 'bench' in p) {
    if (inMatch) { picked = p; return; }
    const i = plan.bench.findIndex(x => x.id === first.bench), j = plan.bench.findIndex(x => x.id === p.bench);
    [plan.bench[i], plan.bench[j]] = [plan.bench[j], plan.bench[i]];
  } else {
    const row = plan.rows['row' in first ? first.row : (p as { row: number }).row];
    const benchId = 'bench' in first ? first.bench : (p as { bench: string }).bench;
    if (inMatch) {
      // In a match this lines up a substitution, made on resume; again to cancel.
      if (row.replaceWith === benchId) row.replaceWith = undefined;
      else {
        for (const r of plan.rows) if (r.replaceWith === benchId) r.replaceWith = undefined;
        row.replaceWith = benchId;
      }
    } else {
      const i = plan.bench.findIndex(x => x.id === benchId);
      [row.player, plan.bench[i]] = [plan.bench[i], row.player];
    }
  }
}

const ATTRIBUTE_LABELS: Partial<Record<VisibleAttribute, string>> = {
  offTheBall: 'Off the ball', setPieces: 'Set pieces', workRate: 'Work rate', firstTouch: 'First touch',
};
const label = (a: string) => ATTRIBUTE_LABELS[a as VisibleAttribute] ?? a[0].toUpperCase() + a.slice(1);

function drawProfile(s: Screen, v: Extract<View, { kind: 'profile' }>) {
  const { player: p, team } = v;
  const { bg, fg } = teamBar(team);
  s.background();
  s.titleBar(fit(`${p.name} (${team.shortName})`, 600, 'MY7'), bg, fg);
  s.tag(DATE, W - 4, 0);
  ['Playing\nSkills', 'Condition &\nAvailability', 'Contract\nInfo', 'Transfer\nInfo', 'Career\nHistory', 'Manager\nOptions']
    .forEach((t, i) => s.button(t, 10 + i * 104, 66, 102, 30, undefined, { active: i === 0 }));
  s.rect(10, 100, 620, 30, '#000');
  s.rect(11, 101, 618, 28, C.boxBlue);
  s.rect(11, 101, 618, 1, C.boxBlueLight);
  s.text(p.positions.map(x => POSITION_WORDS[x]).join(', '), W / 2, 104, { font: 'MY3', colour: C.white, align: 'center' });
  s.panel(20, 134, 600, 306);
  s.text(`Age ${p.age}. ${p.nation}.`, W / 2, 138, { font: 'MY4', colour: C.cyan, align: 'center' });
  const attrs = VISIBLE_ATTRIBUTES.filter(a => !(p.positions[0] === 'GK' && ['shooting', 'dribbling', 'flair', 'creativity'].includes(a)));
  const half = Math.ceil(attrs.length / 2);
  attrs.forEach((a, i) => {
    const x = i < half ? 28 : 330, y = 168 + (i % half) * 17;
    const val = Math.round(p.attributes[a]);
    s.text(label(a), x, y, { font: 'MY2', colour: C.text });
    s.text(val ? String(val) : '-', x + 262, y, { font: 'MY2', colour: C.yellow, align: 'right' });
  });
  if (p.positions[0] === 'GK') {
    s.text('Handling', 330, 168 + (attrs.length - half) * 17, { font: 'MY2', colour: C.text });
    s.text(String(Math.round(p.attributes.handling)), 592, 168 + (attrs.length - half) * 17, { font: 'MY2', colour: C.yellow, align: 'right' });
  }
  s.doneBar('Done', () => { view = v.back; });
}

// ------------------------------------------------------------------ tactics

const FORMATION_NAMES = Object.keys(FORMATIONS) as FormationName[];
const cycle = <T,>(list: readonly T[], cur: T, dir: 1 | -1) => list[(list.indexOf(cur) + dir + list.length) % list.length];

/** Where each position sits on the tactics pitch, as fractions across and up. */
const SPOT: Record<Position, [number, number]> = {
  GK: [0.5, 0.05], DR: [0.85, 0.24], DC: [0.5, 0.22], DL: [0.15, 0.24], DM: [0.5, 0.38],
  MR: [0.85, 0.52], MC: [0.5, 0.52], ML: [0.15, 0.52], AMR: [0.82, 0.7], AMC: [0.5, 0.7], AML: [0.18, 0.7], ST: [0.5, 0.86],
};
const PITCH = { x: 330, y: 8, w: 300, h: 428 };

function pitchSpots(): { x: number; y: number }[] {
  // Players sharing a position are spread across it.
  const out: { x: number; y: number }[] = [];
  const groups = new Map<Position, number[]>();
  plan.rows.forEach((r, i) => groups.set(r.slot, [...(groups.get(r.slot) ?? []), i]));
  for (const [slot, idx] of groups) {
    idx.forEach((i, k) => {
      const [fx, fy] = SPOT[slot];
      const spread = slot === 'GK' ? 0 : 0.22;
      const dx = idx.length > 1 ? (k - (idx.length - 1) / 2) * spread : 0;
      out[i] = { x: PITCH.x + (Math.max(0.08, Math.min(0.92, fx + dx))) * PITCH.w, y: PITCH.y + PITCH.h - fy * PITCH.h - 8 };
    });
  }
  return out;
}

function nearestSlot(x: number, y: number): Position {
  const fx = (x - PITCH.x) / PITCH.w, fy = (PITCH.y + PITCH.h - y) / PITCH.h;
  let best: Position = 'MC', d = Infinity;
  for (const [pos, [sx, sy]] of Object.entries(SPOT) as [Position, [number, number]][]) {
    const dd = (sx - fx) ** 2 + (sy - fy) ** 2;
    if (dd < d) { d = dd; best = pos; }
  }
  return best;
}

function drawTactics(s: Screen) {
  const t = plan.tactic;
  const inMatch = !!match && !match.finished;
  const { bg, fg } = teamBar(plan.team);
  s.background();
  s.titleBar(plan.team.name, bg, fg, 8, 318);
  const cyc = (labelText: string, x: number, w: number, onPrev: () => void, onNext: () => void) =>
    s.button(labelText, x, 66, w, 30, onNext, { arrows: true, onRightClick: onPrev });
  cyc(`${t.formation}\nFormation`, 10, 104, () => setFormation(cycle(FORMATION_NAMES, t.formation, -1)), () => setFormation(cycle(FORMATION_NAMES, t.formation, 1)));
  const ments = [-2, -1, 0, 1, 2] as Mentality[];
  cyc(`${MENTALITY_NAMES[t.mentality]}\nMentality`, 116, 104, () => { t.mentality = cycle(ments, t.mentality, -1); }, () => { t.mentality = cycle(ments, t.mentality, 1); });
  const passing = ['short', 'mixed', 'direct'] as const;
  cyc(`${cap(t.passing)}\nPassing`, 222, 104, () => { t.passing = cycle(passing, t.passing, -1); }, () => { t.passing = cycle(passing, t.passing, 1); });
  const press = ['low', 'mid', 'high'] as const, width = ['narrow', 'normal', 'wide'] as const;
  s.button(`${cap(t.pressing)}\nPressing`, 10, 98, 79, 30, () => { t.pressing = cycle(press, t.pressing, 1); }, { onRightClick: () => { t.pressing = cycle(press, t.pressing, -1); } });
  s.button(`${cap(t.width)}\nWidth`, 90, 98, 79, 30, () => { t.width = cycle(width, t.width, 1); }, { onRightClick: () => { t.width = cycle(width, t.width, -1); } });
  s.button(`Counter\n${t.counterAttack ? 'On' : 'Off'}`, 170, 98, 79, 30, () => { t.counterAttack = !t.counterAttack; }, { active: t.counterAttack });
  s.button(`Offside\n${t.offsideTrap ? 'Trap' : 'Off'}`, 250, 98, 76, 30, () => { t.offsideTrap = !t.offsideTrap; }, { active: t.offsideTrap });

  // The numbered team list: 1-11 on the pitch, then the substitutes.
  s.panel(10, 132, 316, 308);
  const listed: { player: Player; row?: number; bench?: string }[] = [
    ...plan.rows.map((r, i) => ({ player: r.player, row: i })),
    ...plan.bench.slice(0, BENCH_SIZE).map(p => ({ player: p, bench: p.id })),
  ];
  listed.forEach((e, i) => {
    const y = 135 + i * 14;
    const pick = e.row !== undefined ? { row: e.row } : { bench: e.bench! };
    const lit = !!picked && JSON.stringify(picked) === JSON.stringify(pick);
    s.blueBox(String(i + 1), 14, y, 26, 13, { lit, onClick: () => handlePick(pick) });
    const r = e.row !== undefined ? plan.rows[e.row] : undefined;
    const incoming = r?.replaceWith ? plan.bench.find(b => b.id === r.replaceWith) : undefined;
    const goingOn = e.bench ? plan.rows.find(x => x.replaceWith === e.bench) : undefined;
    const colour = i < 11 ? (r && !r.player.positions.includes(r.slot) ? C.gold : C.white) : '#9a9a9a';
    s.text(fit(e.player.name, 150, 'MY2'), 46, y, { font: 'MY2', colour });
    if (r) s.text(r.slot, 206, y, { font: 'MY1', colour: C.gold });
    if (inMatch && r) {
      const cond = Math.round(match!.sides[mySide].pitch.find(o => o.player.id === r.player.id)?.condition ?? 100);
      s.text(`${cond}%`, 240, y + 1, { font: 'MY1', colour: cond < 70 ? C.orange : C.cyan });
    }
    if (incoming) s.text(`off`, 290, y + 1, { font: 'MY1', colour: C.orange });
    if (goingOn) s.text(`on`, 290, y + 1, { font: 'MY1', colour: C.yellow });
    s.area(44, y, 240, 14, { onClick: () => { view = { kind: 'profile', player: e.player, team: plan.team, back: { kind: 'tactics' } }; } });
  });
  const problem = planProblem();
  const hints = problem ? [problem] : [inMatch ? 'Click a player, then a substitute, to bring him on.' : 'Click two numbers to swap players.', 'Drag on the pitch to move. Right-click for runs.'];
  hints.forEach((h, i) => s.text(h, 168, 414 + i * 12, { font: 'MY1', colour: problem ? C.orange : C.text, align: 'center' }));

  drawPitch(s);
  s.doneBar('Done', () => {
    if (planProblem()) return;
    picked = undefined;
    if (inMatch) { view = { kind: 'info', tab: 'ratings' }; } else view = { kind: 'menu' };
  }, 10, 496);
  s.bevel(508, 446, 122, 30, C.grey, C.greyLight, C.greyDark);
  s.label('Undo\nChanges', 508, 446, 122, 30, 'MY1', C.text);
  s.area(508, 446, 122, 30, { onClick: () => { if (undo) restore(undo); picked = undefined; } });
}

const cap = (w: string) => w[0].toUpperCase() + w.slice(1);

function setFormation(f: FormationName) {
  plan.tactic.formation = f;
  FORMATIONS[f].forEach((slot, i) => { if (plan.rows[i]) plan.rows[i].slot = slot; });
}

function drawPitch(s: Screen) {
  const { x, y, w, h } = PITCH;
  const g = s.ctx;
  s.rect(x - 2, y - 2, w + 4, h + 4, '#000');
  s.rect(x, y, w, h, C.pitch);
  g.strokeStyle = C.pitchLine;
  g.lineWidth = 1;
  g.setLineDash([]);
  const r = (a: number, b: number, c: number, d: number) => g.strokeRect(Math.round(a) + 0.5, Math.round(b) + 0.5, Math.round(c), Math.round(d));
  r(x + w * 0.2, y, w * 0.6, h * 0.17);
  r(x + w * 0.35, y, w * 0.3, h * 0.06);
  r(x + w * 0.2, y + h * 0.83, w * 0.6, h * 0.17 - 1);
  r(x + w * 0.35, y + h * 0.94, w * 0.3, h * 0.06 - 1);
  g.beginPath();
  g.moveTo(x, y + h / 2 + 0.5); g.lineTo(x + w, y + h / 2 + 0.5);
  g.moveTo(x + w / 2 + 50, y + h / 2); g.arc(x + w / 2, y + h / 2, 50, 0, Math.PI * 2);
  g.stroke();
  // The thirds, dashed, as on the original's pitch.
  g.setLineDash([4, 4]);
  g.beginPath();
  for (const f of [0.33, 0.67]) { g.moveTo(x, y + h * f + 0.5); g.lineTo(x + w, y + h * f + 0.5); }
  for (const f of [0.17, 0.83]) { g.moveTo(x + w * f + 0.5, y); g.lineTo(x + w * f + 0.5, y + h); }
  g.stroke();
  g.setLineDash([]);

  const spots = pitchSpots();
  plan.rows.forEach((row, i) => {
    const p = spots[i];
    // Runs: a dashed line to an x where he goes, forward or back.
    if (row.run !== 'normal' && row.slot !== 'GK') {
      const ty = p.y + (row.run === 'forward' ? -60 : 40);
      g.strokeStyle = C.yellow;
      g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(p.x + 0.5, p.y); g.lineTo(p.x + 0.5, ty); g.stroke();
      g.setLineDash([]);
      s.text('x', p.x, ty - 7, { font: 'MY1', colour: C.yellow, align: 'center' });
    }
    const lit = !!picked && 'row' in picked && picked.row === i;
    const incoming = row.replaceWith ? plan.bench.find(b => b.id === row.replaceWith) : undefined;
    const name = (incoming ?? row.player).shortName.split(' ').slice(-1)[0];
    s.text(String(i + 1), p.x, p.y - 8, { font: 'MY2', colour: lit ? C.cyan : C.yellow, align: 'center' });
    s.text(fit(name, 90, 'MY1'), p.x, p.y + 5, { font: 'MY1', colour: incoming ? C.yellow : lit ? C.cyan : C.text, align: 'center' });
    const bw = Math.max(36, textWidth(name, 'MY1') + 6);
    s.area(p.x - bw / 2, p.y - 8, bw, 26, {
      onClick: () => handlePick({ row: i }),
      onRightClick: () => { if (row.slot !== 'GK') row.run = row.run === 'normal' ? 'forward' : row.run === 'forward' ? 'hold' : 'normal'; },
      onDrop: (dx, dy) => {
        if (dx < PITCH.x || dy < PITCH.y || dy > PITCH.y + PITCH.h) return;
        row.slot = nearestSlot(dx, dy);
        picked = undefined;
      },
    });
  });
}

function planProblem(): string | undefined {
  const keepers = plan.rows.filter(r => r.slot === 'GK').length;
  if (keepers !== 1) return 'Put exactly one player in goal.';
  if (match && !match.finished) {
    const left = match.subsLeft(mySide);
    const subs = plan.rows.filter(r => r.replaceWith).length;
    if (subs > left.subs) return `Only ${left.subs} substitutes left.`;
    if (subs > 0 && !match.atHalfTime && left.windows === 0) return 'All substitution windows used.';
  }
  return undefined;
}

// ------------------------------------------------------------------ match

function drawConfirm(s: Screen) {
  const { bg, fg } = teamBar(myTeam);
  s.background();
  s.titleBar(myTeam.name, bg, fg);
  s.tag(DATE, W - 4, 0);
  s.text('Confirm Selection', W / 2, 74, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 120, 600, 300);
  const problem = planProblem();
  s.text(problem ?? 'Go ahead and play match ?', W / 2, 258, { font: 'MY4', colour: problem ? C.orange : C.white, align: 'center' });
  s.button('Yes', 10, 446, 154, 30, problem ? undefined : kickOff, { font: 'MY4' });
  s.button('No', 166, 446, 464, 30, () => { view = { kind: 'menu' }; }, { font: 'MY4' });
}

function kickOff() {
  mySide = atHome ? 0 : 1;
  const runs: Record<string, Run> = {};
  for (const r of plan.rows) runs[r.player.id] = r.run;
  const mine = {
    team: plan.team,
    lineup: { starters: plan.rows.map(r => r.player), bench: plan.bench.slice(0, BENCH_SIZE), slots: plan.rows.map(r => r.slot), runs },
    tactic: { ...plan.tactic }, ai: false,
  };
  const oppTactic: Tactic = { ...DEFAULT_TACTIC, formation: '4-2-3-1' };
  const theirs = { team: oppTeam, lineup: autoLineup(oppTeam, oppTactic.formation), tactic: oppTactic, ai: true };
  const seed = Math.floor(Math.random() * 2 ** 31);
  match = atHome ? new Match(mine, theirs, { seed }) : new Match(theirs, mine, { seed });
  queue = [];
  line = undefined;
  paused = true;
  view = { kind: 'match' };
}

function drawMatch(s: Screen) {
  const m = match!;
  s.background();
  scoreBars(s);
  const clock = matchClock();
  if (clock) s.tag(clock.replace(/^(\d+):(\d+) /, '$1:$2 '), 4, 58, 'left');
  s.tag('Premier League', W - 4, 58);
  if (m.minute > 0 && !m.atHalfTime && !m.finished) s.text(m.displayMinute.replace(/'$/, ''), W / 2, 56, { font: 'MY7', colour: C.yellow, align: 'center' });
  s.panel(20, 90, 600, 310);
  drawScorers(s, 96);
  if (m.minute > 0) s.text(`At ${m.sides[0].setup.team.stadium}`, 24, 96 + 18 * Math.max(1, scorerRows()), { font: 'MY3', colour: C.cyan });
  if (line) drawCommentary(s, line);

  // Attacking possession over the last few minutes, home blue against away red as in the original.
  s.text('Attacking Possession', W / 2, 401, { font: 'MY1', colour: C.text, align: 'center' });
  s.bevel(10, 414, 620, 30, C.grey, C.greyLight, C.greyDark);
  const [h, a] = m.sides;
  const poss = h.stats.possessionMinutes / Math.max(1, h.stats.possessionMinutes + a.stats.possessionMinutes);
  const span = 520, left = 60, split = Math.round(span * (m.minute ? poss : 0.5));
  s.rect(left, 420, split, 18, teamBar(h.setup.team).bg);
  s.rect(left + split, 420, span - split, 18, teamBar(a.setup.team).bg);

  const status = m.finished ? 'Full Time' : m.atHalfTime ? 'Half Time' : m.minute === 0 ? 'Kick Off' : `${m.half === 1 ? 'First' : 'Second'} Half From ${h.setup.team.stadium}`;
  s.doneBar(status, () => {
    if (m.finished || m.atHalfTime) { stop(); view = { kind: 'info', tab: 'ratings' }; return; }
    // Kick off, or stop the game and go to the match info screens, as Return does.
    if (paused) { paused = false; tick(); } else { pause(); view = { kind: 'info', tab: 'ratings' }; }
  });
}

function scorerRows() {
  const goals = match!.events.filter(e => e.type === 'goal');
  return Math.max(goals.filter(e => e.side === 0).length, goals.filter(e => e.side === 1).length);
}

/** Goal scorers under each team, with the minutes, as the original listed them. */
function drawScorers(s: Screen, y: number) {
  const m = match!;
  for (const side of [0, 1] as const) {
    const byName = new Map<string, string[]>();
    for (const e of m.events) {
      if (e.type !== 'goal' || e.side !== side) continue;
      const name = scorerName(e);
      byName.set(name, [...(byName.get(name) ?? []), e.clock]);
    }
    [...byName].forEach(([name, mins], i) => {
      const x = side === 0 ? 24 : 334;
      s.text(name, x, y + i * 18, { font: 'MY3', colour: C.text });
      s.text(mins.join(', '), x + 282, y + i * 18, { font: 'MY3', colour: C.yellow, align: 'right' });
    });
  }
}

function scorerName(e: MatchEvent): string {
  const m = match!;
  const squad = [...m.sides[e.side!].setup.lineup.starters, ...m.sides[e.side!].setup.lineup.bench];
  // The goal text names the scorer; pick the longest short name it contains.
  const hit = squad.filter(p => e.text.includes(p.shortName)).sort((a, b) => b.shortName.length - a.shortName.length)[0];
  return hit?.shortName ?? 'Goal';
}

function drawCommentary(s: Screen, l: NonNullable<typeof line>) {
  const m = match!;
  const goal = l.type === 'goal';
  const team = l.side !== undefined ? m.sides[l.side].setup.team : undefined;
  const colours = team ? teamBar(team) : { bg: C.grey, fg: C.white };
  // A goal flashes white with the scoring side's colour as the text.
  const bg = goal ? C.white : colours.bg, fg = goal ? colours.bg : colours.fg;
  const lines = wrap(l.text, 540);
  const h = 40 + (lines.length - 1) * 20;
  const y = 246 - h / 2;
  s.rect(38, y, 566, h, '#000');
  s.rect(40, y + 2, 562, h - 4, bg);
  s.rect(40, y + 2, 562, 1, goal ? C.white : lighten(bg));
  s.rect(40, y + h - 3, 562, 1, goal ? '#cbcbcb' : darken(bg));
  lines.forEach((t, i) => s.text(t, W / 2, y + 8 + i * 20, { font: 'MY4', colour: fg, align: 'center', shadow: !goal }));
}

function wrap(t: string, w: number): string[] {
  const words = t.split(' ');
  const out: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, 'MY4') > w) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out.slice(0, 2);
}

function stop() { window.clearTimeout(timer); }

function pause() {
  paused = true;
  stop();
  screen.render();
}

function tick() {
  const m = match;
  if (!m || paused) return;
  stop();
  if (queue.length === 0) {
    if (m.finished) { paused = true; screen.render(); return; }
    queue = m.step().filter(e => e.importance > 0 || e.type === 'build' || e.type === 'chance');
    if (queue.length === 0) { screen.render(); timer = window.setTimeout(tick, SPEEDS[speed] * 0.35); return; }
  }
  const ev = queue.shift()!;
  line = { text: ev.text, side: ev.side, type: ev.type };
  screen.render();
  if (ev.type === 'halftime' || ev.type === 'fulltime') {
    queue = [];
    paused = true;
    // The original stops on the match info screens at half and full time.
    timer = window.setTimeout(() => { view = { kind: 'info', tab: 'ratings' }; screen.render(); }, SPEEDS[speed] * 1.5);
    return;
  }
  const wait = ev.importance === 2 ? 2.4 : ev.importance === 1 ? 1.1 : 0.8;
  timer = window.setTimeout(tick, SPEEDS[speed] * wait);
}

// ------------------------------------------------------------------ match info (half and full time, paused)

function drawInfo(s: Screen, tab: InfoTab) {
  const m = match!;
  s.background();
  scoreBars(s);
  const [h, a] = m.sides;
  const when = m.finished ? 'Full Time' : m.atHalfTime ? 'Half Time' : `${m.displayMinute} mins`;
  s.tag(`Premier League From ${h.setup.team.stadium} - ${when}`, 4, 58, 'left');
  const clock = matchClock();
  if (clock) s.tag(clock, W - 4, 58);
  s.panel(20, 88, 600, 314);
  if (tab === 'ratings') drawRatings(s);
  else if (tab === 'stats') drawMatchStats(s);
  else if (tab === 'incidents') drawIncidents(s);
  else drawPlayerStats(s, tab === 'homeStats' ? 0 : 1);

  const tabs: [string, InfoTab][] = [
    [`${h.setup.team.shortName}\nPlayer Stats`, 'homeStats'], ['Match\nIncidents', 'incidents'], ['Match\nStats', 'stats'],
    ['Player\nRatings', 'ratings'], [`${a.setup.team.shortName}\nPlayer Stats`, 'awayStats'],
  ];
  tabs.forEach(([t, k], i) => s.button(t, 10 + i * 124, 414, 122, 30, () => { view = { kind: 'info', tab: k }; }, { active: k === tab }));
  const myTactics = () => { plan = planFromMatch(); undo = snapshot(); picked = undefined; view = { kind: 'tactics' }; };
  const tacticsButton = (side: 0 | 1, x: number) => s.button(`${m.sides[side].setup.team.shortName}\nTactics`, x, 446, 122, 30,
    side === mySide && !m.finished ? myTactics : undefined);
  tacticsButton(0, 10);
  tacticsButton(1, 508);
  s.doneBar('Done', () => {
    if (m.finished) { view = { kind: 'result' }; return; }
    applyPlan();
    view = { kind: 'match' };
    paused = false;
    tick();
  }, 134, 372);
}

/** Makes the changes picked on the tactics screen, all at once. */
function applyPlan() {
  const m = match!;
  if (m.finished || !plan || plan.team.id !== m.sides[mySide].setup.team.id) return;
  const s = m.sides[mySide];
  const onPitch = new Set(s.pitch.map(o => o.player.id));
  if (!plan.rows.every(r => onPitch.has(r.player.id))) return; // plan is from before kick-off
  for (const r of plan.rows) if (r.replaceWith) m.substitute(mySide, r.player.id, r.replaceWith);
  if (JSON.stringify(plan.tactic) !== JSON.stringify(s.setup.tactic)) m.setTactic(mySide, { ...plan.tactic });
  for (const r of plan.rows) {
    const id = r.replaceWith ?? r.player.id;
    m.setPosition(mySide, id, r.slot);
    m.setRun(mySide, id, r.run);
  }
  plan = planFromMatch();
}

function sideList(side: 0 | 1) {
  const s = match!.sides[side];
  const starters = s.setup.lineup.starters, bench = s.setup.lineup.bench;
  return [...starters, ...bench];
}

function drawRatings(s: Screen) {
  const m = match!;
  const motm = m.finished ? m.result().motmPlayer.id : undefined;
  for (const side of [0, 1] as const) {
    const x = side === 0 ? 22 : 330;
    const onPitch = new Set(m.sides[side].pitch.map(o => o.player.id));
    sideList(side).forEach((p, i) => {
      const y = 92 + i * 15.5;
      const st = m.playerStats.get(p.id);
      const played = !!st && st.minutes > 0;
      s.blueBox(String(i + 1), x, Math.round(y), 30, 15, { font: 'MY1' });
      const colour = p.id === motm ? C.cyan : played || onPitch.has(p.id) ? C.text : '#8a8a8a';
      s.text(fit(p.name, 160, 'MY2'), x + 40, Math.round(y), { font: 'MY2', colour });
      if (st?.yellow) s.rect(x + 34, Math.round(y) + 2, 4, 11, st.red ? '#f70000' : C.gold);
      else if (st?.red) s.rect(x + 34, Math.round(y) + 2, 4, 11, '#f70000');
      if (played) {
        s.text(String(Math.max(1, Math.min(10, Math.round(st!.rating)))), x + 252, Math.round(y), { font: 'MY2', colour: C.cyan, align: 'right' });
        if (st!.goals) s.text(String(st!.goals), x + 280, Math.round(y), { font: 'MY2', colour: C.yellow, align: 'right' });
      }
    });
  }
}

function drawMatchStats(s: Screen) {
  const [h, a] = match!.sides;
  const poss = (x: typeof h) => Math.round((100 * x.stats.possessionMinutes) / Math.max(1, h.stats.possessionMinutes + a.stats.possessionMinutes));
  const rows: [string, number | string, number | string][] = [
    ['Shots on goal', h.stats.shots, a.stats.shots],
    ['On target', h.stats.onTarget, a.stats.onTarget],
    ['Off target', h.stats.shots - h.stats.onTarget, a.stats.shots - a.stats.onTarget],
    ['Corners', h.stats.corners, a.stats.corners],
    ['Free Kicks', a.stats.fouls, h.stats.fouls],
    ['Possession', `${poss(h)}%`, `${poss(a)}%`],
    ['Bookings', h.stats.yellows, a.stats.yellows],
    ['Sendings Off', h.stats.reds, a.stats.reds],
    ['Expected Goals', h.stats.xg.toFixed(1), a.stats.xg.toFixed(1)],
  ];
  rows.forEach(([lbl, x, y], i) => {
    const top = 106 + i * 31;
    s.blueBox(String(x), 22, top, 100, 30, { font: 'MY3', colour: i >= 5 ? C.cyan : C.white });
    s.text(lbl, W / 2, top + 5, { font: 'MY4', colour: C.text, align: 'center' });
    s.blueBox(String(y), 518, top, 100, 30, { font: 'MY3', colour: i >= 5 ? C.cyan : C.white });
  });
}

function drawIncidents(s: Screen) {
  const m = match!;
  drawScorers(s, 94);
  const rows = scorerRows();
  let y = 94 + Math.max(1, rows) * 18 + 8;
  if (!m.events.some(e => ['goal', 'yellow', 'red', 'sub', 'injury', 'penalty', 'disallowed'].includes(e.type))) {
    s.text('No incidents', W / 2, 240, { font: 'MY4', colour: C.text, align: 'center' });
  }
  for (const e of m.events) {
    if (!['yellow', 'red', 'sub', 'injury', 'penalty', 'disallowed'].includes(e.type)) continue;
    if (y > 384) break;
    const x = e.side === 1 ? 334 : 24;
    s.text(`${e.clock}`, x, y, { font: 'MY1', colour: C.yellow });
    s.text(fit(e.text, 250, 'MY1'), x + 30, y, { font: 'MY1', colour: e.type === 'red' ? '#ff5050' : e.type === 'yellow' ? C.gold : C.text });
    y += 14;
  }
}

function drawPlayerStats(s: Screen, side: 0 | 1) {
  const m = match!;
  const cols: [string, (st: ReturnType<typeof m.playerStats.get> & object) => string][] = [
    ['Sh', st => String(st.shots)], ['On', st => String(st.onTarget)], ['Gls', st => String(st.goals)], ['Ast', st => String(st.assists)],
    ['Key', st => String(st.keyPasses)], ['Tck', st => String(st.tackles)], ['Sav', st => String(st.saves)], ['Min', st => String(st.minutes)],
  ];
  cols.forEach(([h], i) => s.button(h, 238 + i * 38, 92, 37, 15, undefined, { font: 'MY1', colour: C.text }));
  s.button('Con', 542, 92, 37, 15, undefined, { font: 'MY1', colour: C.text });
  s.button('Rtg', 580, 92, 36, 15, undefined, { font: 'MY1', colour: C.text });
  const pitch = m.sides[side].pitch;
  sideList(side).forEach((p, i) => {
    const y = 110 + i * 14.5;
    const st = m.playerStats.get(p.id);
    s.blueBox(String(i + 1), 24, Math.round(y), 26, 14, { font: 'MY1' });
    const played = !!st && st.minutes > 0;
    s.text(fit(p.name, 170, 'MY1'), 58, Math.round(y), { font: 'MY1', colour: played ? C.text : '#8a8a8a' });
    if (!st || !played) return;
    cols.forEach(([, f], c) => s.text(f(st), 256 + c * 38, Math.round(y), { font: 'MY1', colour: c === 2 && st.goals ? C.yellow : C.cyan, align: 'center' }));
    const cond = pitch.find(o => o.player.id === p.id)?.condition;
    if (cond !== undefined) s.text(String(Math.round(cond)), 560, Math.round(y), { font: 'MY1', colour: C.gold, align: 'center' });
    s.blueBox(String(Math.max(1, Math.min(10, Math.round(st.rating)))), 582, Math.round(y), 32, 14, { font: 'MY1' });
  });
}

function drawResult(s: Screen) {
  const m = match!;
  const r = m.result();
  s.background();
  s.titleBar('Premier League', C.boxBlue, C.yellow);
  s.tag(DATE, W - 4, 0);
  s.text('Result', W / 2, 74, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 120, 600, 300);
  s.text(r.home.name, 256, 134, { font: 'MY4', colour: r.home.id === myTeam.id ? C.yellow : C.text, align: 'right' });
  s.text(`${r.homeGoals} : ${r.awayGoals}`, W / 2, 134, { font: 'MY4', colour: C.cyan, align: 'center' });
  s.text(r.away.name, 384, 134, { font: 'MY4', colour: r.away.id === myTeam.id ? C.yellow : C.text });
  s.text(`Man of the match: ${r.motmPlayer.name} (${r.manOfTheMatch.rating.toFixed(1)})`, W / 2, 180, { font: 'MY3', colour: C.cyan, align: 'center' });
  s.button('Match\nInfo', 10, 446, 122, 30, () => { view = { kind: 'info', tab: 'ratings' }; });
  s.doneBar('Done', () => { match = undefined; plan = newPlan(myTeam, plan.tactic); view = { kind: 'menu' }; }, 134, 372);
  s.button('Play\nAgain', 508, 446, 122, 30, () => { plan = newPlan(myTeam, plan.tactic); match = undefined; view = { kind: 'confirm' }; });
}

// ------------------------------------------------------------------ boot

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const backdrop: { image: HTMLImageElement | undefined } = { image: undefined };
const screen = new Screen(canvas, backdrop);

const photo = window.CM_ASSETS?.backdrops.BOBBY;
if (photo) {
  const img = new Image();
  img.onload = () => { backdrop.image = img; screen.render(); };
  img.src = photo;
}

screen.draw = s => {
  switch (view.kind) {
    case 'pickTeam': return drawPickTeam(s, view);
    case 'menu': return drawMenu(s);
    case 'squad': return drawSquad(s, view.team);
    case 'profile': return drawProfile(s, view);
    case 'tactics': return drawTactics(s);
    case 'confirm': return drawConfirm(s);
    case 'match': return drawMatch(s);
    case 'info': return drawInfo(s, view.tab);
    case 'result': return drawResult(s);
  }
};

// Space switches between normal and fast; Return pauses and continues.
document.addEventListener('keydown', e => {
  if (view.kind !== 'match' || !match || match.finished) return;
  if (e.key === ' ') {
    e.preventDefault();
    speed = speed === 'fast' ? 'normal' : 'fast';
    if (!paused) tick();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (match.atHalfTime) return;
    if (paused) { paused = false; tick(); } else { pause(); view = { kind: 'info', tab: 'ratings' }; }
  }
  screen.render();
});

plan = newPlan(myTeam, DEFAULT_TACTIC);
screen.render();
