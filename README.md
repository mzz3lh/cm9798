# CM9798

A modern remake of Championship Manager 97/98: the same fast, text-driven game, with 2026/27 players, rules and competitions. For private use.

The design is in the [design doc](https://claude.ai/code/artifact/3101f0e9-5060-4fb7-993f-e2753fc5718f).

## Status: Phase 2, a playable season

Pick any of the 20 Premier League clubs of 2026/27 and play the season day by day: league, League Cup and FA Cup, transfers in both windows, contracts, injuries, bans, the board and the club's money. Every match in the Premier League, Championship and League One is played, so cup ties against lower-league sides and loan stats work.

- `src/engine/` holds the game rules. Nothing in it touches the screen.
  - `match.ts` is the minute-by-minute possession engine, with AI mentality, subs and ratings. `commentary.ts` has the commentary lines.
  - `world.ts` is the saved game: clubs, players, fixtures, cups, news and talks, all plain JSON.
  - `season.ts` moves the game a day at a time: fixtures, cup draws, results, injuries, bans, money, the board and the end of the season.
  - `transfers.ts` handles bids, asking prices, personal terms, renewals and the computer clubs' own deals. Offering a player exactly the wage he asks for, for the length he wants, is always accepted.
  - `calendar.ts` has the 2026/27 dates and transfer windows; `economy.ts` values players and wages.
  - `generate.ts` fills in any attribute left at 0, as the original did; `rng.ts` makes everything replayable from a seed.
- `src/data/` holds the squads: real Premier League squads (as at the end of 2025/26, with the three promoted clubs), the Championship and League One.
- `src/ui/` is the game, drawn like the original: 640x480 with the photo backdrop, grey bevelled buttons and the original bitmap fonts.
  - `screens.ts` has the main menu (with the date as its title), news, competition info, player search, bids, contract talks, finances and saves.
  - `matchday.ts` has the squad, tactics, match and match info screens.
  - `saves.ts` autosaves into the browser at every stop: the last 30 days, then one a week, so you can go back to any of those dates. A save can also be downloaded as a file and loaded on another machine.
  - `demo.ts` is the Phase 1 one-off match demo.
- `scripts/original-assets.mjs` decodes the original game's fonts and backdrops from `original/cm9798v2/`, which is kept out of git. The build embeds them when that folder is there and falls back to a system font without them.
- `scripts/season.ts` plays a whole season with the computer managing every club and checks it finishes, with sensible results, in under four hours of play.

## Commands

```sh
npm install
npm run typecheck
npm run season       # a whole season, auto-played, with the table and play time
npm run balance      # five simulated seasons against real averages
npm run tactics      # each tactic against the same opponent, 400 matches
npm run build        # writes dist/game.html and dist/demo.html, single self-contained pages
```
