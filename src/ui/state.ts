// What the screens share: the game being played, the screen on show and the
// canvas. Each screen module reads and changes `ui`; game.ts draws whichever
// view is current.

import type { CompId, GameState } from '../engine/world';
import type { Player, Team } from '../engine/types';
import type { Screen } from './retro/screen';

export type InfoTab = 'homeStats' | 'incidents' | 'stats' | 'ratings' | 'awayStats';
export type ProfileTab = 'skills' | 'condition' | 'contract' | 'transfer';
export type SquadMode = 'positions' | 'stats' | 'contracts' | 'fitness';

export type View =
  | { kind: 'title' }
  | { kind: 'pickClub' }
  | { kind: 'menu' }
  /** Unread news, one item at a time. */
  | { kind: 'news'; at: number }
  | { kind: 'newsList'; page: number }
  | { kind: 'competitions' }
  | { kind: 'table'; back: View }
  | { kind: 'fixtures'; clubId: string; page: number; back: View }
  | { kind: 'cup'; comp: Exclude<CompId, 'PL'>; round: number; back: View }
  | { kind: 'scorers'; back: View }
  | { kind: 'transfersList'; page: number; back: View }
  | { kind: 'squad'; teamId: string; mode: SquadMode; back: View }
  | { kind: 'profile'; player: Player; team: Team; back: View; tab: ProfileTab; message?: string }
  | { kind: 'search'; page: number }
  | { kind: 'bid'; playerId: string; fee: number; back: View; message?: string }
  | { kind: 'terms'; talksId: string; wage: number; years: number; back: View; message?: string; done?: boolean }
  | { kind: 'offer'; talksId: string; back: View; message?: string }
  | { kind: 'finances' }
  | { kind: 'saves'; page: number; confirm?: string; message?: string }
  | { kind: 'matchday' }
  /** `theirs` shows the other side's tactics, to look at but not change. */
  | { kind: 'tactics'; theirs?: boolean; back?: View }
  | { kind: 'confirm' }
  | { kind: 'match' }
  | { kind: 'info'; tab: InfoTab }
  | { kind: 'result' }
  /** The match info screens for a match already played. */
  | { kind: 'report'; fixtureId: string; tab: InfoTab; back: View }
  | { kind: 'dayResults'; page: number }
  | { kind: 'over' };

export const ui = {
  view: { kind: 'title' } as View,
  game: undefined as GameState | undefined,
  screen: undefined as unknown as Screen,
};

export function game(): GameState {
  return ui.game!;
}

export function go(v: View) {
  ui.view = v;
}
