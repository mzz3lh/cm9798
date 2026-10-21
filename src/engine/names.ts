// Names for generated players, by nation. The original made up lesser
// players from each nation's naming style; this does the same for clubs
// whose real squads aren't in the database yet.

import type { Rng } from './rng';

const NAMES: Record<string, { first: string[]; last: string[] }> = {
  England: {
    first: ['Jack', 'Harry', 'George', 'Charlie', 'Jacob', 'Alfie', 'Oscar', 'James', 'William', 'Joshua', 'Thomas', 'Ethan', 'Callum', 'Lewis', 'Ryan', 'Dan', 'Sam', 'Ben', 'Joe', 'Liam', 'Kieran', 'Jordan', 'Josh', 'Tom', 'Matt', 'Luke', 'Adam', 'Connor', 'Jamie', 'Kyle', 'Reece', 'Tyler', 'Nathan', 'Elliot', 'Max', 'Owen', 'Archie', 'Freddie', 'Ollie', 'Billy', 'Danny', 'Marcus', 'Jayden', 'Kai', 'Rhys', 'Aaron', 'Mason', 'Harvey', 'Louie', 'Theo'],
    last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Williams', 'Wilson', 'Johnson', 'Davies', 'Robinson', 'Wright', 'Thompson', 'Evans', 'Walker', 'White', 'Roberts', 'Green', 'Hall', 'Wood', 'Jackson', 'Clarke', 'Hughes', 'Edwards', 'Turner', 'Hill', 'Moore', 'Cooper', 'Ward', 'Morris', 'King', 'Watson', 'Harrison', 'Morgan', 'Baker', 'Allen', 'Young', 'Mitchell', 'Bennett', 'Shaw', 'Lloyd', 'Barker', 'Foster', 'Pearce', 'Holmes', 'Cole', 'Dixon', 'Hunt', 'Palmer', 'Marshall', 'Grant', 'Fletcher', 'Lowe', 'Chapman', 'Kelly', 'Mason', 'Webb', 'Butler', 'Barnes', 'Fisher', 'Sharp', 'Rowe', 'Bowen', 'Dawson', 'Sutton', 'Payne', 'Burgess', 'Stone', 'Doyle', 'Booth', 'Gregory', 'Hartley', 'Nolan', 'Whitehead', 'Ashworth', 'Pickering', 'Rhodes', 'Brennan', 'Dunne', 'Garner', 'Tierney', 'Hogan'],
  },
  Ireland: {
    first: ['Sean', 'Conor', 'Cian', 'Darragh', 'Eoin', 'Ciaran', 'Niall', 'Shane', 'Aidan', 'Killian'],
    last: ['Murphy', 'Kelly', "O'Sullivan", 'Walsh', "O'Brien", 'Byrne', 'Ryan', "O'Connor", 'Doherty', 'McCarthy', 'Gallagher', 'Kavanagh'],
  },
  Scotland: {
    first: ['Callum', 'Ross', 'Scott', 'Fraser', 'Lewis', 'Craig', 'Euan', 'Kyle', 'Jamie', 'Ryan'],
    last: ['Campbell', 'Stewart', 'MacDonald', 'Robertson', 'Reid', 'Murray', 'Paterson', 'Fraser', 'McLean', 'Henderson', 'Ferguson', 'McKenna'],
  },
  Wales: {
    first: ['Rhys', 'Dylan', 'Gethin', 'Owain', 'Tomos', 'Ieuan', 'Rhodri', 'Gareth', 'Aled', 'Joe'],
    last: ['Jones', 'Williams', 'Davies', 'Evans', 'Thomas', 'Roberts', 'Lewis', 'Morgan', 'Griffiths', 'Price', 'Pritchard', 'Vaughan'],
  },
  France: {
    first: ['Lucas', 'Hugo', 'Théo', 'Mathis', 'Enzo', 'Kylian', 'Yanis', 'Bilal', 'Moussa', 'Axel'],
    last: ['Martin', 'Bernard', 'Dubois', 'Lefebvre', 'Diallo', 'Camara', 'Traoré', 'Fofana', 'Mendy', 'Girard', 'Bonnet', 'Rousseau'],
  },
  Nigeria: {
    first: ['Chinedu', 'Emeka', 'Tunde', 'Femi', 'Kelechi', 'Samuel', 'Victor', 'David', 'Chidi', 'Tobi'],
    last: ['Okafor', 'Adeyemi', 'Okonkwo', 'Balogun', 'Eze', 'Nwosu', 'Adebayo', 'Ogunleye', 'Obi', 'Akinola'],
  },
  Netherlands: {
    first: ['Daan', 'Sem', 'Bram', 'Thijs', 'Jesse', 'Lars', 'Ruben', 'Milan', 'Stijn', 'Joey'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van Dijk', 'Bakker', 'Visser', 'Smit', 'Meijer', 'Mulder', 'Bos'],
  },
  Jamaica: {
    first: ['Andre', 'Damion', 'Kemar', 'Shamar', 'Romario', 'Javain', 'Dexter', 'Renaldo'],
    last: ['Campbell', 'Brown', 'Reid', 'Bailey', 'Lawrence', 'Francis', 'Grant', 'Powell'],
  },
};

/** Most players in English lower leagues are home-grown; the rest come from these. */
const MIX: [string, number][] = [
  ['England', 62], ['Ireland', 8], ['Scotland', 7], ['Wales', 6], ['France', 5], ['Nigeria', 5], ['Netherlands', 4], ['Jamaica', 3],
];

export function randomNation(rng: Rng): string {
  let r = rng.next() * MIX.reduce((a, [, w]) => a + w, 0);
  for (const [n, w] of MIX) { r -= w; if (r < 0) return n; }
  return 'England';
}

export function randomName(rng: Rng, nation: string): string {
  const n = NAMES[nation] ?? NAMES.England;
  return `${rng.pick(n.first)} ${rng.pick(n.last)}`;
}
