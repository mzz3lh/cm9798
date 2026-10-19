// Fills in anything the database leaves at 0, following the original's rule:
// "only enter it if you are sure, otherwise leave it blank and the game will
// generate appropriate values". Generation is seeded by the player's id, so
// the same player gets the same values every time.

import { Rng, hashString } from './rng';
import { lineOf } from './formations';
import {
  VISIBLE_ATTRIBUTES, HIDDEN_ATTRIBUTES, TENDENCIES,
  type Attribute, type Attributes, type Player, type Position, type Tendencies, type Tendency,
} from './types';

type Profile = Partial<Record<Attribute, number>>;

/** Typical strengths by line, on the 0-20 scale (10 = average for his level). */
const PROFILES: Record<'GK' | 'DEF' | 'MID' | 'ATT' | 'WIDE', Profile> = {
  GK: {
    heading: 13, pace: 11, passing: 10, positioning: 14, tackling: 14, handling: 14,
    shooting: 2, dribbling: 3, creativity: 4, flair: 4, offTheBall: 2, marking: 3,
    composure: 12, decisions: 12, firstTouch: 8, technique: 8,
  },
  DEF: {
    tackling: 14, marking: 14, positioning: 14, heading: 13, strength: 13,
    shooting: 5, dribbling: 7, creativity: 7, flair: 6, offTheBall: 7, setPieces: 7,
    handling: 1,
  },
  MID: {
    passing: 14, creativity: 12, technique: 12, workRate: 13, stamina: 13, decisions: 13,
    firstTouch: 13, tackling: 10, marking: 9, heading: 8, handling: 1,
  },
  ATT: {
    shooting: 15, offTheBall: 15, composure: 13, heading: 11, dribbling: 12, pace: 13,
    tackling: 5, marking: 4, positioning: 5, workRate: 10, handling: 1,
  },
  WIDE: {
    pace: 15, dribbling: 14, flair: 13, creativity: 12, passing: 12, offTheBall: 13,
    shooting: 11, heading: 7, tackling: 7, marking: 7, handling: 1,
  },
};

const TENDENCY_PROFILES: Record<'GK' | 'DEF' | 'MID' | 'ATT' | 'WIDE', Partial<Tendencies>> = {
  GK: { comesOffLine: 10, staysBack: 20 },
  DEF: { staysBack: 15, attacksCrosses: 8, divesIntoTackles: 10, shootsOnSight: 3 },
  MID: { triesKillerPasses: 10, shootsOnSight: 8, staysBack: 9, divesIntoTackles: 9 },
  ATT: { shootsOnSight: 12, attacksCrosses: 11, dribblesAtDefenders: 9, staysBack: 2 },
  WIDE: { dribblesAtDefenders: 13, shootsOnSight: 9, triesKillerPasses: 9, staysBack: 5 },
};

function profileKey(pos: Position): 'GK' | 'DEF' | 'MID' | 'ATT' | 'WIDE' {
  if (pos === 'AML' || pos === 'AMR' || pos === 'ML' || pos === 'MR') return 'WIDE';
  return lineOf(pos);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface PlayerSeed {
  id?: string;
  name: string;
  shortName?: string;
  nation: string;
  age: number;
  positions: Position[];
  ability: number;
  potential?: number;
  reputation?: number;
  attributes?: Partial<Attributes>;
  tendencies?: Partial<Tendencies>;
}

export function makePlayer(seed: PlayerSeed): Player {
  const id = seed.id ?? seed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const rng = new Rng(hashString(id));
  const key = profileKey(seed.positions[0]);
  const profile = PROFILES[key];

  const attributes = {} as Attributes;
  const all: Attribute[] = [...VISIBLE_ATTRIBUTES, ...HIDDEN_ATTRIBUTES, 'handling'];
  for (const attr of all) {
    const given = seed.attributes?.[attr];
    if (given && given > 0) {
      attributes[attr] = clamp(Math.round(given), 1, 20);
      continue;
    }
    let base: number;
    if ((HIDDEN_ATTRIBUTES as readonly string[]).includes(attr)) {
      // Hidden traits are spread wide and are independent of position.
      base = attr === 'dirtiness' || attr === 'injuryProneness' ? 7 : 12;
      attributes[attr] = clamp(Math.round(rng.normal(base, 3.5)), 1, 20);
      continue;
    }
    base = profile[attr] ?? 10;
    // Physical decline with age, as in the original (no maximums under 18 or over 28).
    if ((attr === 'pace' || attr === 'stamina') && seed.age > 30) base -= (seed.age - 30) * 0.8;
    if (attr === 'strength' && seed.age < 20) base -= (20 - seed.age);
    attributes[attr] = clamp(Math.round(rng.normal(base, 2.5)), 1, 20);
  }

  const tendencies = {} as Tendencies;
  const tProfile = TENDENCY_PROFILES[key];
  for (const t of TENDENCIES as readonly Tendency[]) {
    const given = seed.tendencies?.[t];
    if (given && given > 0) {
      tendencies[t] = clamp(Math.round(given), 1, 20);
    } else {
      tendencies[t] = clamp(Math.round(rng.normal(tProfile[t] ?? 7, 2.5)), 1, 20);
    }
  }

  const potential = seed.potential && seed.potential > 0
    ? Math.max(seed.potential, seed.ability)
    : Math.max(seed.ability, Math.round(seed.ability + Math.max(0, 24 - seed.age) * rng.int(2, 6)));

  return {
    id,
    name: seed.name,
    shortName: seed.shortName ?? seed.name.split(' ').slice(-1)[0],
    nation: seed.nation,
    age: seed.age,
    positions: seed.positions,
    ability: clamp(seed.ability, 1, 200),
    potential: clamp(potential, 1, 200),
    reputation: seed.reputation ?? seed.ability,
    attributes,
    tendencies,
  };
}
