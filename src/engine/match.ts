// The match engine: a minute-by-minute chain of possessions. Each attack is a
// duel between the attributes of the players involved, and each step is
// written out as commentary. The engine never models positions continuously,
// so a whole match takes a few milliseconds and can be replayed from its seed.

import { Rng } from './rng';
import { FORMATIONS, familiarity, isWide, lineOf, slotWeights } from './formations';
import { lines } from './commentary';
import {
  MENTALITY_NAMES,
  type Attribute, type Lineup, type MatchEvent, type MatchEventType, type Mentality,
  type Player, type PlayerMatchStats, type Position, type Run, type Tactic, type Takers, type Team, type TeamMatchStats,
} from './types';

export interface MatchSide {
  team: Team;
  lineup: Lineup;
  tactic: Tactic;
  /** If true the engine picks this side's mentality and subs. */
  ai: boolean;
}

export interface MatchOptions {
  seed: number;
  /** 0 = friendly, 0.5 = league, 1 = cup final. Drives Big Occasion. */
  importance?: number;
  isCup?: boolean;
  neutral?: boolean;
  /** Turn off commentary for background matches (faster). */
  commentary?: boolean;
}

export interface OnPitch {
  player: Player;
  slot: Position;
  run: Run;
  condition: number;
  form: number;
  yellow: number;
  /** Minutes left off the pitch after treatment (new 2026/27 law). */
  treatment: number;
}

interface SideState {
  setup: MatchSide;
  pitch: OnPitch[];
  bench: Player[];
  used: Set<string>;
  subsMade: number;
  subWindows: number;
  lastSubMinute: number;
  stats: TeamMatchStats;
}

const SUB_LIMIT = 5;
const INCIDENTS = new Set<MatchEventType>(['goal', 'yellow', 'red', 'sub', 'injury', 'penalty', 'disallowed']);
const WINDOW_LIMIT = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export class Match {
  readonly rng: Rng;
  readonly options: Required<MatchOptions>;
  readonly sides: [SideState, SideState];
  readonly events: MatchEvent[] = [];
  readonly playerStats = new Map<string, PlayerMatchStats>();

  /** Match minute; 0 before kick-off. */
  minute = 0;
  half: 1 | 2 = 1;
  stoppage = 0;
  private extra = 0;
  finished = false;
  private started = false;
  private lastPossession: 0 | 1 = 0;
  /** True between the half-time whistle and the second-half kick-off. */
  atHalfTime = false;

  constructor(home: MatchSide, away: MatchSide, options: MatchOptions) {
    this.rng = new Rng(options.seed);
    this.options = {
      seed: options.seed,
      importance: options.importance ?? 0.5,
      isCup: options.isCup ?? false,
      neutral: options.neutral ?? false,
      commentary: options.commentary ?? true,
    };
    this.sides = [this.initSide(home, 0), this.initSide(away, 1)];
  }

  private initSide(setup: MatchSide, side: 0 | 1): SideState {
    const slots = setup.lineup.slots ?? FORMATIONS[setup.tactic.formation];
    const imp = this.options.importance;
    const pitch: OnPitch[] = setup.lineup.starters.map((player, i) => {
      // Consistency sets how far a player strays from his ability today;
      // Big Occasion lifts or sinks him in important matches.
      const spread = (21 - player.attributes.consistency) / 100;
      const big = ((player.attributes.bigOccasion - 10) / 200) * imp;
      const form = clamp(this.rng.normal(1, spread * 0.6) + big, 0.8, 1.15);
      this.registerPlayer(player, side);
      return { player, slot: slots[i], run: setup.lineup.runs?.[player.id] ?? 'normal', condition: setup.lineup.fitness?.[player.id] ?? 100, form, yellow: 0, treatment: 0 };
    });
    return {
      setup,
      pitch,
      bench: [...setup.lineup.bench],
      used: new Set(pitch.map(p => p.player.id)),
      subsMade: 0,
      subWindows: 0,
      lastSubMinute: -1,
      stats: { goals: 0, shots: 0, onTarget: 0, corners: 0, fouls: 0, yellows: 0, reds: 0, possessionMinutes: 0, xg: 0 },
    };
  }

  private registerPlayer(player: Player, side: 0 | 1) {
    if (this.playerStats.has(player.id)) return;
    this.playerStats.set(player.id, {
      playerId: player.id, side, minutes: 0, goals: 0, assists: 0, shots: 0, onTarget: 0,
      keyPasses: 0, tackles: 0, saves: 0, yellow: 0, red: false, injured: false, rating: 6.4,
    });
  }

  // ---------------------------------------------------------------- helpers

  private ps(p: Player) {
    return this.playerStats.get(p.id)!;
  }

  private rate(p: Player, delta: number) {
    this.ps(p).rating += delta;
  }

  /** A player's effective quality (about 0.3 to 1.4) in one attribute right now. */
  private eff(o: OnPitch, attr: Attribute): number {
    const base = o.player.ability / 200;
    const rel = (o.player.attributes[attr] - 10) / 10;
    const fam = familiarity(o.player.positions, o.slot);
    const cond = 0.75 + 0.25 * (o.condition / 100);
    return base * (1 + 0.35 * rel) * fam * cond * o.form;
  }

  /** Phase weights for a player in his slot, allowing for his runs. */
  private w(o: OnPitch): [number, number, number] {
    return slotWeights(o.slot, o.run);
  }

  private active(s: SideState): OnPitch[] {
    return s.pitch.filter(o => o.treatment === 0);
  }

  /** The player picked to take a set piece, if he is on the pitch and fit to. */
  private taker(s: SideState, role: keyof Takers): OnPitch | undefined {
    const id = s.setup.lineup.takers?.[role];
    return id ? this.active(s).find(o => o.player.id === id) : undefined;
  }

  private keeper(s: SideState): OnPitch | undefined {
    return s.pitch.find(o => o.slot === 'GK');
  }

  private outfield(s: SideState): OnPitch[] {
    return this.active(s).filter(o => o.slot !== 'GK');
  }

  private mentality(side: 0 | 1): Mentality {
    return this.sides[side].setup.tactic.mentality;
  }

  /** Strength of one phase of play: 0 = defence, 1 = midfield, 2 = attack. */
  private phase(s: SideState, which: 0 | 1 | 2): number {
    const attrs: Attribute[][] = [
      ['tackling', 'marking', 'positioning', 'strength', 'pace'],
      ['passing', 'technique', 'decisions', 'workRate', 'firstTouch'],
      ['offTheBall', 'dribbling', 'technique', 'pace', 'creativity', 'composure'],
    ];
    let total = 0;
    for (const o of this.outfield(s)) {
      const w = this.w(o)[which];
      if (w === 0) continue;
      total += w * mean(attrs[which].map(a => this.eff(o, a)));
    }
    const t = s.setup.tactic;
    const m = t.mentality;
    if (which === 0) {
      // Committing players forward leaves gaps at the back; sitting deep closes them.
      total *= m > 0 ? 1 - 0.13 * m : 1 - 0.07 * m;
      if (t.pressing === 'low') total *= 1.04;
    } else if (which === 1) {
      total *= 1 + 0.015 * m;
      if (t.pressing === 'high') total *= 1.05;
      if (t.pressing === 'low') total *= 0.96;
      if (t.passing === 'short') total *= 1.03;
      if (t.passing === 'direct') total *= 0.97;
    } else {
      total *= m > 0 ? 1 + 0.09 * m : 1 + 0.12 * m;
    }
    return total;
  }

  private teamName(side: 0 | 1) {
    return this.sides[side].setup.team.shortName;
  }

  private say(type: MatchEventType, text: string, importance: 0 | 1 | 2, side?: 0 | 1) {
    // Without commentary only the incidents are kept, for the match report.
    if (!this.options.commentary && importance < 2 && !INCIDENTS.has(type)) return;
    this.events.push({ minute: this.minute, clock: this.displayMinute, type, side, text, importance });
  }

  private scoreFill() {
    return {
      home: this.sides[0].setup.team.shortName,
      away: this.sides[1].setup.team.shortName,
      hs: String(this.sides[0].stats.goals),
      as: String(this.sides[1].stats.goals),
    };
  }

  /** Overall strength used by the AI to judge the gap between the teams. */
  strength(side: 0 | 1): number {
    const s = this.sides[side];
    const xi = s.pitch.map(o => o.player.ability * familiarity(o.player.positions, o.slot));
    return mean(xi);
  }

  // ---------------------------------------------------------------- public controls

  setTactic(side: 0 | 1, tactic: Tactic) {
    const s = this.sides[side];
    const old = s.setup.tactic;
    if (tactic.formation !== old.formation) {
      const slots = FORMATIONS[tactic.formation];
      // Keep the keeper; give the outfield players the new slots in order.
      const outfield = s.pitch.filter(o => o.slot !== 'GK');
      outfield.forEach((o, i) => { o.slot = slots[i + 1] ?? o.slot; });
    }
    s.setup.tactic = tactic;
    if (this.started && !this.finished) {
      const change = tactic.mentality !== old.mentality
        ? MENTALITY_NAMES[tactic.mentality]
        : tactic.formation !== old.formation ? tactic.formation : 'new instructions';
      this.say('tactic', lines.tactic(this.rng, { team: this.teamName(side), change }), 1, side);
    }
  }

  /** Moves a player to a new position on the pitch. */
  setPosition(side: 0 | 1, playerId: string, slot: Position) {
    const o = this.sides[side].pitch.find(x => x.player.id === playerId);
    if (!o || o.slot === slot) return;
    const from = o.slot;
    o.slot = slot;
    if (this.started && !this.finished) {
      this.say('tactic', `${this.teamName(side)} reshuffle: ${o.player.shortName} moves from ${from} to ${slot}.`, 0, side);
    }
  }

  /** Changes the captain and set-piece takers. */
  setTakers(side: 0 | 1, takers: Takers) {
    this.sides[side].setup.lineup.takers = { ...takers };
  }

  /** Changes the runs a player makes. */
  setRun(side: 0 | 1, playerId: string, run: Run) {
    const o = this.sides[side].pitch.find(x => x.player.id === playerId);
    if (o) o.run = run;
  }

  /** Returns an error message, or undefined if the substitution was made. */
  substitute(side: 0 | 1, offId: string, onId: string): string | undefined {
    const s = this.sides[side];
    if (s.subsMade >= SUB_LIMIT) return 'All five substitutes have been used.';
    // Half-time changes and further changes in the same minute don't use a new window.
    const newWindow = this.started && !this.atHalfTime && s.lastSubMinute !== this.minute;
    if (newWindow && s.subWindows >= WINDOW_LIMIT) return 'All three substitution windows have been used.';
    const idx = s.pitch.findIndex(o => o.player.id === offId);
    const on = s.bench.find(p => p.id === onId);
    if (idx < 0 || !on) return 'Player not found.';
    const off = s.pitch[idx];
    s.pitch[idx] = { player: on, slot: off.slot, run: 'normal', condition: s.setup.lineup.fitness?.[on.id] ?? 100, form: clamp(this.rng.normal(1, 0.06), 0.85, 1.12), yellow: 0, treatment: 0 };
    s.bench = s.bench.filter(p => p.id !== onId);
    s.used.add(on.id);
    this.registerPlayer(on, side);
    s.subsMade++;
    if (newWindow) s.subWindows++;
    if (!this.atHalfTime) s.lastSubMinute = this.minute;
    if (this.started) {
      this.say('sub', lines.sub(this.rng, { team: this.teamName(side), on: on.shortName, off: off.player.shortName }), 1, side);
    }
    return undefined;
  }

  /** Substitutions still available to a side. */
  subsLeft(side: 0 | 1): { subs: number; windows: number } {
    const s = this.sides[side];
    return { subs: SUB_LIMIT - s.subsMade, windows: WINDOW_LIMIT - s.subWindows };
  }

  // ---------------------------------------------------------------- the clock

  /** Plays one minute and returns the events it produced. */
  step(): MatchEvent[] {
    if (this.finished) return [];
    const before = this.events.length;

    if (!this.started) {
      this.started = true;
      this.chooseAiMentality(0);
      this.chooseAiMentality(1);
      this.say('kickoff', lines.kickoff(this.rng, {
        home: this.teamName(0), stadium: this.sides[0].setup.team.stadium,
      }), 1);
      this.stoppage = this.rng.int(1, 4);
      this.minute = 1;
    }

    if (this.atHalfTime) {
      this.atHalfTime = false;
      this.say('kickoff', lines.secondHalf(this.rng, this.scoreFill()), 0);
    }

    this.playMinute();

    const end = this.half === 1 ? 45 : 90;
    if (this.minute >= end) {
      this.extra++;
      if (this.extra > this.stoppage) {
        this.endHalf();
        return this.events.slice(before);
      }
    } else {
      this.minute++;
    }
    return this.events.slice(before);
  }

  /** Displayed minute, e.g. "45+2". */
  get displayMinute(): string {
    if (this.extra > 0) return `${this.minute}+${this.extra}`;
    return String(this.minute);
  }

  private endHalf() {
    if (this.half === 1) {
      this.say('halftime', lines.halftime(this.rng, this.scoreFill()), 1);
      this.atHalfTime = true;
      this.half = 2;
      this.minute = 46;
      this.extra = 0;
      this.stoppage = this.rng.int(2, 6);
      for (const s of this.sides) for (const o of s.pitch) o.condition = Math.min(100, o.condition + 6);
      for (const side of [0, 1] as const) {
        if (this.sides[side].setup.ai) this.aiHalfTime(side);
      }
    } else {
      this.finish();
    }
  }

  playToEnd(): MatchResult {
    while (!this.finished) this.step();
    return this.result();
  }

  // ---------------------------------------------------------------- a minute of football

  private playMinute() {
    for (const side of [0, 1] as const) {
      const s = this.sides[side];
      const t = s.setup.tactic;
      const pressDrain = t.pressing === 'high' ? 1.2 : t.pressing === 'low' ? 0.85 : 1;
      for (const o of s.pitch) {
        const drain = 0.33 * (1 + (10 - o.player.attributes.stamina) / 20) * pressDrain * (1 + 0.06 * t.mentality) * (o.run === 'forward' ? 1.12 : o.run === 'hold' ? 0.92 : 1);
        o.condition = Math.max(20, o.condition - drain);
        if (o.treatment > 0) o.treatment--;
        this.ps(o.player).minutes++;
      }
      if (s.setup.ai) this.aiDuringMatch(side);
    }

    this.randomIncidents();

    // Who controls the ball this minute.
    let midH = this.phase(this.sides[0], 1);
    let midA = this.phase(this.sides[1], 1);
    if (!this.options.neutral) midH *= 1.09;
    const pHome = midH ** 2.2 / (midH ** 2.2 + midA ** 2.2);
    const side: 0 | 1 = this.rng.chance(pHome) ? 0 : 1;
    this.sides[side].stats.possessionMinutes++;
    this.lastPossession = side;

    const m = this.mentality(side);
    // Attacking teams attack more often, but leave room to be countered.
    const oppMent = this.mentality((1 - side) as 0 | 1);
    const attemptP = 0.36 * (1 + 0.12 * m) * (oppMent > 0 ? 1 + 0.08 * oppMent : 1);
    if (this.rng.chance(attemptP)) {
      this.attack(side);
    } else if (this.rng.chance(this.longShotChance(side))) {
      this.longShot(side);
    } else if (this.options.commentary && this.rng.chance(0.22)) {
      const s = this.sides[side];
      const opp = this.sides[1 - side];
      if (opp.setup.tactic.mentality === -2 && this.rng.chance(0.25)) {
        this.say('build', lines.sittingDeep(this.rng, { team: opp.setup.team.shortName }), 0, (1 - side) as 0 | 1);
      } else {
        const p = this.rng.pick(this.outfield(s));
        this.say('build', lines.possession(this.rng, { team: s.setup.team.shortName, player: p.player.shortName }), 0, side);
      }
    }
  }

  private longShotChance(side: 0 | 1): number {
    const shooters = this.outfield(this.sides[side]).filter(o => lineOf(o.slot) !== 'DEF');
    const tendency = mean(shooters.map(o => o.player.tendencies.shootsOnSight)) / 10;
    // Teams facing a deep block shoot from range more often.
    const deep = this.mentality((1 - side) as 0 | 1) < 0 ? 1.3 : 1;
    return 0.055 * tendency * deep;
  }

  private pickShooter(side: 0 | 1, kind: 'open' | 'header' | 'long' | 'setpiece'): OnPitch {
    const pool = this.outfield(this.sides[side]);
    return this.rng.weighted(pool, o => {
      const att = this.w(o)[2] + 0.05;
      const t = o.player.tendencies;
      if (kind === 'header') return att * (o.player.attributes.heading / 10) ** 2 * (t.attacksCrosses / 10) ** 1.5;
      if (kind === 'setpiece') return (lineOf(o.slot) === 'DEF' ? 0.8 : att) * (o.player.attributes.heading / 10) ** 3 * (t.attacksCrosses / 10) ** 1.5;
      if (kind === 'long') return (lineOf(o.slot) === 'DEF' ? 0.15 : 1) * (t.shootsOnSight / 10) ** 2.5 * (o.player.attributes.shooting / 10);
      return (att + 0.2) ** 0.8 * (o.player.attributes.offTheBall / 10) * (t.shootsOnSight / 10) ** 1.2;
    });
  }

  private pickCreator(side: 0 | 1, exclude: OnPitch, wide: boolean): OnPitch {
    const pool = this.outfield(this.sides[side]).filter(o => o !== exclude);
    return this.rng.weighted(pool, o => {
      const mid = this.w(o)[1] + this.w(o)[2] * 0.6;
      const wideBonus = wide ? (isWide(o.slot) ? 2.5 : 0.4) : 1;
      return mid * wideBonus * (o.player.attributes.creativity / 10) * (o.player.tendencies.triesKillerPasses / 10 + 0.5);
    });
  }

  private pickDefender(side: 0 | 1): OnPitch {
    const pool = this.outfield(this.sides[side]);
    return this.rng.weighted(pool, o => this.w(o)[0] ** 2 * (o.player.attributes.tackling / 10));
  }

  private attack(side: 0 | 1) {
    const s = this.sides[side];
    const oppSide = (1 - side) as 0 | 1;
    const opp = this.sides[oppSide];
    const t = s.setup.tactic;
    const oppM = opp.setup.tactic.mentality;

    // Choose the route.
    const counter = oppM > 0 && this.rng.chance((t.counterAttack ? 0.3 : 0.12) * oppM);
    const crossW = t.width === 'wide' ? 1.6 : t.width === 'narrow' ? 0.5 : 1;
    const longW = t.passing === 'direct' ? 1.8 : t.passing === 'short' ? 0.3 : 0.8;
    type Route = 'through' | 'cross' | 'dribble' | 'long';
    const route: Route = this.rng.weighted<Route>(['through', 'cross', 'dribble', 'long'], r =>
      r === 'through' ? (t.passing === 'short' ? 1.4 : 1) : r === 'cross' ? crossW : r === 'long' ? longW : 0.8);

    const target = route === 'cross' ? this.pickShooter(side, 'header') : this.pickShooter(side, 'open');
    const creator = this.pickCreator(side, target, route === 'cross');
    const defender = this.pickDefender(oppSide);

    const threat = this.phase(s, 2) * (counter ? 1.25 : 1) * (side === 0 && !this.options.neutral ? 1.05 : 1);
    let resist = this.phase(opp, 0);
    // A deep block is harder to play through, but it concedes more speculative shots.
    if (oppM === -2) resist *= 1.12;
    if (oppM === -1) resist *= 1.05;
    const routeSkill = route === 'cross' ? this.eff(creator, 'passing') * 0.5 + this.eff(target, 'heading') * 0.5
      : route === 'dribble' ? this.eff(target, 'dribbling')
      : this.eff(creator, 'passing') * 0.6 + this.eff(creator, 'creativity') * 0.4;
    const ratio = (threat / resist) * (0.7 + 0.6 * routeSkill / Math.max(0.3, this.eff(defender, 'positioning')));
    let pCreate = clamp(0.42 * ratio ** 0.75, 0.08, 0.75);
    if (oppM === -2) pCreate *= 1.15;

    const fill = {
      team: s.setup.team.shortName,
      creator: creator.player.shortName,
      player: target.player.shortName,
      defender: defender.player.shortName,
      flank: this.rng.chance(0.5) ? 'left' : 'right',
    };

    if (counter) this.say('build', lines.build.counter(this.rng, fill), 0, side);
    const created = this.rng.chance(pCreate);
    if (this.options.commentary && (created || this.rng.chance(0.4))) {
      this.say('build', lines.build[route](this.rng, fill), 0, side);
    }

    if (!created) {
      this.ps(defender.player).tackles++;
      this.rate(defender.player, 0.05);
      if (this.options.commentary && this.rng.chance(0.6)) {
        this.say('build', lines.attackBroken(this.rng, fill), 0, oppSide);
      }
      if (this.rng.chance(route === 'cross' ? 0.4 : 0.22)) this.corner(side);
      return;
    }

    // Penalty: a foul inside the box.
    if (route !== 'long' && this.rng.chance(0.017 * (0.6 + defender.player.attributes.dirtiness / 15))) {
      this.say('penalty', lines.penaltyAwarded(this.rng, { player: defender.player.shortName, victim: target.player.shortName }), 2, side);
      this.booking(oppSide, defender, this.rng.chance(0.04) ? 'red' : this.rng.chance(0.3) ? 'yellow' : undefined);
      this.penalty(side);
      return;
    }

    this.ps(creator.player).keyPasses++;
    this.rate(creator.player, 0.1);

    // Chance quality.
    let xg: number;
    let kind: 'open' | 'header' = 'open';
    const oneOnOne = this.rng.chance(counter ? 0.3 : t.mentality > 0 && opp.setup.tactic.offsideTrap ? 0.16 : 0.1);
    if (oneOnOne) {
      xg = 0.3 + this.rng.next() * 0.15;
      this.say('chance', lines.oneOnOne(this.rng, fill), 1, side);
    } else if (route === 'cross') {
      kind = 'header';
      xg = 0.04 + this.rng.next() ** 2 * 0.18;
      this.say('chance', lines.aerialWon(this.rng, fill), 0, side);
    } else {
      xg = 0.03 + this.rng.next() ** 2.2 * 0.25;
    }
    if (oppM === -2) xg *= 0.6;
    else if (oppM === -1) xg *= 0.82;
    else if (oppM > 0) xg *= 1 + 0.1 * oppM;

    this.shoot(side, target, creator, xg, kind);
  }

  private longShot(side: 0 | 1) {
    const shooter = this.pickShooter(side, 'long');
    this.say('chance', lines.longShot(this.rng, { player: shooter.player.shortName }), 0, side);
    const xg = 0.015 + this.rng.next() * 0.05;
    this.shoot(side, shooter, undefined, xg, 'long');
  }

  private shoot(side: 0 | 1, shooter: OnPitch, creator: OnPitch | undefined, xg: number, kind: 'open' | 'header' | 'long' | 'pen') {
    const s = this.sides[side];
    const oppSide = (1 - side) as 0 | 1;
    const opp = this.sides[oppSide];
    const keeper = this.keeper(opp);
    s.stats.shots++;
    s.stats.xg += xg;
    const st = this.ps(shooter.player);
    st.shots++;

    if (kind === 'open') this.say('shot', lines.shot(this.rng, { player: shooter.player.shortName }), 0, side);
    if (kind === 'header') this.say('shot', lines.header(this.rng, { player: shooter.player.shortName }), 0, side);

    const finishAttr: Attribute = kind === 'header' ? 'heading' : 'shooting';
    const finish = (this.eff(shooter, finishAttr) * 0.7 + this.eff(shooter, 'composure') * 0.3) / 0.62;
    const gk = keeper
      ? (this.eff(keeper, 'tackling') * 0.5 + this.eff(keeper, 'handling') * 0.25 + this.eff(keeper, 'positioning') * 0.25) / 0.62
      : 0.3;
    const pGoal = clamp(0.93 * xg * clamp(finish, 0.6, 1.6) ** 0.9 / clamp(gk, 0.5, 1.6) ** 0.8, 0.005, 0.95);
    const pOnTarget = clamp(0.3 + 0.22 * (finish - 1) + xg * 0.6, 0.15, 0.9);
    const blockedP = kind === 'long' ? 0.32 : kind === 'pen' ? 0 : this.mentality(oppSide) === -2 ? 0.34 : 0.24;

    if (this.rng.chance(pGoal)) {
      this.goal(side, shooter, creator);
      return;
    }
    if (kind !== 'pen' && this.rng.chance(blockedP)) {
      const blocker = this.pickDefender(oppSide);
      this.say('block', lines.block(this.rng, { defender: blocker.player.shortName }), 0, oppSide);
      this.rate(blocker.player, 0.05);
      if (this.rng.chance(0.6)) this.corner(side);
      return;
    }
    if (this.rng.chance(Math.max(0, (pOnTarget - pGoal) / (1 - pGoal)))) {
      s.stats.onTarget++;
      st.onTarget++;
      this.rate(shooter.player, 0.05);
      if (keeper) {
        this.ps(keeper.player).saves++;
        // A save is worth what the chance was worth: tipping away a tame shot earns little.
        this.rate(keeper.player, 0.02 + xg * 0.75);
        const great = xg > 0.2;
        if (kind === 'pen') this.say('save', lines.penaltySaved(this.rng, { keeper: keeper.player.shortName }), 2, oppSide);
        else this.say('save', (great ? lines.greatSave : lines.save)(this.rng, { keeper: keeper.player.shortName }), great ? 1 : 0, oppSide);
      }
      if (kind !== 'pen' && this.rng.chance(xg > 0.15 ? 0.55 : 0.3)) this.corner(side);
    } else {
      this.rate(shooter.player, -0.03 - xg * 0.3);
      if (kind === 'pen') this.say('miss', lines.penaltyMissed(this.rng, { player: shooter.player.shortName }), 2, side);
      else this.say('miss', lines.miss(this.rng, {}), xg > 0.25 ? 1 : 0, side);
    }
  }

  private goal(side: 0 | 1, scorer: OnPitch, creator: OnPitch | undefined) {
    const s = this.sides[side];
    const oppSide = (1 - side) as 0 | 1;

    // VAR: a small share of goals are ruled out on review.
    if (this.rng.chance(0.05)) {
      this.say('var', lines.varCheck(this.rng, {}), 1, side);
      if (this.rng.chance(0.6)) {
        this.say('disallowed', lines.varOverturned(this.rng, {}), 2, side);
        return;
      }
      this.say('var', lines.varStands(this.rng, {}), 1, side);
    }

    s.stats.goals++;
    s.stats.onTarget++;
    const st = this.ps(scorer.player);
    st.goals++;
    st.onTarget++;
    this.rate(scorer.player, 1.0);
    if (creator && this.rng.chance(0.85)) {
      this.ps(creator.player).assists++;
      this.rate(creator.player, 0.55);
    }
    const opp = this.sides[oppSide];
    for (const o of opp.pitch) {
      if (o.slot === 'GK') this.rate(o.player, -0.3);
      else if (lineOf(o.slot) === 'DEF') this.rate(o.player, -0.12);
    }
    this.say('goal', lines.goal(this.rng, { player: scorer.player.shortName, team: s.setup.team.shortName }), 2, side);
    this.say('goal', lines.score(this.rng, this.scoreFill()), 1);
  }

  private corner(side: 0 | 1) {
    const s = this.sides[side];
    s.stats.corners++;
    this.say('corner', lines.corner(this.rng, { team: s.setup.team.shortName }), 0, side);
    const taker = this.taker(s, 'corners') ?? this.rng.weighted(this.outfield(s), o => (o.player.attributes.setPieces / 10) ** 4);
    if (this.rng.chance(0.3)) {
      const header = this.pickShooter(side, 'setpiece');
      if (header === taker) return;
      this.say('corner', lines.cornerTaken(this.rng, { taker: taker.player.shortName }), 0, side);
      this.say('chance', lines.aerialWon(this.rng, { player: header.player.shortName, defender: this.pickDefender((1 - side) as 0 | 1).player.shortName }), 0, side);
      this.shoot(side, header, taker, 0.05 + this.rng.next() * 0.1, 'header');
    } else if (this.options.commentary && this.rng.chance(0.4)) {
      const opp = this.sides[1 - side];
      this.say('corner', lines.cornerCleared(this.rng, {
        defender: this.pickDefender((1 - side) as 0 | 1).player.shortName,
        keeper: this.keeper(opp)?.player.shortName ?? 'the keeper',
      }), 0, (1 - side) as 0 | 1);
    }
  }

  private freeKick(side: 0 | 1) {
    const s = this.sides[side];
    const taker = this.taker(s, 'freeKicks') ?? this.rng.weighted(this.outfield(s), o => (o.player.attributes.setPieces / 10) ** 4);
    if (!taker) return;
    this.say('chance', lines.freeKick(this.rng, { player: taker.player.shortName }), 1, side);
    this.shoot(side, taker, undefined, 0.02 + 0.04 * (taker.player.attributes.setPieces / 20), 'long');
  }

  private penalty(side: 0 | 1) {
    const s = this.sides[side];
    const taker = this.taker(s, 'penalties') ?? this.rng.weighted(this.outfield(s), o =>
      (o.player.attributes.setPieces / 10) ** 3 * (o.player.attributes.composure / 10) ** 2 * (this.w(o)[2] + 0.3));
    this.say('penalty', lines.penaltyTaken(this.rng, { player: taker.player.shortName }), 1, side);
    this.shoot(side, taker, undefined, 0.78, 'pen');
  }

  // ---------------------------------------------------------------- fouls, cards, injuries

  private randomIncidents() {
    for (const side of [0, 1] as const) {
      const s = this.sides[side];
      const t = s.setup.tactic;
      const press = t.pressing === 'high' ? 1.15 : t.pressing === 'low' ? 0.9 : 1;
      const defending = this.lastPossession !== side ? 1.2 : 0.8;
      if (this.rng.chance(0.118 * press * defending)) {
        const fouler = this.rng.weighted(this.outfield(s), o =>
          (o.player.attributes.aggression + o.player.attributes.dirtiness + o.player.tendencies.divesIntoTackles) / 30 * (this.w(o)[0] + 0.4));
        const victim = this.rng.pick(this.outfield(this.sides[1 - side]));
        s.stats.fouls++;
        const dirty = fouler.player.attributes.dirtiness / 10;
        const card = this.rng.chance(0.001 * dirty) ? 'red' : this.rng.chance((fouler.yellow > 0 ? 0.06 : 0.19) * (0.5 + dirty * 0.5)) ? 'yellow' : undefined;
        if (card || (this.options.commentary && this.rng.chance(0.3))) {
          this.say('foul', lines.foul(this.rng, { player: fouler.player.shortName, victim: victim.player.shortName }), 0, side);
        }
        this.booking(side, fouler, card);
        // Now and then the foul gives a free kick close enough to shoot from.
        if (this.rng.chance(0.025)) this.freeKick((1 - side) as 0 | 1);
      }

      // Keeper holding the ball too long (new 2026/27 law): rare, mostly when time-wasting.
      const keeper = this.keeper(s);
      const leading = s.stats.goals > this.sides[1 - side].stats.goals;
      if (keeper && leading && this.half === 2 && this.minute > 75 && this.rng.chance(0.004)) {
        this.say('keeper_delay', lines.keeperDelay(this.rng, { keeper: keeper.player.shortName, team: this.teamName((1 - side) as 0 | 1) }), 1, (1 - side) as 0 | 1);
        this.corner((1 - side) as 0 | 1);
      }

      // Injuries and knocks.
      for (const o of [...s.pitch]) {
        if (o.treatment > 0) continue;
        const prone = 0.5 + o.player.attributes.injuryProneness / 10;
        if (this.rng.chance(0.00009 * prone)) {
          if (this.rng.chance(0.55)) {
            o.treatment = 1;
            if (this.options.commentary) this.say('injury', lines.knock(this.rng, { player: o.player.shortName }), 0, side);
          } else {
            this.ps(o.player).injured = true;
            this.say('injury', lines.injury(this.rng, { player: o.player.shortName }), 1, side);
            this.forcedSub(side, o);
          }
        }
      }
    }
  }

  private booking(side: 0 | 1, o: OnPitch, card: 'yellow' | 'red' | undefined) {
    if (!card) return;
    const s = this.sides[side];
    const st = this.ps(o.player);
    if (card === 'yellow') {
      o.yellow++;
      st.yellow++;
      s.stats.yellows++;
      this.rate(o.player, -0.35);
      if (o.yellow >= 2) {
        this.say('red', lines.secondYellow(this.rng, { player: o.player.shortName }), 2, side);
        this.sendOff(side, o);
      } else {
        this.say('yellow', lines.yellow(this.rng, { player: o.player.shortName }), 1, side);
      }
    } else {
      this.say('red', lines.red(this.rng, { player: o.player.shortName }), 2, side);
      this.sendOff(side, o);
    }
  }

  private sendOff(side: 0 | 1, o: OnPitch) {
    const s = this.sides[side];
    this.ps(o.player).red = true;
    s.stats.reds++;
    this.rate(o.player, -1.5);
    s.pitch = s.pitch.filter(x => x !== o);
    if (o.slot === 'GK') {
      // Sacrifice an outfield player for the reserve keeper if possible, else an outfielder goes in goal.
      const reserve = s.bench.find(p => p.positions[0] === 'GK');
      const victim = this.outfield(s).sort((a, b) => this.w(b)[2] - this.w(a)[2])[0];
      if (reserve && victim && s.subsMade < SUB_LIMIT) {
        const idx = s.pitch.indexOf(victim);
        s.pitch[idx] = { player: reserve, slot: 'GK', run: 'normal', condition: 100, form: 1, yellow: 0, treatment: 0 };
        s.bench = s.bench.filter(p => p !== reserve);
        this.registerPlayer(reserve, side);
        s.subsMade++;
        this.say('sub', lines.sub(this.rng, { team: s.setup.team.shortName, on: reserve.shortName, off: victim.player.shortName }), 1, side);
      } else if (victim) {
        victim.slot = 'GK';
      }
    }
    if (s.pitch.length < 7) {
      // Fewer than seven players: the match is abandoned and forfeited (2026/27 law).
      this.say('info', `${s.setup.team.shortName} are down to six players. The match is abandoned.`, 2, side);
      s.stats.goals = 0;
      this.sides[1 - side].stats.goals = Math.max(3, this.sides[1 - side].stats.goals);
      this.finish();
    }
  }

  private forcedSub(side: 0 | 1, o: OnPitch) {
    const s = this.sides[side];
    const replacement = this.bestBenchFor(s, o.slot);
    if (replacement && s.subsMade < SUB_LIMIT) {
      this.substitute(side, o.player.id, replacement.id);
    } else {
      s.pitch = s.pitch.filter(x => x !== o);
    }
  }

  private bestBenchFor(s: SideState, slot: Position): Player | undefined {
    const pool = s.bench.filter(p => (slot === 'GK') === (p.positions[0] === 'GK'));
    let best: Player | undefined;
    let bestScore = -1;
    for (const p of pool) {
      const score = p.ability * familiarity(p.positions, slot);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------- AI manager

  /**
   * Picks the AI's mentality. Ultra defensive is reserved for clear mismatches
   * away from home, cup underdogs, or protecting a late lead: the original
   * parked the bus far too often.
   */
  private chooseAiMentality(side: 0 | 1) {
    const s = this.sides[side];
    if (!s.setup.ai) return;
    const ratio = this.strength(side) / this.strength((1 - side) as 0 | 1);
    const away = side === 1 && !this.options.neutral;
    let m: Mentality = 0;
    if (ratio > 1.2) m = 1;
    else if (ratio < 0.75 && (away || this.options.isCup) && this.rng.chance(0.3)) m = -2;
    else if (ratio < 0.85 && (away || this.rng.chance(0.4))) m = -1;
    else if (ratio < 0.92 && away && this.rng.chance(0.3)) m = -1;
    if (m !== s.setup.tactic.mentality) s.setup.tactic = { ...s.setup.tactic, mentality: m };
  }

  private aiDuringMatch(side: 0 | 1) {
    const s = this.sides[side];
    const opp = this.sides[1 - side];
    const diff = s.stats.goals - opp.stats.goals;
    const t = s.setup.tactic;
    const minute = this.minute;
    const ratio = this.strength(side) / this.strength((1 - side) as 0 | 1);

    // Late game management.
    if (this.half === 2 && minute >= 70 && minute % 5 === 0) {
      let m: Mentality = t.mentality;
      if (diff < 0) m = (diff <= -2 && minute < 80 ? 1 : 2) as Mentality;
      else if (diff === 1 && minute >= 80) m = (ratio < 0.85 && minute >= 85 ? -2 : -1) as Mentality;
      else if (diff === 0 && minute >= 80) m = ratio > 1.05 ? 1 : 0;
      if (m !== t.mentality) this.setTactic(side, { ...t, mentality: m });
    }

    // Substitutions in three windows: around 60, 72 and 82 minutes, or for tired players.
    if (this.half === 2 && s.subsMade < SUB_LIMIT && s.subWindows < WINDOW_LIMIT) {
      const windowDue = (s.subWindows === 0 && minute >= 58 + this.rng.int(0, 6))
        || (s.subWindows === 1 && minute >= 70 + this.rng.int(0, 5))
        || (s.subWindows === 2 && minute >= 80 + this.rng.int(0, 4));
      if (windowDue && this.rng.chance(0.5)) {
        const count = s.subWindows === 2 ? SUB_LIMIT - s.subsMade : this.rng.int(1, 2);
        const tired = this.outfield(s)
          .filter(o => !this.ps(o.player).injured)
          .sort((a, b) => a.condition - b.condition);
        let made = 0;
        for (const o of tired) {
          if (made >= count || s.subsMade >= SUB_LIMIT) break;
          if (o.condition > 82 && made > 0) break;
          const slot = diff < 0 && lineOf(o.slot) === 'DEF' && t.mentality > 0 ? o.slot : o.slot;
          const rep = this.bestBenchFor(s, slot);
          if (!rep) break;
          this.substitute(side, o.player.id, rep.id);
          made++;
        }
      }
    }
  }

  private aiHalfTime(side: 0 | 1) {
    const s = this.sides[side];
    const diff = s.stats.goals - this.sides[1 - side].stats.goals;
    if (diff <= -2 && s.setup.tactic.mentality < 1) {
      s.setup.tactic = { ...s.setup.tactic, mentality: 1 };
    } else if (diff < 0 && s.setup.tactic.mentality === -2) {
      s.setup.tactic = { ...s.setup.tactic, mentality: -1 };
    }
  }

  // ---------------------------------------------------------------- full time

  private finish() {
    if (this.finished) return;
    this.finished = true;
    const [h, a] = this.sides;
    for (const side of [0, 1] as const) {
      const s = this.sides[side];
      const opp = this.sides[1 - side];
      const res = Math.sign(s.stats.goals - opp.stats.goals);
      for (const [id, st] of this.playerStats) {
        if (st.side !== side || st.minutes === 0) continue;
        st.minutes = Math.min(st.minutes, 90);
        st.rating += res * 0.3;
        const onPitch = s.pitch.find(o => o.player.id === id);
        const slot = onPitch?.slot;
        if (opp.stats.goals === 0 && slot && (slot === 'GK' || lineOf(slot) === 'DEF')) st.rating += slot === 'GK' ? 0.3 : 0.4;
        st.rating = clamp(Math.round((st.rating + this.rng.normal(0, 0.15)) * 10) / 10, 1, 10);
      }
    }
    this.say('fulltime', lines.fulltime(this.rng, {
      home: h.setup.team.shortName, away: a.setup.team.shortName, hs: String(h.stats.goals), as: String(a.stats.goals),
    }), 2);
  }

  result(): MatchResult {
    const all = [...this.playerStats.values()].filter(p => p.minutes > 0);
    const motm = all.reduce((best, p) =>
      p.rating > best.rating || (p.rating === best.rating && p.goals > best.goals) ? p : best, all[0]);
    const playerById = new Map<string, Player>();
    for (const s of this.sides) {
      for (const p of [...s.setup.lineup.starters, ...s.setup.lineup.bench]) playerById.set(p.id, p);
    }
    return {
      home: this.sides[0].setup.team,
      away: this.sides[1].setup.team,
      homeGoals: this.sides[0].stats.goals,
      awayGoals: this.sides[1].stats.goals,
      stats: [this.sides[0].stats, this.sides[1].stats],
      players: all,
      manOfTheMatch: motm,
      motmPlayer: playerById.get(motm.playerId)!,
      mentalities: [this.sides[0].setup.tactic.mentality, this.sides[1].setup.tactic.mentality],
      events: this.events,
    };
  }
}

export interface MatchResult {
  home: Team;
  away: Team;
  homeGoals: number;
  awayGoals: number;
  stats: [TeamMatchStats, TeamMatchStats];
  players: PlayerMatchStats[];
  manOfTheMatch: PlayerMatchStats;
  motmPlayer: Player;
  /** Mentality each side finished with. */
  mentalities: [Mentality, Mentality];
  events: MatchEvent[];
}
