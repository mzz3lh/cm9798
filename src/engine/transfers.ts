// Transfers and contracts, with the original's rhythm: bid, the selling club
// accepts, rejects or names its price the next day, then personal terms are
// agreed with the player. One change from 1997, at Mike's request: a player
// who names a wage accepts any offer that meets it and the length he wants.
// The board limits wages by what the club can afford, as the 97/98 patch did.

import { addDays, daysBetween, windowOpen } from './calendar';
import { marketWage, money, roundWage, wantedYears } from './economy';
import type { Player } from './types';
import { addNews, newId, playerById, rngFor, valueOf, wageBill, type GameState, type Talks } from './world';

export const SQUAD_LIMIT = 32;

function team(g: GameState, id: string) {
  return g.teams[id];
}

/** Where a player ranks in his club by ability: 0 = best. */
function rankInSquad(g: GameState, p: Player): number {
  const squad = team(g, g.players[p.id].clubId).squad;
  return [...squad].sort((a, b) => b.ability - a.ability).findIndex(x => x.id === p.id);
}

/** What a club wants for one of its players. */
export function askingPrice(g: GameState, p: Player, buyerId: string): number {
  const st = g.players[p.id];
  const rank = rankInSquad(g, p);
  let f = 1.15 + (rank < 3 ? 0.5 : rank < 11 ? 0.25 : 0);
  if (st.listed) f -= 0.3;
  if (team(g, st.clubId).reputation > team(g, buyerId).reputation + 3) f += 0.2;
  return Math.round(valueOf(g, p) * f / 250000) * 250000 || 25000;
}

/** What a player asks to sign for (or stay at) a club: his weekly wage and the years he wants. */
export function contractDemand(g: GameState, p: Player, clubId: string, moving: boolean): { wage: number; years: number } {
  const market = marketWage(p, team(g, clubId).reputation);
  const current = g.players[p.id].contract.wage;
  return { wage: roundWage(Math.max(market * (moving ? 1.1 : 1.0), current * (moving ? 1.15 : 1.05))), years: wantedYears(p) };
}

/** Won't talk to a club far below his standing, as in the original. */
export function willTalk(g: GameState, p: Player, clubId: string): boolean {
  return team(g, clubId).reputation * 10 + 45 >= p.reputation;
}

function weeklyWagesAfter(g: GameState, clubId: string, add: number, remove = 0): number {
  return wageBill(g, clubId) + add - remove;
}

// ------------------------------------------------------------------ the human buying

export function openTalks(g: GameState, playerId: string): Talks | undefined {
  return g.talks.find(t => t.playerId === playerId && ['bid', 'countered', 'terms'].includes(t.stage));
}

/** Makes a bid. Returns the talks, or why it can't be made. */
export function makeBid(g: GameState, playerId: string, fee: number): Talks | string {
  const p = playerById(g, playerId);
  if (!p) return 'Player not found.';
  const st = g.players[playerId];
  const me = g.humanClubId;
  if (st.clubId === me) return 'He already plays for you.';
  if (!windowOpen(g.date)) return 'The transfer window is closed.';
  if (st.movedOn && st.movedOn > g.date) return `${p.name} has only just moved clubs.`;
  if (team(g, me).squad.length >= SQUAD_LIMIT) return `Your squad is full (${SQUAD_LIMIT} players).`;
  if (fee > g.clubs[me].transferBudget) return `The board will only let you spend ${money(g.clubs[me].transferBudget)}.`;
  const existing = openTalks(g, playerId);
  if (existing && existing.to === me) {
    existing.fee = fee;
    existing.stage = 'bid';
    existing.replyOn = addDays(g.date, 1);
    return existing;
  }
  const t: Talks = { id: newId(g, 'k'), playerId, from: st.clubId, to: me, fee, stage: 'bid', replyOn: addDays(g.date, 1), rounds: 0 };
  g.talks.push(t);
  return t;
}

/** Talks with one of the human's own players about a new contract. */
export function startRenewal(g: GameState, playerId: string): Talks | string {
  const p = playerById(g, playerId);
  if (!p || g.players[playerId].clubId !== g.humanClubId) return 'Not your player.';
  const existing = g.talks.find(t => t.playerId === playerId && t.renewal && t.stage === 'terms');
  if (existing) return existing;
  const t: Talks = {
    id: newId(g, 'k'), playerId, from: g.humanClubId, to: g.humanClubId, fee: 0, stage: 'terms', rounds: 0, renewal: true,
    demand: contractDemand(g, p, g.humanClubId, false),
  };
  g.talks.push(t);
  return t;
}

export type TermsReply = { ok: true; text: string } | { ok: false; text: string };

/**
 * A contract offer to a player. Meeting his asking wage and the length he
 * wants (a year either way is fine) is always accepted. Below it he may
 * still accept if it's close, otherwise he asks for a little more, and
 * after three refusals he walks away.
 */
export function offerTerms(g: GameState, talksId: string, wage: number, years: number): TermsReply {
  const t = g.talks.find(x => x.id === talksId);
  const p = t && playerById(g, t.playerId);
  if (!t || !p || t.stage !== 'terms' || !t.demand) return { ok: false, text: 'These talks are over.' };
  const club = g.clubs[t.to];
  const current = t.renewal ? g.players[p.id].contract.wage : 0;
  if (weeklyWagesAfter(g, t.to, wage, current) > club.wageBudget) {
    return { ok: false, text: `The board won't sanction it: the wage bill would go over ${money(club.wageBudget)} a week.` };
  }
  const d = t.demand;
  const lengthOk = Math.abs(years - d.years) <= 1;
  if (wage >= d.wage && lengthOk) {
    complete(g, t, wage, years);
    return { ok: true, text: t.renewal ? `${p.name} has signed a new ${years} year contract.` : `${p.name} has signed for ${team(g, t.to).name}.` };
  }
  if (wage >= d.wage) return { ok: false, text: `${p.name} wants a ${d.years} year contract.` };
  const rng = rngFor(g, 'terms', t.id, t.rounds);
  if (lengthOk && wage >= d.wage * 0.93 && rng.chance(0.5)) {
    complete(g, t, wage, years);
    return { ok: true, text: `${p.name} has accepted.` };
  }
  t.rounds++;
  if (t.rounds >= 3) {
    t.stage = 'refused';
    return { ok: false, text: `${p.name} has broken off talks.` };
  }
  // Haggling can make him dig in.
  if (wage < d.wage * 0.85) d.wage = roundWage(d.wage * 1.05);
  return { ok: false, text: `${p.name} turns it down. He wants ${money(d.wage)} a week over ${d.years} years.` };
}

export function withdraw(g: GameState, talksId: string) {
  const t = g.talks.find(x => x.id === talksId);
  if (t && ['bid', 'countered', 'terms'].includes(t.stage)) t.stage = 'withdrawn';
}

/** Accepting the selling club's price moves straight on to personal terms. */
export function meetAskingPrice(g: GameState, talksId: string): string | undefined {
  const t = g.talks.find(x => x.id === talksId);
  if (!t || t.stage !== 'countered' || !t.asking) return 'These talks are over.';
  if (t.asking > g.clubs[t.to].transferBudget) return `The board will only let you spend ${money(g.clubs[t.to].transferBudget)}.`;
  t.fee = t.asking;
  toTerms(g, t);
  return undefined;
}

function toTerms(g: GameState, t: Talks) {
  const p = playerById(g, t.playerId)!;
  t.stage = willTalk(g, p, t.to) ? 'terms' : 'refused';
  t.demand = contractDemand(g, p, t.to, true);
}

function complete(g: GameState, t: Talks, wage: number, years: number) {
  const p = playerById(g, t.playerId)!;
  const st = g.players[p.id];
  t.stage = 'done';
  st.contract = { wage, expires: g.seasonYear + years };
  if (t.renewal) return;
  movePlayer(g, p, t.from, t.to, t.fee);
}

export function movePlayer(g: GameState, p: Player, from: string, to: string, fee: number) {
  const st = g.players[p.id];
  team(g, from).squad = team(g, from).squad.filter(x => x.id !== p.id);
  team(g, to).squad.push(p);
  st.clubId = to;
  st.listed = false;
  st.morale = 14;
  st.movedOn = addDays(g.date, 30);
  const buyer = g.clubs[to], seller = g.clubs[from];
  buyer.balance -= fee; buyer.transferBudget = Math.max(0, buyer.transferBudget - fee); buyer.spend.fees += fee;
  seller.balance += fee; seller.income.sales += fee;
  // Half of what comes in for a player goes back into the budget.
  seller.transferBudget += Math.round(fee / 2);
  g.transfers.push({ date: g.date, playerId: p.id, name: p.name, from, to, fee });
  // Talks anyone else had for him are off.
  for (const other of g.talks) if (other.playerId === p.id && ['bid', 'countered', 'terms'].includes(other.stage)) other.stage = 'withdrawn';
  const human = from === g.humanClubId || to === g.humanClubId;
  addNews(g, {
    kind: 'transfer', human, title: team(g, to).name, clubId: to,
    heading: `${p.name} Signs`,
    body: `${p.name} has joined ${team(g, to).name} from ${team(g, from).name} for ${fee ? money(fee) : 'an undisclosed fee'}.`,
  });
}

// ------------------------------------------------------------------ the human selling

export function toggleListed(g: GameState, playerId: string) {
  const st = g.players[playerId];
  if (st.clubId === g.humanClubId) st.listed = !st.listed;
}

/** Accepts a bid for one of the human's players: the buyer agrees terms with him at once. */
export function acceptBid(g: GameState, talksId: string): string | undefined {
  const t = g.talks.find(x => x.id === talksId);
  if (!t || t.stage !== 'bid' || t.from !== g.humanClubId) return 'That offer has gone.';
  if (!windowOpen(g.date)) return 'The transfer window is closed.';
  const p = playerById(g, t.playerId)!;
  const d = contractDemand(g, p, t.to, true);
  t.stage = 'done';
  g.players[p.id].contract = { wage: d.wage, expires: g.seasonYear + d.years };
  movePlayer(g, p, t.from, t.to, t.fee);
  return undefined;
}

export function rejectBid(g: GameState, talksId: string) {
  const t = g.talks.find(x => x.id === talksId);
  if (t && t.stage === 'bid' && t.from === g.humanClubId) t.stage = 'rejected';
}

// ------------------------------------------------------------------ each day

/** The selling club's answer to a bid. */
function answerBid(g: GameState, t: Talks) {
  const p = playerById(g, t.playerId);
  if (!p || g.players[p.id].clubId !== t.from) { t.stage = 'withdrawn'; return; }
  const asking = askingPrice(g, p, t.to);
  const seller = team(g, t.from);
  t.asking = asking;
  const news = (heading: string, body: string) =>
    addNews(g, { kind: 'bid', human: true, title: seller.name, clubId: seller.id, heading, body, talksId: t.id });
  if (t.fee >= asking) {
    toTerms(g, t);
    if (t.stage === 'refused') news('Bid Accepted', `${seller.name} have accepted your offer of ${money(t.fee)} for ${p.name}, but he does not want to join ${team(g, t.to).name}.`);
    else news('Bid Accepted', `${seller.name} have accepted your offer of ${money(t.fee)} for ${p.name}. He is ready to discuss personal terms.`);
  } else if (t.fee >= asking * 0.7) {
    t.stage = 'countered';
    news('Bid Rejected', `${seller.name} have turned down your offer of ${money(t.fee)} for ${p.name}, but would accept ${money(asking)}.`);
  } else {
    t.stage = 'rejected';
    news('Bid Rejected', `${seller.name} have rejected your offer of ${money(t.fee)} for ${p.name} out of hand.`);
  }
}

/** A club that could buy a player: has the money and the room, and would improve. */
function suitors(g: GameState, p: Player, maxFee: number): string[] {
  const seller = g.players[p.id].clubId;
  return Object.values(g.clubs).filter(c => {
    if (c.id === seller || c.id === g.humanClubId || c.transferBudget < maxFee) return false;
    const t = team(g, c.id);
    if (t.squad.length >= 30 || !willTalk(g, p, c.id)) return false;
    // He must be better than the club's second-best player in his position.
    const same = t.squad.filter(x => x.positions[0] === p.positions[0]).map(x => x.ability).sort((a, b) => b - a);
    return p.ability > (same[1] ?? 0) + 3;
  }).map(c => c.id);
}

export function transferDay(g: GameState) {
  const rng = rngFor(g, 'transfers', g.date);
  for (const t of g.talks) {
    if (t.stage === 'bid' && t.to === g.humanClubId && t.replyOn && t.replyOn <= g.date) answerBid(g, t);
    // Offers for the human's players lapse after five days unanswered.
    if (t.stage === 'bid' && t.from === g.humanClubId && t.replyOn && addDays(t.replyOn, 5) <= g.date) t.stage = 'withdrawn';
  }
  if (!windowOpen(g.date)) return;

  // Offers for the human's players: often for those on the list, now and then for a star.
  for (const p of team(g, g.humanClubId).squad) {
    const st = g.players[p.id];
    if (openTalks(g, p.id) || (st.movedOn && st.movedOn > g.date)) continue;
    const listed = st.listed;
    if (!rng.chance(listed ? 0.07 : p.ability >= 140 ? 0.004 : 0.0015)) continue;
    const value = valueOf(g, p);
    const fee = Math.round(value * (listed ? 0.65 + rng.next() * 0.35 : 1.05 + rng.next() * 0.4) / 250000) * 250000 || 25000;
    const buyers = suitors(g, p, fee);
    if (!buyers.length) continue;
    const buyer = rng.pick(buyers);
    const t: Talks = { id: newId(g, 'k'), playerId: p.id, from: g.humanClubId, to: buyer, fee, stage: 'bid', replyOn: g.date, rounds: 0 };
    g.talks.push(t);
    addNews(g, {
      kind: 'offer', human: true, title: team(g, buyer).name, clubId: buyer, heading: 'Transfer Offer',
      body: `${team(g, buyer).name} have offered ${money(fee)} for ${p.name}. His value is about ${money(value)}.`,
      talksId: t.id,
    });
  }

  // Business between the computer's clubs, so the world moves too.
  if (rng.chance(0.3)) aiDeal(g, rng);
}

function aiDeal(g: GameState, rng: ReturnType<typeof rngFor>) {
  const buyers = Object.values(g.clubs).filter(c => c.id !== g.humanClubId && c.division !== 'L1' && c.transferBudget > 1e6);
  if (!buyers.length) return;
  const buyer = rng.pick(buyers);
  const squad = team(g, buyer.id).squad;
  // Strengthen the position where the club's best player is weakest.
  const lines = ['GK', 'DC', 'DR', 'DL', 'MC', 'AML', 'AMR', 'ST'] as const;
  const need = lines.map(pos => ({ pos, best: Math.max(0, ...squad.filter(p => p.positions.includes(pos)).map(p => p.ability)) }))
    .sort((a, b) => a.best - b.best)[0];
  // One signing per position per window is enough.
  if (g.transfers.some(t => t.to === buyer.id && daysBetween(t.date, g.date) < 90 && playerById(g, t.playerId)?.positions[0] === need.pos)) return;
  const candidates = Object.values(g.teams)
    .filter(t => t.id !== buyer.id && t.id !== g.humanClubId && t.reputation <= team(g, buyer.id).reputation + 1 && t.squad.length > 18)
    .flatMap(t => t.squad)
    .filter(p => p.positions[0] === need.pos && p.ability > need.best + 4 && willTalk(g, p, buyer.id) && !openTalks(g, p.id))
    .filter(p => { const st = g.players[p.id]; return !st.movedOn || st.movedOn <= g.date; });
  const affordable = candidates.filter(p => askingPrice(g, p, buyer.id) <= buyer.transferBudget);
  if (!affordable.length) return;
  const p = rng.pick(affordable.sort((a, b) => b.ability - a.ability).slice(0, 5));
  const fee = askingPrice(g, p, buyer.id);
  const d = contractDemand(g, p, buyer.id, true);
  g.players[p.id].contract = { wage: d.wage, expires: g.seasonYear + d.years };
  movePlayer(g, p, g.players[p.id].clubId, buyer.id, fee);
}
