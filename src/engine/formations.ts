import type { FormationName, Line, Position, Run } from './types';

/** Each formation is eleven slots, goalkeeper first. */
export const FORMATIONS: Record<FormationName, Position[]> = {
  '4-4-2': ['GK', 'DR', 'DC', 'DC', 'DL', 'MR', 'MC', 'MC', 'ML', 'ST', 'ST'],
  '4-3-3': ['GK', 'DR', 'DC', 'DC', 'DL', 'MC', 'MC', 'MC', 'AMR', 'ST', 'AML'],
  '4-2-3-1': ['GK', 'DR', 'DC', 'DC', 'DL', 'DM', 'DM', 'AMR', 'AMC', 'AML', 'ST'],
  '3-5-2': ['GK', 'DC', 'DC', 'DC', 'MR', 'MC', 'DM', 'MC', 'ML', 'ST', 'ST'],
  '5-3-2': ['GK', 'DR', 'DC', 'DC', 'DC', 'DL', 'MC', 'MC', 'MC', 'ST', 'ST'],
  '4-5-1': ['GK', 'DR', 'DC', 'DC', 'DL', 'MR', 'MC', 'DM', 'MC', 'ML', 'ST'],
  '4-1-4-1': ['GK', 'DR', 'DC', 'DC', 'DL', 'DM', 'MR', 'MC', 'MC', 'ML', 'ST'],
  '3-4-3': ['GK', 'DC', 'DC', 'DC', 'MR', 'MC', 'MC', 'ML', 'AMR', 'ST', 'AML'],
  '4-4-2 Diamond': ['GK', 'DR', 'DC', 'DC', 'DL', 'DM', 'MC', 'MC', 'AMC', 'ST', 'ST'],
};

export function lineOf(pos: Position): Line {
  switch (pos) {
    case 'GK': return 'GK';
    case 'DL': case 'DC': case 'DR': return 'DEF';
    case 'DM': case 'ML': case 'MC': case 'MR': return 'MID';
    default: return 'ATT';
  }
}

export function isWide(pos: Position): boolean {
  return pos === 'DL' || pos === 'DR' || pos === 'ML' || pos === 'MR' || pos === 'AML' || pos === 'AMR';
}

/**
 * How much a player's work in a slot counts towards each phase of play.
 * defence, midfield, attack.
 */
export const SLOT_WEIGHTS: Record<Position, [number, number, number]> = {
  GK: [0, 0, 0],
  DC: [1.0, 0.15, 0.05],
  DL: [0.75, 0.35, 0.25],
  DR: [0.75, 0.35, 0.25],
  DM: [0.55, 0.8, 0.1],
  MC: [0.25, 1.0, 0.4],
  ML: [0.2, 0.75, 0.6],
  MR: [0.2, 0.75, 0.6],
  AMC: [0.05, 0.6, 0.9],
  AML: [0.05, 0.4, 0.95],
  AMR: [0.05, 0.4, 0.95],
  ST: [0.05, 0.15, 1.0],
};

/** Familiarity (0-1) of a player with a slot, given his listed positions. */
export function familiarity(positions: Position[], slot: Position): number {
  const idx = positions.indexOf(slot);
  if (idx === 0) return 1;
  if (idx > 0) return 0.95;
  const line = lineOf(slot);
  if (line === 'GK' || positions[0] === 'GK') return 0.2;
  // Same line, different side: decent. Neighbouring line: weaker.
  if (positions.some(p => lineOf(p) === line)) return 0.85;
  const order: Line[] = ['DEF', 'MID', 'ATT'];
  const near = positions.some(p => Math.abs(order.indexOf(lineOf(p)) - order.indexOf(line)) === 1);
  return near ? 0.7 : 0.5;
}

/**
 * Slot weights adjusted for a player's runs: getting forward adds to attack
 * and leaves a gap behind; holding position does the opposite.
 */
export function slotWeights(slot: Position, run: Run): [number, number, number] {
  const [d, m, a] = SLOT_WEIGHTS[slot];
  if (slot === 'GK' || run === 'normal') return [d, m, a];
  if (run === 'forward') return [d * 0.65, m, Math.min(1.1, a + 0.3)];
  return [Math.min(1.1, d + 0.25), m, a * 0.5];
}
