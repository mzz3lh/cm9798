// Balance check: plays whole seasons of a generated 20-club league and
// compares the averages with real Premier League figures.
// Run: npx tsx scripts/balance.ts [seasons]

import { makePlayer } from '../src/engine/generate';
import { autoLineup } from '../src/engine/lineup';
import { Match } from '../src/engine/match';
import { Rng } from '../src/engine/rng';
import type { FormationName, Position, Tactic, Team } from '../src/engine/types';

const SQUAD_SHAPE: Position[] = [
  'GK', 'GK', 'DR', 'DR', 'DC', 'DC', 'DC', 'DC', 'DL', 'DL', 'DM', 'DM', 'MC', 'MC', 'MC',
  'AMR', 'AMR', 'AML', 'AML', 'AMC', 'ST', 'ST', 'ST',
];
const FORMATIONS: FormationName[] = ['4-4-2', '4-3-3', '4-2-3-1', '4-1-4-1', '3-5-2'];

function makeLeague(seed: number): Team[] {
  const rng = new Rng(seed);
  const teams: Team[] = [];
  for (let t = 0; t < 20; t++) {
    // Spread similar to the Premier League: top clubs ~165, bottom ~125.
    const level = 165 - t * 2.1;
    const squad = SQUAD_SHAPE.map((pos, i) => makePlayer({
      id: `t${t}-p${i}-${seed}`,
      name: `Player ${t}-${i}`,
      nation: 'England',
      age: rng.int(19, 33),
      positions: [pos],
      ability: Math.round(level + rng.normal(0, 8) - (i % 2 === 1 ? 12 : 0)),
    }));
    teams.push({
      id: `t${t}`, name: `Club ${t + 1}`, shortName: `Club ${t + 1}`, reputation: 20 - Math.floor(t / 2),
      stadium: 'Ground', colours: { primary: '#000', secondary: '#fff' }, squad,
    });
  }
  return teams;
}

function tacticFor(team: Team, i: number): Tactic {
  return {
    formation: FORMATIONS[i % FORMATIONS.length], mentality: 0, passing: 'mixed',
    pressing: 'mid', width: 'normal', counterAttack: false, offsideTrap: false,
  };
}

const seasons = Number(process.argv[2] ?? 5);
let matches = 0, goals = 0, homeWins = 0, draws = 0, shots = 0, onTarget = 0, yellows = 0, reds = 0,
  corners = 0, fouls = 0, xg = 0;
let gkMotm = 0, ultraMatches = 0, bigGapMatches = 0, bigGapUltra = 0, bigGapKeeperHero = 0;
const scorelines = new Map<string, number>();
let topGoals = 0, topTeamPoints = 0, bottomTeamPoints = 0;

for (let s = 0; s < seasons; s++) {
  const league = makeLeague(1000 + s);
  const points = new Map<string, number>(league.map(t => [t.id, 0]));
  const scorers = new Map<string, number>();
  for (let h = 0; h < league.length; h++) {
    for (let a = 0; a < league.length; a++) {
      if (h === a) continue;
      const home = league[h], away = league[a];
      const ht = tacticFor(home, h), at = tacticFor(away, a);
      const m = new Match(
        { team: home, lineup: autoLineup(home, ht.formation), tactic: ht, ai: true },
        { team: away, lineup: autoLineup(away, at.formation), tactic: at, ai: true },
        { seed: s * 100000 + h * 100 + a, commentary: false },
      );
      const r = m.playToEnd();
      matches++;
      goals += r.homeGoals + r.awayGoals;
      if (r.homeGoals > r.awayGoals) { homeWins++; points.set(home.id, points.get(home.id)! + 3); }
      else if (r.homeGoals === r.awayGoals) { draws++; points.set(home.id, points.get(home.id)! + 1); points.set(away.id, points.get(away.id)! + 1); }
      else points.set(away.id, points.get(away.id)! + 3);
      for (const st of r.stats) {
        shots += st.shots; onTarget += st.onTarget; yellows += st.yellows; reds += st.reds;
        corners += st.corners; fouls += st.fouls; xg += st.xg;
      }
      for (const pl of r.players) scorers.set(pl.playerId, (scorers.get(pl.playerId) ?? 0) + pl.goals);
      const key = `${Math.min(r.homeGoals, 5)}-${Math.min(r.awayGoals, 5)}`;
      scorelines.set(key, (scorelines.get(key) ?? 0) + 1);
      if (r.motmPlayer.positions[0] === 'GK') gkMotm++;
      // Matches where a much stronger side met a much weaker one (gap of 8+ league places).
      const ultra = r.events.some(e => e.type === 'build' && /behind the ball|defending deep/.test(e.text))
        || r.mentalities.includes(-2);
      // Mentality is only known at the end, so also check the start via a fresh match is costly; use the end state.
      if (r.mentalities.includes(-2)) ultraMatches++;
      if (Math.abs(h - a) >= 8) {
        bigGapMatches++;
        const weakSide = h > a ? 0 : 1;
        if (r.mentalities[weakSide] === -2) bigGapUltra++;
        const strongGoals = weakSide === 0 ? r.awayGoals : r.homeGoals;
        const weakGoals = weakSide === 0 ? r.homeGoals : r.awayGoals;
        const motmSide = r.manOfTheMatch.side;
        if (strongGoals <= weakGoals && motmSide === weakSide && r.motmPlayer.positions[0] === 'GK') bigGapKeeperHero++;
      }
      void ultra;
    }
  }
  topGoals += Math.max(...scorers.values());
  if (s === 0) {
    const byPos = new Map<string, number>();
    for (const t of league) for (const pl of t.squad) byPos.set(pl.positions[0], (byPos.get(pl.positions[0]) ?? 0) + (scorers.get(pl.id) ?? 0));
    console.log('Goals by position, season 1:', [...byPos.entries()].map(([k, v]) => `${k} ${v}`).join(', '));
    console.log('Top 5 scorers:', [...scorers.values()].sort((x, y) => y - x).slice(0, 5).join(', '));
  }
  const sorted = [...points.values()].sort((x, y) => y - x);
  topTeamPoints += sorted[0];
  bottomTeamPoints += sorted[19];
}

const pct = (n: number) => `${((100 * n) / matches).toFixed(1)}%`;
const per = (n: number) => (n / matches).toFixed(2);
console.log(`Seasons: ${seasons}, matches: ${matches}`);
console.log('Measure                 Engine    Real PL (approx)');
console.log(`Goals per match         ${per(goals).padEnd(9)} 2.7 to 2.9`);
console.log(`Home wins               ${pct(homeWins).padEnd(9)} 43 to 46%`);
console.log(`Draws                   ${pct(draws).padEnd(9)} 22 to 25%`);
console.log(`Away wins               ${pct(matches - homeWins - draws).padEnd(9)} 30 to 33%`);
console.log(`Shots per match         ${per(shots).padEnd(9)} 24 to 26`);
console.log(`On target per match     ${per(onTarget).padEnd(9)} 8 to 9`);
console.log(`xG per match            ${per(xg).padEnd(9)} 2.7 to 3.0`);
console.log(`Corners per match       ${per(corners).padEnd(9)} 10 to 11`);
console.log(`Fouls per match         ${per(fouls).padEnd(9)} 21 to 23`);
console.log(`Yellows per match       ${per(yellows).padEnd(9)} 3.5 to 4.3`);
console.log(`Reds per match          ${per(reds).padEnd(9)} 0.08 to 0.15`);
console.log(`Top scorer goals        ${(topGoals / seasons).toFixed(1).padEnd(9)} 22 to 30`);
console.log(`Champion points         ${(topTeamPoints / seasons).toFixed(1).padEnd(9)} 85 to 95`);
console.log(`Bottom club points      ${(bottomTeamPoints / seasons).toFixed(1).padEnd(9)} 15 to 30`);
console.log(`Keeper man of the match ${pct(gkMotm).padEnd(9)} target under 10%`);
console.log(`Ended ultra defensive   ${pct(ultraMatches).padEnd(9)} target under 15%`);
console.log(`Big gap: weak side ultra defensive        ${((100 * bigGapUltra) / bigGapMatches).toFixed(1)}%`);
console.log(`Big gap: underdog keeper MOTM, no defeat  ${((100 * bigGapKeeperHero) / bigGapMatches).toFixed(1)}%  (target: rare, under 3%)`);
const top = [...scorelines.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8)
  .map(([k, v]) => `${k} ${pct(v)}`).join(', ');
console.log(`Most common scores: ${top}`);
