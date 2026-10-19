// Phase 1 match demo: pick two clubs and a tactic, then watch the text
// commentary play out, changing tactics and making subs as you go.

import { DEMO_TEAMS } from '../data/squads';
import { autoLineup } from '../engine/lineup';
import { Match } from '../engine/match';
import { FORMATIONS } from '../engine/formations';
import {
  MENTALITY_NAMES,
  type FormationName, type MatchEvent, type Mentality, type Player, type Tactic, type Team,
} from '../engine/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const SPEEDS: Record<string, number> = { slow: 2600, normal: 1300, fast: 450, instant: 0 };

let match: Match | undefined;
let timer: number | undefined;
let paused = false;
let queue: MatchEvent[] = [];
let mySide: 0 | 1 = 0;

function teamById(id: string): Team {
  return DEMO_TEAMS.find(t => t.id === id)!;
}

function readTactic(prefix: string): Tactic {
  return {
    formation: ($<HTMLSelectElement>(`${prefix}-formation`).value) as FormationName,
    mentality: Number($<HTMLSelectElement>(`${prefix}-mentality`).value) as Mentality,
    passing: $<HTMLSelectElement>(`${prefix}-passing`).value as Tactic['passing'],
    pressing: $<HTMLSelectElement>(`${prefix}-pressing`).value as Tactic['pressing'],
    width: $<HTMLSelectElement>(`${prefix}-width`).value as Tactic['width'],
    counterAttack: $<HTMLInputElement>(`${prefix}-counter`).checked,
    offsideTrap: $<HTMLInputElement>(`${prefix}-offside`).checked,
  };
}

function tacticControls(prefix: string, t: Tactic): string {
  const opt = (v: string, label: string, sel: string) => `<option value="${v}"${v === sel ? ' selected' : ''}>${label}</option>`;
  return `
    <label>Formation<select id="${prefix}-formation">${Object.keys(FORMATIONS).map(f => opt(f, f, t.formation)).join('')}</select></label>
    <label>Mentality<select id="${prefix}-mentality">${([-2, -1, 0, 1, 2] as Mentality[]).map(m => opt(String(m), MENTALITY_NAMES[m], String(t.mentality))).join('')}</select></label>
    <label>Passing<select id="${prefix}-passing">${opt('short', 'Short', t.passing)}${opt('mixed', 'Mixed', t.passing)}${opt('direct', 'Direct', t.passing)}</select></label>
    <label>Pressing<select id="${prefix}-pressing">${opt('low', 'Low', t.pressing)}${opt('mid', 'Mid', t.pressing)}${opt('high', 'High', t.pressing)}</select></label>
    <label>Width<select id="${prefix}-width">${opt('narrow', 'Narrow', t.width)}${opt('normal', 'Normal', t.width)}${opt('wide', 'Wide', t.width)}</select></label>
    <label class="check"><input type="checkbox" id="${prefix}-counter"${t.counterAttack ? ' checked' : ''}> Counter attack</label>
    <label class="check"><input type="checkbox" id="${prefix}-offside"${t.offsideTrap ? ' checked' : ''}> Offside trap</label>`;
}

const DEFAULT_TACTIC: Tactic = { formation: '4-3-3', mentality: 0, passing: 'mixed', pressing: 'mid', width: 'normal', counterAttack: false, offsideTrap: false };

// ------------------------------------------------------------------ setup screen

function renderSetup() {
  const opts = (sel: string) => DEMO_TEAMS.map(t => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${t.name}</option>`).join('');
  $('setup-teams').innerHTML = `
    <label>Your club<select id="my-team">${opts('ars')}</select></label>
    <label>Opponent<select id="opp-team">${opts('liv')}</select></label>
    <label>Venue<select id="venue"><option value="home">Home</option><option value="away">Away</option></select></label>
    <label>Commentary speed<select id="speed"><option value="slow">Slow</option><option value="normal" selected>Normal</option><option value="fast">Fast</option><option value="instant">Instant result</option></select></label>`;
  $('setup-tactic').innerHTML = tacticControls('t', DEFAULT_TACTIC);
  const refresh = () => renderSetupSquad();
  $('my-team').addEventListener('change', refresh);
  $('t-formation').addEventListener('change', refresh);
  refresh();
}

function renderSetupSquad() {
  const team = teamById($<HTMLSelectElement>('my-team').value);
  const formation = $<HTMLSelectElement>('t-formation').value as FormationName;
  const lu = autoLineup(team, formation);
  const slots = FORMATIONS[formation];
  $('setup-squad').innerHTML = `
    <table class="squad"><thead><tr><th>Pos</th><th>Player</th><th class="num">Age</th><th>Best at</th></tr></thead><tbody>
    ${lu.starters.map((p, i) => `<tr><td class="pos">${slots[i]}</td><td>${p.name}</td><td class="num">${p.age}</td><td class="muted">${p.positions.join(', ')}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Bench: ${lu.bench.map(p => p.shortName).join(', ')}</p>`;
}

// ------------------------------------------------------------------ match screen

function kickOff() {
  const mine = teamById($<HTMLSelectElement>('my-team').value);
  let opp = teamById($<HTMLSelectElement>('opp-team').value);
  if (opp.id === mine.id) opp = DEMO_TEAMS.find(t => t.id !== mine.id)!;
  const home = $<HTMLSelectElement>('venue').value === 'home';
  mySide = home ? 0 : 1;
  const myTactic = readTactic('t');
  const oppTactic: Tactic = { ...DEFAULT_TACTIC, formation: '4-2-3-1' };
  const mineSide = { team: mine, lineup: autoLineup(mine, myTactic.formation), tactic: myTactic, ai: false };
  const oppSide = { team: opp, lineup: autoLineup(opp, oppTactic.formation), tactic: oppTactic, ai: true };
  const seed = Math.floor(Math.random() * 2 ** 31);
  match = home ? new Match(mineSide, oppSide, { seed }) : new Match(oppSide, mineSide, { seed });
  queue = [];
  paused = false;

  $('setup').hidden = true;
  $('fulltime').hidden = true;
  $('game').hidden = false;
  $('commentary').innerHTML = '';
  $('in-tactic').innerHTML = tacticControls('m', myTactic);
  for (const id of ['m-formation', 'm-mentality', 'm-passing', 'm-pressing', 'm-width', 'm-counter', 'm-offside']) {
    $(id).addEventListener('change', () => match?.setTactic(mySide, readTactic('m')));
  }
  $<HTMLSelectElement>('live-speed').value = $<HTMLSelectElement>('speed').value;
  paintBoard();
  tick();
}

function speed(): number {
  return SPEEDS[$<HTMLSelectElement>('live-speed').value] ?? 1300;
}

function tick() {
  if (!match) return;
  window.clearTimeout(timer);
  if (paused) return;

  if (speed() === 0) {
    // Instant result: play out and show the end.
    while (!match.finished) match.step();
    queue = [];
    paintAll(match.events.slice(-1));
    showFullTime();
    return;
  }

  if (queue.length === 0) {
    if (match.finished) { showFullTime(); return; }
    queue = match.step();
    paintBoard();
    if (queue.length === 0) { timer = window.setTimeout(tick, speed() * 0.35); return; }
  }
  const ev = queue.shift()!;
  addLine(ev);
  paintBoard();
  const pause = ev.importance === 2 ? 2.2 : ev.importance === 1 ? 1.1 : 0.8;
  timer = window.setTimeout(tick, speed() * pause);
}

function addLine(ev: MatchEvent) {
  const box = $('commentary');
  const row = document.createElement('div');
  row.className = `line imp${ev.importance} ${ev.type}`;
  if (ev.side !== undefined && match) {
    row.style.setProperty('--team', match.sides[ev.side].setup.team.colours.primary);
    row.classList.add('sided');
  }
  row.innerHTML = `<span class="min">${ev.clock}'</span><span class="txt"></span>`;
  row.querySelector('.txt')!.textContent = ev.text;
  box.appendChild(row);
  while (box.children.length > 120) box.removeChild(box.firstChild!);
  box.scrollTop = box.scrollHeight;
}

function paintAll(_last: MatchEvent[]) {
  if (!match) return;
  $('commentary').innerHTML = '';
  for (const ev of match.events.filter(e => e.importance > 0)) addLine(ev);
  paintBoard();
}

function bar(label: string, a: number, b: number, fmt = (n: number) => String(n)) {
  const total = a + b || 1;
  return `<div class="stat"><span class="a num">${fmt(a)}</span><span class="label">${label}</span><span class="b num">${fmt(b)}</span>
    <div class="track"><i style="width:${(100 * a) / total}%"></i></div></div>`;
}

function paintBoard() {
  if (!match) return;
  const [h, a] = match.sides;
  const head = $('scoreboard');
  head.style.setProperty('--home', h.setup.team.colours.primary);
  head.style.setProperty('--away', a.setup.team.colours.primary);
  $('home-name').textContent = h.setup.team.name;
  $('away-name').textContent = a.setup.team.name;
  $('score').textContent = `${h.stats.goals} - ${a.stats.goals}`;
  $('clock').textContent = match.finished ? 'FT' : match.atHalfTime ? 'HT' : `${match.displayMinute}'`;
  $('venue-line').textContent = h.setup.team.stadium;

  const poss = h.stats.possessionMinutes + a.stats.possessionMinutes || 1;
  $('stats').innerHTML = [
    bar('Possession', Math.round((100 * h.stats.possessionMinutes) / poss), Math.round((100 * a.stats.possessionMinutes) / poss), n => `${n}%`),
    bar('Shots', h.stats.shots, a.stats.shots),
    bar('On target', h.stats.onTarget, a.stats.onTarget),
    bar('Corners', h.stats.corners, a.stats.corners),
    bar('Fouls', h.stats.fouls, a.stats.fouls),
    bar('Yellow cards', h.stats.yellows, a.stats.yellows),
    bar('Red cards', h.stats.reds, a.stats.reds),
  ].join('');

  const me = match.sides[mySide];
  const left = match.subsLeft(mySide);
  $('subs-left').textContent = `${left.subs} subs left, ${left.windows} windows`;
  $('my-xi').innerHTML = me.pitch.map(o => {
    const st = match!.playerStats.get(o.player.id)!;
    const marks = `${st.goals ? ' <b class="g">' + '&#9917;'.repeat(st.goals) + '</b>' : ''}${o.yellow ? ' <b class="yc"></b>' : ''}`;
    return `<li><span class="pos">${o.slot}</span><span class="nm">${o.player.shortName}${marks}</span>
      <span class="cond" title="Condition ${Math.round(o.condition)}%"><i style="width:${o.condition}%"></i></span>
      <button class="sub" data-id="${o.player.id}" aria-label="Substitute ${o.player.shortName}">Sub</button></li>`;
  }).join('');
  for (const btn of $('my-xi').querySelectorAll<HTMLButtonElement>('button.sub')) {
    btn.disabled = match.finished || left.subs === 0;
    btn.addEventListener('click', () => openSub(btn.dataset.id!));
  }
  $('pause').textContent = paused ? 'Resume' : 'Pause';
}

function openSub(offId: string) {
  if (!match) return;
  paused = true;
  window.clearTimeout(timer);
  const me = match.sides[mySide];
  const off = me.pitch.find(o => o.player.id === offId)!;
  $('sub-title').textContent = `Replace ${off.player.name} (${off.slot})`;
  $('sub-list').innerHTML = me.bench.map((p: Player) =>
    `<li><button data-id="${p.id}"><span>${p.name}</span><span class="muted">${p.positions.join(', ')}</span></button></li>`).join('')
    || '<li class="muted">No substitutes left on the bench.</li>';
  for (const b of $('sub-list').querySelectorAll<HTMLButtonElement>('button')) {
    b.addEventListener('click', () => {
      const err = match!.substitute(mySide, offId, b.dataset.id!);
      $('sub-error').textContent = err ?? '';
      if (!err) {
        $('sub-panel').hidden = true;
        const ev = match!.events[match!.events.length - 1];
        addLine(ev);
        paused = false;
        paintBoard();
        tick();
      }
    });
  }
  $('sub-error').textContent = '';
  $('sub-panel').hidden = false;
  paintBoard();
}

function showFullTime() {
  if (!match) return;
  paintBoard();
  const r = match.result();
  const motm = r.motmPlayer;
  const rows = (side: 0 | 1) => {
    const s = match!.sides[side];
    const players = [...s.setup.lineup.starters, ...s.setup.lineup.bench];
    return r.players.filter(p => p.side === side).sort((x, y) => y.rating - x.rating).map(st => {
      const p = players.find(x => x.id === st.playerId)!;
      const notes = [st.goals ? `${st.goals} goal${st.goals > 1 ? 's' : ''}` : '', st.assists ? `${st.assists} assist${st.assists > 1 ? 's' : ''}` : '',
        st.saves ? `${st.saves} saves` : '', st.red ? 'sent off' : st.yellow ? 'booked' : '', st.injured ? 'injured' : ''].filter(Boolean).join(', ');
      return `<tr${p.id === motm.id ? ' class="motm"' : ''}><td>${p.name}</td><td class="num">${st.minutes}</td><td class="muted">${notes}</td><td class="num rating">${st.rating.toFixed(1)}</td></tr>`;
    }).join('');
  };
  $('ft-score').textContent = `${r.home.name} ${r.homeGoals} - ${r.awayGoals} ${r.away.name}`;
  $('ft-motm').textContent = `Man of the match: ${motm.name}, ${r.manOfTheMatch.rating.toFixed(1)}`;
  $('ft-home-name').textContent = r.home.name;
  $('ft-away-name').textContent = r.away.name;
  $('ft-home').innerHTML = rows(0);
  $('ft-away').innerHTML = rows(1);
  $('fulltime').hidden = false;
}

function boot() {
  renderSetup();
  $('kickoff').addEventListener('click', kickOff);
  $('pause').addEventListener('click', () => { paused = !paused; paintBoard(); if (!paused) tick(); });
  $('live-speed').addEventListener('change', () => { if (!paused) tick(); });
  $('sub-cancel').addEventListener('click', () => { $('sub-panel').hidden = true; paused = false; tick(); });
  $('again').addEventListener('click', () => { window.clearTimeout(timer); $('game').hidden = true; $('fulltime').hidden = true; $('setup').hidden = false; });
  $('rematch').addEventListener('click', () => { window.clearTimeout(timer); $('fulltime').hidden = true; kickOff(); });
}

boot();
