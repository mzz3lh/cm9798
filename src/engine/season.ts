// A season, a day at a time. Each day players recover, injuries heal, money
// comes and goes, cups are drawn and the day's matches are played. The game
// stops, as the original did, whenever the human manager has a match or news
// to read. The human's own match is played on screen; every other match is
// played by the same engine without commentary.

import { addDays, daysBetween, dayMonth, LEAGUE_DATES, SEASON, weekday, windowOpen, type ISODate } from './calendar';
import { money } from './economy';
import { autoLineup, defaultTakers } from './lineup';
import { Match, type MatchResult, type MatchSide } from './match';
import type { Rng } from './rng';
import { transferDay } from './transfers';
import type { Lineup, Player, Tactic, Team } from './types';
import {
  addNews, unreadNews, COMP_NAMES, DIVISION_TAGS, newId, playerById, rngFor, wageBill,
  type CompId, type Cup, type Fixture, type FixtureResult, type GameState,
} from './world';

export { addNews, unreadNews };

// ------------------------------------------------------------------ fixtures and tables

export function fixturesOn(g: GameState, date: ISODate): Fixture[] {
  return g.fixtures.filter(f => f.date === date);
}

export function clubFixtures(g: GameState, clubId: string): Fixture[] {
  return g.fixtures.filter(f => f.home === clubId || f.away === clubId).sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** The human's match today, if it hasn't been played yet. */
export function humanMatchToday(g: GameState): Fixture | undefined {
  return fixturesOn(g, g.date).find(f => !f.result && (f.home === g.humanClubId || f.away === g.humanClubId));
}

export function nextFixture(g: GameState, clubId: string): Fixture | undefined {
  return clubFixtures(g, clubId).find(f => !f.result);
}

export interface TableRow {
  clubId: string;
  p: number; w: number; d: number; l: number; f: number; a: number; pts: number;
}

export function leagueTable(g: GameState): TableRow[] {
  const rows = new Map<string, TableRow>();
  for (const c of Object.values(g.clubs)) {
    if (c.division === 'PL') rows.set(c.id, { clubId: c.id, p: 0, w: 0, d: 0, l: 0, f: 0, a: 0, pts: 0 });
  }
  for (const fx of g.fixtures) {
    if (fx.comp !== 'PL' || !fx.result) continue;
    const h = rows.get(fx.home)!, a = rows.get(fx.away)!;
    const { home: hg, away: ag } = fx.result;
    h.p++; a.p++; h.f += hg; h.a += ag; a.f += ag; a.a += hg;
    if (hg > ag) { h.w++; a.l++; h.pts += 3; } else if (hg < ag) { a.w++; h.l++; a.pts += 3; } else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  // Points, then goal difference, then goals scored (Premier League rules), then name.
  return [...rows.values()].sort((x, y) => y.pts - x.pts || (y.f - y.a) - (x.f - x.a) || y.f - x.f
    || g.teams[x.clubId].name.localeCompare(g.teams[y.clubId].name));
}

// ------------------------------------------------------------------ team selection

/** The players a club can't pick: injured or banned, and (for AI clubs) the badly tired if there's cover. */
export function unavailableIds(g: GameState, team: Team, restTired: boolean): Set<string> {
  const out = new Set<string>();
  for (const p of team.squad) {
    const st = g.players[p.id];
    if (st.injury || st.banned > 0) out.add(p.id);
  }
  if (restTired) {
    for (const p of team.squad) if (g.players[p.id].condition < 72 && team.squad.length - out.size > 18) out.add(p.id);
  }
  return out;
}

export function fitnessOf(g: GameState, team: Team): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of team.squad) out[p.id] = g.players[p.id].condition;
  return out;
}

/** What an AI club sends out: its best fit eleven in its usual formation. */
export function aiSide(g: GameState, clubId: string): MatchSide {
  const team = g.teams[clubId];
  const tactic: Tactic = { ...g.clubs[clubId].tactic };
  const lu = autoLineup(team, tactic.formation, unavailableIds(g, team, true));
  const lineup: Lineup = { ...lu, takers: defaultTakers(lu.starters), fitness: fitnessOf(g, team) };
  return { team, lineup, tactic, ai: true };
}

export function matchImportance(fx: Fixture): number {
  if (fx.comp === 'PL') return 0.5;
  return fx.round === 'Final' ? 1 : fx.round === 'Semi Final' ? 0.85 : fx.round === 'Quarter Final' ? 0.7 : 0.55;
}

export function matchSeed(g: GameState, fx: Fixture): number {
  return rngFor(g, 'match', fx.id).int(1, 2 ** 31 - 1);
}

/** Sets up a match for a fixture; the human's side is passed in, everyone else is picked by the AI. */
export function createMatch(g: GameState, fx: Fixture, human?: MatchSide, commentary = true): Match {
  const home = human && fx.home === g.humanClubId ? human : aiSide(g, fx.home);
  const away = human && fx.away === g.humanClubId ? human : aiSide(g, fx.away);
  return new Match(home, away, {
    seed: matchSeed(g, fx), importance: matchImportance(fx), isCup: fx.comp !== 'PL', neutral: fx.neutral, commentary,
  });
}

// ------------------------------------------------------------------ results

const INJURIES: [name: string, minDays: number, maxDays: number, weight: number][] = [
  ['Bruised ankle', 3, 8, 22], ['Twisted ankle', 7, 18, 16], ['Calf strain', 10, 24, 14], ['Hamstring strain', 14, 35, 16],
  ['Groin strain', 10, 28, 10], ['Thigh strain', 10, 25, 9], ['Knee injury', 21, 60, 6], ['Broken metatarsal', 45, 80, 3],
  ['Torn knee ligaments', 120, 240, 1.5], ['Concussion', 7, 12, 3],
];

function injure(g: GameState, p: Player, rng: Rng, where: string) {
  const [name, lo, hi] = rng.weighted(INJURIES, x => x[3]);
  const days = rng.int(lo, hi);
  const st = g.players[p.id];
  st.injury = { name, until: addDays(g.date, days) };
  if (st.clubId === g.humanClubId) {
    const weeks = Math.max(1, Math.round(days / 7));
    addNews(g, {
      kind: 'injury', human: true, title: g.teams[st.clubId].name, clubId: st.clubId,
      heading: `${p.name} Injured`,
      body: `${p.name} picked up a ${name.toLowerCase()} ${where}. The physio expects him to be out for ${days < 10 ? `${days} days` : `about ${weeks} week${weeks > 1 ? 's' : ''}`}.`,
    });
  }
}

/** Goals in extra time and the shoot-out for a cup tie still level. */
function decideTie(m: Match, rng: Rng): { et: [number, number]; pens?: [number, number] } {
  const ratio = m.strength(0) / Math.max(1, m.strength(1));
  const et: [number, number] = [0, 0];
  for (let i = 0; i < 6; i++) {
    if (rng.chance(0.045 * ratio ** 1.5)) et[0]++;
    if (rng.chance(0.045 / ratio ** 1.5)) et[1]++;
  }
  if (et[0] !== et[1]) return { et };
  const taker = (side: 0 | 1, k: number) => {
    const ps = m.sides[side].pitch.filter(o => o.slot !== 'GK').map(o => o.player)
      .sort((a, b) => (b.attributes.setPieces + b.attributes.composure) - (a.attributes.setPieces + a.attributes.composure));
    return ps[k % Math.max(1, ps.length)];
  };
  const scores = (p: Player | undefined) => rng.chance(0.62 + ((p?.attributes.composure ?? 10) + (p?.attributes.setPieces ?? 10)) / 200);
  const pens: [number, number] = [0, 0];
  for (let k = 0; k < 5; k++) {
    if (scores(taker(0, k))) pens[0]++;
    if (scores(taker(1, k))) pens[1]++;
  }
  for (let k = 5; pens[0] === pens[1] && k < 30; k++) {
    if (scores(taker(0, k))) pens[0]++;
    if (scores(taker(1, k))) pens[1]++;
  }
  return { et, pens };
}

/** Who goes through a cup tie, once it's decided. */
export function tieWinner(g: GameState, fx: Fixture): string | undefined {
  if (!fx.result) return undefined;
  const r = fx.result;
  if (r.pens) return r.pens[0] > r.pens[1] ? fx.home : fx.away;
  let h = (r.et?.[0] ?? r.home), a = (r.et?.[1] ?? r.away);
  if (fx.tie && fx.leg === 2) {
    const first = g.fixtures.find(x => x.tie === fx.tie && x.leg === 1)?.result;
    // Leg one was played the other way round.
    if (first) { h += first.away; a += first.home; }
  } else if (fx.tie && fx.leg === 1) return undefined;
  return h > a ? fx.home : h < a ? fx.away : undefined;
}

/**
 * Records a finished match: the result, extra time and penalties for a
 * drawn cup tie, player stats, condition, injuries, bans and gate money.
 */
export function recordMatch(g: GameState, fx: Fixture, m: Match): FixtureResult {
  const r: MatchResult = m.result();
  const rng = rngFor(g, 'after', fx.id);
  const result: FixtureResult = {
    home: r.homeGoals, away: r.awayGoals,
    scorers: r.players.filter(p => p.goals > 0).map(p => ({ id: p.playerId, side: p.side, goals: p.goals })),
    motm: r.manOfTheMatch?.playerId,
    attendance: 0,
  };
  fx.result = result;
  if (fx.comp !== 'PL' && (!fx.tie || fx.leg === 2) && !tieWinner(g, fx)) {
    const d = decideTie(m, rng);
    result.et = [r.homeGoals + d.et[0], r.awayGoals + d.et[1]];
    if (d.pens) result.pens = d.pens;
  }

  // Bans are served by sitting out the match.
  const sides = [g.teams[fx.home], g.teams[fx.away]];
  for (const team of sides) {
    const played = new Set(r.players.map(p => p.playerId));
    for (const p of team.squad) {
      const st = g.players[p.id];
      if (st.banned > 0 && !played.has(p.id)) st.banned--;
    }
  }

  const starters = new Set(m.sides.flatMap(s => s.setup.lineup.starters.map(p => p.id)));
  for (const ps of r.players) {
    const p = playerById(g, ps.playerId);
    const st = g.players[ps.playerId];
    if (!p || !st || ps.minutes <= 0) continue;
    const s = st.stats[fx.comp];
    if (starters.has(p.id)) s.apps++; else s.subs++;
    s.goals += ps.goals;
    s.assists += ps.assists;
    s.ratings += Math.max(1, Math.min(10, ps.rating));
    if (result.motm === p.id) s.motm++;
    // Ninety minutes takes 20-30% out of a player; stamina decides how much.
    st.condition = Math.max(35, st.condition - ps.minutes * (0.18 + (20 - p.attributes.stamina) * 0.008));
    st.morale = Math.max(1, Math.min(20, st.morale + (ps.rating >= 7.5 ? 1 : ps.rating < 5.5 ? -1 : 0)));
    if (ps.red) {
      s.reds++;
      // A second yellow costs one match; a straight red three.
      const ban = ps.yellow >= 2 ? 1 : 3;
      st.banned += ban;
      if (st.clubId === g.humanClubId) {
        addNews(g, {
          kind: 'ban', human: true, title: g.teams[st.clubId].name, clubId: st.clubId,
          heading: `${p.name} Suspended`,
          body: `${p.name} will miss the next ${ban === 1 ? 'match' : `${ban} matches`} after his sending off against ${g.teams[st.clubId === fx.home ? fx.away : fx.home].name}.`,
        });
      }
    } else if (ps.yellow > 0) {
      s.yellows += ps.yellow;
      if (fx.comp === 'PL') {
        const before = st.leagueYellows;
        st.leagueYellows += ps.yellow;
        // Five, ten and fifteen bookings bring one, two and three match bans.
        for (const [at, ban] of [[5, 1], [10, 2], [15, 3]] as const) {
          if (before < at && st.leagueYellows >= at) {
            st.banned += ban;
            if (st.clubId === g.humanClubId) {
              addNews(g, {
                kind: 'ban', human: true, title: g.teams[st.clubId].name, clubId: st.clubId,
                heading: `${p.name} Suspended`,
                body: `${p.name} has picked up his ${at === 5 ? 'fifth' : at === 10 ? 'tenth' : 'fifteenth'} booking of the season and will miss the next ${ban === 1 ? 'match' : `${ban} matches`}.`,
              });
            }
          }
        }
      }
    }
    if (ps.injured) injure(g, p, rng, `against ${g.teams[st.clubId === fx.home ? fx.away : fx.home].name}`);
  }

  // Gate money goes to the home club (shared in cup ties).
  const home = g.clubs[fx.home], away = g.clubs[fx.away];
  const pull = Math.max(g.teams[fx.home].reputation, g.teams[fx.away].reputation * 0.9) / 20;
  const fill = Math.min(1, 0.7 + pull * 0.32 + (fx.comp !== 'PL' && fx.round.includes('Final') ? 0.2 : 0));
  const capacity = fx.neutral ? 90000 : home.capacity;
  result.attendance = Math.round(capacity * fill * (0.97 + rng.next() * 0.03));
  const price = home.division === 'PL' ? 48 : home.division === 'CH' ? 28 : 21;
  const gate = result.attendance * price;
  if (fx.comp === 'PL') { home.balance += gate; home.income.gate += gate; }
  else { for (const c of [home, away]) { c.balance += gate / 2; c.income.gate += gate / 2; } }

  if (fx.comp === 'PL' && (fx.home === g.humanClubId || fx.away === g.humanClubId)) updateBoard(g);
  if (fx.comp !== 'PL') afterCupTie(g, fx);
  return result;
}

// ------------------------------------------------------------------ cups

function cupOf(g: GameState, comp: CompId): Cup | undefined {
  return comp === 'LC' ? g.cups.LC : comp === 'FAC' ? g.cups.FAC : undefined;
}

const PRIZE: Record<'LC' | 'FAC', number[]> = {
  // Prize money for winning each round, roughly as paid today.
  LC: [50000, 75000, 100000, 200000, 400000, 2000000],
  FAC: [105000, 120000, 225000, 450000, 1000000, 2000000],
};

function afterCupTie(g: GameState, fx: Fixture) {
  const cup = cupOf(g, fx.comp)!;
  const winner = tieWinner(g, fx);
  if (!winner) return;
  const loser = winner === fx.home ? fx.away : fx.home;
  cup.alive = cup.alive.filter(id => id !== loser);
  const roundIdx = cup.rounds.findIndex(r => r.name === fx.round);
  const prize = PRIZE[cup.id][roundIdx] ?? 0;
  g.clubs[winner].balance += prize;
  g.clubs[winner].income.prize += prize;
  const name = COMP_NAMES[fx.comp];
  if (fx.round === 'Final') {
    cup.winner = winner;
    addNews(g, {
      kind: 'season', human: true, title: name, heading: `${g.teams[winner].name} Win The ${name}`,
      body: `${g.teams[winner].name} beat ${g.teams[loser].name} ${scoreLine(g, fx, winner)} in the ${name} final at Wembley.`,
    });
  } else if (loser === g.humanClubId) {
    addNews(g, {
      kind: 'result', human: true, title: name, heading: `Out Of The ${name}`,
      body: `${g.teams[g.humanClubId].name} are out of the ${name} after losing to ${g.teams[winner].name} in the ${fx.round.toLowerCase()}.`,
    });
  }
}

/** "2-1", "1-1 (4-3 pens)" or "3-2 aet", from the winner's side. */
export function scoreLine(g: GameState, fx: Fixture, from?: string): string {
  const r = fx.result!;
  const flip = from === fx.away;
  const [h, a] = r.et ?? [r.home, r.away];
  const s = flip ? `${a}-${h}` : `${h}-${a}`;
  if (r.pens) return `${s} (${flip ? r.pens[1] : r.pens[0]}-${flip ? r.pens[0] : r.pens[1]} pens)`;
  return r.et ? `${s} aet` : s;
}

function drawRound(g: GameState, cup: Cup, idx: number) {
  const round = cup.rounds[idx];
  round.drawn = true;
  const rng = rngFor(g, 'draw', cup.id, idx);
  const pot = [...cup.alive].sort(() => rng.next() - 0.5);
  const neutral = round.name === 'Final' || (cup.id === 'FAC' && round.name === 'Semi Final');
  const made: Fixture[] = [];
  for (let i = 0; i + 1 < pot.length; i += 2) {
    const [home, away] = [pot[i], pot[i + 1]];
    if (round.dates.length === 2) {
      const tie = newId(g, 't');
      made.push({ id: newId(g, 'f'), comp: cup.id, round: round.name, date: round.dates[0], home, away, tie, leg: 1 });
      made.push({ id: newId(g, 'f'), comp: cup.id, round: round.name, date: round.dates[1], home: away, away: home, tie, leg: 2 });
    } else {
      made.push({ id: newId(g, 'f'), comp: cup.id, round: round.name, date: round.dates[0], home, away, neutral });
    }
  }
  g.fixtures.push(...made);
  const name = COMP_NAMES[cup.id];
  const inIt = cup.alive.includes(g.humanClubId);
  const mine = made.find(f => f.home === g.humanClubId || f.away === g.humanClubId);
  const opp = mine && g.teams[mine.home === g.humanClubId ? mine.away : mine.home];
  addNews(g, {
    kind: 'draw', human: inIt, title: name, heading: `${round.name} Draw`,
    body: opp
      ? `${g.teams[g.humanClubId].name} will play ${opp.name} (${DIVISION_TAGS[g.clubs[opp.id].division]}) ${neutral ? 'at Wembley' : mine!.home === g.humanClubId ? 'at home' : 'away'} on ${dayMonth(mine!.date)}.`
      : `The ${round.name.toLowerCase()} of the ${name} has been drawn.`,
    fixtures: made.filter(f => f.leg !== 2).map(f => f.id),
  });
}

function cupDay(g: GameState) {
  for (const cup of [g.cups.LC, g.cups.FAC]) {
    cup.rounds.forEach((r, i) => {
      if (!r.drawn && r.draw <= g.date && (i === 0 || cupRoundDone(g, cup, i - 1))) drawRound(g, cup, i);
    });
  }
}

function cupRoundDone(g: GameState, cup: Cup, idx: number): boolean {
  const name = cup.rounds[idx].name;
  const fx = g.fixtures.filter(f => f.comp === cup.id && f.round === name);
  return cup.rounds[idx].drawn && fx.every(f => f.result);
}

// ------------------------------------------------------------------ the board

/** The board's confidence follows the league position against what the club's standing promises. */
function updateBoard(g: GameState) {
  const table = leagueTable(g);
  const pos = table.findIndex(r => r.clubId === g.humanClubId) + 1;
  const expected = [...table].sort((a, b) => g.teams[b.clubId].reputation - g.teams[a.clubId].reputation)
    .findIndex(r => r.clubId === g.humanClubId) + 1;
  const played = table[0].p;
  const weight = Math.min(1, played / 10);
  const target = 60 + (expected - pos) * 5 * weight;
  g.board = Math.round(Math.max(0, Math.min(100, g.board + (target - g.board) * 0.25)));
}

export function expectedFinish(g: GameState): number {
  const table = leagueTable(g);
  return [...table].sort((a, b) => g.teams[b.clubId].reputation - g.teams[a.clubId].reputation)
    .findIndex(r => r.clubId === g.humanClubId) + 1;
}

// ------------------------------------------------------------------ a day

/** Plays every match due today except the human's own. */
export function playOtherMatches(g: GameState) {
  for (const fx of fixturesOn(g, g.date)) {
    if (fx.result || fx.home === g.humanClubId || fx.away === g.humanClubId) continue;
    const m = createMatch(g, fx, undefined, false);
    m.playToEnd();
    recordMatch(g, fx, m);
  }
}

function newDay(g: GameState) {
  g.date = addDays(g.date, 1);
  const day = g.date;
  const rng = rngFor(g, 'day', day);
  for (const [id, st] of Object.entries(g.players)) {
    const p = playerById(g, id);
    if (!p) continue;
    st.condition = Math.min(100, st.condition + 6 + p.attributes.stamina * 0.25);
    if (st.injury && st.injury.until <= day) {
      st.injury = undefined;
      if (st.clubId === g.humanClubId) {
        addNews(g, { kind: 'injury', human: true, title: g.teams[st.clubId].name, clubId: st.clubId, heading: `${p.name} Fit Again`, body: `${p.name} has recovered from injury and is available for selection.` });
      }
    } else if (!st.injury && rng.chance(0.0004 * (0.5 + p.attributes.injuryProneness / 10))) {
      injure(g, p, rng, 'in training');
    }
  }

  // Wages go out every Monday; television money on the first of each month in the season.
  if (weekday(day) === 1) {
    for (const c of Object.values(g.clubs)) {
      const bill = wageBill(g, c.id);
      c.balance -= bill;
      c.spend.wages += bill;
    }
  }
  if (day.endsWith('-01') && day >= '2026-08-01' && day <= '2027-05-01') {
    for (const c of Object.values(g.clubs)) {
      const tv = c.division === 'PL' ? 11e6 : c.division === 'CH' ? 1e6 : 0.15e6;
      c.balance += tv;
      c.income.tv += tv;
    }
  }

  for (const w of SEASON.windows) {
    if (day === w.close) {
      addNews(g, { kind: 'transfer', human: true, title: 'Transfer Window', heading: 'Transfer Window Closes', body: 'The transfer window closes tonight. No more signings can be registered until it opens again.' });
    } else if (day === w.open && day > SEASON.start) {
      addNews(g, { kind: 'transfer', human: true, title: 'Transfer Window', heading: 'Transfer Window Opens', body: 'The transfer window is open. Clubs can buy and sell players until it closes.' });
    }
  }
  if (day === '2026-08-21') seasonPreview(g);

  cupDay(g);
  transferDay(g);
  if (!g.over && day > LEAGUE_DATES[LEAGUE_DATES.length - 1] && seasonFinished(g)) endSeason(g);
}

function seasonFinished(g: GameState): boolean {
  return g.fixtures.every(f => f.result) && !!g.cups.FAC.winner && !!g.cups.LC.winner;
}

function seasonPreview(g: GameState) {
  const exp = expectedFinish(g);
  const aim = exp <= 1 ? 'win the league' : exp <= 4 ? 'finish in the top four' : exp <= 7 ? 'qualify for Europe' : exp <= 12 ? 'finish in the top half' : exp <= 16 ? 'finish clear of trouble' : 'avoid relegation';
  addNews(g, {
    kind: 'board', human: true, title: g.teams[g.humanClubId].name, clubId: g.humanClubId,
    heading: 'The Board\'s Expectations',
    body: `The board expect you to ${aim} this season. Your transfer budget is ${money(g.clubs[g.humanClubId].transferBudget)}.`,
  });
}

function endSeason(g: GameState) {
  g.over = true;
  const table = leagueTable(g);
  const champ = g.teams[table[0].clubId];
  const down = table.slice(-3).map(r => g.teams[r.clubId].name);
  const pos = table.findIndex(r => r.clubId === g.humanClubId) + 1;
  const scorers = Object.entries(g.players)
    .filter(([, st]) => g.clubs[st.clubId]?.division === 'PL')
    .sort((a, b) => b[1].stats.PL.goals - a[1].stats.PL.goals)[0];
  const top = scorers && playerById(g, scorers[0]);
  addNews(g, {
    kind: 'season', human: true, title: 'Premier League', heading: `${champ.name} Are Champions`,
    body: `${champ.name} are the 2026/27 Premier League champions with ${table[0].pts} points. ${down.join(', ')} are relegated. ${top ? `${top.name} (${g.teams[scorers[1].clubId].shortName}) won the Golden Boot with ${scorers[1].stats.PL.goals} goals.` : ''}`,
  });
  addNews(g, {
    kind: 'board', human: true, title: g.teams[g.humanClubId].name, clubId: g.humanClubId,
    heading: 'End Of Season',
    body: `${g.teams[g.humanClubId].name} finished ${ordinal(pos)} in the Premier League. The board's confidence in you stands at ${g.board}%.`,
  });
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

export type Stop = { kind: 'match'; fixture: Fixture } | { kind: 'news' } | { kind: 'over' };

/**
 * Moves the game on to the next thing the human must see: unread news, his
 * own match, or the end of the season. Today's other matches are played first.
 */
export function advance(g: GameState, maxDays = 400): Stop {
  for (let i = 0; i < maxDays; i++) {
    playOtherMatches(g);
    const mine = humanMatchToday(g);
    if (unreadNews(g).length) return { kind: 'news' };
    if (mine) return { kind: 'match', fixture: mine };
    if (g.over) return { kind: 'over' };
    newDay(g);
  }
  return { kind: 'news' };
}

export function daysUntil(g: GameState, date: ISODate): number {
  return daysBetween(g.date, date);
}

export { windowOpen };
