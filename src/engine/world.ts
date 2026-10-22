// The state of a whole game: clubs, players, fixtures, cups, news and
// transfer talks. Everything here is plain data so a save is just this
// object as JSON. The rules that change it live in season.ts and
// transfers.ts; none of it touches the screen.

import { FA_CUP_ROUNDS, LEAGUE_CUP_ROUNDS, LEAGUE_DATES, SEASON, type CupRoundDef, type ISODate } from './calendar';
import { marketWage, playerValue, yearsLeft } from './economy';
import { FORMATIONS, familiarity } from './formations';
import { Rng, hashString } from './rng';
import type { FormationName, MatchEventType, Player, Tactic, Takers, Team, TeamMatchStats } from './types';

export type Division = 'PL' | 'CH' | 'L1';
export type CompId = 'PL' | 'LC' | 'FAC';

export const COMP_NAMES: Record<CompId, string> = { PL: 'Premier League', LC: 'League Cup', FAC: 'FA Cup' };
export const DIVISION_NAMES: Record<Division, string> = { PL: 'Premier League', CH: 'Championship', L1: 'League One' };
/** The short tags the original put beside a club: PR, D1, D2. */
export const DIVISION_TAGS: Record<Division, string> = { PL: 'PR', CH: 'D1', L1: 'D2' };

export interface Club {
  id: string;
  division: Division;
  capacity: number;
  /** Bank balance in pounds. */
  balance: number;
  /** What the board lets the manager spend on fees. */
  transferBudget: number;
  /** The most the board lets the club pay in wages each week. */
  wageBudget: number;
  tactic: Tactic;
  income: { gate: number; tv: number; prize: number; sales: number };
  spend: { wages: number; fees: number };
}

export interface SeasonStats {
  apps: number;
  subs: number;
  goals: number;
  assists: number;
  motm: number;
  yellows: number;
  reds: number;
  /** Sum of match ratings, for the average. */
  ratings: number;
}

export interface PlayerState {
  clubId: string;
  /** Weekly wage and the year the contract ends (30 June). */
  contract: { wage: number; expires: number };
  /** Physical condition, 0-100. */
  condition: number;
  /** 1-20, 10 = ok. */
  morale: number;
  injury?: { name: string; until: ISODate };
  /** Domestic matches still to sit out. */
  banned: number;
  /** League bookings this season, for the totting-up bans. */
  leagueYellows: number;
  listed: boolean;
  /** Can't be sold or bought again until this date (just moved). */
  movedOn?: ISODate;
  stats: Record<CompId, SeasonStats>;
}

export interface FixtureResult {
  home: number;
  away: number;
  /** Goals after extra time, when it was played. */
  et?: [number, number];
  pens?: [number, number];
  /** Scorers by player id with goal counts. */
  scorers: { id: string; side: 0 | 1; goals: number }[];
  motm?: string;
  attendance: number;
  /** What the match info screens show for it afterwards. */
  report?: MatchReport;
}

/** Each player's match stats, packed in this order to keep saves small. */
export const REPORT_FIELDS = ['minutes', 'goals', 'assists', 'shots', 'onTarget', 'keyPasses', 'tackles', 'saves', 'yellow', 'red', 'injured', 'rating'] as const;

/** A played match, kept so its match info screens can be opened later. */
export interface MatchReport {
  stats: [TeamMatchStats, TeamMatchStats];
  /** Player ids by shirt number: the starters, then the substitutes. */
  squads: [string[], string[]];
  /** Stats for those who played, as REPORT_FIELDS; the rating is times ten. */
  players: Record<string, number[]>;
  /** Goals, cards, substitutions and injuries. */
  events: { clock: string; type: MatchEventType; side?: 0 | 1; text: string }[];
}

export interface Fixture {
  id: string;
  comp: CompId;
  /** Round name for cups, "Round 12" for the league. */
  round: string;
  date: ISODate;
  home: string;
  away: string;
  neutral?: boolean;
  /** Two-legged ties share a tie id; leg 2 decides it. */
  tie?: string;
  leg?: 1 | 2;
  result?: FixtureResult;
}

export interface Cup {
  id: Exclude<CompId, 'PL'>;
  rounds: (CupRoundDef & { drawn: boolean })[];
  /** Clubs still in it. */
  alive: string[];
  winner?: string;
}

export type NewsKind = 'general' | 'result' | 'injury' | 'ban' | 'transfer' | 'offer' | 'bid' | 'contract' | 'draw' | 'board' | 'award' | 'season';

export interface NewsItem {
  id: string;
  date: ISODate;
  kind: NewsKind;
  /** The title bar: usually a club name, drawn in its colours. */
  title: string;
  clubId?: string;
  heading: string;
  body: string;
  /** Shown to the human manager (stops the game until read). */
  human: boolean;
  read: boolean;
  /** Talks this item asks the manager to deal with. */
  talksId?: string;
  /** For draws: the fixtures drawn. */
  fixtures?: string[];
}

export type TalksStage =
  | 'bid'          // fee offered, waiting for the selling club
  | 'countered'    // selling club wants more
  | 'terms'        // fee agreed, personal terms to agree
  | 'done' | 'rejected' | 'withdrawn' | 'refused';

export interface Talks {
  id: string;
  playerId: string;
  /** Selling and buying clubs. */
  from: string;
  to: string;
  fee: number;
  /** What the seller asks, once it has said. */
  asking?: number;
  stage: TalksStage;
  /** When the other side answers. */
  replyOn?: ISODate;
  /** The player's demands once terms are discussed. */
  demand?: { wage: number; years: number };
  /** Offers the player has turned down. */
  rounds: number;
  /** A contract renewal with the player's own club rather than a transfer. */
  renewal?: boolean;
}

export interface TransferRecord {
  date: ISODate;
  playerId: string;
  name: string;
  from: string;
  to: string;
  fee: number;
}

export interface TeamSheet {
  tactic: Tactic;
  rows: { id: string; spot: number; runTo?: number }[];
  bench: string[];
  takers: Takers;
}

export interface GameState {
  version: 1;
  seed: number;
  date: ISODate;
  seasonYear: number;
  humanClubId: string;
  clubs: Record<string, Club>;
  teams: Record<string, Team>;
  players: Record<string, PlayerState>;
  fixtures: Fixture[];
  cups: Record<'LC' | 'FAC', Cup>;
  news: NewsItem[];
  talks: Talks[];
  transfers: TransferRecord[];
  /** Board confidence, 0-100. */
  board: number;
  /** The human's team sheet between matches: tactic, players by shirt number with their pitch spots, subs, takers. */
  sheet?: TeamSheet;
  nextId: number;
  over?: boolean;
}

// ------------------------------------------------------------------ news

export function addNews(g: GameState, item: Omit<NewsItem, 'id' | 'date' | 'read'>): NewsItem {
  const n: NewsItem = { id: newId(g, 'n'), date: g.date, read: false, ...item };
  g.news.push(n);
  return n;
}

export function unreadNews(g: GameState): NewsItem[] {
  return g.news.filter(n => n.human && !n.read);
}

// ------------------------------------------------------------------ helpers

export function emptyStats(): SeasonStats {
  return { apps: 0, subs: 0, goals: 0, assists: 0, motm: 0, yellows: 0, reds: 0, ratings: 0 };
}

export function newId(g: GameState, prefix: string): string {
  return `${prefix}${g.nextId++}`;
}

/** A random stream for one purpose on one day, so results don't depend on the order things run in. */
export function rngFor(g: GameState, ...keys: (string | number)[]): Rng {
  return new Rng(hashString(`${g.seed}:${keys.join(':')}`));
}

export function playerById(g: GameState, id: string): Player | undefined {
  const st = g.players[id];
  return st ? g.teams[st.clubId]?.squad.find(p => p.id === id) : undefined;
}

export function clubOf(g: GameState, playerId: string): Team | undefined {
  const st = g.players[playerId];
  return st ? g.teams[st.clubId] : undefined;
}

export function valueOf(g: GameState, p: Player): number {
  return playerValue(p, yearsLeft(g.players[p.id].contract.expires, g.seasonYear));
}

export function wageBill(g: GameState, clubId: string): number {
  return g.teams[clubId].squad.reduce((a, p) => a + g.players[p.id].contract.wage, 0);
}

export function available(g: GameState, p: Player): boolean {
  const st = g.players[p.id];
  return !st.injury && st.banned === 0;
}

/** The formation that gets the most out of a squad, for AI clubs. */
export function bestFormation(team: Team): FormationName {
  let best: FormationName = '4-4-2', bestScore = -1;
  for (const f of Object.keys(FORMATIONS) as FormationName[]) {
    const used = new Set<string>();
    let score = 0;
    for (const slot of FORMATIONS[f]) {
      let top: Player | undefined, s = -1;
      for (const p of team.squad) {
        if (used.has(p.id)) continue;
        const v = p.ability * familiarity(p.positions, slot);
        if (v > s) { s = v; top = p; }
      }
      if (top) { used.add(top.id); score += s; }
    }
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best;
}

export function defaultTactic(formation: FormationName): Tactic {
  return { formation, mentality: 0, passing: 'mixed', pressing: 'mid', width: 'normal', counterAttack: false, offsideTrap: false };
}

// ------------------------------------------------------------------ a new game

export interface ClubSource {
  team: Team;
  capacity: number;
}

export function createGame(
  sources: Record<Division, ClubSource[]>, humanClubId: string, seed: number,
): GameState {
  const g: GameState = {
    version: 1, seed, date: SEASON.start, seasonYear: SEASON.year, humanClubId,
    clubs: {}, teams: {}, players: {}, fixtures: [], cups: {} as GameState['cups'],
    news: [], talks: [], transfers: [], board: 60, nextId: 1,
  };
  const rng = new Rng(seed);
  for (const div of ['PL', 'CH', 'L1'] as Division[]) {
    for (const src of sources[div]) {
      // A copy, so the database itself is never changed by a game.
      const team: Team = JSON.parse(JSON.stringify(src.team));
      g.teams[team.id] = team;
      for (const p of team.squad) {
        const wage = Math.round(marketWage(p, team.reputation) * (0.8 + rng.next() * 0.4) / 500) * 500;
        const maxYears = p.age >= 33 ? 1 : p.age >= 30 ? 2 : 5;
        g.players[p.id] = {
          clubId: team.id, contract: { wage, expires: g.seasonYear + rng.int(1, maxYears) },
          condition: 100, morale: 10, banned: 0, leagueYellows: 0, listed: false,
          stats: { PL: emptyStats(), LC: emptyStats(), FAC: emptyStats() },
        };
      }
      const bill = wageBill(g, team.id);
      const rep = team.reputation;
      const budget = div === 'PL' ? 4e6 * Math.exp((rep - 9) / 3.2) : div === 'CH' ? 1.5e6 * rep / 8 : 0.4e6 * rep / 6;
      g.clubs[team.id] = {
        id: team.id, division: div, capacity: src.capacity,
        balance: Math.round(budget * 1.6 + bill * 20),
        transferBudget: Math.round(budget / 1e5) * 1e5,
        wageBudget: Math.round(bill * 1.12 / 1000) * 1000,
        tactic: defaultTactic(bestFormation(team)),
        income: { gate: 0, tv: 0, prize: 0, sales: 0 },
        spend: { wages: 0, fees: 0 },
      };
    }
  }
  scheduleLeague(g, rng);
  const byDiv = (d: Division) => Object.values(g.clubs).filter(c => c.division === d).map(c => c.id);
  const l1 = byDiv('L1').sort((a, b) => g.teams[b].reputation - g.teams[a].reputation);
  // Twenty League One clubs come through the earlier rounds of each cup.
  g.cups.LC = { id: 'LC', rounds: LEAGUE_CUP_ROUNDS.map(r => ({ ...r, drawn: false })), alive: [...byDiv('PL'), ...byDiv('CH'), ...l1.slice(0, 20)] };
  const qualifiers = [...l1].sort(() => rng.next() - 0.5).slice(0, 20);
  g.cups.FAC = { id: 'FAC', rounds: FA_CUP_ROUNDS.map(r => ({ ...r, drawn: false })), alive: [...byDiv('PL'), ...byDiv('CH'), ...qualifiers] };
  return g;
}

/** A double round robin over the season's league dates; each club alternates home and away. */
function scheduleLeague(g: GameState, rng: Rng) {
  const ids = Object.values(g.clubs).filter(c => c.division === 'PL').map(c => c.id).sort(() => rng.next() - 0.5);
  const n = ids.length;
  const rounds: [string, string][][] = [];
  // Circle method: the first club stays put, the rest rotate.
  const ring = [...ids];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [string, string][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = ring[i], b = ring[n - 1 - i];
      pairs.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    ring.splice(1, 0, ring.pop()!);
  }
  const second = rounds.map(pairs => pairs.map(([a, b]) => [b, a] as [string, string]));
  const all = [...rounds, ...second.sort(() => rng.next() - 0.5)];
  all.forEach((pairs, r) => {
    for (const [home, away] of pairs) {
      g.fixtures.push({ id: newId(g, 'f'), comp: 'PL', round: `Round ${r + 1}`, date: LEAGUE_DATES[r], home, away });
    }
  });
}
