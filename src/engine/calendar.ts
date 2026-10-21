// Dates are kept as ISO strings ("2026-08-22") so a save is plain JSON.
// The 2026/27 calendar: Premier League rounds, cup rounds and the transfer
// windows. The league runs from 22 August 2026 to 30 May 2027 (Premier
// League). Cup dates follow the usual pattern: League Cup midweeks from late
// August with a March final, FA Cup third round in January and a May final.

export type ISODate = string;

const MS_DAY = 86400000;

export function toDate(d: ISODate): Date {
  return new Date(`${d}T12:00:00Z`);
}

export function fromDate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDate(new Date(toDate(d).getTime() + n * MS_DAY));
}

export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toDate(b).getTime() - toDate(a).getTime()) / MS_DAY);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekday(d: ISODate): number {
  return toDate(d).getUTCDay();
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/** The corner tag, as the original wrote it: "Wed 16.7.97". */
export function shortDate(d: ISODate): string {
  const x = toDate(d);
  return `${DAYS[x.getUTCDay()].slice(0, 3)} ${x.getUTCDate()}.${x.getUTCMonth() + 1}.${String(x.getUTCFullYear()).slice(2)}`;
}

/** The main menu's title: "Wednesday 16th July 1997". */
export function longDate(d: ISODate): string {
  const x = toDate(d);
  return `${DAYS[x.getUTCDay()]} ${ordinal(x.getUTCDate())} ${MONTHS[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
}

/** "22 Aug", for fixture lists. */
export function dayMonth(d: ISODate): string {
  const x = toDate(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()].slice(0, 3)}`;
}

export function monthName(d: ISODate): string {
  return MONTHS[toDate(d).getUTCMonth()];
}

// ------------------------------------------------------------------ 2026/27

export const SEASON = {
  name: '2026/27',
  year: 2026,
  start: '2026-07-15',
  end: '2027-06-30',
  /** Summer window closes 1 September; January window runs through to 1 February. */
  windows: [
    { open: '2026-06-15', close: '2026-09-01' },
    { open: '2027-01-01', close: '2027-02-01' },
  ],
};

/** Premier League rounds: 38 dates, Saturdays plus the midweek and holiday rounds. */
export const LEAGUE_DATES: ISODate[] = [
  '2026-08-22', '2026-08-29', '2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03',
  '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07', '2026-11-21', '2026-11-28',
  '2026-12-01', '2026-12-05', '2026-12-12', '2026-12-19', '2026-12-26', '2026-12-29',
  '2027-01-02', '2027-01-06', '2027-01-16', '2027-01-23', '2027-01-30', '2027-02-06',
  '2027-02-10', '2027-02-20', '2027-02-27', '2027-03-13', '2027-04-10', '2027-04-17',
  '2027-04-21', '2027-05-01', '2027-05-08', '2027-05-15', '2027-03-17', '2027-04-28',
  '2027-05-19', '2027-05-30',
].sort();

export interface CupRoundDef {
  name: string;
  /** One date, or two for a two-legged tie. */
  dates: ISODate[];
  /** When the round is drawn. */
  draw: ISODate;
}

export const LEAGUE_CUP_ROUNDS: CupRoundDef[] = [
  { name: 'Second Round', dates: ['2026-08-26'], draw: '2026-08-12' },
  { name: 'Third Round', dates: ['2026-09-23'], draw: '2026-08-27' },
  { name: 'Fourth Round', dates: ['2026-10-28'], draw: '2026-09-24' },
  { name: 'Quarter Final', dates: ['2026-12-16'], draw: '2026-10-29' },
  { name: 'Semi Final', dates: ['2027-01-13', '2027-02-03'], draw: '2026-12-17' },
  { name: 'Final', dates: ['2027-03-21'], draw: '2027-02-04' },
];

export const FA_CUP_ROUNDS: CupRoundDef[] = [
  { name: 'Third Round', dates: ['2027-01-09'], draw: '2026-12-07' },
  { name: 'Fourth Round', dates: ['2027-02-13'], draw: '2027-01-11' },
  { name: 'Fifth Round', dates: ['2027-03-06'], draw: '2027-02-15' },
  { name: 'Quarter Final', dates: ['2027-04-03'], draw: '2027-03-08' },
  { name: 'Semi Final', dates: ['2027-04-24'], draw: '2027-04-05' },
  { name: 'Final', dates: ['2027-05-22'], draw: '2027-04-26' },
];

export function windowOpen(d: ISODate): boolean {
  return SEASON.windows.some(w => d >= w.open && d <= w.close);
}
