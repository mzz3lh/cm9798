// Match day, drawn as CM 97/98 drew it: the squad and tactics screens, the
// match with its one-line commentary bar, and the match info screens. Return
// pauses, space cycles slow, normal and fast, and half time stops on the
// match info screens, where the tactics screen makes substitutions. The
// human's team sheet is kept between matches in the save.

import { dayMonth, longDate, shortDate } from '../engine/calendar';
import { money } from '../engine/economy';
import { FORMATIONS, familiarity } from '../engine/formations';
import { autoLineup, defaultTakers } from '../engine/lineup';
import type { Match } from '../engine/match';
import { aiSide, createMatch, fitnessOf, recordMatch, scoreLine, unavailableIds } from '../engine/season';
import { askingPrice, openTalks, startRenewal, toggleListed } from '../engine/transfers';
import {
  MENTALITY_NAMES,
  type FormationName, type MatchEvent, type Mentality, type Player, type Position, type Run,
  type PlayerMatchStats, type Tactic, type Takers, type Team, type TeamMatchStats,
} from '../engine/types';
import { COMP_NAMES, playerById, valueOf, type Fixture, type GameState } from '../engine/world';
import { cap, dateTag, listName, positionCode, sortSquad, statusTag, tagBox, teamBar as clubBar } from './common';
import { autosaveNow } from './flow';
import { fit, textWidth } from './retro/fonts';
import { C, W, darken, lighten, type Screen } from './retro/screen';
import { game, go, ui, type InfoTab, type ProfileTab, type SquadMode, type View } from './state';

// ------------------------------------------------------------------ state

const BENCH_SIZE = 9;
const SPEEDS = { slow: 1300, normal: 825, fast: 350 };
const SPEED_ORDER = ['slow', 'normal', 'fast'] as const;
const nextSpeed = () => SPEED_ORDER[(SPEED_ORDER.indexOf(speed) + 1) % SPEED_ORDER.length];

/** Where a player stands on the tactics pitch, and the spot he runs to, if any. */
interface Place { spot: Spot; runTo?: Spot }

/** The team sheet: who wears 1-11 and where they play, then the substitutes. */
interface Plan {
  team: Team;
  tactic: Tactic;
  /** Starters by shirt number, each with his place; `sub` is a substitute lined up to replace him. */
  rows: (Place & { player: Player; sub?: Place & { id: string } })[];
  /** Substitutes first (the first BENCH_SIZE), then reserves. */
  bench: Player[];
  takers: Takers;
}

const ROLES: { key: keyof Takers; tag: string; name: string }[] = [
  { key: 'captain', tag: 'cpt', name: 'Captain' }, { key: 'corners', tag: 'cnr', name: 'Corners' },
  { key: 'freeKicks', tag: 'dfk', name: 'Direct Free Kicks' }, { key: 'penalties', tag: 'pen', name: 'Penalties' },
];

/** Hands a departing player's captaincy and set pieces to the man replacing him. */
function passTakers(takers: Takers, from: string, to: string) {
  for (const r of ROLES) if (takers[r.key] === from) takers[r.key] = to;
}

/** What the score bars and match info screens read: a live match, or a played one's report. */
export interface MatchView {
  sides: readonly {
    setup: { team: Team; lineup: { starters: Player[]; bench: Player[] } };
    stats: TeamMatchStats;
    pitch: readonly { player: Player; condition: number }[];
  }[];
  events: readonly ViewEvent[];
  playerStats: ReadonlyMap<string, PlayerMatchStats>;
  finished: boolean;
  atHalfTime: boolean;
  result(): { motmPlayer?: Player };
}
type ViewEvent = Pick<MatchEvent, 'clock' | 'type' | 'side' | 'text'>;

const mv = (): MatchView => report ?? match!;

/** The events shown so far, and the goals in them. */
function eventsSoFar(m: MatchView): readonly ViewEvent[] {
  return m === match && shown ? m.events.slice(0, shown.events) : m.events;
}
function goalsSoFar(m: MatchView, side: 0 | 1): number {
  return m === match && shown ? eventsSoFar(m).filter(e => e.type === 'goal' && e.side === side).length : m.sides[side].stats.goals;
}

let plan: Plan;
let undo: string | undefined;
let match: Match | undefined;
let fixture: Fixture | undefined;
let recorded = false;
let mySide: 0 | 1 = 0;
let speed: keyof typeof SPEEDS = 'normal';
let paused = false;
let timer: number | undefined;
let queue: { ev: MatchEvent; index: number }[] = [];
/**
 * How far the watched match has got on screen: the clock stands still while a
 * move's lines are shown, as in the original, and goals count once shown.
 * Undefined when everything so far is shown (paused, half time, full time).
 */
let shown: { clock: string; events: number } | undefined;
/** A finished match opened from a results list, drawn in place of the live one. */
let report: MatchView | undefined;
/** The commentary line on screen, and whose colour it takes. */
let line: { text: string; side?: 0 | 1; type?: string } | undefined;
/** A player picked for a swap: a starter's row or a bench player. */
let picked: { row: number } | { bench: string } | undefined;
/** The starter whose captain and set-piece menu is open on the tactics screen. */
let roleMenu: { row: number } | undefined;
/** Places on the tactics pitch kept through a match, by player id. */
let layout = new Map<string, Place>();

const myTeam = () => game().teams[game().humanClubId];
const oppTeam = () => {
  const g = game();
  return fixture ? g.teams[fixture.home === g.humanClubId ? fixture.away : fixture.home] : undefined;
};
const atHome = () => !fixture || fixture.home === game().humanClubId;

/** Club colours, allowing for a clash with the home side in a match. */
const teamBar = (t: Team) => clubBar(t, match?.sides[0].setup.team ?? (fixture ? game().teams[fixture.home] : undefined));

export function currentMatch(): Match | undefined {
  return match;
}

/** Forgets the team sheet and any match, for a game just loaded. */
export function resetMatchday() {
  stop();
  plan = undefined as unknown as Plan;
  match = undefined;
  fixture = undefined;
  shown = undefined;
  layout = new Map();
}

function newPlan(team: Team, tactic: Tactic, out: Set<string>): Plan {
  const lu = autoLineup(team, tactic.formation, out);
  // As in the original, each player starts where his profile says he plays.
  const spots = spotsFor(lu.starters.map(p => p.positions[0]), new Set());
  return {
    team, tactic: { ...tactic },
    rows: lu.starters.map((player, i) => ({ player, spot: spots[i] })),
    bench: [...lu.bench, ...team.squad.filter(p => !lu.starters.includes(p) && !lu.bench.includes(p))],
    takers: defaultTakers(lu.starters),
  };
}

/**
 * The human's team sheet, rebuilt from the save: anyone sold, injured or
 * banned since gives way to the best fit available, who takes his spot.
 */
export function ensurePlan(): Plan {
  const g = game();
  const team = myTeam();
  const out = unavailableIds(g, team, false);
  const sheet = g.sheet;
  if (!sheet) { plan = newPlan(team, g.clubs[team.id].tactic, out); return plan; }
  const byId = new Map(team.squad.map(p => [p.id, p]));
  const used = new Set<string>();
  const rows: Plan['rows'] = [];
  for (const r of sheet.rows) {
    let p = byId.get(r.id);
    if (!p || out.has(p.id)) {
      const slot = positionOf(r.spot);
      p = team.squad.filter(x => !out.has(x.id) && !used.has(x.id) && !sheet.rows.some(y => y.id === x.id && y !== r && byId.has(y.id) && !out.has(y.id)))
        .sort((a, b) => b.ability * familiarity(b.positions, slot) - a.ability * familiarity(a.positions, slot))[0];
    }
    if (!p) continue;
    used.add(p.id);
    rows.push({ player: p, spot: r.spot, runTo: r.runTo });
  }
  const benchFirst = sheet.bench.map(id => byId.get(id)).filter((p): p is Player => !!p && !used.has(p.id) && !out.has(p.id));
  const rest = sortSquad(team.squad.filter(p => !used.has(p.id) && !benchFirst.includes(p) && !out.has(p.id)))
    .sort((a, b) => b.ability - a.ability);
  const keeperOnBench = [...benchFirst, ...rest].slice(0, BENCH_SIZE).some(p => p.positions[0] === 'GK');
  const spareKeeper = !keeperOnBench ? rest.find(p => p.positions[0] === 'GK') : undefined;
  const bench = [...benchFirst, ...(spareKeeper ? [spareKeeper] : []), ...rest.filter(p => p !== spareKeeper)];
  const unavailable = team.squad.filter(p => out.has(p.id));
  const takers = { ...sheet.takers };
  for (const r of ROLES) if (!rows.some(x => x.player.id === takers[r.key])) takers[r.key] = defaultTakers(rows.map(x => x.player))[r.key];
  plan = { team, tactic: { ...sheet.tactic }, rows, bench: [...bench, ...unavailable], takers };
  return plan;
}

/** Keeps the team sheet in the save. */
function saveSheet() {
  if (!plan || plan.team.id !== game().humanClubId) return;
  game().sheet = {
    tactic: { ...plan.tactic },
    rows: plan.rows.map(r => ({ id: r.player.id, spot: r.spot, runTo: r.runTo })),
    bench: plan.bench.slice(0, BENCH_SIZE).map(p => p.id),
    takers: { ...plan.takers },
  };
}

function planFromMatch(side: 0 | 1 = mySide): Plan {
  const s = match!.sides[side];
  const kept = s.pitch.map(o => {
    const l = side === mySide ? layout.get(o.player.id) : undefined;
    return l && positionOf(l.spot) === o.slot ? l : undefined;
  });
  const taken = new Set(kept.filter(Boolean).map(l => l!.spot));
  const fresh = spotsFor(s.pitch.filter((_, i) => !kept[i]).map(o => o.slot), taken);
  let k = 0;
  return {
    team: s.setup.team, tactic: { ...s.setup.tactic },
    rows: s.pitch.map((o, i) => ({ player: o.player, ...(kept[i] ?? { spot: fresh[k++] }) })),
    bench: [...s.bench],
    takers: { ...s.setup.lineup.takers },
  };
}

/** The opposition's likely team sheet, for the read-only tactics screen before a match. */
function opponentPlan(): Plan | undefined {
  const opp = oppTeam();
  if (!opp) return undefined;
  if (match) return planFromMatch(mySide === 0 ? 1 : 0);
  const side = aiSide(game(), opp.id);
  const spots = spotsFor(FORMATIONS[side.tactic.formation], new Set());
  return {
    team: opp, tactic: side.tactic, rows: side.lineup.starters.map((player, i) => ({ player, spot: spots[i] })),
    bench: side.lineup.bench, takers: side.lineup.takers ?? {},
  };
}

/** The place a row shows on the pitch: the incoming substitute's if one is lined up. */
const placeOf = (r: Plan['rows'][number]): Place => r.sub ?? r;
const shownPlayer = (r: Plan['rows'][number]): Player => (r.sub ? plan.bench.find(b => b.id === r.sub!.id) : undefined) ?? r.player;

const snapshot = () => JSON.stringify({ t: plan.tactic, r: plan.rows.map(r => ({ ...r, player: r.player.id })), b: plan.bench.map(p => p.id), k: plan.takers });
function restore(json: string) {
  const byId = (id: string) => plan.team.squad.find(p => p.id === id)!;
  const s = JSON.parse(json);
  plan.tactic = s.t;
  plan.rows = s.r.map((r: Place & { player: string; sub?: Place & { id: string } }) => ({ ...r, player: byId(r.player) }));
  plan.bench = s.b.map(byId);
  plan.takers = s.k;
}

export function openTactics(back: View) {
  ensurePlanIfNeeded();
  undo = snapshot();
  picked = undefined;
  go({ kind: 'tactics', back });
}

function ensurePlanIfNeeded() {
  if (!plan || plan.team.id !== game().humanClubId || !match) ensurePlan();
}

// ------------------------------------------------------------------ shared pieces

function scoreBars(s: Screen) {
  const [h, a] = mv().sides;
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
  bar(h.setup.team, goalsSoFar(mv(), 0), 0);
  bar(a.setup.team, goalsSoFar(mv(), 1), 320);
  dateTag(s);
}

function matchClock(): string {
  const m = mv();
  return m.finished ? `${m.sides[0].stats.goals}:${m.sides[1].stats.goals} FT` : m.atHalfTime ? `${m.sides[0].stats.goals}:${m.sides[1].stats.goals} HT` : '';
}

const compName = () => (fixture ? COMP_NAMES[fixture.comp] : 'Friendly');

// ------------------------------------------------------------------ match day

/** The game has stopped for one of the human's matches. */
export function startMatchday(fx: Fixture) {
  fixture = fx;
  match = undefined;
  recorded = false;
  picked = undefined;
  ensurePlan();
  go({ kind: 'matchday' });
}

export function drawMatchday(s: Screen) {
  const g = game();
  const opp = oppTeam()!;
  const fx = fixture!;
  s.background();
  s.titleBar(longDate(g.date));
  dateTag(s);
  const home = g.teams[fx.home], away = g.teams[fx.away];
  s.text(`${home.name} v ${away.name}`, W / 2, 70, { font: 'MY6', colour: C.white, align: 'center' });
  const where = fx.neutral ? 'Wembley Stadium' : home.stadium;
  s.text(`${compName()}${fx.comp === 'PL' ? '' : ` ${fx.round}${fx.leg ? ` (leg ${fx.leg})` : ''}`}, at ${where}`, W / 2, 104, { font: 'MY3', colour: C.cyan, align: 'center' });
  const problem = planProblem();
  s.tile('Play\nMatch', 54, 150, 130, 108, () => { saveSheet(); go({ kind: 'confirm' }); });
  s.tile('Squad\nDetails', 188, 150, 130, 108, () => go({ kind: 'squad', teamId: g.humanClubId, mode: 'positions', back: { kind: 'matchday' } }));
  s.tile('Match\nTactics', 322, 150, 130, 108, () => openTactics({ kind: 'matchday' }));
  s.tile('Opposition\nSquad', 456, 150, 130, 108, () => go({ kind: 'squad', teamId: opp.id, mode: 'positions', back: { kind: 'matchday' } }));
  s.tile('Opposition\nTactics', 188, 264, 130, 108, () => { picked = undefined; go({ kind: 'tactics', theirs: true, back: { kind: 'matchday' } }); });
  s.tile(`Speed:\n${cap(speed)}`, 322, 264, 130, 108, () => { speed = nextSpeed(); });
  if (problem) s.text(problem, W / 2, 392, { font: 'MY3', colour: C.orange, align: 'center' });
  s.doneBar('Please Select');
}

// ------------------------------------------------------------------ squad

export function drawSquad(s: Screen, v: Extract<View, { kind: 'squad' }>) {
  const g = game();
  const team = g.teams[v.teamId];
  const mine = team.id === g.humanClubId && !match;
  if (mine && (!plan || plan.team.id !== team.id)) ensurePlan();
  const { bg, fg } = teamBar(team);
  s.background();
  s.titleBar(`${team.name} Squad`, bg, fg);
  dateTag(s);
  const modes: SquadMode[] = ['positions', 'stats', 'contracts', 'fitness'];
  const modeName: Record<SquadMode, string> = { positions: 'Playing\nPositions', stats: 'Season\nStats', contracts: 'Contracts\n& Values', fitness: 'Fitness &\nAvailability' };
  s.button(modeName[v.mode], 10, 66, 153, 30, undefined, { arrows: true, active: true });
  s.area(10, 66, 76, 30, { onClick: () => { v.mode = modes[(modes.indexOf(v.mode) + modes.length - 1) % modes.length]; } });
  s.area(86, 66, 77, 30, { onClick: () => { v.mode = modes[(modes.indexOf(v.mode) + 1) % modes.length]; } });
  const next = g.fixtures.find(f => !f.result && (f.home === team.id || f.away === team.id));
  const oppId = next && (next.home === team.id ? next.away : next.home);
  s.button('Match\nTactics', 165, 66, 153, 30, mine ? () => openTactics(v) : undefined);
  s.button('Opposition\nSquad', 320, 66, 153, 30, oppId && team.id === g.humanClubId ? () => go({ kind: 'squad', teamId: oppId, mode: v.mode, back: v }) : undefined);
  s.button(g.clubs[team.id].division === 'PL' ? 'Premier\nLeague' : 'Club\nFixtures', 475, 66, 155, 30, () =>
    go(g.clubs[team.id].division === 'PL' ? { kind: 'table', back: v } : { kind: 'fixtures', clubId: team.id, page: 0, back: v }));

  // Who wears which number: 1-11 the team, 12-20 the substitutes.
  const numberOf = new Map<string, number>();
  if (mine) {
    plan.rows.forEach((r, i) => numberOf.set(r.player.id, i + 1));
    plan.bench.slice(0, BENCH_SIZE).forEach((p, i) => numberOf.set(p.id, 12 + i));
  } else {
    const side = team.id === g.humanClubId && match ? undefined : aiSide(g, team.id);
    side?.lineup.starters.forEach((p, i) => numberOf.set(p.id, i + 1));
    side?.lineup.bench.forEach((p, i) => numberOf.set(p.id, 12 + i));
  }
  s.panel(10, 100, 620, 312);
  const players = sortSquad(team.squad);
  // Top to bottom, then the second column, split evenly between the two as the original did.
  const shown = players.slice(0, 32), perColumn = Math.max(1, Math.ceil(shown.length / 2));
  const rowH = perColumn > 16 ? 18 : 19;
  if (v.mode !== 'positions') {
    const heads = v.mode === 'stats' ? ['Apps', 'Gls', 'Ast', 'AvR'] : v.mode === 'contracts' ? ['Wage', 'Ends', 'Value'] : ['Cond', 'Status'];
    for (const col of [0, 1]) heads.forEach((h, i) => s.text(h, 12 + col * 310 + 192 + i * (v.mode === 'stats' ? 26 : v.mode === 'contracts' ? 36 : 48), 101, { font: 'MY1', colour: C.text }));
  }
  shown.forEach((p, i) => {
    const col = i < perColumn ? 0 : 1;
    const x = 12 + col * 310, y = 104 + (i % perColumn) * rowH + (v.mode === 'positions' ? 0 : 8);
    const n = numberOf.get(p.id);
    const isPicked = picked && (('row' in picked && plan.rows[picked.row]?.player.id === p.id) || ('bench' in picked && picked.bench === p.id));
    s.blueBox(n ? String(n) : '-', x, y, 30, rowH - 1, {
      lit: !!isPicked,
      onClick: mine ? () => pickByPlayer(p) : undefined,
    });
    const tag = statusTag(g, p);
    if (tag && team.id === g.humanClubId) tagBox(s, tag.text, x + 32, y + 1, tag.colour);
    const nameX = x + 60;
    const st = g.players[p.id];
    s.text(fit(listName(p), v.mode === 'positions' ? 148 : 128, 'MY3'), nameX, y, { font: 'MY3', colour: n && n <= 11 ? C.white : C.text });
    s.area(nameX, y, 140, rowH, { onClick: () => openProfile(p, team, v) });
    const dx = x + 192;
    if (v.mode === 'positions') {
      s.text(positionCode(p), x + 214, y + 3, { font: 'MY2', colour: C.gold });
    } else if (v.mode === 'stats') {
      const all = [st.stats.PL, st.stats.LC, st.stats.FAC];
      const apps = all.reduce((a, x) => a + x.apps + x.subs, 0);
      const rat = all.reduce((a, x) => a + x.ratings, 0);
      [String(apps), String(all.reduce((a, x) => a + x.goals, 0)), String(all.reduce((a, x) => a + x.assists, 0)), apps ? (rat / apps).toFixed(1) : '-']
        .forEach((t, k) => s.text(t, dx + k * 26 + 8, y + 3, { font: 'MY2', colour: C.cyan, align: 'center' }));
    } else if (v.mode === 'contracts') {
      s.text(money(st.contract.wage), dx, y + 3, { font: 'MY1', colour: C.cyan });
      s.text(`'${String(st.contract.expires).slice(2)}`, dx + 40, y + 3, { font: 'MY1', colour: st.contract.expires <= g.seasonYear + 1 ? C.orange : C.cyan });
      s.text(money(valueOf(g, p)), dx + 64, y + 3, { font: 'MY1', colour: C.gold });
    } else {
      s.text(`${Math.round(st.condition)}%`, dx, y + 3, { font: 'MY2', colour: st.condition < 80 ? C.orange : C.cyan });
      const status = st.injury ? `Injured to ${dayMonth(st.injury.until)}` : st.banned ? `Banned ${st.banned}` : 'Fit';
      s.text(fit(status, 76, 'MY1'), dx + 36, y + 4, { font: 'MY1', colour: st.injury || st.banned ? C.orange : C.text });
    }
  });
  const back = v.back;
  const btn = (label: string, i: number, fn?: () => void) => s.button(label, 10 + i * 155, 414, 153, 30, fn);
  btn('Fixtures\n& Results', 0, () => go({ kind: 'fixtures', clubId: team.id, page: 0, back: v }));
  btn('View\nTables', 1, () => go({ kind: 'table', back: v }));
  btn('Transfer\nIns/Outs', 2, () => go({ kind: 'transfersList', page: 0, back: v }));
  btn(mine ? 'Click a number,\nthen another, to swap' : '', 3);
  s.doneBar('Done', () => { picked = undefined; if (mine) saveSheet(); go(back); });
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
  const inMatch = ui.view.kind === 'tactics' && match && !match.finished;
  if ('row' in first && 'row' in p) {
    // Two players swap shirt numbers; each keeps his own place on the pitch.
    [plan.rows[first.row], plan.rows[p.row]] = [plan.rows[p.row], plan.rows[first.row]];
  } else if ('bench' in first && 'bench' in p) {
    if (inMatch) { picked = p; return; }
    const i = plan.bench.findIndex(x => x.id === first.bench), j = plan.bench.findIndex(x => x.id === p.bench);
    [plan.bench[i], plan.bench[j]] = [plan.bench[j], plan.bench[i]];
  } else {
    const row = plan.rows['row' in first ? first.row : (p as { row: number }).row];
    const benchId = 'bench' in first ? first.bench : (p as { bench: string }).bench;
    const incoming = plan.bench.find(x => x.id === benchId)!;
    if (inMatch) {
      // In a match this lines up a substitution, made on resume; again to cancel.
      // A substitute goes man-for-man: he takes the place and runs of the player he replaces.
      if (row.sub?.id === benchId) row.sub = undefined;
      else {
        for (const r of plan.rows) if (r.sub?.id === benchId) r.sub = undefined;
        row.sub = { id: benchId, spot: row.spot, runTo: row.runTo };
      }
    } else {
      // Before the match too, the player brought in takes the other's place and runs.
      const i = plan.bench.indexOf(incoming);
      plan.bench[i] = row.player;
      passTakers(plan.takers, row.player.id, incoming.id);
      row.player = incoming;
    }
  }
}

// ------------------------------------------------------------------ profile

/** A player's profile line, e.g. "Defender/Midfielder (Left)", as the original wrote it. */
function positionWords(p: Player): string {
  const LINE: Record<Position, string> = {
    GK: 'Goalkeeper', DL: 'Defender', DC: 'Defender', DR: 'Defender', DM: 'Defensive Midfielder',
    ML: 'Midfielder', MC: 'Midfielder', MR: 'Midfielder', AML: 'Attacking Midfielder', AMC: 'Attacking Midfielder',
    AMR: 'Attacking Midfielder', ST: 'Striker',
  };
  const lines = [...new Set(p.positions.map(x => LINE[x]))];
  if (lines[0] === 'Goalkeeper') return 'Goalkeeper';
  const order = ['R', 'L', 'C'];
  const sides = [...new Set(p.positions.filter(x => x !== 'DM' && x !== 'ST').map(x => x.slice(-1)))]
    .sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const SIDE: Record<string, string> = { R: 'Right', L: 'Left', C: 'Centre' };
  return sides.length ? `${lines.join('/')} (${sides.map(x => SIDE[x]).join('/')})` : lines.join('/');
}

type ProfileRow = [label: string, value: string | undefined];

/** The two columns of the Playing Skills page, in the original's order. */
function skillRows(p: Player): [ProfileRow[], ProfileRow[]] {
  const a = p.attributes;
  const n = (v: number) => String(Math.max(1, Math.min(20, Math.round(v))));
  if (p.positions[0] === 'GK') {
    return [[
      ['Adaptability', n(a.adaptability)], ['Aerial ability', n(a.heading)], ['Aggression', n(a.aggression)],
      ['Determination', n(a.determination)], ['Influence', n(a.influence)], ['Injury proneness', n(a.injuryProneness)],
      ['Passing', n(a.passing)], ['Positioning', n(a.positioning)], ['Rushing Out', n(p.tendencies.comesOffLine)],
      ['Shot stopping', n(a.handling)], ['Stamina', n(a.stamina)],
    ], [
      ['Strength', n(a.strength)], ['Technique', n(a.technique)], ['Creativity', undefined], ['Dribbling', undefined],
      ['Flair', undefined], ['Off the ball', undefined], ['Set pieces', undefined], ['Shooting', undefined],
    ]];
  }
  return [[
    ['Adaptability', n(a.adaptability)], ['Aggression', n(a.aggression)], ['Creativity', n(a.creativity)],
    ['Determination', n(a.determination)], ['Dribbling', n(a.dribbling)], ['Flair', n(a.flair)], ['Heading', n(a.heading)],
    ['Influence', n(a.influence)], ['Injury proneness', n(a.injuryProneness)], ['Off the ball', n(a.offTheBall)], ['Pace', n(a.pace)],
  ], [
    ['Passing', n(a.passing)], ['Positioning', n(a.positioning)], ['Set pieces', n(a.setPieces)], ['Shooting', n(a.shooting)],
    ['Stamina', n(a.stamina)], ['Strength', n(a.strength)], ['Tackling', n(a.tackling)], ['Technique', n(a.technique)],
  ]];
}

/** What the match knows about a player right now: which side, condition, form and his stats. */
function inMatch(p: Player) {
  const m = match;
  if (!m) return undefined;
  const side = ([0, 1] as const).find(i => m.sides[i].setup.team.squad.some(x => x.id === p.id));
  if (side === undefined) return undefined;
  const s = m.sides[side];
  return { side, on: s.pitch.find(o => o.player.id === p.id), stats: m.playerStats.get(p.id), goalDiff: s.stats.goals - m.sides[1 - side].stats.goals };
}

function moraleWord(m: number) {
  return m >= 16 ? 'Superb' : m >= 13 ? 'Good' : m >= 8 ? 'Ok' : m >= 5 ? 'Poor' : 'Very Poor';
}

export function drawProfile(s: Screen, v: Extract<View, { kind: 'profile' }>) {
  const { player: p, team } = v;
  const g = game();
  const st = g.players[p.id];
  const { bg, fg } = teamBar(team);
  s.background();
  s.titleBar(fit(`${p.name} (${team.shortName})`, 600, 'MY7'), bg, fg);
  dateTag(s);
  const tabs: [string, ProfileTab | undefined][] = [
    ['Playing\nSkills', 'skills'], ['Condition &\nAvailability', 'condition'], ['Contract\nInfo', 'contract'],
    ['Transfer\nInfo', 'transfer'], ['Career\nHistory', undefined],
  ];
  tabs.forEach(([t, k], i) => s.button(t, 10 + i * 124, 66, 122, 30, k ? () => { v.tab = k; v.message = undefined; } : undefined, { active: k === v.tab }));
  s.rect(10, 100, 620, 30, '#000');
  s.rect(11, 101, 618, 28, C.boxBlue);
  s.rect(11, 101, 618, 1, C.boxBlueLight);
  s.text(positionWords(p), W / 2, 104, { font: 'MY3', colour: C.white, align: 'center' });
  s.panel(20, 134, 600, 306);
  s.text(`Aged ${p.age}. ${p.nation}.`, W / 2, 140, { font: 'MY4', colour: C.cyan, align: 'center' });

  const now = inMatch(p);
  const condition = Math.round(now?.on?.condition ?? st?.condition ?? 100);
  const rowLine = (x: number, y: number, w: number) => s.rect(x, y + 15, w, 1, 'rgba(150,150,150,0.25)');
  const rows = (list: [string, string][]) => list.forEach(([label, value], i) => {
    const y = 170 + i * 17;
    s.text(label, 26, y, { font: 'MY2', colour: C.text });
    s.text(value, 254, y, { font: 'MY2', colour: value === '-' ? C.text : C.yellow });
    rowLine(22, y, 596);
  });
  const mine = st?.clubId === g.humanClubId;
  if (v.tab === 'skills') {
    const form = now?.on ? (now.on.form >= 1.08 ? 'Very Good' : now.on.form >= 1.03 ? 'Good' : now.on.form >= 0.97 ? 'Ok' : now.on.form >= 0.92 ? 'Poor' : 'Very Poor') : 'Ok';
    const [left, right] = skillRows(p);
    const cols: [ProfileRow[], number][] = [[left, 26], [[...right, ['Current Form', form], ['Morale', moraleWord(st?.morale ?? 10)]], 328]];
    for (const [list, x] of cols) {
      list.forEach(([label, value], i) => {
        const y = 170 + i * 17;
        const word = value !== undefined && isNaN(Number(value));
        s.text(label, x, y, { font: 'MY2', colour: value === undefined ? '#8a8a8a' : C.text });
        s.text(value ?? '-', word ? x + 238 : x + 264, y, { font: 'MY2', colour: value === undefined ? C.gold : C.yellow, align: word ? 'center' : 'right' });
        rowLine(x - 4, y, 290);
      });
    }
    s.text(`Physical condition ${condition}%`, 470, 170 + 10 * 17, { font: 'MY2', colour: C.yellow, align: 'center' });
  } else if (v.tab === 'condition') {
    rows([
      ['Injuries', st?.injury ? st.injury.name : now?.stats?.injured ? 'Injured' : 'None'],
      ['Period out', st?.injury ? `Until ${shortDate(st.injury.until)}` : '-'],
      ['Physical condition', `${condition}%`],
      ['Domestic bans', st?.banned ? `${st.banned} match${st.banned > 1 ? 'es' : ''}` : '-'],
      ['League bookings', st ? String(st.leagueYellows) : '-'],
      ['Morale', moraleWord(st?.morale ?? 10)],
    ]);
  } else if (v.tab === 'contract' && st) {
    rows([
      ['Club', team.name], ['Wage', `${money(st.contract.wage)} a week`], ['Contract ends', `30.6.${st.contract.expires}`],
      ['Transfer status', st.listed ? 'Transfer listed' : 'Not for sale'],
    ]);
    if (mine) {
      s.button('Offer New\nContract', 26, 250, 140, 30, () => {
        const t = startRenewal(g, p.id);
        if (typeof t === 'string') v.message = t;
        else go({ kind: 'terms', talksId: t.id, wage: t.demand!.wage, years: t.demand!.years, back: v });
      });
    }
  } else if (st) {
    const value = valueOf(g, p);
    const talks = openTalks(g, p.id);
    rows([
      ['Value', money(value)],
      ['Asking price', mine ? (st.listed ? 'Listed: offers invited' : 'Not for sale') : money(askingPrice(g, p, g.humanClubId))],
      ['Transfer status', st.listed ? 'Transfer listed' : 'Not listed'],
      ['Talks', talks ? talksLine(g, talks.stage) : '-'],
    ]);
    if (mine) {
      s.button(st.listed ? 'Take Off\nTransfer List' : 'Put On\nTransfer List', 26, 250, 140, 30, () => toggleListed(g, p.id));
    } else {
      s.button('Make\nOffer', 26, 250, 140, 30, () => go({ kind: 'bid', playerId: p.id, fee: talks?.fee ?? askingPrice(g, p, g.humanClubId), back: v }));
      if (talks?.stage === 'terms' && talks.to === g.humanClubId) {
        s.button('Discuss\nTerms', 170, 250, 140, 30, () => go({ kind: 'terms', talksId: talks.id, wage: talks.demand!.wage, years: talks.demand!.years, back: v }));
      }
    }
  }
  if (v.message) s.text(v.message, W / 2, 290, { font: 'MY3', colour: C.orange, align: 'center' });
  drawSeasonStats(s, p, now);
  s.doneBar('Done', () => go(v.back));
}

function talksLine(g: GameState, stage: string) {
  return ({ bid: 'Offer made', countered: 'Asking for more', terms: 'Discussing terms' } as Record<string, string>)[stage] ?? '-';
}

/** "Stats this season": league, cups, and the live match counted in. */
function drawSeasonStats(s: Screen, p: Player, now: ReturnType<typeof inMatch>) {
  const heads = ['Apps', 'Goals', 'Assts', 'MoM', 'Yel', 'Red', 'Sub', 'AvR'];
  s.text('Stats this season', 26, 364, { font: 'MY2', colour: C.text });
  heads.forEach((h, i) => s.button(h, 302 + i * 40, 362, 39, 17, undefined, { font: 'MY1', colour: C.text }));
  const st = game().players[p.id];
  const rowsOf = (keys: ('PL' | 'LC' | 'FAC')[]) => {
    const x = keys.map(k => st?.stats[k]).filter(Boolean);
    const sum = (f: (z: (typeof x)[number]) => number) => x.reduce((a, z) => a + f(z!), 0);
    const apps = sum(z => z!.apps), subs = sum(z => z!.subs);
    return { vals: [apps, sum(z => z!.goals), sum(z => z!.assists), sum(z => z!.motm), sum(z => z!.yellows), sum(z => z!.reds), subs].map(String), avr: apps + subs ? sum(z => z!.ratings) / (apps + subs) : undefined };
  };
  const live = now?.stats && now.stats.minutes > 0 && !recorded ? ` (+${now.stats.goals} today)` : '';
  ([['League', rowsOf(['PL'])], ['Cups', rowsOf(['LC', 'FAC'])], ['International', { vals: ['0', '0', '0', '0', '0', '0', '0'], avr: undefined }]] as const)
    .forEach(([label, r], i) => {
      const y = 382 + i * 18;
      s.text(label + (i === 0 ? live : ''), 26, y, { font: 'MY2', colour: C.yellow });
      r.vals.forEach((val, k) => s.text(val, 321 + k * 40, y, { font: 'MY2', colour: C.cyan, align: 'center' }));
      s.blueBox(r.avr ? r.avr.toFixed(1) : '', 584, y, 34, 16, { font: 'MY1' });
    });
}

/** Opens a player's profile from wherever he is listed; Done comes back here. */
export function openProfile(p: Player, team: Team, back: View = ui.view) {
  if (ui.view.kind === 'match' && !paused) pause();
  go({ kind: 'profile', player: p, team, back, tab: 'skills' });
}

// ------------------------------------------------------------------ tactics

const FORMATION_NAMES = Object.keys(FORMATIONS) as FormationName[];
const cycle = <T,>(list: readonly T[], cur: T, dir: 1 | -1) => list[(list.indexOf(cur) + dir + list.length) % list.length];

const PITCH = { x: 330, y: 8, w: 300, h: 428 };

// The preset spots on the tactics pitch, as in the original: seven lanes
// across and nine depths up the pitch, plus the goalkeeper's spot. Players
// are dragged between them and runs are drawn from one to another.
const LANES = [0.16, 0.27, 0.38, 0.5, 0.62, 0.73, 0.84];
const DEPTHS = [0.12, 0.21, 0.31, 0.41, 0.52, 0.62, 0.72, 0.85, 0.93];
/** depth * LANES.length + lane, or GK_SPOT. */
type Spot = number;
const GK_SPOT: Spot = -1;
const ALL_SPOTS: Spot[] = [GK_SPOT, ...DEPTHS.flatMap((_, d) => LANES.map((_, l) => d * LANES.length + l))];
const laneOf = (s: Spot) => s % LANES.length;
const depthOf = (s: Spot) => (s === GK_SPOT ? -1 : Math.floor(s / LANES.length));

function spotXY(s: Spot): { x: number; y: number } {
  if (s === GK_SPOT) return { x: PITCH.x + PITCH.w / 2, y: PITCH.y + PITCH.h - 12 };
  return { x: PITCH.x + LANES[laneOf(s)] * PITCH.w, y: PITCH.y + PITCH.h - DEPTHS[depthOf(s)] * PITCH.h };
}

/** The position the match engine plays from a spot. */
function positionOf(s: Spot): Position {
  if (s === GK_SPOT) return 'GK';
  const lane = laneOf(s), depth = depthOf(s);
  const side = lane === 0 ? 'L' : lane === LANES.length - 1 ? 'R' : 'C';
  if (depth <= 2) return `D${side}` as Position;
  if (depth === 3) return side === 'C' ? 'DM' : (`M${side}` as Position);
  if (depth <= 5) return `M${side}` as Position;
  if (depth === 6) return `AM${side}` as Position;
  return side === 'C' ? 'ST' : (`AM${side}` as Position);
}

/** A run makes the engine get forward or hold back; a run across the pitch changes nothing yet. */
function runOf(p: Place): Run {
  if (p.runTo === undefined || p.spot === GK_SPOT) return 'normal';
  const d = depthOf(p.runTo) - depthOf(p.spot);
  return d > 0 ? 'forward' : d < 0 ? 'hold' : 'normal';
}

function nearestSpot(x: number, y: number, free?: (s: Spot) => boolean): Spot {
  let best = GK_SPOT, d = Infinity;
  for (const s of ALL_SPOTS) {
    if (free && !free(s)) continue;
    const p = spotXY(s);
    const dd = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (dd < d) { d = dd; best = s; }
  }
  return best;
}

/** Where each position stands by default: its depth and the lanes it prefers. */
const HOME: Record<Exclude<Position, 'GK'>, { depth: number; lanes?: number[] }> = {
  DL: { depth: 1, lanes: [0, 1] }, DC: { depth: 1 }, DR: { depth: 1, lanes: [6, 5] },
  DM: { depth: 3 }, ML: { depth: 4, lanes: [0, 1] }, MC: { depth: 4 }, MR: { depth: 4, lanes: [6, 5] },
  AML: { depth: 6, lanes: [0, 1] }, AMC: { depth: 6 }, AMR: { depth: 6, lanes: [6, 5] }, ST: { depth: 7 },
};
/** Central players spread across the middle lanes by how many share the position. */
const CENTRE_LANES = [[3], [2, 4], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5]];

/** Spots for players of the given positions, avoiding spots already taken. */
function spotsFor(positions: Position[], taken: Set<Spot>): Spot[] {
  const used = new Set(taken);
  const out: Spot[] = new Array(positions.length);
  const want = (i: number, s: Spot) => {
    const target = used.has(s) ? nearestFree(s, used) : s;
    out[i] = target;
    used.add(target);
  };
  const groups = new Map<Position, number[]>();
  positions.forEach((pos, i) => groups.set(pos, [...(groups.get(pos) ?? []), i]));
  for (const [pos, idx] of groups) {
    if (pos === 'GK') { idx.forEach(i => want(i, GK_SPOT)); continue; }
    const home = HOME[pos];
    const lanes = home.lanes ?? CENTRE_LANES[Math.min(idx.length, CENTRE_LANES.length) - 1];
    idx.forEach((i, k) => want(i, home.depth * LANES.length + (lanes[k] ?? lanes[lanes.length - 1])));
  }
  return out;
}

function nearestFree(s: Spot, used: Set<Spot>): Spot {
  const from = s === GK_SPOT ? { l: 3, d: 0 } : { l: laneOf(s), d: depthOf(s) };
  let best = s, bd = Infinity;
  for (const t of ALL_SPOTS) {
    if (t === GK_SPOT || used.has(t)) continue;
    // Prefer the same depth: a defender moved aside stays in the back line.
    const dd = (laneOf(t) - from.l) ** 2 + 2.5 * (depthOf(t) - from.d) ** 2;
    if (dd < bd) { bd = dd; best = t; }
  }
  return best;
}

/** Defenders-midfielders-forwards, e.g. "4-5-1"; attacking midfielders count as midfielders. */
function shapeOf(positions: Position[]): string {
  const lines = [0, 0, 0];
  for (const p of positions) if (p !== 'GK') lines[p[0] === 'D' && p !== 'DM' ? 0 : p === 'ST' ? 2 : 1]++;
  return lines.join('-');
}

/** The formation's name if the pitch still has its shape, otherwise the shape the pitch shows. */
function formationLabel(): string {
  const shape = shapeOf(plan.rows.map(r => positionOf(placeOf(r).spot)));
  return shape === shapeOf(FORMATIONS[plan.tactic.formation]) ? plan.tactic.formation : shape;
}

/** The tactics screen; for the other side it shows their team sheet without letting it change. */
export function drawTacticsView(s: Screen, v: Extract<View, { kind: 'tactics' }>) {
  if (!v.theirs) { ensurePlanIfNeededForTactics(); drawTactics(s, false, v); return; }
  const theirs = opponentPlan();
  if (!theirs) { go(v.back ?? { kind: 'menu' }); return; }
  const mine = plan;
  plan = theirs;
  try { drawTactics(s, true, v); } finally { plan = mine; }
}

function ensurePlanIfNeededForTactics() {
  if (!plan || plan.team.id !== game().humanClubId) ensurePlan();
}

function drawTactics(s: Screen, readOnly: boolean, v: Extract<View, { kind: 'tactics' }>) {
  const t = plan.tactic;
  const team = plan.team;
  const live = !!match && !match.finished;
  const side = match ? match.sides.findIndex(x => x.setup.team.id === team.id) : -1;
  // Read-only: the buttons show the settings but do nothing.
  const act = <T,>(f: T) => (readOnly ? undefined : f);
  const { bg, fg } = teamBar(plan.team);
  s.background();
  s.titleBar(plan.team.name, bg, fg, 8, 318);
  const cyc = (labelText: string, x: number, w: number, onPrev: () => void, onNext: () => void) => {
    // The left half steps back (the ‹ arrow), the right half forward; right-click also steps back.
    s.button(labelText, x, 66, w, 30, undefined, { arrows: true, colour: C.text });
    if (readOnly) return;
    s.area(x, 66, w / 2, 30, { onClick: onPrev, onRightClick: onPrev });
    s.area(x + w / 2, 66, w / 2, 30, { onClick: onNext, onRightClick: onPrev });
  };
  cyc(`${formationLabel()}\nFormation`, 10, 104, () => setFormation(cycle(FORMATION_NAMES, t.formation, -1)), () => setFormation(cycle(FORMATION_NAMES, t.formation, 1)));
  const ments = [-2, -1, 0, 1, 2] as Mentality[];
  cyc(`${MENTALITY_NAMES[t.mentality]}\nMentality`, 116, 104, () => { t.mentality = cycle(ments, t.mentality, -1); }, () => { t.mentality = cycle(ments, t.mentality, 1); });
  const passing = ['short', 'mixed', 'direct'] as const;
  cyc(`${cap(t.passing)}\nPassing`, 222, 104, () => { t.passing = cycle(passing, t.passing, -1); }, () => { t.passing = cycle(passing, t.passing, 1); });
  const press = ['low', 'mid', 'high'] as const, width = ['narrow', 'normal', 'wide'] as const;
  s.button(`${cap(t.pressing)}\nPressing`, 10, 98, 79, 30, act(() => { t.pressing = cycle(press, t.pressing, 1); }), { onRightClick: act(() => { t.pressing = cycle(press, t.pressing, -1); }), colour: C.text });
  s.button(`${cap(t.width)}\nWidth`, 90, 98, 79, 30, act(() => { t.width = cycle(width, t.width, 1); }), { onRightClick: act(() => { t.width = cycle(width, t.width, -1); }), colour: C.text });
  s.button(`Counter\n${t.counterAttack ? 'On' : 'Off'}`, 170, 98, 79, 30, act(() => { t.counterAttack = !t.counterAttack; }), { active: t.counterAttack, colour: t.counterAttack ? C.yellow : C.text });
  s.button(`Offside\n${t.offsideTrap ? 'Trap' : 'Off'}`, 250, 98, 76, 30, act(() => { t.offsideTrap = !t.offsideTrap; }), { active: t.offsideTrap, colour: t.offsideTrap ? C.yellow : C.text });

  // The numbered team list: 1-11 on the pitch, then the substitutes.
  s.panel(10, 132, 316, 308);
  const listed: { player: Player; row?: number; bench?: string }[] = [
    ...plan.rows.map((r, i) => ({ player: r.player, row: i })),
    ...plan.bench.slice(0, BENCH_SIZE).map(p => ({ player: p, bench: p.id })),
  ];
  const g = game();
  listed.forEach((e, i) => {
    const y = 135 + i * 14;
    const pick = e.row !== undefined ? { row: e.row } : { bench: e.bench! };
    const lit = !!picked && JSON.stringify(picked) === JSON.stringify(pick);
    s.blueBox(String(i + 1), 14, y, 26, 13, { lit, onClick: act(() => handlePick(pick)) });
    const r = e.row !== undefined ? plan.rows[e.row] : undefined;
    const goingOn = e.bench ? plan.rows.find(x => x.sub?.id === e.bench) : undefined;
    const slot = r ? positionOf(r.spot) : undefined;
    const st = g.players[e.player.id];
    const out = !live && !!st && (!!st.injury || st.banned > 0);
    const colour = out ? C.orange : i < 11 ? (slot && !r!.player.positions.includes(slot) ? C.gold : C.white) : '#9a9a9a';
    // Each player's positions from his profile, substitutes included, as on the squad screen,
    // shown in full and ending where the next column starts; the name gives way if needed.
    const code = positionCode(e.player);
    const codeLeft = 224 - textWidth(code, 'MY1');
    s.text(fit(e.player.name, Math.min(138, codeLeft - 50), 'MY2'), 46, y, { font: 'MY2', colour });
    s.text(code, codeLeft, y + 1, { font: 'MY1', colour: goingOn ? C.yellow : C.gold });
    if (r?.sub) s.text('off', 228, y + 1, { font: 'MY1', colour: C.orange });
    else if (goingOn) s.text('on', 228, y + 1, { font: 'MY1', colour: C.yellow });
    else if (live && r) {
      const cond = Math.round(match!.sides[side].pitch.find(o => o.player.id === r.player.id)?.condition ?? 100);
      s.text(`${cond}%`, 226, y + 1, { font: 'MY1', colour: cond < 70 ? C.orange : C.cyan });
    } else if (!live && st && st.condition < 90) {
      s.text(`${Math.round(st.condition)}%`, 226, y + 1, { font: 'MY1', colour: st.condition < 75 ? C.orange : C.cyan });
    }
    // Captain and set-piece tags, as the original showed them: cpt, cnr, dfk, pen.
    const tags = r ? ROLES.filter(x => plan.takers[x.key] === r.player.id) : [];
    tags.forEach((x, k) => s.text(x.tag, 252 + k * 18, y + 1, { font: 'MY1', colour: C.gold }));
    const menu = act(() => { if (r) roleMenu = { row: e.row! }; });
    s.area(44, y, 180, 14, { onClick: () => openProfile(e.player, team), onRightClick: r ? menu : undefined });
    if (r && menu) s.area(250, y, 74, 14, { onClick: menu });
  });
  const problem = readOnly ? undefined : planProblem();
  const hints = readOnly ? ['The opposition\'s tactics, to look at only.', 'Click a name for his profile.'] : problem ? [problem] : [
    live ? 'Click a number, then a substitute\'s, to bring him on.' : 'Click two numbers to swap players.',
    'Drag a player to move him. Right-drag to draw a run.',
    'Right-click a name for captain and set pieces.',
  ];
  hints.forEach((h, i) => s.text(h, 168, 413 + i * 10, { font: 'MY1', colour: problem ? C.orange : C.text, align: 'center' }));

  drawPitch(s, readOnly);
  if (readOnly) { s.doneBar('Done', () => go(v.back ?? (match ? { kind: 'info', tab: 'ratings' } : { kind: 'matchday' }))); return; }
  s.doneBar('Done', () => {
    if (planProblem()) return;
    picked = undefined;
    roleMenu = undefined;
    // Back to where the tactics were opened from: the match info, the squad or the match day menu.
    if (live) go({ kind: 'info', tab: 'ratings' });
    else { saveSheet(); go(v.back ?? { kind: 'menu' }); }
  }, 10, 496);
  s.bevel(508, 446, 122, 30, C.grey, C.greyLight, C.greyDark);
  s.label('Undo\nChanges', 508, 446, 122, 30, 'MY1', C.text);
  s.area(508, 446, 122, 30, { onClick: () => { if (undo) restore(undo); picked = undefined; } });
  if (roleMenu) drawRoleMenu(s, roleMenu.row);
}

/** The captain and set-piece taker menu for one player; any one player can take them all. */
function drawRoleMenu(s: Screen, row: number) {
  const p = plan.rows[row].player;
  // A click anywhere else closes the menu.
  s.area(0, 0, W, 480, { onClick: () => { roleMenu = undefined; }, onRightClick: () => { roleMenu = undefined; } });
  const x = 60, y = Math.min(300, 135 + row * 14 + 14), w = 200;
  s.rect(x - 2, y - 2, w + 4, 22 + ROLES.length * 26 + 30, '#000');
  s.rect(x, y, w, 20 + ROLES.length * 26 + 28, C.boxBlue);
  s.text(fit(p.name, w - 12, 'MY2'), x + w / 2, y + 3, { font: 'MY2', colour: C.white, align: 'center' });
  ROLES.forEach((r, i) => {
    const on = plan.takers[r.key] === p.id;
    s.button(r.name, x + 6, y + 20 + i * 26, w - 12, 24, () => { plan.takers[r.key] = p.id; }, { font: 'MY2', active: on });
  });
  s.button('Close', x + 6, y + 22 + ROLES.length * 26, w - 12, 24, () => { roleMenu = undefined; }, { font: 'MY2' });
}

/** Lines the team up in a formation, each player taking the slot that suits him best. */
function setFormation(f: FormationName) {
  plan.tactic.formation = f;
  const slots = FORMATIONS[f];
  const free = new Set(plan.rows.map((_, i) => i));
  const given: Position[] = new Array(plan.rows.length);
  // Fill the keeper first, then the slots with the fewest natural players.
  const order = slots.map((slot, i) => ({ slot, i, n: plan.rows.filter(r => shownPlayer(r).positions.includes(slot)).length }))
    .sort((a, b) => (a.slot === 'GK' ? -1 : b.slot === 'GK' ? 1 : a.n - b.n));
  for (const { slot } of order) {
    let best = -1, score = -1;
    for (const i of free) {
      const p = shownPlayer(plan.rows[i]);
      const sc = familiarity(p.positions, slot) * 1000 + p.ability;
      if (sc > score) { score = sc; best = i; }
    }
    if (best < 0) break;
    given[best] = slot;
    free.delete(best);
  }
  const spots = spotsFor(given, new Set());
  plan.rows.forEach((r, i) => { const pl = placeOf(r); pl.spot = spots[i]; pl.runTo = undefined; });
}

function drawPitch(s: Screen, readOnly = false) {
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
  for (const f of [0.11, 0.89]) { g.moveTo(x + w * f + 0.5, y); g.lineTo(x + w * f + 0.5, y + h); }
  g.stroke();
  g.setLineDash([]);

  const drag = s.dragging;
  const dragRow = drag?.hit.id?.startsWith('row:') ? Number(drag.hit.id.slice(4)) : undefined;
  const onPitch = (px: number, py: number) => px >= x && px < x + w && py >= y && py < y + h;
  // While dragging, the preset spots show as dots.
  if (dragRow !== undefined) for (const sp of ALL_SPOTS) { const p = spotXY(sp); s.rect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3, C.pitchLine); }

  const dashed = (a: { x: number; y: number }, b: { x: number; y: number }, colour: string) => {
    g.strokeStyle = colour;
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(a.x + 0.5, a.y + 0.5); g.lineTo(b.x + 0.5, b.y + 0.5); g.stroke();
    g.setLineDash([]);
    s.text('x', b.x, b.y - 7, { font: 'MY1', colour, align: 'center' });
  };

  plan.rows.forEach((row, i) => {
    const place = placeOf(row);
    const p = spotXY(place.spot);
    if (place.runTo !== undefined) dashed(p, spotXY(place.runTo), C.yellow);
    const lit = !!picked && 'row' in picked && picked.row === i;
    const name = shownPlayer(row).shortName.split(' ').slice(-1)[0];
    s.text(String(i + 1), p.x, p.y - 13, { font: 'MY2', colour: lit ? C.cyan : C.yellow, align: 'center' });
    s.text(fit(name, 80, 'MY1'), p.x, p.y, { font: 'MY1', colour: row.sub ? C.yellow : lit ? C.cyan : C.text, align: 'center' });
    const bw = Math.max(30, Math.min(80, textWidth(name, 'MY1')) + 4);
    if (readOnly) return;
    s.area(p.x - bw / 2, p.y - 13, bw, 25, {
      id: `row:${i}`,
      onClick: () => handlePick({ row: i }),
      // A right-click clears his run; a right-drag draws a new one.
      onRightClick: () => { place.runTo = undefined; },
      onRightDrop: (dx, dy) => {
        if (place.spot === GK_SPOT || !onPitch(dx, dy)) return;
        const to = nearestSpot(dx, dy, sp => sp !== GK_SPOT);
        place.runTo = to === place.spot ? undefined : to;
      },
      onDrop: (dx, dy) => {
        if (!onPitch(dx, dy)) return;
        const to = nearestSpot(dx, dy);
        // Dropped on a team-mate: the two change places.
        const other = plan.rows.find(o => o !== row && placeOf(o).spot === to);
        if (other) { placeOf(other).spot = place.spot; placeOf(other).runTo = undefined; }
        place.spot = to;
        if (place.runTo === to || to === GK_SPOT) place.runTo = undefined;
        picked = undefined;
      },
    });
  });

  // What the drag will do, drawn as it goes: the player at his new spot, or the run line.
  if (drag && dragRow !== undefined && onPitch(drag.cx, drag.cy)) {
    const place = placeOf(plan.rows[dragRow]);
    if (drag.button === 2 && place.spot !== GK_SPOT) {
      dashed(spotXY(place.spot), spotXY(nearestSpot(drag.cx, drag.cy, sp => sp !== GK_SPOT)), C.cyan);
    } else if (drag.button === 0) {
      const to = spotXY(nearestSpot(drag.cx, drag.cy));
      s.text(String(dragRow + 1), to.x, to.y - 13, { font: 'MY2', colour: C.cyan, align: 'center' });
      s.text(fit(shownPlayer(plan.rows[dragRow]).shortName.split(' ').slice(-1)[0], 80, 'MY1'), to.x, to.y, { font: 'MY1', colour: C.cyan, align: 'center' });
    }
  }
}

function planProblem(): string | undefined {
  if (!plan) return undefined;
  const keepers = plan.rows.filter(r => placeOf(r).spot === GK_SPOT).length;
  if (plan.rows.length < 11) return 'Not enough fit players to name a team.';
  if (keepers !== 1) return 'Put a player in goal.';
  if (match && !match.finished) {
    const left = match.subsLeft(mySide);
    const subs = plan.rows.filter(r => r.sub).length;
    if (subs > left.subs) return `Only ${left.subs} substitutes left.`;
    if (subs > 0 && !match.atHalfTime && left.windows === 0) return 'All substitution windows used.';
    return undefined;
  }
  const g = game();
  const out = [...plan.rows.map(r => r.player), ...plan.bench.slice(0, BENCH_SIZE)].find(p => g.players[p.id] && (g.players[p.id].injury || g.players[p.id].banned > 0));
  if (out) return `${out.name} is ${g.players[out.id].injury ? 'injured' : 'suspended'}.`;
  return undefined;
}

// ------------------------------------------------------------------ match

export function drawConfirm(s: Screen) {
  const team = myTeam();
  const { bg, fg } = teamBar(team);
  s.background();
  s.titleBar(team.name, bg, fg);
  dateTag(s);
  s.text('Confirm Selection', W / 2, 74, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 120, 600, 300);
  const problem = planProblem();
  s.text(problem ?? 'Go ahead and play match ?', W / 2, 258, { font: 'MY4', colour: problem ? C.orange : C.white, align: 'center' });
  s.button('Yes', 10, 446, 154, 30, problem ? undefined : kickOff, { font: 'MY4' });
  s.button('No', 166, 446, 464, 30, () => go({ kind: 'matchday' }), { font: 'MY4' });
}

function kickOff() {
  const g = game();
  const fx = fixture!;
  saveSheet();
  mySide = atHome() ? 0 : 1;
  const runs: Record<string, Run> = {};
  for (const r of plan.rows) runs[r.player.id] = runOf(r);
  layout = new Map(plan.rows.map(r => [r.player.id, { spot: r.spot, runTo: r.runTo }]));
  const mine = {
    team: plan.team,
    lineup: {
      starters: plan.rows.map(r => r.player), bench: plan.bench.slice(0, BENCH_SIZE), slots: plan.rows.map(r => positionOf(r.spot)),
      runs, takers: { ...plan.takers }, fitness: fitnessOf(g, plan.team),
    },
    tactic: { ...plan.tactic }, ai: false,
  };
  match = createMatch(g, fx, mine, true);
  recorded = false;
  shown = undefined;
  queue = [];
  line = undefined;
  paused = true;
  go({ kind: 'match' });
}

export function drawMatch(s: Screen) {
  const m = match!;
  s.background();
  scoreBars(s);
  const clock = matchClock();
  if (clock) s.tag(clock, 4, 58, 'left');
  s.tag(compName(), W - 4, 58);
  if (m.minute > 0 && !m.atHalfTime && !m.finished) s.text((shown?.clock ?? m.displayMinute).replace(/'$/, ''), W / 2, 56, { font: 'MY7', colour: C.yellow, align: 'center' });
  s.panel(20, 90, 600, 310);
  const running = m.minute > 0 && !paused && !m.finished && !m.atHalfTime;
  if (running) {
    s.tag('Click or press Return to pause', 4, 58, 'left');
    // Clicking anywhere on the match stops it for the match info screens, as the bar below does.
    s.area(0, 56, W, 356, { onClick: pauseToInfo });
  } else if (m.minute > 0 && !m.finished && !m.atHalfTime) {
    s.tag('Paused: click the bar below or press Return', 4, 58, 'left');
  }
  drawScorers(s, 96);
  const where = fixture?.neutral ? 'Wembley Stadium' : m.sides[0].setup.team.stadium;
  if (m.minute > 0) s.text(`At ${where}`, 24, 96 + 18 * Math.max(1, scorerRows()), { font: 'MY3', colour: C.cyan });
  if (line) drawCommentary(s, line);

  // Attacking possession over the last few minutes, home blue against away red as in the original.
  s.text('Attacking Possession', W / 2, 401, { font: 'MY1', colour: C.text, align: 'center' });
  s.bevel(10, 414, 620, 30, C.grey, C.greyLight, C.greyDark);
  const [h, a] = m.sides;
  const poss = h.stats.possessionMinutes / Math.max(1, h.stats.possessionMinutes + a.stats.possessionMinutes);
  const span = 520, left = 60, split = Math.round(span * (m.minute ? poss : 0.5));
  s.rect(left, 420, split, 18, teamBar(h.setup.team).bg);
  s.rect(left + split, 420, span - split, 18, teamBar(a.setup.team).bg);

  const status = m.finished ? 'Full Time' : m.atHalfTime ? 'Half Time' : m.minute === 0 ? 'Kick Off' : `${m.half === 1 ? 'First' : 'Second'} Half From ${where}`;
  s.doneBar(status, () => {
    if (m.finished || m.atHalfTime) { stop(); go({ kind: 'info', tab: 'ratings' }); return; }
    // Kick off, or stop the game and go to the match info screens, as Return does.
    if (paused) { paused = false; tick(); } else pauseToInfo();
  });
}

/** Stops the match and shows the match info screens, where the tactics screen makes changes. */
function pauseToInfo() {
  pause();
  // The rest of the move is skipped, so the score and stats agree on the info screens.
  queue = [];
  shown = undefined;
  go({ kind: 'info', tab: 'ratings' });
}

function scorerRows() {
  const goals = eventsSoFar(mv()).filter(e => e.type === 'goal');
  return Math.max(goals.filter(e => e.side === 0).length, goals.filter(e => e.side === 1).length);
}

/** Goal scorers under each team, with the minutes, as the original listed them. */
function drawScorers(s: Screen, y: number) {
  const m = mv();
  for (const side of [0, 1] as const) {
    const byName = new Map<string, { player?: Player; mins: string[] }>();
    for (const e of eventsSoFar(m)) {
      if (e.type !== 'goal' || e.side !== side) continue;
      const p = scorer(e);
      const name = p?.shortName ?? 'Goal';
      byName.set(name, { player: p, mins: [...(byName.get(name)?.mins ?? []), e.clock] });
    }
    [...byName].forEach(([name, { player, mins }], i) => {
      const x = side === 0 ? 24 : 334;
      const w = s.text(name, x, y + i * 18, { font: 'MY3', colour: C.text });
      s.text(mins.join(', '), x + 282, y + i * 18, { font: 'MY3', colour: C.yellow, align: 'right' });
      if (player) s.area(x, y + i * 18, w, 18, { onClick: () => openProfile(player, m.sides[side].setup.team) });
    });
  }
}

function scorer(e: ViewEvent): Player | undefined {
  const m = mv();
  const squad = [...m.sides[e.side!].setup.lineup.starters, ...m.sides[e.side!].setup.lineup.bench];
  // The goal text names the scorer; pick the longest short name it contains.
  return squad.filter(p => e.text.includes(p.shortName)).sort((a, b) => b.shortName.length - a.shortName.length)[0];
}

function drawCommentary(s: Screen, l: NonNullable<typeof line>) {
  const m = mv();
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
  ui.screen.render();
}

function tick() {
  const m = match;
  if (!m || paused) return;
  stop();
  if (queue.length === 0) {
    if (m.finished) { paused = true; shown = undefined; ui.screen.render(); return; }
    const from = m.events.length;
    queue = m.step().map((ev, i) => ({ ev, index: from + i }))
      .filter(({ ev }) => ev.importance > 0 || ev.type === 'build' || ev.type === 'chance');
    if (queue.length === 0) {
      // A quiet minute: the clock runs on.
      shown = { clock: m.displayMinute, events: m.events.length };
      ui.screen.render();
      timer = window.setTimeout(tick, SPEEDS[speed] * 0.35);
      return;
    }
  }
  // A move: the clock stands at its minute while its lines are read.
  const { ev, index } = queue.shift()!;
  shown = { clock: ev.clock, events: index + 1 };
  line = { text: ev.text, side: ev.side, type: ev.type };
  ui.screen.render();
  if (ev.type === 'halftime' || ev.type === 'fulltime') {
    queue = [];
    shown = undefined;
    paused = true;
    // The original stops on the match info screens at half and full time.
    timer = window.setTimeout(() => { if (ui.view.kind === 'match') go({ kind: 'info', tab: 'ratings' }); ui.screen.render(); }, SPEEDS[speed] * 1.5);
    return;
  }
  const wait = ev.importance === 2 ? 2.4 : ev.importance === 1 ? 1.1 : 0.8;
  timer = window.setTimeout(tick, SPEEDS[speed] * wait);
}

/** Space cycles slow, normal and fast; Return pauses and continues. */
export function matchKey(e: KeyboardEvent): boolean {
  if (ui.view.kind !== 'match' || !match || match.finished) return false;
  if (e.key === ' ') {
    speed = nextSpeed();
    if (!paused) tick();
    return true;
  }
  if (e.key === 'Enter') {
    if (match.atHalfTime) return true;
    if (paused) { paused = false; tick(); } else pauseToInfo();
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ match info (half and full time, paused)

/** The match info page for a tab, and the row of tab buttons under it. */
function drawInfoTabs(s: Screen, tab: InfoTab, open: (tab: InfoTab) => void) {
  const [h, a] = mv().sides;
  s.panel(20, 88, 600, 314);
  if (tab === 'ratings') drawRatings(s);
  else if (tab === 'stats') drawMatchStats(s);
  else if (tab === 'incidents') drawIncidents(s);
  else drawPlayerStats(s, tab === 'homeStats' ? 0 : 1);
  const tabs: [string, InfoTab][] = [
    [`${h.setup.team.shortName}\nPlayer Stats`, 'homeStats'], ['Match\nIncidents', 'incidents'], ['Match\nStats', 'stats'],
    ['Player\nRatings', 'ratings'], [`${a.setup.team.shortName}\nPlayer Stats`, 'awayStats'],
  ];
  tabs.forEach(([t, k], i) => s.button(t, 10 + i * 124, 414, 122, 30, () => open(k), { active: k === tab }));
}

/** A played match's report, rebuilt into the shape the match info screens read. */
function reportView(g: GameState, fx: Fixture): MatchView | undefined {
  const r = fx.result?.report;
  if (!r) return undefined;
  const playerStats = new Map<string, PlayerMatchStats>();
  const sides = ([0, 1] as const).map(side => {
    const players = r.squads[side].map(id => playerById(g, id)).filter((p): p is Player => !!p);
    for (const p of players) {
      const v = r.players[p.id];
      if (!v) continue;
      // In the order of REPORT_FIELDS.
      const [minutes, goals, assists, shots, onTarget, keyPasses, tackles, saves, yellow, red, injured, rating] = v;
      playerStats.set(p.id, {
        playerId: p.id, side, minutes, goals, assists, shots, onTarget, keyPasses, tackles, saves, yellow,
        red: !!red, injured: !!injured, rating: rating / 10,
      });
    }
    const team = g.teams[side === 0 ? fx.home : fx.away];
    return { setup: { team, lineup: { starters: players.slice(0, 11), bench: players.slice(11) } }, stats: r.stats[side], pitch: [] };
  });
  const motm = fx.result!.motm ? playerById(g, fx.result!.motm) : undefined;
  return { sides, events: r.events, playerStats, finished: true, atHalfTime: false, result: () => ({ motmPlayer: motm }) };
}

/** The match info screens for any played match, opened from a results list. */
export function drawReport(s: Screen, v: Extract<View, { kind: 'report' }>) {
  const g = game();
  const fx = g.fixtures.find(f => f.id === v.fixtureId);
  const view = fx && reportView(g, fx);
  s.background();
  if (!fx || !view) {
    s.titleBar('Match Info');
    s.text('There is no match report for this game.', W / 2, 220, { font: 'MY4', colour: C.text, align: 'center' });
    s.doneBar('Done', () => go(v.back));
    return;
  }
  const live = { fixture, report };
  report = view;
  fixture = fx;
  try {
    scoreBars(s);
    const where = fx.neutral ? 'Wembley Stadium' : g.teams[fx.home].stadium;
    s.tag(`${compName()}${fx.comp === 'PL' ? '' : ` ${fx.round}`} From ${where} - Full Time`, 4, 58, 'left');
    s.tag(fx.result!.et ? scoreLine(g, fx) : matchClock(), W - 4, 58);
    drawInfoTabs(s, v.tab, k => { v.tab = k; });
    s.doneBar('Done', () => go(v.back));
  } finally {
    ({ fixture, report } = live);
  }
}

export function drawInfo(s: Screen, tab: InfoTab) {
  const m = match!;
  s.background();
  scoreBars(s);
  const [h, a] = m.sides;
  const when = m.finished ? 'Full Time' : m.atHalfTime ? 'Half Time' : `${m.displayMinute} mins`;
  s.tag(`${compName()} From ${fixture?.neutral ? 'Wembley Stadium' : h.setup.team.stadium} - ${when}`, 4, 58, 'left');
  const clock = matchClock();
  if (clock) s.tag(clock, W - 4, 58);
  drawInfoTabs(s, tab, k => go({ kind: 'info', tab: k }));
  const myTactics = () => { plan = planFromMatch(); undo = snapshot(); picked = undefined; go({ kind: 'tactics' }); };
  const theirTactics = () => { picked = undefined; go({ kind: 'tactics', theirs: true, back: { kind: 'info', tab } }); };
  const tacticsButton = (side: 0 | 1, x: number) => s.button(`${m.sides[side].setup.team.shortName}\nTactics`, x, 446, 122, 30,
    side === mySide ? (m.finished ? undefined : myTactics) : theirTactics);
  tacticsButton(0, 10);
  tacticsButton(1, 508);
  s.doneBar('Done', () => {
    if (m.finished) { finishMatch(); go({ kind: 'result' }); return; }
    applyPlan();
    go({ kind: 'match' });
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
  for (const r of plan.rows) {
    if (r.sub && !m.substitute(mySide, r.player.id, r.sub.id)) passTakers(plan.takers, r.player.id, r.sub.id);
  }
  m.setTakers(mySide, plan.takers);
  if (JSON.stringify(plan.tactic) !== JSON.stringify(s.setup.tactic)) m.setTactic(mySide, { ...plan.tactic });
  for (const r of plan.rows) {
    const id = r.sub?.id ?? r.player.id, place = placeOf(r);
    m.setPosition(mySide, id, positionOf(place.spot));
    m.setRun(mySide, id, runOf(place));
    layout.set(id, { spot: place.spot, runTo: place.runTo });
  }
  plan = planFromMatch();
}

function sideList(side: 0 | 1) {
  const s = mv().sides[side];
  const starters = s.setup.lineup.starters, bench = s.setup.lineup.bench;
  return [...starters, ...bench];
}

function drawRatings(s: Screen) {
  const m = mv();
  const motm = m.finished ? m.result().motmPlayer?.id : undefined;
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
      s.area(x + 40, Math.round(y), 200, 15, { onClick: () => openProfile(p, m.sides[side].setup.team) });
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
  const [h, a] = mv().sides;
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
  const m = mv();
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
  const m = mv();
  const cols: [string, (st: PlayerMatchStats) => string][] = [
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
    s.blueBox(String(i + 1), 24, Math.round(y), 26, 13, { font: 'MY1' });
    const played = !!st && st.minutes > 0;
    s.text(fit(p.name, 170, 'MY1'), 58, Math.round(y), { font: 'MY1', colour: played ? C.text : '#8a8a8a' });
    s.area(58, Math.round(y), 170, 14, { onClick: () => openProfile(p, m.sides[side].setup.team) });
    if (!st || !played) return;
    cols.forEach(([, f], c) => s.text(f(st), 256 + c * 38, Math.round(y), { font: 'MY1', colour: c === 2 && st.goals ? C.yellow : C.cyan, align: 'center' }));
    const cond = pitch.find(o => o.player.id === p.id)?.condition;
    if (cond !== undefined) s.text(String(Math.round(cond)), 560, Math.round(y), { font: 'MY1', colour: C.gold, align: 'center' });
    s.blueBox(String(Math.max(1, Math.min(10, Math.round(st.rating)))), 582, Math.round(y), 32, 13, { font: 'MY1' });
  });
}

/** Puts the result in the season once: stats, injuries, bans, extra time and penalties in a cup. */
function finishMatch() {
  if (recorded || !match || !fixture) return;
  recorded = true;
  recordMatch(game(), fixture, match);
  autosaveNow();
}

export function drawResult(s: Screen) {
  const m = match!;
  const g = game();
  finishMatch();
  const r = m.result();
  const fx = fixture!;
  s.background();
  s.titleBar(compName(), C.boxBlue, C.yellow);
  dateTag(s);
  s.text(fx.comp === 'PL' ? 'Result' : `${fx.round}${fx.leg ? ` - Leg ${fx.leg}` : ''}`, W / 2, 74, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 120, 600, 300);
  const me = g.humanClubId;
  s.text(r.home.name, 256, 134, { font: 'MY4', colour: r.home.id === me ? C.yellow : C.text, align: 'right' });
  const res = fx.result!;
  s.text(`${res.et ? res.et[0] : r.homeGoals} : ${res.et ? res.et[1] : r.awayGoals}`, W / 2, 134, { font: 'MY4', colour: C.cyan, align: 'center' });
  s.text(r.away.name, 384, 134, { font: 'MY4', colour: r.away.id === me ? C.yellow : C.text });
  let y = 164;
  if (res.et) {
    s.text(`After extra time (${r.homeGoals}-${r.awayGoals} at 90 minutes)${res.pens ? `. ${scoreLine(g, fx, fx.home).replace(/.*\(/, '').replace(')', '')} on penalties` : ''}`, W / 2, y, { font: 'MY3', colour: C.white, align: 'center' });
    y += 22;
  }
  s.text(`Man of the match: ${r.motmPlayer.name} (${r.manOfTheMatch.rating.toFixed(1)})`, W / 2, y + 8, { font: 'MY3', colour: C.cyan, align: 'center' });
  s.text(`Attendance: ${res.attendance.toLocaleString('en-GB')}`, W / 2, y + 32, { font: 'MY3', colour: C.text, align: 'center' });
  s.button('Match\nInfo', 10, 446, 122, 30, () => go({ kind: 'info', tab: 'ratings' }));
  s.doneBar('Done', () => {
    match = undefined;
    go({ kind: 'dayResults', page: 0 });
  }, 134, 496);
}
