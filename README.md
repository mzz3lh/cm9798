# CM9798

A modern remake of Championship Manager 97/98: the same fast, text-driven game, with 2026/27 players, rules and competitions. For private use.

The design is in the [design doc](https://claude.ai/code/artifact/3101f0e9-5060-4fb7-993f-e2753fc5718f).

## Status: Phase 1, the match engine

- `src/engine/` holds the game rules. Nothing in it touches the screen.
  - `match.ts` is the minute-by-minute possession engine, with AI mentality, subs and ratings.
  - `commentary.ts` has the commentary lines.
  - `generate.ts` fills in any attribute left at 0, as the original did.
  - `rng.ts` is the seeded random number generator, so any match can be replayed from its seed.
- `src/data/squads.ts` holds four sample squads (2025/26, with hand-set ratings) for the demo.
- `src/ui/` is the browser match demo.
- `scripts/balance.ts` plays whole seasons of a generated league and compares the results with real Premier League averages.
- `scripts/tactics.ts` checks that each tactic setting changes the results.

## Commands

```sh
npm install
npm run typecheck
npm run balance      # five simulated seasons against real averages
npm run tactics      # each tactic against the same opponent, 400 matches
npm run build:demo   # writes dist/demo.html, a single self-contained page
```
