// Commentary lines, in the spirit of CM97/98: short, plain, one beat at a time.
// Each function returns one line; the engine picks which to call.

import type { Rng } from './rng';

type Fill = Record<string, string>;

function fill(template: string, f: Fill): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => f[k] ?? k);
}

function say(rng: Rng, options: string[], f: Fill): string {
  return fill(rng.pick(options), f);
}

export const lines = {
  kickoff: (rng: Rng, f: Fill) => say(rng, [
    '{home} get us under way at {stadium}.',
    "We're off! {home} kick off at {stadium}.",
    'The referee blows and {home} start the game at {stadium}.',
  ], f),

  secondHalf: (rng: Rng, f: Fill) => say(rng, [
    '{away} get the second half started.',
    "We're back under way for the second half.",
  ], f),

  halftime: (rng: Rng, f: Fill) => say(rng, [
    'Half time: {home} {hs}, {away} {as}.',
    "The referee blows for half time. It's {home} {hs}, {away} {as}.",
  ], f),

  fulltime: (rng: Rng, f: Fill) => say(rng, [
    "That's it! Full time: {home} {hs}, {away} {as}.",
    'The final whistle goes. {home} {hs}, {away} {as}.',
  ], f),

  possession: (rng: Rng, f: Fill) => say(rng, [
    '{team} keep the ball well.',
    '{player} plays it simply in midfield.',
    '{team} knock it around at the back.',
    '{player} looks for an opening.',
    '{team} are content to keep possession.',
    '{player} switches the play.',
  ], f),

  pressing: (rng: Rng, f: Fill) => say(rng, [
    '{team} press high and win it back.',
    '{player} closes down quickly and forces a mistake.',
  ], f),

  build: {
    through: (rng: Rng, f: Fill) => say(rng, [
      '{creator} threads a pass through to {player}...',
      '{creator} spots the run of {player}...',
      'Lovely ball from {creator} towards {player}...',
    ], f),
    cross: (rng: Rng, f: Fill) => say(rng, [
      '{creator} crosses into the box...',
      '{creator} whips the ball in from the {flank}...',
      '{creator} gets to the byline and pulls it back...',
    ], f),
    dribble: (rng: Rng, f: Fill) => say(rng, [
      '{player} takes on {defender}...',
      '{player} goes past {defender} and into the area...',
      '{player} runs at the defence...',
    ], f),
    long: (rng: Rng, f: Fill) => say(rng, [
      '{creator} hits it long towards {player}...',
      'A long ball forward from {creator}...',
    ], f),
    counter: (rng: Rng, f: Fill) => say(rng, [
      '{team} break quickly!',
      'Counter attack from {team}!',
    ], f),
  },

  attackBroken: (rng: Rng, f: Fill) => say(rng, [
    '{defender} reads it and clears.',
    'Good tackle by {defender}.',
    '{defender} gets a vital touch.',
    '{defender} cuts it out.',
    'The pass is cut out by {defender}.',
  ], f),

  aerialWon: (rng: Rng, f: Fill) => say(rng, [
    '{player} rises highest...',
    '{player} wins it in the air again...',
    '{player} climbs above {defender}...',
  ], f),

  longShot: (rng: Rng, f: Fill) => say(rng, [
    '{player} tries his luck from distance...',
    '{player} shoots from 30 yards...',
    '{player} has a go from outside the box...',
  ], f),

  oneOnOne: (rng: Rng, f: Fill) => say(rng, [
    "{player} is clean through! It's just him and the keeper...",
    '{player} is through on goal...',
  ], f),

  shot: (rng: Rng, f: Fill) => say(rng, [
    '{player} shoots...',
    '{player} hits it...',
    '{player} goes for goal...',
  ], f),

  header: (rng: Rng, f: Fill) => say(rng, [
    '{player} heads towards goal...',
    'Header from {player}...',
  ], f),

  goal: (rng: Rng, f: Fill) => say(rng, [
    'GOAL! {player} scores for {team}!',
    'GOAL!!! {player} puts it away!',
    "It's in! {player} scores!",
    'GOAL! A fine finish from {player}!',
  ], f),

  score: (_rng: Rng, f: Fill) => fill('{home} {hs}, {away} {as}.', f),

  save: (rng: Rng, f: Fill) => say(rng, [
    'Saved by {keeper}.',
    '{keeper} gathers it comfortably.',
    'Straight at {keeper}.',
  ], f),

  greatSave: (rng: Rng, f: Fill) => say(rng, [
    'What a save by {keeper}!',
    '{keeper} tips it round the post!',
    'Brilliant stop from {keeper}!',
  ], f),

  miss: (rng: Rng, f: Fill) => say(rng, [
    'Wide.',
    'Over the bar.',
    "It's just wide of the post.",
    'He should have done better. It goes wide.',
  ], f),

  block: (rng: Rng, f: Fill) => say(rng, [
    'Blocked by {defender}.',
    '{defender} throws himself in the way.',
  ], f),

  corner: (rng: Rng, f: Fill) => say(rng, [
    'Corner to {team}.',
    "It's out for a corner.",
  ], f),

  cornerTaken: (rng: Rng, f: Fill) => say(rng, [
    '{taker} swings in the corner...',
    '{taker} takes the corner...',
  ], f),

  cornerCleared: (rng: Rng, f: Fill) => say(rng, [
    'Headed clear by {defender}.',
    '{keeper} punches it away.',
    'The corner comes to nothing.',
  ], f),

  foul: (rng: Rng, f: Fill) => say(rng, [
    'Free kick. {player} brings down {victim}.',
    'Foul by {player} on {victim}.',
  ], f),

  freeKick: (rng: Rng, f: Fill) => say(rng, [
    '{player} lines up the free kick...',
    'Free kick in range. {player} stands over it...',
    '{player} goes for goal from the free kick...',
  ], f),

  yellow: (rng: Rng, f: Fill) => say(rng, [
    '{player} is booked.',
    'Yellow card for {player}.',
  ], f),

  secondYellow: (rng: Rng, f: Fill) => say(rng, [
    "It's a second yellow for {player}, and he's off!",
  ], f),

  red: (rng: Rng, f: Fill) => say(rng, [
    'RED CARD! {player} is sent off!',
    'Straight red for {player}!',
  ], f),

  penaltyAwarded: (rng: Rng, f: Fill) => say(rng, [
    'PENALTY! {victim} is brought down by {player}!',
    "The referee points to the spot! {player} fouled {victim}.",
  ], f),

  penaltyTaken: (rng: Rng, f: Fill) => say(rng, [
    '{player} steps up to take it...',
  ], f),

  penaltySaved: (rng: Rng, f: Fill) => say(rng, [
    '{keeper} saves the penalty!',
  ], f),

  penaltyMissed: (rng: Rng, f: Fill) => say(rng, [
    '{player} blasts it over!',
    '{player} hits the post!',
  ], f),

  varCheck: (rng: Rng, f: Fill) => say(rng, [
    'VAR check for a possible offside...',
    'The goal is being checked by VAR...',
  ], f),

  varOverturned: (rng: Rng, f: Fill) => say(rng, [
    'NO GOAL! Semi-automated offside rules it out.',
    'NO GOAL! VAR finds a foul in the build-up.',
  ], f),

  varStands: (rng: Rng, f: Fill) => say(rng, [
    'The goal stands.',
  ], f),

  injury: (rng: Rng, f: Fill) => say(rng, [
    '{player} is down injured and has to come off.',
    "{player} pulls up holding his hamstring. He can't continue.",
  ], f),

  knock: (rng: Rng, f: Fill) => say(rng, [
    '{player} needs treatment and must wait a minute on the touchline.',
  ], f),

  sub: (_rng: Rng, f: Fill) => fill('Substitution for {team}: {on} replaces {off}.', f),

  tactic: (_rng: Rng, f: Fill) => fill('{team} change their approach: {change}.', f),

  keeperDelay: (rng: Rng, f: Fill) => say(rng, [
    '{keeper} holds on to the ball too long! Corner to {team}.',
  ], f),

  sittingDeep: (rng: Rng, f: Fill) => say(rng, [
    '{team} have everybody behind the ball.',
    '{team} are defending deep.',
  ], f),
};
