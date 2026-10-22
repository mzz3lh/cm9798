// Money: what a player is worth, what he earns and what he asks for. Values
// are anchored on the original's scale (ability 120 = an average top-flight
// player, 150 = an average international) at today's prices.

import type { Player } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Rounds money the way a transfer screen shows it: £25k steps under £1m, £250k steps above. */
export function roundMoney(v: number): number {
  if (v < 1e6) return Math.max(0, Math.round(v / 25000) * 25000);
  if (v < 1e7) return Math.round(v / 250000) * 250000;
  return Math.round(v / 500000) * 500000;
}

/** Weekly wages round to £500 under £10k, £1k above. */
export function roundWage(v: number): number {
  return v < 10000 ? Math.max(500, Math.round(v / 500) * 500) : Math.round(v / 1000) * 1000;
}

/** "£15.5m", "£750k", "£45k/wk" style figures. */
export function money(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}£${(a / 1e6).toFixed(a >= 1e8 ? 0 : 2).replace(/\.?0+$/, '')}m`;
  if (a >= 1e3) return `${sign}£${Math.round(a / 1e3)}k`;
  return `${sign}£${Math.round(a)}`;
}

/**
 * Market value. Ability sets the base; youth with room to grow adds to it,
 * age takes it away, and a contract running down drags it towards nothing.
 */
export function playerValue(p: Player, contractYearsLeft: number): number {
  let v = 15e6 * Math.exp((p.ability - 120) / 27);
  if (p.age < 24) v *= 1 + clamp(p.potential - p.ability, 0, 60) / 60 * (24 - p.age) / 6;
  if (p.age >= 29) v *= clamp(1 - (p.age - 28) * 0.13, 0.12, 1);
  if (contractYearsLeft <= 1) v *= 0.45;
  else if (contractYearsLeft <= 2) v *= 0.8;
  return roundMoney(v);
}

/** The going weekly wage for a player of this ability at a club of this reputation (1-20). */
export function marketWage(p: Player, clubReputation: number): number {
  const base = 45000 * Math.exp((p.ability - 120) / 26);
  // Bigger clubs pay more for the same player; lower leagues much less.
  const club = 0.55 + clubReputation / 20 * 0.7;
  const age = p.age >= 31 ? 0.85 : 1;
  return roundWage(base * club * age);
}

/** How many years a player wants on a new contract, by age. */
export function wantedYears(p: Player): number {
  return p.age < 24 ? 5 : p.age < 29 ? 4 : p.age < 32 ? 2 : 1;
}

/** Seasons left on a contract that ends on 30 June of `expires`, counting the current one. */
export function yearsLeft(expires: number, seasonYear: number): number {
  return expires - seasonYear;
}
