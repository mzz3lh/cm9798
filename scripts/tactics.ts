// Checks that tactics visibly change what happens on the pitch.
// Run: npx tsx scripts/tactics.ts
import { ARSENAL, LIVERPOOL, BURNLEY } from '../src/data/squads';
import { autoLineup } from '../src/engine/lineup';
import { Match } from '../src/engine/match';
import { MENTALITY_NAMES, type Mentality, type Tactic, type Team } from '../src/engine/types';

const base: Tactic = { formation: '4-3-3', mentality: 0, passing: 'mixed', pressing: 'mid', width: 'normal', counterAttack: false, offsideTrap: false };
const N = 400;

function run(label: string, us: Team, them: Team, tactic: Tactic) {
  let gf = 0, ga = 0, sf = 0, sa = 0, poss = 0, w = 0, d = 0, xgf = 0, xga = 0;
  for (let i = 0; i < N; i++) {
    const m = new Match(
      { team: us, lineup: autoLineup(us, tactic.formation), tactic: { ...tactic }, ai: false },
      { team: them, lineup: autoLineup(them, '4-2-3-1'), tactic: { ...base, formation: '4-2-3-1' }, ai: true },
      { seed: 7000 + i, commentary: false },
    );
    const r = m.playToEnd();
    gf += r.homeGoals; ga += r.awayGoals; sf += r.stats[0].shots; sa += r.stats[1].shots;
    xgf += r.stats[0].xg; xga += r.stats[1].xg;
    poss += r.stats[0].possessionMinutes / (r.stats[0].possessionMinutes + r.stats[1].possessionMinutes);
    if (r.homeGoals > r.awayGoals) w++; else if (r.homeGoals === r.awayGoals) d++;
  }
  const f = (x: number) => (x / N).toFixed(2);
  console.log(`${label.padEnd(28)} W ${(100 * w / N).toFixed(0).padStart(3)}%  D ${(100 * d / N).toFixed(0).padStart(3)}%  goals ${f(gf)}-${f(ga)}  shots ${f(sf)}-${f(sa)}  xG ${f(xgf)}-${f(xga)}  possession ${(100 * poss / N).toFixed(0)}%`);
}

for (const [us, them] of [[ARSENAL, LIVERPOOL], [BURNLEY, ARSENAL]] as const) {
  console.log(`\n${us.name} (home, you) v ${them.name} (AI)`);
  for (const m of [-2, -1, 0, 1, 2] as Mentality[]) run(MENTALITY_NAMES[m], us, them, { ...base, mentality: m });
  run('High press', us, them, { ...base, pressing: 'high' });
  run('Low block, counter', us, them, { ...base, mentality: -1, pressing: 'low', counterAttack: true });
  run('Direct, wide', us, them, { ...base, passing: 'direct', width: 'wide' });
  run('4-4-2', us, them, { ...base, formation: '4-4-2' });
  run('5-3-2', us, them, { ...base, formation: '5-3-2' });
}
