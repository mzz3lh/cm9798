// Phase 2 gate: plays a whole 2026/27 season with the computer managing the
// human's club too, and checks that it runs, that the league and cups finish,
// and how long a person would spend playing it.
// Run: npx tsx scripts/season.ts [club id] [seed]

import { CHAMPIONSHIP, LEAGUE_ONE } from '../src/data/football-league';
import { PREMIER_LEAGUE } from '../src/data/premier-league';
import { money } from '../src/engine/economy';
import { advance, createMatch, leagueTable, recordMatch } from '../src/engine/season';
import { createGame, playerById, COMP_NAMES } from '../src/engine/world';

const clubId = process.argv[2] ?? 'ars';
const seed = Number(process.argv[3] ?? 7);
const t0 = performance.now();
const g = createGame({ PL: PREMIER_LEAGUE, CH: CHAMPIONSHIP, L1: LEAGUE_ONE }, clubId, seed);

let stops = 0, humanMatches = 0, liveEvents = 0, newsRead = 0;
for (;;) {
  const stop = advance(g);
  stops++;
  if (stop.kind === 'over') break;
  if (stop.kind === 'news') {
    for (const n of g.news) if (n.human && !n.read) { n.read = true; newsRead++; }
    continue;
  }
  // The human's match, managed by the computer, with commentary on to count the lines a person would watch.
  const m = createMatch(g, stop.fixture, undefined, true);
  m.playToEnd();
  liveEvents += m.events.filter(e => e.importance > 0 || e.type === 'build' || e.type === 'chance').length;
  recordMatch(g, stop.fixture, m);
  humanMatches++;
}
const ms = performance.now() - t0;

const table = leagueTable(g);
console.log(`Season simulated in ${(ms / 1000).toFixed(1)}s: ${g.fixtures.length} fixtures, ${stops} stops, ${newsRead} news items for the manager.`);
console.log('\nFinal table');
table.forEach((r, i) => console.log(`${String(i + 1).padStart(2)} ${g.teams[r.clubId].name.padEnd(26)} ${String(r.p).padStart(2)} ${String(r.w).padStart(2)} ${String(r.d).padStart(2)} ${String(r.l).padStart(2)} ${String(r.f).padStart(3)}-${String(r.a).padEnd(3)} ${String(r.pts).padStart(3)}`));
const goals = table.reduce((a, r) => a + r.f, 0), games = table.reduce((a, r) => a + r.p, 0) / 2;
console.log(`\nGoals per game ${(goals / games).toFixed(2)} (real 2.7-2.9). Champions on ${table[0].pts} points (real 82-95), bottom ${table[19].pts} (real 16-35).`);
for (const id of ['LC', 'FAC'] as const) console.log(`${COMP_NAMES[id]} winners: ${g.teams[g.cups[id].winner!].name}`);

const scorers = Object.entries(g.players).filter(([, s]) => s.stats.PL.goals > 0).sort((a, b) => b[1].stats.PL.goals - a[1].stats.PL.goals).slice(0, 5);
console.log('\nTop scorers: ' + scorers.map(([id, s]) => `${playerById(g, id)!.name} (${g.teams[s.clubId].shortName}) ${s.stats.PL.goals}`).join(', '));
const allStates = Object.values(g.players);
console.log(`Injuries now: ${allStates.filter(s => s.injury).length}, transfers: ${g.transfers.length} (${g.transfers.slice(0, 5).map(t => `${t.name} to ${g.teams[t.to].shortName} ${money(t.fee)}`).join('; ')})`);

// Time a person spends: each commentary line is shown for about the normal speed's delay
// (0.825s, longer for key moments), plus about 90s of team selection and menus per match
// and 6s per news item or stop.
const watch = liveEvents * 0.825 * 1.15;
const playSeconds = watch + humanMatches * 90 + (stops + newsRead) * 6;
console.log(`\n${humanMatches} matches for the manager. Estimated play time at normal speed: ${(playSeconds / 3600).toFixed(1)} hours (gate: under 4).`);
const ok = !!g.over && table.every(r => r.p === 38) && !!g.cups.LC.winner && !!g.cups.FAC.winner && playSeconds < 4 * 3600;
console.log(ok ? 'GATE PASSED' : 'GATE FAILED');
process.exit(ok ? 0 : 1);
