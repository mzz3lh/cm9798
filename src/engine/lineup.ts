import { FORMATIONS, familiarity } from './formations';
import type { FormationName, Lineup, Player, Team } from './types';

/**
 * Picks the strongest eleven for a formation: each slot takes the best
 * remaining player for it, filling the hardest-to-fill slots first.
 */
export function autoLineup(team: Team, formation: FormationName, unavailable: Set<string> = new Set()): Lineup {
  const slots = FORMATIONS[formation];
  const pool = team.squad.filter(p => !unavailable.has(p.id));
  const chosen: (Player | undefined)[] = new Array(slots.length);
  const used = new Set<string>();

  // Order slots by how few natural players exist for them.
  const order = slots
    .map((slot, i) => ({ slot, i, n: pool.filter(p => p.positions.includes(slot)).length }))
    .sort((a, b) => a.n - b.n);

  for (const { slot, i } of order) {
    let best: Player | undefined;
    let bestScore = -1;
    for (const p of pool) {
      if (used.has(p.id)) continue;
      const score = p.ability * familiarity(p.positions, slot);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best) { chosen[i] = best; used.add(best.id); }
  }

  const starters = chosen.filter((p): p is Player => !!p);
  const rest = pool.filter(p => !used.has(p.id)).sort((a, b) => b.ability - a.ability);
  // Bench of nine, always with a reserve keeper if there is one.
  const keeper = rest.find(p => p.positions[0] === 'GK');
  const bench = [...(keeper ? [keeper] : []), ...rest.filter(p => p !== keeper)].slice(0, 9);
  return { starters, bench };
}
