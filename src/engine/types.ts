// Core data model. Scales follow CM97/98: ability, potential and reputation
// are 0-200; attributes and tendencies are 0-20, where 0 means "not known,
// generate it in game".

export const VISIBLE_ATTRIBUTES = [
  'aggression', 'creativity', 'determination', 'dribbling', 'flair', 'heading',
  'influence', 'marking', 'offTheBall', 'pace', 'passing', 'positioning',
  'setPieces', 'shooting', 'stamina', 'strength', 'tackling', 'technique',
  // Added in the remake
  'composure', 'decisions', 'workRate', 'firstTouch',
] as const;

export const HIDDEN_ATTRIBUTES = [
  'adaptability', 'bigOccasion', 'character', 'consistency', 'dirtiness', 'injuryProneness',
] as const;

/** Goalkeepers reuse outfield slots as in the original, plus handling. */
export const GOALKEEPER_ATTRIBUTES = ['handling'] as const;

/** Hidden tendencies: what a player chooses to do, not how well he does it. */
export const TENDENCIES = [
  'shootsOnSight', 'attacksCrosses', 'triesKillerPasses', 'dribblesAtDefenders',
  'staysBack', 'divesIntoTackles', 'comesOffLine',
] as const;

export type VisibleAttribute = (typeof VISIBLE_ATTRIBUTES)[number];
export type HiddenAttribute = (typeof HIDDEN_ATTRIBUTES)[number];
export type Tendency = (typeof TENDENCIES)[number];
export type Attribute = VisibleAttribute | HiddenAttribute | 'handling';

export type Attributes = Record<Attribute, number>;
export type Tendencies = Record<Tendency, number>;

/** Pitch positions a player can fill. */
export const POSITIONS = [
  'GK', 'DL', 'DC', 'DR', 'DM', 'ML', 'MC', 'MR', 'AML', 'AMC', 'AMR', 'ST',
] as const;
export type Position = (typeof POSITIONS)[number];

export type Line = 'GK' | 'DEF' | 'MID' | 'ATT';

export interface Player {
  id: string;
  name: string;
  /** Name used in commentary. */
  shortName: string;
  nation: string;
  age: number;
  /** Positions in order of preference; the first is natural. */
  positions: Position[];
  ability: number;
  potential: number;
  reputation: number;
  attributes: Attributes;
  tendencies: Tendencies;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  /** Club reputation 1-20, as in the original team database. */
  reputation: number;
  stadium: string;
  colours: { primary: string; secondary: string };
  squad: Player[];
}

export type Mentality = -2 | -1 | 0 | 1 | 2;
export const MENTALITY_NAMES: Record<Mentality, string> = {
  [-2]: 'Ultra defensive',
  [-1]: 'Defensive',
  0: 'Normal',
  1: 'Attacking',
  2: 'All out attack',
};

export type PassingStyle = 'short' | 'mixed' | 'direct';
export type Pressing = 'low' | 'mid' | 'high';
export type Width = 'narrow' | 'normal' | 'wide';

export interface Tactic {
  formation: FormationName;
  mentality: Mentality;
  passing: PassingStyle;
  pressing: Pressing;
  width: Width;
  counterAttack: boolean;
  offsideTrap: boolean;
}

export type FormationName =
  | '4-4-2' | '4-3-3' | '4-2-3-1' | '3-5-2' | '5-3-2' | '4-5-1' | '4-1-4-1' | '3-4-3' | '4-4-2 Diamond';

/** The runs a player makes, shown as arrows on the original's tactics pitch. */
export type Run = 'hold' | 'normal' | 'forward';
export const RUN_NAMES: Record<Run, string> = { hold: 'Hold position', normal: 'Normal', forward: 'Get forward' };

export interface Lineup {
  /** Eleven players, matched one to one with the formation's slots. */
  starters: Player[];
  bench: Player[];
  /** Optional per-player positions that override the formation's slots. */
  slots?: Position[];
  /** Optional runs per player id; anyone missing plays 'normal'. */
  runs?: Record<string, Run>;
}

export type MatchEventType =
  | 'kickoff' | 'halftime' | 'fulltime' | 'chance' | 'shot' | 'save' | 'miss' | 'block'
  | 'goal' | 'disallowed' | 'corner' | 'foul' | 'yellow' | 'red' | 'injury' | 'sub'
  | 'penalty' | 'var' | 'tactic' | 'build' | 'info' | 'keeper_delay';

export interface MatchEvent {
  minute: number;
  /** Minute as shown on screen, e.g. "45+2". */
  clock: string;
  type: MatchEventType;
  /** 0 = home, 1 = away, undefined = neutral. */
  side?: 0 | 1;
  text: string;
  /** 0 = filler, 1 = notable, 2 = key moment (goal, red card). */
  importance: 0 | 1 | 2;
}

export interface TeamMatchStats {
  goals: number;
  shots: number;
  onTarget: number;
  corners: number;
  fouls: number;
  yellows: number;
  reds: number;
  possessionMinutes: number;
  xg: number;
}

export interface PlayerMatchStats {
  playerId: string;
  side: 0 | 1;
  minutes: number;
  goals: number;
  assists: number;
  shots: number;
  onTarget: number;
  keyPasses: number;
  tackles: number;
  saves: number;
  yellow: number;
  red: boolean;
  injured: boolean;
  rating: number;
}
