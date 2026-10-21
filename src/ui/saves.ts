// Autosave with rewind by date. The game is saved, gzipped, into the
// browser's IndexedDB at each stop; the last 30 days are kept, plus one save a
// week before that, so a manager can go back to any of them. A save can also
// be downloaded as a file and loaded again, to move a career between machines.

import type { GameState } from '../engine/world';
import { daysBetween, weekday } from '../engine/calendar';

const DB = 'cm9798';
const STORE = 'saves';
const KEEP_DAYS = 30;

export interface SaveInfo {
  date: string;
  club: string;
  savedAt: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'date' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function request<T>(store: 'readonly' | 'readwrite', fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, store).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

async function pack(json: string): Promise<Blob> {
  const blob = new Blob([json], { type: 'application/json' });
  if (typeof CompressionStream === 'undefined') return blob;
  return new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

async function unpack(blob: Blob): Promise<string> {
  const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) {
    return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
  }
  return blob.text();
}

/** Saves the game under today's date, replacing an earlier save from the same day, and thins out old saves. */
export async function autosave(g: GameState): Promise<void> {
  const data = await pack(JSON.stringify(g));
  await request('readwrite', s => s.put({ date: g.date, club: g.teams[g.humanClubId].name, savedAt: Date.now(), data }));
  const all = await listSaves();
  for (const old of all) {
    // Older than 30 days: keep only Mondays.
    if (daysBetween(old.date, g.date) > KEEP_DAYS && weekday(old.date) !== 1) await request('readwrite', s => s.delete(old.date));
    // A save from after today belongs to a future that has been rewound away.
    else if (old.date > g.date) await request('readwrite', s => s.delete(old.date));
  }
}

/** Saves, newest first. */
export async function listSaves(): Promise<SaveInfo[]> {
  const rows = await request<{ date: string; club: string; savedAt: number }[]>('readonly', s => s.getAll());
  return rows.map(r => ({ date: r.date, club: r.club, savedAt: r.savedAt })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function loadSave(date: string): Promise<GameState> {
  const row = await request<{ data: Blob }>('readonly', s => s.get(date));
  return JSON.parse(await unpack(row.data));
}

/** Starting a new career clears the old one's saves. */
export async function clearSaves(): Promise<void> {
  await request('readwrite', s => s.clear());
}

/** Downloads the game as a gzipped file. */
export async function exportSave(g: GameState) {
  const blob = await pack(JSON.stringify(g));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cm9798-${g.teams[g.humanClubId].shortName.replace(/\W+/g, '')}-${g.date}.cm`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Asks for a save file and reads it. */
export function importSave(): Promise<GameState | undefined> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.cm,.json,.gz';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(undefined);
      try {
        const g = JSON.parse(await unpack(file)) as GameState;
        resolve(g.version === 1 && g.teams && g.humanClubId ? g : undefined);
      } catch { resolve(undefined); }
    };
    input.click();
  });
}
