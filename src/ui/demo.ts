// Phase 1 match demo. Pick two clubs, set the team on the tactics screen
// (positions, runs, instructions), then watch the commentary. Pausing, and
// the automatic half-time stop, bring back the same tactics screen so several
// changes can be made in one go, as in the original.

import { DEMO_TEAMS } from '../data/squads';
import { autoLineup } from '../engine/lineup';
import { Match } from '../engine/match';
import { FORMATIONS } from '../engine/formations';
import {
  MENTALITY_NAMES, POSITIONS, RUN_NAMES,
  type FormationName, type MatchEvent, type Mentality, type Player, type Position, type Run,
  type Tactic, type Team,
} from '../engine/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const SPEEDS: Record<string, number> = { slow: 2600, normal: 1300, fast: 450, instant: 0 };
const DEFAULT_TACTIC: Tactic = { formation: '4-3-3', mentality: 0, passing: 'mixed', pressing: 'mid', width: 'normal', counterAttack: false, offsideTrap: false };

/** One row of the team sheet: who plays where, and what runs he makes. */
interface SheetRow {
  player: Player;
  slot: Position;
  run: Run;
  /** In a match: the bench player chosen to replace him, if any. */
  replaceWith?: string;
}

/** The team sheet being edited, before it is applied. */
interface Plan {
  team: Team;
  tactic: Tactic;
  rows: SheetRow[];
  bench: Player[];
}

let match: Match | undefined;
let timer: number | undefined;
let paused = false;
let queue: MatchEvent[] = [];
let mySide: 0 | 1 = 0;
let plan: Plan;
let mode: 'setup' | 'match' = 'setup';

const teamById = (id: string) => DEMO_TEAMS.find(t => t.id === id)!;

// ------------------------------------------------------------------ the team sheet

function planFromSetup(team: Team, tactic: Tactic): Plan {
  const lu = autoLineup(team, tactic.formation);
  const slots = FORMATIONS[tactic.formation];
  return {
    team,
    tactic: { ...tactic },
    rows: lu.starters.map((player, i) => ({ player, slot: slots[i], run: 'normal' })),
    bench: team.squad.filter(p => !lu.starters.includes(p)),
  };
}

function planFromMatch(): Plan {
  const s = match!.sides[mySide];
  return {
    team: s.setup.team,
    tactic: { ...s.setup.tactic },
    rows: s.pitch.map(o => ({ player: o.player, slot: o.slot, run: o.run })),
    bench: [...s.bench],
  };
}

function opt(value: string, label: string, selected: string) {
  return `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
}

function renderInstructions() {
  const t = plan.tactic;
  $('instructions').innerHTML = `
    <label>Formation<select id="i-formation">${Object.keys(FORMATIONS).map(f => opt(f, f, t.formation)).join('')}</select></label>
    <label>Mentality<select id="i-mentality">${([-2, -1, 0, 1, 2] as Mentality[]).map(m => opt(String(m), MENTALITY_NAMES[m], String(t.mentality))).join('')}</select></label>
    <label>Passing<select id="i-passing">${opt('short', 'Short', t.passing)}${opt('mixed', 'Mixed', t.passing)}${opt('direct', 'Direct', t.passing)}</select></label>
    <label>Pressing<select id="i-pressing">${opt('low', 'Low', t.pressing)}${opt('mid', 'Mid', t.pressing)}${opt('high', 'High', t.pressing)}</select></label>
    <label>Width<select id="i-width">${opt('narrow', 'Narrow', t.width)}${opt('normal', 'Normal', t.width)}${opt('wide', 'Wide', t.width)}</select></label>
    <label class="check"><input type="checkbox" id="i-counter"${t.counterAttack ? ' checked' : ''}> Counter attack</label>
    <label class="check"><input type="checkbox" id="i-offside"${t.offsideTrap ? ' checked' : ''}> Offside trap</label>`;
  $('i-formation').addEventListener('change', e => {
    // A formation preset puts everyone back into its standard positions.
    const f = (e.target as HTMLSelectElement).value as FormationName;
    plan.tactic.formation = f;
    FORMATIONS[f].forEach((slot, i) => { if (plan.rows[i]) plan.rows[i].slot = slot; });
    if (mode === 'setup') plan = planFromSetup(plan.team, plan.tactic);
    renderSheet();
  });
  const bind = (id: string, apply: (el: HTMLInputElement & HTMLSelectElement) => void) =>
    $(id).addEventListener('change', e => apply(e.target as HTMLInputElement & HTMLSelectElement));
  bind('i-mentality', el => { plan.tactic.mentality = Number(el.value) as Mentality; });
  bind('i-passing', el => { plan.tactic.passing = el.value as Tactic['passing']; });
  bind('i-pressing', el => { plan.tactic.pressing = el.value as Tactic['pressing']; });
  bind('i-width', el => { plan.tactic.width = el.value as Tactic['width']; });
  bind('i-counter', el => { plan.tactic.counterAttack = el.checked; });
  bind('i-offside', el => { plan.tactic.offsideTrap = el.checked; });
}

/** Pitch rows from the attack down, and the columns each position sits in. */
const PITCH_ROWS: Position[][] = [['ST'], ['AML', 'AMC', 'AMR'], ['ML', 'MC', 'MR'], ['DM'], ['DL', 'DC', 'DR'], ['GK']];
const COLUMN: Record<Position, number> = {
  GK: 2, DL: 0, DC: 2, DR: 4, DM: 2, ML: 0, MC: 2, MR: 4, AML: 0, AMC: 2, AMR: 4, ST: 2,
};

function renderPitch() {
  const rowsHtml = PITCH_ROWS.map(rowSlots => {
    const here = plan.rows.filter(r => rowSlots.includes(r.slot) && !r.replaceWith);
    const subsIn = plan.rows.filter(r => rowSlots.includes(r.slot) && r.replaceWith);
    const all = [...here.map(r => ({ name: r.player.shortName, slot: r.slot, run: r.run, sub: false })),
      ...subsIn.map(r => ({ name: plan.bench.find(b => b.id === r.replaceWith)?.shortName ?? '', slot: r.slot, run: r.run, sub: true }))];
    // Spread players sharing a column so they don't sit on top of each other.
    const byCol = new Map<number, typeof all>();
    for (const p of all) {
      const c = COLUMN[p.slot];
      byCol.set(c, [...(byCol.get(c) ?? []), p]);
    }
    const dots: string[] = [];
    for (const [col, ps] of byCol) {
      ps.forEach((p, i) => {
        const offset = (i - (ps.length - 1) / 2) * 1.6;
        const x = ((col + offset + 0.5) / 5) * 100;
        const arrow = p.run === 'forward' ? '<span class="arrow up" aria-label="gets forward">&#9650;</span>'
          : p.run === 'hold' ? '<span class="arrow down" aria-label="holds position">&#9632;</span>' : '';
        dots.push(`<div class="dot${p.sub ? ' incoming' : ''}" style="left:${Math.max(8, Math.min(92, x))}%">${arrow}<i></i><span>${esc(p.name)}</span></div>`);
      });
    }
    return `<div class="prow">${dots.join('')}</div>`;
  }).join('');
  $('pitch').innerHTML = rowsHtml;
}

function renderTable() {
  const inMatch = mode === 'match' && match;
  const head = `<tr><th>Pos</th><th>Player</th><th>Runs</th>${inMatch ? '<th class="num">Cond</th><th class="num">Rtg</th><th>Replace with</th>' : '<th>Swap with</th>'}</tr>`;
  const taken = new Set(plan.rows.map(r => r.replaceWith).filter(Boolean));
  const body = plan.rows.map((r, i) => {
    const posSel = `<select data-i="${i}" class="pos-sel" aria-label="Position for ${esc(r.player.name)}">${POSITIONS.map(p => opt(p, p, r.slot)).join('')}</select>`;
    const runSel = r.slot === 'GK' ? '<span class="muted">-</span>'
      : `<select data-i="${i}" class="run-sel" aria-label="Runs for ${esc(r.player.name)}">${(['hold', 'normal', 'forward'] as Run[]).map(x => opt(x, RUN_NAMES[x], r.run)).join('')}</select>`;
    const misplaced = !r.player.positions.includes(r.slot);
    const nameCell = `<td class="${misplaced ? 'warn' : ''}" title="${misplaced ? 'Not his usual position: ' + r.player.positions.join(', ') : r.player.positions.join(', ')}">${esc(r.player.name)}<span class="muted small"> ${r.player.positions.join('/')}</span></td>`;
    if (inMatch) {
      const o = match!.sides[mySide].pitch.find(x => x.player.id === r.player.id);
      const st = match!.playerStats.get(r.player.id)!;
      const benchOpts = plan.bench.filter(b => b.id === r.replaceWith || !taken.has(b.id))
        .map(b => opt(b.id, `${b.shortName} (${b.positions.join('/')})`, r.replaceWith ?? '')).join('');
      return `<tr${r.replaceWith ? ' class="subbing"' : ''}><td>${posSel}</td>${nameCell}<td>${runSel}</td>
        <td class="num">${Math.round(o?.condition ?? 100)}%</td><td class="num">${Math.max(1, Math.min(10, st.rating)).toFixed(1)}</td>
        <td><select data-i="${i}" class="rep-sel" aria-label="Replace ${esc(r.player.name)}"><option value="">-</option>${benchOpts}</select></td></tr>`;
    }
    const swapOpts = plan.bench.map(b => opt(b.id, `${b.shortName} (${b.positions.join('/')})`, '')).join('');
    return `<tr><td>${posSel}</td>${nameCell}<td>${runSel}</td>
      <td><select data-i="${i}" class="swap-sel" aria-label="Swap ${esc(r.player.name)}"><option value="">-</option>${swapOpts}</select></td></tr>`;
  }).join('');
  $('sheet').innerHTML = `<table class="squad"><thead>${head}</thead><tbody>${body}</tbody></table>`;

  for (const el of $('sheet').querySelectorAll<HTMLSelectElement>('.pos-sel')) {
    el.addEventListener('change', () => { plan.rows[Number(el.dataset.i)].slot = el.value as Position; renderSheet(); });
  }
  for (const el of $('sheet').querySelectorAll<HTMLSelectElement>('.run-sel')) {
    el.addEventListener('change', () => { plan.rows[Number(el.dataset.i)].run = el.value as Run; renderPitch(); });
  }
  for (const el of $('sheet').querySelectorAll<HTMLSelectElement>('.rep-sel')) {
    el.addEventListener('change', () => { plan.rows[Number(el.dataset.i)].replaceWith = el.value || undefined; renderSheet(); });
  }
  for (const el of $('sheet').querySelectorAll<HTMLSelectElement>('.swap-sel')) {
    el.addEventListener('change', () => {
      const row = plan.rows[Number(el.dataset.i)];
      const incoming = plan.bench.find(b => b.id === el.value);
      if (!incoming) return;
      plan.bench = [...plan.bench.filter(b => b !== incoming), row.player];
      row.player = incoming;
      row.run = 'normal';
      renderSheet();
    });
  }

  const keepers = plan.rows.filter(r => r.slot === 'GK').length;
  const subsChosen = plan.rows.filter(r => r.replaceWith).length;
  const notes: string[] = [];
  if (keepers !== 1) notes.push(`You have ${keepers} players in goal. Put exactly one player at GK.`);
  if (inMatch) {
    const left = match!.subsLeft(mySide);
    const needWindow = !match!.atHalfTime && subsChosen > 0;
    notes.push(`${left.subs} substitutes and ${left.windows} windows left${match!.atHalfTime ? ' (half-time changes don\'t use a window)' : ''}.`);
    if (subsChosen > left.subs) notes.push(`You have picked ${subsChosen} substitutions but only ${left.subs} are left.`);
    if (needWindow && left.windows === 0) notes.push('All three substitution windows have been used.');
  }
  $('sheet-notes').innerHTML = notes.map(n => `<p>${esc(n)}</p>`).join('');
}

function renderSheet() {
  renderPitch();
  renderTable();
}

function sheetProblems(): string | undefined {
  const keepers = plan.rows.filter(r => r.slot === 'GK').length;
  if (keepers !== 1) return 'Put exactly one player in goal.';
  if (mode === 'match' && match) {
    const left = match.subsLeft(mySide);
    const subs = plan.rows.filter(r => r.replaceWith).length;
    if (subs > left.subs) return `Only ${left.subs} substitutes are left.`;
    if (subs > 0 && !match.atHalfTime && left.windows === 0) return 'All three substitution windows have been used.';
  }
  return undefined;
}

// ------------------------------------------------------------------ setup

function renderSetup() {
  mode = 'setup';
  const opts = (sel: string) => DEMO_TEAMS.map(t => opt(t.id, t.name, sel)).join('');
  $('setup-teams').innerHTML = `
    <label>Your club<select id="my-team">${opts('ars')}</select></label>
    <label>Opponent<select id="opp-team">${opts('liv')}</select></label>
    <label>Venue<select id="venue"><option value="home">Home</option><option value="away">Away</option></select></label>
    <label>Commentary speed<select id="speed"><option value="slow">Slow</option><option value="normal" selected>Normal</option><option value="fast">Fast</option><option value="instant">Instant result</option></select></label>`;
  $('my-team').addEventListener('change', () => {
    plan = planFromSetup(teamById($<HTMLSelectElement>('my-team').value), plan.tactic);
    renderInstructions();
    renderSheet();
  });
  plan = planFromSetup(teamById('ars'), DEFAULT_TACTIC);
  showManage('Team selection', 'Set your positions, runs and instructions, then kick off.');
}

/** Shows the tactics screen, used before kick-off, when paused and at half time. */
function showManage(title: string, subtitle: string) {
  $('manage-title').textContent = title;
  $('manage-sub').textContent = subtitle;
  $('manage-error').textContent = '';
  renderInstructions();
  renderSheet();
  $('setup-teams').hidden = mode !== 'setup';
  $('kickoff').hidden = mode !== 'setup';
  $('resume').hidden = mode !== 'match';
  $('manage-speed-wrap').hidden = mode !== 'match';
  if (mode === 'match') $<HTMLSelectElement>('manage-speed').value = $<HTMLSelectElement>('live-speed').value;
  $('analysis').hidden = mode !== 'match';
  if (mode === 'match') renderAnalysis();
  $('manage').hidden = false;
}

// ------------------------------------------------------------------ match

function kickOff() {
  const err = sheetProblems();
  if (err) { $('manage-error').textContent = err; return; }
  let opp = teamById($<HTMLSelectElement>('opp-team').value);
  if (opp.id === plan.team.id) opp = DEMO_TEAMS.find(t => t.id !== plan.team.id)!;
  const home = $<HTMLSelectElement>('venue').value === 'home';
  mySide = home ? 0 : 1;
  const runs: Record<string, Run> = {};
  for (const r of plan.rows) runs[r.player.id] = r.run;
  const benchSorted = [...plan.bench].sort((a, b) => b.ability - a.ability);
  const keeper = benchSorted.find(p => p.positions[0] === 'GK');
  const bench = [...(keeper ? [keeper] : []), ...benchSorted.filter(p => p !== keeper)].slice(0, 9);
  const mine = {
    team: plan.team,
    lineup: { starters: plan.rows.map(r => r.player), bench, slots: plan.rows.map(r => r.slot), runs },
    tactic: { ...plan.tactic }, ai: false,
  };
  const oppTactic: Tactic = { ...DEFAULT_TACTIC, formation: '4-2-3-1' };
  const theirs = { team: opp, lineup: autoLineup(opp, oppTactic.formation), tactic: oppTactic, ai: true };
  const seed = Math.floor(Math.random() * 2 ** 31);
  match = home ? new Match(mine, theirs, { seed }) : new Match(theirs, mine, { seed });
  queue = [];
  paused = false;
  mode = 'match';

  $('manage').hidden = true;
  $('fulltime').hidden = true;
  $('game').hidden = false;
  $('match-grid').hidden = false;
  $('commentary').innerHTML = '';
  $<HTMLSelectElement>('live-speed').value = $<HTMLSelectElement>('speed').value;
  paintBoard();
  tick();
}

function pause(title: string, subtitle: string) {
  paused = true;
  window.clearTimeout(timer);
  plan = planFromMatch();
  paintBoard();
  $('match-grid').hidden = true;
  showManage(title, subtitle);
}

function resume() {
  if (!match) return;
  const err = sheetProblems();
  if (err) { $('manage-error').textContent = err; return; }
  // Apply everything picked on the team sheet in one go.
  const old = match.sides[mySide].setup.tactic;
  for (const r of plan.rows) {
    if (r.replaceWith) {
      const e = match.substitute(mySide, r.player.id, r.replaceWith);
      if (e) { $('manage-error').textContent = e; return; }
    }
  }
  const t = plan.tactic;
  if (JSON.stringify(t) !== JSON.stringify(old)) match.setTactic(mySide, { ...t });
  for (const r of plan.rows) {
    const id = r.replaceWith ?? r.player.id;
    match.setPosition(mySide, id, r.slot);
    match.setRun(mySide, id, r.run);
  }
  for (const ev of match.events.slice(-12)) {
    if (!shown.has(ev)) addLine(ev);
  }
  $('manage').hidden = true;
  $('match-grid').hidden = false;
  paused = false;
  paintBoard();
  tick();
}

const shown = new WeakSet<MatchEvent>();

function speed(): number {
  return SPEEDS[$<HTMLSelectElement>('live-speed').value] ?? 1300;
}

function tick() {
  if (!match) return;
  window.clearTimeout(timer);
  if (paused) return;

  if (speed() === 0) {
    // Instant result: play to the next stop (half time or the end).
    const startHalf = match.half;
    while (!match.finished && !(match.atHalfTime && startHalf === 1)) match.step();
    queue = [];
    for (const ev of match.events) if (!shown.has(ev) && ev.importance > 0) addLine(ev);
    for (const ev of match.events) shown.add(ev);
    paintBoard();
    if (match.finished) showFullTime();
    else pause('Half time', halfTimeLine());
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
  if (ev.type === 'halftime') {
    for (const e of queue) addLine(e);
    queue = [];
    pause('Half time', halfTimeLine());
    return;
  }
  const wait = ev.importance === 2 ? 2.2 : ev.importance === 1 ? 1.1 : 0.8;
  timer = window.setTimeout(tick, speed() * wait);
}

function addLine(ev: MatchEvent) {
  if (shown.has(ev)) return;
  shown.add(ev);
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
  while (box.children.length > 150) box.removeChild(box.firstChild!);
  box.scrollTop = box.scrollHeight;
}

function bar(label: string, a: number, b: number, fmt = (n: number) => String(n)) {
  const total = a + b || 1;
  return `<div class="stat"><span class="a num">${fmt(a)}</span><span class="label">${label}</span><span class="b num">${fmt(b)}</span>
    <div class="track"><i style="width:${(100 * a) / total}%"></i></div></div>`;
}

function statsHtml(): string {
  const [h, a] = match!.sides;
  const poss = h.stats.possessionMinutes + a.stats.possessionMinutes || 1;
  return [
    bar('Possession', Math.round((100 * h.stats.possessionMinutes) / poss), Math.round((100 * a.stats.possessionMinutes) / poss), n => `${n}%`),
    bar('Shots', h.stats.shots, a.stats.shots),
    bar('On target', h.stats.onTarget, a.stats.onTarget),
    bar('Corners', h.stats.corners, a.stats.corners),
    bar('Fouls', h.stats.fouls, a.stats.fouls),
    bar('Yellow cards', h.stats.yellows, a.stats.yellows),
    bar('Red cards', h.stats.reds, a.stats.reds),
  ].join('');
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
  $('stats').innerHTML = statsHtml();

  const me = match.sides[mySide];
  $('my-xi').innerHTML = me.pitch.map(o => {
    const st = match!.playerStats.get(o.player.id)!;
    const marks = `${st.goals ? ' <b class="g">' + '&#9917;'.repeat(st.goals) + '</b>' : ''}${o.yellow ? ' <b class="yc"></b>' : ''}`;
    const run = o.run === 'forward' ? ' <span class="arrow up">&#9650;</span>' : o.run === 'hold' ? ' <span class="arrow down">&#9632;</span>' : '';
    return `<li><span class="pos">${o.slot}</span><span class="nm">${esc(o.player.shortName)}${run}${marks}</span>
      <span class="cond" title="Condition ${Math.round(o.condition)}%"><i style="width:${o.condition}%"></i></span>
      <span class="num small">${Math.max(1, Math.min(10, st.rating)).toFixed(1)}</span></li>`;
  }).join('');
  const left = match.subsLeft(mySide);
  $('subs-left').textContent = `${left.subs} subs, ${left.windows} windows left`;
  $<HTMLButtonElement>('pause').disabled = match.finished || paused;
}

// ------------------------------------------------------------------ analysis

/** The assistant manager's read of the game so far. */
function assistantNotes(): string[] {
  const m = match!;
  const me = m.sides[mySide], them = m.sides[1 - mySide];
  const notes: string[] = [];
  const poss = me.stats.possessionMinutes / Math.max(1, me.stats.possessionMinutes + them.stats.possessionMinutes);
  const diff = me.stats.goals - them.stats.goals;
  if (poss < 0.42) notes.push(`We're being outplayed in midfield: ${Math.round(poss * 100)}% possession. Another body in the middle or a higher press would help.`);
  else if (poss > 0.6 && me.stats.shots < them.stats.shots + 3) notes.push(`We have ${Math.round(poss * 100)}% of the ball but aren't hurting them. Try getting a midfielder forward or going wider.`);
  if (them.setup.tactic.mentality <= -1) notes.push(`They're sitting deep (${MENTALITY_NAMES[them.setup.tactic.mentality].toLowerCase()}). Expect blocked shots; patience and crosses can unlock them.`);
  if (them.stats.shots >= me.stats.shots + 4) notes.push(`They've had ${them.stats.shots} shots to our ${me.stats.shots}. Consider holding a midfielder or dropping deeper.`);
  const tired = me.pitch.filter(o => o.slot !== 'GK' && o.condition < 70).map(o => o.player.shortName);
  if (tired.length) notes.push(`Tiring: ${tired.join(', ')}.`);
  const booked = me.pitch.filter(o => o.yellow > 0).map(o => o.player.shortName);
  if (booked.length) notes.push(`On a yellow: ${booked.join(', ')}.`);
  const poor = me.pitch.filter(o => (m.playerStats.get(o.player.id)?.rating ?? 6.4) < 5.9).map(o => o.player.shortName);
  if (poor.length) notes.push(`Struggling: ${poor.join(', ')}.`);
  if (!notes.length) notes.push(diff >= 0 ? 'Going well. Keep it as it is.' : 'Nothing major to change; we just need to take our chances.');
  return notes;
}

function halfTimeLine(): string {
  const [h, a] = match!.sides;
  return `${h.setup.team.shortName} ${h.stats.goals}, ${a.setup.team.shortName} ${a.stats.goals}. Make any changes, then start the second half.`;
}

function renderAnalysis() {
  const m = match!;
  const ratings = (side: 0 | 1) => m.sides[side].pitch
    .map(o => ({ o, st: m.playerStats.get(o.player.id)! }))
    .sort((x, y) => y.st.rating - x.st.rating)
    .map(({ o, st }) => `<tr><td class="pos">${o.slot}</td><td>${esc(o.player.shortName)}</td><td class="num">${st.goals || ''}</td><td class="num">${Math.max(1, Math.min(10, st.rating)).toFixed(1)}</td></tr>`).join('');
  $('analysis').innerHTML = `
    <div class="panel"><h2>Assistant manager</h2><ul class="notes">${assistantNotes().map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>
    <div class="panel"><h2>Match stats</h2>${statsHtml()}</div>
    <div class="panel"><h2>Ratings so far</h2><div class="two">
      <div><h3>${esc(m.sides[0].setup.team.shortName)}</h3><table><tbody>${ratings(0)}</tbody></table></div>
      <div><h3>${esc(m.sides[1].setup.team.shortName)}</h3><table><tbody>${ratings(1)}</tbody></table></div>
    </div></div>`;
}

// ------------------------------------------------------------------ full time

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
        st.saves ? `${st.saves} save${st.saves > 1 ? 's' : ''}` : '', st.red ? 'sent off' : st.yellow ? 'booked' : '', st.injured ? 'injured' : ''].filter(Boolean).join(', ');
      return `<tr${p.id === motm.id ? ' class="motm"' : ''}><td>${esc(p.name)}</td><td class="num">${st.minutes}</td><td class="muted">${notes}</td><td class="num rating">${st.rating.toFixed(1)}</td></tr>`;
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
  $('resume').addEventListener('click', resume);
  $('manage-speed').addEventListener('change', () => {
    $<HTMLSelectElement>('live-speed').value = $<HTMLSelectElement>('manage-speed').value;
  });
  $('pause').addEventListener('click', () => pause('Paused', 'Look at the stats and make as many changes as you like, then resume.'));
  $('live-speed').addEventListener('change', () => { if (!paused) tick(); });
  $('again').addEventListener('click', () => {
    window.clearTimeout(timer);
    $('game').hidden = true;
    $('fulltime').hidden = true;
    renderSetup();
  });
  $('rematch').addEventListener('click', () => {
    window.clearTimeout(timer);
    $('fulltime').hidden = true;
    // Back to team selection with the same club and instructions.
    mode = 'setup';
    plan = planFromSetup(plan.team, plan.tactic);
    showManage('Team selection', 'Set your positions, runs and instructions, then kick off.');
    $('game').hidden = true;
  });
  document.addEventListener('keydown', e => {
    if (e.key === ' ' && mode === 'match' && !paused && match && !match.finished
      && !(e.target instanceof HTMLSelectElement || e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      pause('Paused', 'Look at the stats and make as many changes as you like, then resume.');
    }
  });
}

boot();
