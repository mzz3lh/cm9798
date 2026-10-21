// The Championship and League One for 2026/27, who join the Premier League
// clubs in the two domestic cups. Their leagues are not played until the
// living-world phase. Squads are generated, as the original generated
// players it had no data for, from the club's level; Burnley keep the real
// squad written for the match demo. League One's line-up is approximate: the
// four clubs relegated to League Two in 2026 are not confirmed here.

import { makePlayer } from '../engine/generate';
import { randomName, randomNation } from '../engine/names';
import { Rng, hashString } from '../engine/rng';
import type { Player, Position, Team } from '../engine/types';
import type { ClubInfo } from './premier-league';
import { BURNLEY } from './squads';

const SHAPE: Position[] = [
  'GK', 'GK', 'DR', 'DR', 'DC', 'DC', 'DC', 'DC', 'DL', 'DL', 'DM', 'MC', 'MC', 'MC',
  'MR', 'ML', 'AMR', 'AML', 'AMC', 'ST', 'ST', 'ST',
];

/** A squad made up from the club's level: its best players near `level`, the rest a little below. */
export function generateSquad(teamId: string, level: number): Player[] {
  const rng = new Rng(hashString(`squad-${teamId}`));
  return SHAPE.map((pos, i) => {
    const nation = randomNation(rng);
    const age = rng.int(18, 34);
    const second = i % 2 === 1 || i > 18;
    const ability = Math.round(level + rng.normal(0, 7) - (second ? 8 : 0) - (age < 21 ? 10 : 0));
    const extra: Position[] = pos === 'DR' || pos === 'DL' ? (rng.chance(0.3) ? ['DC'] : [])
      : pos === 'MR' ? ['AMR'] : pos === 'ML' ? ['AML'] : pos === 'AMC' ? ['MC'] : [];
    return makePlayer({
      id: `${teamId}-g${i}`,
      name: randomName(rng, nation),
      nation, age, positions: [pos, ...extra], ability,
      potential: age < 23 ? ability + rng.int(5, 40) : 0,
    });
  });
}

function gen(
  id: string, name: string, shortName: string, reputation: number, stadium: string, capacity: number,
  colours: Team['colours'], level: number,
): ClubInfo {
  return { team: { id, name, shortName, reputation, stadium, colours, squad: generateSquad(id, level) }, capacity };
}

/** Championship clubs play at about ability 100-118, by reputation. */
const champ = (id: string, name: string, shortName: string, rep: number, stadium: string, cap: number, primary: string, secondary: string) =>
  gen(id, name, shortName, rep, stadium, cap, { primary, secondary }, 96 + rep * 2);
/** League One about 80-95. */
const l1 = (id: string, name: string, shortName: string, rep: number, stadium: string, cap: number, primary: string, secondary: string) =>
  gen(id, name, shortName, rep, stadium, cap, { primary, secondary }, 76 + rep * 2);

export const CHAMPIONSHIP: ClubInfo[] = [
  champ('bir', 'Birmingham City', 'Birmingham', 10, "St Andrew's", 29409, '#0000ff', '#ffffff'),
  champ('bla', 'Blackburn Rovers', 'Blackburn', 9, 'Ewood Park', 31367, '#009ee0', '#ffffff'),
  champ('bol', 'Bolton Wanderers', 'Bolton', 8, 'Toughsheet Community Stadium', 28723, '#ffffff', '#263c7e'),
  champ('brc', 'Bristol City', 'Bristol City', 9, 'Ashton Gate', 27000, '#e21b23', '#ffffff'),
  { team: { ...BURNLEY, reputation: 12 }, capacity: 21944 },
  champ('car', 'Cardiff City', 'Cardiff', 8, 'Cardiff City Stadium', 33280, '#0070b5', '#ffffff'),
  champ('cha', 'Charlton Athletic', 'Charlton', 8, 'The Valley', 27111, '#d4021d', '#ffffff'),
  champ('der', 'Derby County', 'Derby', 9, 'Pride Park', 32956, '#ffffff', '#000000'),
  champ('lin', 'Lincoln City', 'Lincoln', 6, 'LNER Stadium', 10120, '#e31b23', '#ffffff'),
  champ('mid', 'Middlesbrough', 'Middlesbrough', 10, 'Riverside Stadium', 34742, '#e11b22', '#ffffff'),
  champ('mil', 'Millwall', 'Millwall', 8, 'The Den', 20146, '#001e5a', '#ffffff'),
  champ('nor', 'Norwich City', 'Norwich', 10, 'Carrow Road', 27359, '#fff200', '#00a650'),
  champ('por', 'Portsmouth', 'Portsmouth', 8, 'Fratton Park', 20867, '#001489', '#ffffff'),
  champ('pre', 'Preston North End', 'Preston', 8, 'Deepdale', 23404, '#ffffff', '#001e5a'),
  champ('qpr', 'Queens Park Rangers', 'QPR', 8, 'Loftus Road', 18439, '#1d5ba4', '#ffffff'),
  champ('shu', 'Sheffield United', 'Sheff Utd', 10, 'Bramall Lane', 32050, '#ee2737', '#ffffff'),
  champ('sou', 'Southampton', 'Southampton', 11, "St Mary's Stadium", 32384, '#d71920', '#ffffff'),
  champ('sto', 'Stoke City', 'Stoke', 9, 'bet365 Stadium', 30089, '#e03a3e', '#ffffff'),
  champ('swa', 'Swansea City', 'Swansea', 9, 'Swansea.com Stadium', 21088, '#ffffff', '#000000'),
  champ('wat', 'Watford', 'Watford', 9, 'Vicarage Road', 22200, '#fbee23', '#ed2127'),
  champ('wba', 'West Bromwich Albion', 'West Brom', 10, 'The Hawthorns', 26850, '#122f67', '#ffffff'),
  champ('whu', 'West Ham United', 'West Ham', 13, 'London Stadium', 62500, '#7a263a', '#1bb1e7'),
  champ('wol', 'Wolverhampton Wanderers', 'Wolves', 12, 'Molineux', 31750, '#fdb913', '#231f20'),
  champ('wre', 'Wrexham', 'Wrexham', 9, 'Racecourse Ground', 12600, '#d71920', '#ffffff'),
];

export const LEAGUE_ONE: ClubInfo[] = [
  l1('wim', 'AFC Wimbledon', 'Wimbledon', 6, 'Plough Lane', 9215, '#1b3f8f', '#f7d417'),
  l1('bar', 'Barnsley', 'Barnsley', 7, 'Oakwell', 23287, '#d71920', '#ffffff'),
  l1('blp', 'Blackpool', 'Blackpool', 7, 'Bloomfield Road', 16616, '#f68712', '#ffffff'),
  l1('brd', 'Bradford City', 'Bradford', 6, 'Valley Parade', 25136, '#8b1a3a', '#f9b233'),
  l1('brm', 'Bromley', 'Bromley', 4, 'Hayes Lane', 5000, '#ffffff', '#000000'),
  l1('bur2', 'Burton Albion', 'Burton', 4, 'Pirelli Stadium', 6912, '#ffcc00', '#000000'),
  l1('cam', 'Cambridge United', 'Cambridge Utd', 5, 'Abbey Stadium', 8127, '#f7a520', '#000000'),
  l1('don', 'Doncaster Rovers', 'Doncaster', 6, 'Eco-Power Stadium', 15231, '#e2231a', '#ffffff'),
  l1('hud', 'Huddersfield Town', 'Huddersfield', 7, "John Smith's Stadium", 24121, '#0e63ad', '#ffffff'),
  l1('lei', 'Leicester City', 'Leicester', 11, 'King Power Stadium', 32259, '#003090', '#ffffff'),
  l1('ori', 'Leyton Orient', 'Leyton Orient', 5, 'Brisbane Road', 9271, '#c8102e', '#ffffff'),
  l1('lut', 'Luton Town', 'Luton', 8, 'Kenilworth Road', 12000, '#f78f1e', '#002d62'),
  l1('man', 'Mansfield Town', 'Mansfield', 5, 'Field Mill', 9186, '#fdc20e', '#003a7d'),
  l1('mkd', 'MK Dons', 'MK Dons', 6, 'Stadium MK', 30500, '#ffffff', '#000000'),
  l1('nco', 'Notts County', 'Notts County', 6, 'Meadow Lane', 19841, '#000000', '#ffffff'),
  l1('oxf', 'Oxford United', 'Oxford Utd', 7, 'Kassam Stadium', 12500, '#fdd700', '#002b5c'),
  l1('pet', 'Peterborough United', 'Peterborough', 6, 'Weston Homes Stadium', 15314, '#0057b8', '#ffffff'),
  l1('ply', 'Plymouth Argyle', 'Plymouth', 7, 'Home Park', 17900, '#00553e', '#ffffff'),
  l1('rea', 'Reading', 'Reading', 7, 'Select Car Leasing Stadium', 24161, '#004494', '#ffffff'),
  l1('shw', 'Sheffield Wednesday', 'Sheff Wed', 9, 'Hillsborough', 39732, '#2160c4', '#ffffff'),
  l1('ste', 'Stevenage', 'Stevenage', 5, 'Lamex Stadium', 7800, '#ffffff', '#d71920'),
  l1('stk', 'Stockport County', 'Stockport', 6, 'Edgeley Park', 10841, '#0055a5', '#ffffff'),
  l1('wig', 'Wigan Athletic', 'Wigan', 6, 'Brick Community Stadium', 25138, '#1d59af', '#ffffff'),
  l1('wyc', 'Wycombe Wanderers', 'Wycombe', 6, 'Adams Park', 10137, '#88d1f1', '#00205b'),
];
