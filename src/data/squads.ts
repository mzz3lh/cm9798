// Sample squads for the Phase 1 match demo. Players and clubs reflect the
// latest data available when this was written (the 2025/26 season), and the
// ratings are rough hand estimates on the CM scales, not converted from
// EA Sports FC or Opta yet: that is the data phase's job. Attributes not given
// are left at 0 and generated, as the original did.

import { makePlayer, type PlayerSeed } from '../engine/generate';
import type { Attributes, Position, Team, Tendencies } from '../engine/types';

function p(
  name: string, nation: string, age: number, positions: Position[], ability: number,
  attributes: Partial<Attributes> = {}, tendencies: Partial<Tendencies> = {},
  shortName?: string,
): PlayerSeed {
  return { name, nation, age, positions, ability, attributes, tendencies, shortName };
}

function team(
  id: string, name: string, shortName: string, reputation: number, stadium: string,
  colours: Team['colours'], seeds: PlayerSeed[],
): Team {
  return { id, name, shortName, reputation, stadium, colours, squad: seeds.map(s => makePlayer({ ...s, id: `${id}-${s.name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-') })) };
}

export const ARSENAL = team('ars', 'Arsenal', 'Arsenal', 18, 'Emirates Stadium', { primary: '#db0007', secondary: '#ffffff' }, [
  p('David Raya', 'Spain', 31, ['GK'], 160, { handling: 15, tackling: 16, passing: 16 }),
  p('Kepa Arrizabalaga', 'Spain', 31, ['GK'], 135, {}, {}, 'Kepa'),
  p('Ben White', 'England', 28, ['DR', 'DC'], 148),
  p('William Saliba', 'France', 25, ['DC'], 170, { pace: 15, positioning: 17, composure: 17 }),
  p('Gabriel Magalhães', 'Brazil', 28, ['DC'], 168, { heading: 18, strength: 17 }, { attacksCrosses: 17 }, 'Gabriel'),
  p('Jurriën Timber', 'Netherlands', 25, ['DR', 'DC'], 155),
  p('Riccardo Calafiori', 'Italy', 24, ['DL', 'DC'], 150),
  p('Piero Hincapié', 'Ecuador', 24, ['DC', 'DL'], 150),
  p('Myles Lewis-Skelly', 'England', 20, ['DL', 'DM'], 138),
  p('Cristhian Mosquera', 'Spain', 22, ['DC'], 138),
  p('Declan Rice', 'England', 27, ['DM', 'MC'], 172, { setPieces: 17, workRate: 18, stamina: 18 }),
  p('Martín Zubimendi', 'Spain', 27, ['DM'], 165, { passing: 16, positioning: 16 }),
  p('Martin Ødegaard', 'Norway', 27, ['AMC', 'MC'], 168, { creativity: 18, passing: 18 }, { triesKillerPasses: 17 }),
  p('Mikel Merino', 'Spain', 30, ['MC', 'ST'], 150, { heading: 15 }),
  p('Christian Nørgaard', 'Denmark', 32, ['DM'], 138),
  p('Eberechi Eze', 'England', 28, ['AMC', 'AML'], 158, { flair: 17, dribbling: 16 }, { shootsOnSight: 13 }),
  p('Ethan Nwaneri', 'England', 19, ['AMR', 'AMC'], 140),
  p('Bukayo Saka', 'England', 25, ['AMR'], 176, { dribbling: 17, creativity: 17 }, { dribblesAtDefenders: 16 }),
  p('Viktor Gyökeres', 'Sweden', 28, ['ST'], 165, { strength: 18, shooting: 16 }, { shootsOnSight: 17 }),
  p('Kai Havertz', 'Germany', 27, ['ST', 'AMC'], 152, { heading: 15 }),
  p('Gabriel Martinelli', 'Brazil', 25, ['AML'], 152, { pace: 17 }, {}, 'Martinelli'),
  p('Leandro Trossard', 'Belgium', 31, ['AML', 'ST'], 148),
  p('Noni Madueke', 'England', 24, ['AMR'], 148),
  p('Gabriel Jesus', 'Brazil', 29, ['ST'], 140, {}, {}, 'Jesus'),
]);

export const LIVERPOOL = team('liv', 'Liverpool', 'Liverpool', 19, 'Anfield', { primary: '#c8102e', secondary: '#ffffff' }, [
  p('Alisson Becker', 'Brazil', 33, ['GK'], 165, { tackling: 17, handling: 16 }, {}, 'Alisson'),
  p('Giorgi Mamardashvili', 'Georgia', 25, ['GK'], 145),
  p('Virgil van Dijk', 'Netherlands', 35, ['DC'], 165, { heading: 18, positioning: 18, influence: 18 }, { attacksCrosses: 15 }, 'Van Dijk'),
  p('Ibrahima Konaté', 'France', 27, ['DC'], 158, { strength: 18 }),
  p('Jeremie Frimpong', 'Netherlands', 25, ['DR', 'MR'], 150, { pace: 18 }),
  p('Milos Kerkez', 'Hungary', 22, ['DL'], 148),
  p('Andy Robertson', 'Scotland', 32, ['DL'], 142),
  p('Joe Gomez', 'England', 29, ['DC', 'DR'], 140),
  p('Conor Bradley', 'Northern Ireland', 23, ['DR'], 142),
  p('Giovanni Leoni', 'Italy', 19, ['DC'], 128),
  p('Ryan Gravenberch', 'Netherlands', 24, ['DM', 'MC'], 165),
  p('Alexis Mac Allister', 'Argentina', 27, ['MC'], 162, { passing: 17 }, {}, 'Mac Allister'),
  p('Dominik Szoboszlai', 'Hungary', 25, ['MC', 'AMC'], 162, { setPieces: 17, stamina: 18 }, { shootsOnSight: 14 }),
  p('Florian Wirtz', 'Germany', 23, ['AMC'], 170, { creativity: 19, technique: 18 }, { triesKillerPasses: 17 }),
  p('Curtis Jones', 'England', 25, ['MC'], 145),
  p('Wataru Endo', 'Japan', 33, ['DM'], 135),
  p('Mohamed Salah', 'Egypt', 34, ['AMR'], 170, { shooting: 18, composure: 18 }, { shootsOnSight: 17 }),
  p('Alexander Isak', 'Sweden', 26, ['ST'], 170, { shooting: 17, dribbling: 16 }),
  p('Hugo Ekitiké', 'France', 24, ['ST'], 160),
  p('Cody Gakpo', 'Netherlands', 27, ['AML'], 155, {}, { shootsOnSight: 14 }),
  p('Federico Chiesa', 'Italy', 28, ['AMR', 'AML'], 140),
  p('Rio Ngumoha', 'England', 17, ['AML'], 118),
]);

export const MAN_CITY = team('mci', 'Manchester City', 'Man City', 19, 'Etihad Stadium', { primary: '#6cabdd', secondary: '#1c2c5b' }, [
  p('Gianluigi Donnarumma', 'Italy', 27, ['GK'], 168, { tackling: 18 }, {}, 'Donnarumma'),
  p('James Trafford', 'England', 23, ['GK'], 140),
  p('Rúben Dias', 'Portugal', 29, ['DC'], 165, { influence: 17 }, {}, 'Dias'),
  p('Joško Gvardiol', 'Croatia', 24, ['DC', 'DL'], 165),
  p('John Stones', 'England', 32, ['DC'], 150),
  p('Nathan Aké', 'Netherlands', 31, ['DC', 'DL'], 145),
  p('Abdukodir Khusanov', 'Uzbekistan', 22, ['DC'], 145),
  p('Matheus Nunes', 'Portugal', 28, ['DR', 'MC'], 148),
  p('Rayan Aït-Nouri', 'Algeria', 25, ['DL'], 150),
  p('Rico Lewis', 'England', 21, ['DR', 'MC'], 142),
  p("Nico O'Reilly", 'England', 21, ['DL', 'MC'], 140),
  p('Rodri', 'Spain', 30, ['DM'], 172, { passing: 18, positioning: 18, decisions: 19 }),
  p('Tijjani Reijnders', 'Netherlands', 28, ['MC'], 158),
  p('Bernardo Silva', 'Portugal', 32, ['MC', 'AMR'], 155, { technique: 18 }, {}, 'Bernardo'),
  p('Mateo Kovačić', 'Croatia', 32, ['MC'], 148),
  p('Nico González', 'Spain', 24, ['DM'], 145),
  p('Phil Foden', 'England', 26, ['AMC', 'AMR'], 160, { flair: 17 }),
  p('Rayan Cherki', 'France', 23, ['AMC', 'AMR'], 155, { flair: 19, dribbling: 18 }),
  p('Erling Haaland', 'Norway', 26, ['ST'], 185, { shooting: 19, strength: 19, heading: 17, offTheBall: 19 }, { shootsOnSight: 18, attacksCrosses: 16 }),
  p('Omar Marmoush', 'Egypt', 27, ['ST', 'AML'], 155),
  p('Jérémy Doku', 'Belgium', 24, ['AML'], 155, { dribbling: 19, pace: 19 }, { dribblesAtDefenders: 19 }),
  p('Savinho', 'Brazil', 22, ['AMR'], 150),
  p('Oscar Bobb', 'Norway', 23, ['AMR'], 138),
]);

export const BURNLEY = team('bur', 'Burnley', 'Burnley', 11, 'Turf Moor', { primary: '#6c1d45', secondary: '#99d6ea' }, [
  p('Martin Dúbravka', 'Slovakia', 37, ['GK'], 128, { tackling: 15 }),
  p('Max Weiß', 'Germany', 22, ['GK'], 115),
  p('Kyle Walker', 'England', 36, ['DR'], 130),
  p('Maxime Estève', 'France', 24, ['DC'], 125),
  p('Axel Tuanzebe', 'DR Congo', 28, ['DC'], 115),
  p('Hjalmar Ekdal', 'Sweden', 27, ['DC'], 112),
  p('Quilindschy Hartman', 'Netherlands', 24, ['DL'], 118),
  p('Lucas Pires', 'Brazil', 25, ['DL'], 110),
  p('Joe Worrall', 'England', 29, ['DC'], 108),
  p('Connor Roberts', 'Wales', 30, ['DR'], 110),
  p('Oliver Sonne', 'Denmark', 25, ['DR'], 108),
  p('Josh Cullen', 'Ireland', 30, ['DM'], 120, { workRate: 17 }),
  p('Lesley Ugochukwu', 'France', 22, ['DM'], 122),
  p('Florentino Luís', 'Portugal', 27, ['DM'], 122, { tackling: 16 }, {}, 'Florentino'),
  p('Hannibal Mejbri', 'Tunisia', 23, ['MC'], 118, {}, {}, 'Hannibal'),
  p('Josh Laurent', 'England', 31, ['MC'], 110),
  p('Jaidon Anthony', 'England', 26, ['AML'], 125),
  p('Loum Tchaouna', 'France', 23, ['AMR'], 118),
  p('Marcus Edwards', 'England', 27, ['AMR'], 115),
  p('Zian Flemming', 'Netherlands', 28, ['ST', 'AMC'], 120),
  p('Lyle Foster', 'South Africa', 26, ['ST'], 120),
  p('Armando Broja', 'Albania', 25, ['ST'], 118),
  p('Zeki Amdouni', 'Switzerland', 25, ['ST'], 118),
]);

export const DEMO_TEAMS: Team[] = [ARSENAL, LIVERPOOL, MAN_CITY, BURNLEY];
