// Moving the game on: Continue plays days until the manager has something to
// see, which is unread news, one of his matches or the end of the season,
// and saves the game at each stop.

import { advance } from '../engine/season';
import type { GameState } from '../engine/world';
import { startMatchday } from './matchday';
import { autosave } from './saves';
import { game, go, ui } from './state';

let saving: Promise<void> = Promise.resolve();
export let saveError: string | undefined;

/** Saves in the background; saves run one after another. */
export function autosaveNow() {
  const g = game();
  const copy = JSON.parse(JSON.stringify(g)) as GameState;
  saving = saving.then(() => autosave(copy)).then(() => { saveError = undefined; }, e => { saveError = String(e?.message ?? e); });
}

export function carryOn() {
  const stop = advance(game());
  autosaveNow();
  if (stop.kind === 'news') go({ kind: 'news', at: 0 });
  else if (stop.kind === 'match') startMatchday(stop.fixture);
  else go({ kind: 'over' });
}

/** Starts playing a game just made or loaded. */
export function begin(g: GameState) {
  ui.game = g;
  go({ kind: 'menu' });
}
