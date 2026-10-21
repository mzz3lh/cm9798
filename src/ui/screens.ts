// The season's screens, drawn as CM 97/98 drew them: the main menu with the
// date as its title, the news, competition info (table, fixtures, cup draws,
// scorers, transfers), player search, bids and contract talks, the club's
// finances and board, the saves to rewind to, and the day's other results.

import { CHAMPIONSHIP, LEAGUE_ONE } from '../data/football-league';
import { PREMIER_LEAGUE } from '../data/premier-league';
import { longDate, shortDate, dayMonth } from '../engine/calendar';
import { money, roundMoney, roundWage } from '../engine/economy';
import {
  clubFixtures, expectedFinish, fixturesOn, leagueTable, nextFixture, ordinal, scoreLine, unreadNews, windowOpen,
} from '../engine/season';
import {
  acceptBid, askingPrice, makeBid, meetAskingPrice, offerTerms, openTalks, rejectBid, withdraw,
} from '../engine/transfers';
import type { Player } from '../engine/types';
import {
  COMP_NAMES, DIVISION_NAMES, DIVISION_TAGS, createGame, playerById, valueOf, wageBill,
  type CompId, type Division, type Fixture, type GameState, type NewsItem,
} from '../engine/world';
import { dateTag, listName, positionCode, tagBox, teamBar } from './common';
import { begin, carryOn, autosaveNow, saveError } from './flow';
import { openProfile, openTactics, resetMatchday } from './matchday';
import { fit } from './retro/fonts';
import { C, W, type Screen } from './retro/screen';
import { clearSaves, exportSave, importSave, listSaves, loadSave, type SaveInfo } from './saves';
import { game, go, ui, type View } from './state';

const SOURCES = { PL: PREMIER_LEAGUE, CH: CHAMPIONSHIP, L1: LEAGUE_ONE };
const COMP_TAGS: Record<CompId, string> = { PL: 'PL', LC: 'LC', FAC: 'FA' };

/** Saves on this machine, read when the title or saves screen opens. */
let saves: SaveInfo[] | undefined;
export function refreshSaves() {
  listSaves().then(s => { saves = s; ui.screen.render(); }, () => { saves = []; ui.screen.render(); });
}

function clubTitle(s: Screen, clubId: string | undefined, title: string) {
  const t = clubId ? game().teams[clubId] : undefined;
  if (t) { const { bg, fg } = teamBar(t); s.titleBar(fit(title, 620, 'MY7'), bg, fg); } else s.titleBar(fit(title, 620, 'MY7'));
}

function pager(s: Screen, page: number, pages: number, set: (p: number) => void) {
  s.tag(`Page ${page + 1} of ${Math.max(1, pages)}`, 4, 0, 'left');
  s.button('Previous\nPage', 10, 414, 153, 30, page > 0 ? () => set(page - 1) : undefined);
  s.button('Next\nPage', 477, 414, 153, 30, page < pages - 1 ? () => set(page + 1) : undefined);
}

// ------------------------------------------------------------------ title and new game

export function drawTitle(s: Screen) {
  s.background();
  s.text('Championship', W / 2, 70, { font: 'MY7', colour: C.yellow, align: 'center' });
  s.text('Manager 97/98', W / 2, 106, { font: 'MY7', colour: C.yellow, align: 'center' });
  s.text('Season 2026/27', W / 2, 150, { font: 'MY4', colour: C.cyan, align: 'center' });
  const latest = saves?.[0];
  s.tile('New\nGame', 120, 210, 130, 108, () => go({ kind: 'pickClub' }));
  s.tile(latest ? `Continue\n${shortDate(latest.date)}` : 'Continue', 255, 210, 130, 108, () => {
    if (latest) loadSave(latest.date).then(g => { resetMatchday(); begin(g); ui.screen.render(); });
  });
  s.tile('Load\nGame', 390, 210, 130, 108, () => { refreshSaves(); go({ kind: 'saves', page: 0 }); });
  if (latest) s.text(`Last saved: ${latest.club}, ${longDate(latest.date)}`, W / 2, 340, { font: 'MY3', colour: C.text, align: 'center' });
  s.doneBar('Please Select');
}

export function drawPickClub(s: Screen) {
  s.background();
  s.titleBar('Player #1 Select Team');
  s.panel(20, 66, 600, 370);
  const clubs = PREMIER_LEAGUE.map(c => c.team).sort((a, b) => a.name.localeCompare(b.name));
  clubs.forEach((t, i) => {
    const col = i < 10 ? 0 : 1, row = i % 10;
    const x = 30 + col * 300, y = 76 + row * 34;
    s.text(t.name, x, y, { font: 'MY4', colour: C.white });
    s.text('(PR)', x + 270, y + 4, { font: 'MY2', colour: C.orange, align: 'right' });
    s.area(x, y, 280, 32, { onClick: () => {
      const g = createGame(SOURCES, t.id, (Date.now() % 1e9) | 0);
      resetMatchday();
      clearSaves().catch(() => {}).then(() => { begin(g); autosaveNow(); ui.screen.render(); });
      ui.game = g;
      go({ kind: 'menu' });
    } });
  });
  s.doneBar('Back', () => go({ kind: 'title' }), 10, 310);
  s.button('Premier League', 322, 446, 308, 30, undefined, { active: true, font: 'MY3', colour: C.yellow });
}

// ------------------------------------------------------------------ main menu

export function drawMenu(s: Screen) {
  const g = game();
  const me = g.teams[g.humanClubId];
  s.background();
  s.titleBar(longDate(g.date));
  s.tag('Season #1', 4, 0, 'left');
  dateTag(s);
  const unread = unreadNews(g).length;
  const tiles: [string, () => void][] = [
    ['Done', () => (g.over ? go({ kind: 'over' }) : unread ? go({ kind: 'news', at: 0 }) : carryOn())],
    ['Competition\nInfo', () => go({ kind: 'competitions' })],
    ['Squad\nDetails', () => go({ kind: 'squad', teamId: g.humanClubId, mode: 'positions', back: { kind: 'menu' } })],
    ['Match\nTactics', () => openTactics({ kind: 'menu' })],
    ['Player Search\n& Transfers', () => go({ kind: 'search', page: 0 })],
    ['Board &\nFinances', () => go({ kind: 'finances' })],
    ['News', () => go({ kind: 'newsList', page: 0 })],
    ['Save Game\n& Rewind', () => { refreshSaves(); go({ kind: 'saves', page: 0 }); }],
  ];
  tiles.forEach(([label, fn], i) => s.tile(label, 54 + (i % 4) * 134, 76 + Math.floor(i / 4) * 114, 130, 108, fn));
  const next = nextFixture(g, g.humanClubId);
  s.panel(54, 312, 532, 96);
  s.text(me.name, W / 2, 318, { font: 'MY4', colour: C.white, align: 'center' });
  if (next) {
    const home = next.home === g.humanClubId;
    const opp = g.teams[home ? next.away : next.home];
    s.text(`Next match: ${opp.name} (${next.neutral ? 'N' : home ? 'H' : 'A'}), ${COMP_NAMES[next.comp]}, ${shortDate(next.date)}`, W / 2, 344, { font: 'MY3', colour: C.cyan, align: 'center' });
  } else if (g.over) s.text('The season is over.', W / 2, 344, { font: 'MY3', colour: C.cyan, align: 'center' });
  const table = leagueTable(g);
  const pos = table.findIndex(r => r.clubId === g.humanClubId) + 1;
  s.text(`${table[0].p ? `${ordinal(pos)} in the Premier League.  ` : ''}Transfer window ${windowOpen(g.date) ? 'open' : 'closed'}.`, W / 2, 366, { font: 'MY3', colour: C.text, align: 'center' });
  if (unread) s.text(`${unread} new news item${unread > 1 ? 's' : ''}`, W / 2, 386, { font: 'MY3', colour: C.yellow, align: 'center' });
  if (saveError) s.text(`Autosave failed: ${fit(saveError, 400, 'MY1')}`, W / 2, 418, { font: 'MY1', colour: C.orange, align: 'center' });
  s.doneBar('Please Select');
}

// ------------------------------------------------------------------ news

/** Unread news, one item at a time; Done goes to the next and then to the main menu. */
export function drawNews(s: Screen) {
  const g = game();
  const unread = unreadNews(g);
  const n = unread[0];
  if (!n) { go({ kind: 'menu' }); s.background(); return; }
  drawNewsItem(s, n, { kind: 'news', at: 0 });
  s.tag(`${1} of ${unread.length}`, 4, 0, 'left');
  s.doneBar('Done', () => { n.read = true; if (!unreadNews(g).length) go({ kind: 'menu' }); });
}

let newsMessage: { id: string; text: string } | undefined;

function drawNewsItem(s: Screen, n: NewsItem, here: View) {
  const g = game();
  s.background();
  clubTitle(s, n.clubId, n.title);
  dateTag(s);
  s.text(n.heading, W / 2, 74, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 120, 600, 286);
  s.paragraph(n.body, 40, 140, 560, 'MY4', C.text);
  const t = n.talksId ? g.talks.find(x => x.id === n.talksId) : undefined;
  const buttons: [string, () => void][] = [];
  if (t && t.from === g.humanClubId && t.stage === 'bid' && !t.renewal) {
    buttons.push(['Accept\nOffer', () => { const e = acceptBid(g, t.id); newsMessage = { id: n.id, text: e ?? 'Offer accepted.' }; }]);
    buttons.push(['Reject\nOffer', () => { rejectBid(g, t.id); newsMessage = { id: n.id, text: 'Offer rejected.' }; }]);
    const p = playerById(g, t.playerId);
    if (p) buttons.push(['View\nPlayer', () => openProfile(p, g.teams[g.humanClubId], here)]);
  } else if (t && t.to === g.humanClubId && t.stage === 'countered') {
    buttons.push([`Pay\n${money(t.asking ?? 0)}`, () => {
      const e = meetAskingPrice(g, t.id);
      if (e) newsMessage = { id: n.id, text: e };
      else if (t.stage === 'terms') go({ kind: 'terms', talksId: t.id, wage: t.demand!.wage, years: t.demand!.years, back: here });
      else newsMessage = { id: n.id, text: 'He does not want to join you.' };
    }]);
    buttons.push(['New\nOffer', () => go({ kind: 'bid', playerId: t.playerId, fee: t.fee, back: here })]);
    buttons.push(['Withdraw', () => { withdraw(g, t.id); newsMessage = { id: n.id, text: 'You have withdrawn.' }; }]);
  } else if (t && t.to === g.humanClubId && t.stage === 'terms') {
    buttons.push(['Discuss\nTerms', () => go({ kind: 'terms', talksId: t.id, wage: t.demand!.wage, years: t.demand!.years, back: here })]);
    buttons.push(['Withdraw', () => { withdraw(g, t.id); newsMessage = { id: n.id, text: 'You have withdrawn.' }; }]);
  }
  if (n.fixtures?.length) {
    const fx = g.fixtures.find(f => f.id === n.fixtures![0]);
    if (fx && fx.comp !== 'PL') {
      const round = g.cups[fx.comp].rounds.findIndex(r => r.name === fx.round);
      buttons.push(['View\nDraw', () => go({ kind: 'cup', comp: fx.comp as 'LC' | 'FAC', round, back: here })]);
    }
  }
  buttons.forEach(([label, fn], i) => s.button(label, 10 + i * 155, 414, 153, 30, fn));
  if (newsMessage?.id === n.id) s.text(newsMessage.text, W / 2, 384, { font: 'MY3', colour: C.yellow, align: 'center' });
}

let reading: string | undefined;

export function drawNewsList(s: Screen, v: Extract<View, { kind: 'newsList' }>) {
  const g = game();
  if (reading) {
    const n = g.news.find(x => x.id === reading)!;
    drawNewsItem(s, n, v);
    s.doneBar('Done', () => { reading = undefined; });
    return;
  }
  const items = g.news.filter(n => n.human).slice().reverse();
  const per = 17, pages = Math.ceil(items.length / per);
  s.background();
  s.titleBar('News');
  dateTag(s);
  s.panel(10, 66, 620, 344);
  items.slice(v.page * per, v.page * per + per).forEach((n, i) => {
    const y = 72 + i * 20;
    s.text(shortDate(n.date), 18, y + 2, { font: 'MY2', colour: C.cyan });
    s.text(fit(n.heading, 440, 'MY3'), 120, y, { font: 'MY3', colour: n.read ? C.text : C.yellow });
    s.area(10, y, 620, 20, { onClick: () => { reading = n.id; } });
  });
  if (!items.length) s.text('No news yet.', W / 2, 220, { font: 'MY4', colour: C.text, align: 'center' });
  pager(s, v.page, pages, p => { v.page = p; });
  s.doneBar('Done', () => go({ kind: 'menu' }), 165, 310);
}

// ------------------------------------------------------------------ competition info

export function drawCompetitions(s: Screen) {
  const g = game();
  s.background();
  s.titleBar('Competition Info');
  dateTag(s);
  const here: View = { kind: 'competitions' };
  const latestRound = (c: 'LC' | 'FAC') => Math.max(0, g.cups[c].rounds.map(r => r.drawn).lastIndexOf(true));
  const tiles: [string, () => void][] = [
    ['Premier\nLeague', () => go({ kind: 'table', back: here })],
    ['Fixtures\n& Results', () => go(fixturesView(g.humanClubId, here))],
    ['League\nCup', () => go({ kind: 'cup', comp: 'LC', round: latestRound('LC'), back: here })],
    ['FA\nCup', () => go({ kind: 'cup', comp: 'FAC', round: latestRound('FAC'), back: here })],
    ['Top\nScorers', () => go({ kind: 'scorers', back: here })],
    ['Transfers', () => go({ kind: 'transfersList', page: 0, back: here })],
  ];
  tiles.forEach(([label, fn], i) => s.tile(label, 120 + (i % 3) * 134, 90 + Math.floor(i / 3) * 140, 130, 108, fn));
  s.doneBar('Done', () => go({ kind: 'menu' }));
}

export function fixturesView(clubId: string, back: View): View {
  const list = clubFixtures(game(), clubId);
  const next = Math.max(0, list.findIndex(f => !f.result));
  return { kind: 'fixtures', clubId, page: Math.floor(Math.max(0, next - 3) / 17), back };
}

export function drawTable(s: Screen, v: Extract<View, { kind: 'table' }>) {
  const g = game();
  const table = leagueTable(g);
  s.background();
  s.titleBar('Premier League');
  dateTag(s);
  s.panel(10, 60, 620, 382);
  const cols = ['P', 'W', 'D', 'L', 'F', 'A', 'Pts'];
  cols.forEach((c, i) => s.text(c, 372 + i * 38, 62, { font: 'MY2', colour: C.gold, align: 'center' }));
  table.forEach((r, i) => {
    const y = 78 + i * 18;
    const me = r.clubId === g.humanClubId;
    s.blueBox(String(i + 1), 14, y, 30, 17, { font: 'MY2' });
    const name = g.teams[r.clubId].name;
    s.text(name, 52, y, { font: 'MY3', colour: me ? C.yellow : C.white });
    s.area(52, y, 290, 18, { onClick: () => go({ kind: 'squad', teamId: r.clubId, mode: 'positions', back: v }) });
    [r.p, r.w, r.d, r.l, r.f, r.a, r.pts].forEach((n, k) => s.text(String(n), 372 + k * 38, y + 2, { font: 'MY2', colour: k === 6 ? C.yellow : C.cyan, align: 'center' }));
    // Champions League places and the drop, as lines under the rows.
    if (i === 3 || i === 16) s.rect(14, y + 17, 612, 1, i === 3 ? C.cyan : C.orange);
  });
  s.doneBar('Done', () => go(v.back));
}

export function drawFixtures(s: Screen, v: Extract<View, { kind: 'fixtures' }>) {
  const g = game();
  const list = clubFixtures(g, v.clubId);
  const per = 17, pages = Math.ceil(list.length / per);
  s.background();
  clubTitle(s, v.clubId, `${g.teams[v.clubId].name} Fixtures`);
  dateTag(s);
  s.panel(10, 60, 620, 350);
  list.slice(v.page * per, v.page * per + per).forEach((f, i) => {
    const y = 66 + i * 20;
    const home = f.home === v.clubId;
    const opp = g.teams[home ? f.away : f.home];
    s.text(shortDate(f.date), 16, y + 2, { font: 'MY2', colour: C.cyan });
    tagBox(s, COMP_TAGS[f.comp], 118, y, f.comp === 'PL' ? C.grey : '#1c5c1c');
    s.text(fit(opp.name, 230, 'MY3'), 152, y, { font: 'MY3', colour: C.white });
    s.text(f.neutral ? 'N' : home ? 'H' : 'A', 392, y, { font: 'MY3', colour: C.gold, align: 'center' });
    if (f.comp !== 'PL') s.text(fit(f.round + (f.leg ? ` ${f.leg}` : ''), 110, 'MY1'), 410, y + 3, { font: 'MY1', colour: C.text });
    if (f.result) {
      const line = scoreLine(g, f, v.clubId);
      const [a, b] = (f.result.et ?? [f.result.home, f.result.away]);
      const mine = home ? a : b, theirs = home ? b : a;
      const won = mine > theirs || (mine === theirs && f.result.pens && (home ? f.result.pens[0] > f.result.pens[1] : f.result.pens[1] > f.result.pens[0]));
      const colour = won ? C.yellow : mine === theirs && !f.result.pens ? C.text : C.orange;
      s.text(fit(line, 100, 'MY2'), 622, y + 2, { font: 'MY2', colour, align: 'right' });
    }
    s.area(152, y, 230, 20, { onClick: () => go({ kind: 'squad', teamId: opp.id, mode: 'positions', back: v }) });
  });
  pager(s, v.page, pages, p => { v.page = p; });
  s.doneBar('Done', () => go(v.back), 165, 310);
}

/** A cup round: the draw, with each side's division tag and the cyan "v", and the scores once played. */
export function drawCup(s: Screen, v: Extract<View, { kind: 'cup' }>) {
  const g = game();
  const cup = g.cups[v.comp];
  const round = cup.rounds[v.round];
  s.background();
  s.titleBar(COMP_NAMES[v.comp]);
  dateTag(s);
  s.text(round.drawn ? `${round.name} Draw` : `${round.name}: not yet drawn`, W / 2, 62, { font: 'MY5', colour: C.white, align: 'center' });
  s.panel(10, 92, 620, 318);
  const ties = g.fixtures.filter(f => f.comp === v.comp && f.round === round.name && f.leg !== 2);
  const wide = ties.length <= 16;
  ties.forEach((f, i) => {
    const col = wide ? 0 : i < Math.ceil(ties.length / 2) ? 0 : 1;
    const row = wide ? i : i % Math.ceil(ties.length / 2);
    const x = 14 + col * 310, w = wide ? 612 : 304;
    const y = 96 + row * (wide ? 19 : 19);
    const font = wide ? 'MY3' : 'MY1';
    const name = (id: string) => (wide ? g.teams[id].name : g.teams[id].shortName);
    const tag = (id: string) => DIVISION_TAGS[g.clubs[id].division];
    const mid = x + w / 2;
    const leg2 = f.tie ? g.fixtures.find(o => o.tie === f.tie && o.leg === 2) : undefined;
    const hl = (id: string) => (id === g.humanClubId ? C.yellow : C.white);
    s.text(fit(name(f.home), w / 2 - 70, font), mid - 44, y, { font, colour: hl(f.home), align: 'right' });
    tagBox(s, tag(f.home), mid - 40, y, '#003c8a');
    s.text('v', mid, y, { font: 'MY3', colour: C.cyan, align: 'center' });
    tagBox(s, tag(f.away), mid + 14, y, '#003c8a');
    s.text(fit(name(f.away), w / 2 - 70, font), mid + 44, y, { font, colour: hl(f.away) });
    const score = (fx: Fixture | undefined) => (fx?.result ? scoreLine(g, fx).replace(' pens', 'p') : '');
    const res = [score(f), score(leg2)].filter(Boolean).join(', ');
    if (res) s.text(fit(res, wide ? 120 : 60, 'MY1'), wide ? x + w - 2 : x + w - 2, y + 3, { font: 'MY1', colour: C.gold, align: 'right' });
  });
  if (!ties.length) s.text(round.drawn ? 'No ties.' : `The draw is on ${dayMonth(round.draw)}.`, W / 2, 230, { font: 'MY4', colour: C.text, align: 'center' });
  if (cup.winner) s.text(`Winners: ${g.teams[cup.winner].name}`, W / 2, 392, { font: 'MY3', colour: C.yellow, align: 'center' });
  s.button('Previous\nRound', 10, 414, 153, 30, v.round > 0 ? () => { v.round--; } : undefined);
  s.button(dayMonth(round.dates[0]) + (round.dates[1] ? ` & ${dayMonth(round.dates[1])}` : ''), 165, 414, 310, 30, undefined, { font: 'MY3' });
  s.button('Next\nRound', 477, 414, 153, 30, v.round < cup.rounds.length - 1 ? () => { v.round++; } : undefined);
  s.doneBar('Done', () => go(v.back));
}

let scorerComp: CompId = 'PL';

export function drawScorers(s: Screen, v: Extract<View, { kind: 'scorers' }>) {
  const g = game();
  s.background();
  s.titleBar('Top Scorers');
  dateTag(s);
  const comps: CompId[] = ['PL', 'LC', 'FAC'];
  s.button(`${COMP_NAMES[scorerComp]}`, 165, 60, 310, 30, () => { scorerComp = comps[(comps.indexOf(scorerComp) + 1) % 3]; }, { arrows: true, onRightClick: () => { scorerComp = comps[(comps.indexOf(scorerComp) + 2) % 3]; } });
  s.panel(10, 94, 620, 346);
  const list = Object.entries(g.players).filter(([, st]) => st.stats[scorerComp].goals > 0)
    .sort((a, b) => b[1].stats[scorerComp].goals - a[1].stats[scorerComp].goals || a[1].stats[scorerComp].apps - b[1].stats[scorerComp].apps).slice(0, 20);
  s.text('Gls', 520, 96, { font: 'MY2', colour: C.gold, align: 'center' });
  s.text('Apps', 580, 96, { font: 'MY2', colour: C.gold, align: 'center' });
  list.forEach(([id, st], i) => {
    const y = 112 + i * 16;
    const p = playerById(g, id)!;
    s.blueBox(String(i + 1), 14, y, 30, 15, { font: 'MY1' });
    s.text(fit(p.name, 220, 'MY2'), 52, y + 1, { font: 'MY2', colour: st.clubId === g.humanClubId ? C.yellow : C.white });
    s.text(g.teams[st.clubId].name, 290, y + 1, { font: 'MY2', colour: C.text });
    s.text(String(st.stats[scorerComp].goals), 520, y + 1, { font: 'MY2', colour: C.yellow, align: 'center' });
    s.text(String(st.stats[scorerComp].apps + st.stats[scorerComp].subs), 580, y + 1, { font: 'MY2', colour: C.cyan, align: 'center' });
    s.area(52, y, 500, 16, { onClick: () => openProfile(p, g.teams[st.clubId], v) });
  });
  if (!list.length) s.text('No goals yet.', W / 2, 240, { font: 'MY4', colour: C.text, align: 'center' });
  s.doneBar('Done', () => go(v.back));
}

export function drawTransfersList(s: Screen, v: Extract<View, { kind: 'transfersList' }>) {
  const g = game();
  const list = g.transfers.slice().reverse();
  const per = 17, pages = Math.ceil(list.length / per);
  s.background();
  s.titleBar('Transfers');
  dateTag(s);
  s.panel(10, 60, 620, 350);
  list.slice(v.page * per, v.page * per + per).forEach((t, i) => {
    const y = 66 + i * 20;
    const mine = t.from === g.humanClubId || t.to === g.humanClubId;
    s.text(shortDate(t.date), 14, y + 2, { font: 'MY1', colour: C.cyan });
    s.text(fit(t.name, 160, 'MY2'), 90, y + 1, { font: 'MY2', colour: mine ? C.yellow : C.white });
    s.text(fit(`${g.teams[t.from].shortName} to ${g.teams[t.to].shortName}`, 280, 'MY2'), 256, y + 1, { font: 'MY2', colour: C.text });
    s.text(t.fee ? money(t.fee) : 'Free', 622, y + 1, { font: 'MY2', colour: C.gold, align: 'right' });
    const p = playerById(g, t.playerId);
    if (p) s.area(90, y, 160, 20, { onClick: () => openProfile(p, g.teams[g.players[p.id].clubId], v) });
  });
  if (!list.length) s.text('No transfers yet.', W / 2, 220, { font: 'MY4', colour: C.text, align: 'center' });
  pager(s, v.page, pages, p => { v.page = p; });
  s.doneBar('Done', () => go(v.back), 165, 310);
}

// ------------------------------------------------------------------ player search

const POSITIONS = ['Any', 'GK', 'D', 'M', 'F'] as const;
const DIVS = ['Any', 'PL', 'CH', 'L1'] as const;
const MAX_VALUES = [0, 1e6, 5e6, 10e6, 25e6, 50e6];
const AGES = ['Any', 'Under 21', 'Under 24', '24-29', '30+'] as const;
const filters = { pos: 'Any' as (typeof POSITIONS)[number], div: 'Any' as (typeof DIVS)[number], maxValue: 0, age: 'Any' as (typeof AGES)[number], listed: false };

function matchesSearch(g: GameState, p: Player): boolean {
  const st = g.players[p.id];
  if (st.clubId === g.humanClubId) return false;
  const pos = p.positions[0];
  const line = pos === 'GK' ? 'GK' : pos.startsWith('D') && pos !== 'DM' ? 'D' : pos === 'ST' ? 'F' : 'M';
  if (filters.pos !== 'Any' && filters.pos !== line) return false;
  if (filters.div !== 'Any' && g.clubs[st.clubId].division !== filters.div) return false;
  if (filters.maxValue && valueOf(g, p) > filters.maxValue) return false;
  if (filters.listed && !st.listed) return false;
  const a = p.age;
  if (filters.age === 'Under 21' && a >= 21) return false;
  if (filters.age === 'Under 24' && a >= 24) return false;
  if (filters.age === '24-29' && (a < 24 || a > 29)) return false;
  if (filters.age === '30+' && a < 30) return false;
  return true;
}

let searchCache: { key: string; list: Player[] } | undefined;

export function drawSearch(s: Screen, v: Extract<View, { kind: 'search' }>) {
  const g = game();
  s.background();
  s.titleBar('Player Search');
  dateTag(s);
  const step = <T,>(list: readonly T[], cur: T, d: number) => list[(list.indexOf(cur) + d + list.length) % list.length];
  const cyc = (label: string, x: number, w: number, fn: (d: number) => void) =>
    s.button(label, x, 60, w, 30, () => { fn(1); v.page = 0; }, { arrows: true, onRightClick: () => { fn(-1); v.page = 0; } });
  cyc(`Position\n${filters.pos}`, 10, 122, d => { filters.pos = step(POSITIONS, filters.pos, d); });
  cyc(`Division\n${filters.div === 'Any' ? 'Any' : DIVISION_NAMES[filters.div as Division]}`, 134, 122, d => { filters.div = step(DIVS, filters.div, d); });
  cyc(`Value up to\n${filters.maxValue ? money(filters.maxValue) : 'Any'}`, 258, 122, d => { filters.maxValue = step(MAX_VALUES, filters.maxValue, d); });
  cyc(`Age\n${filters.age}`, 382, 122, d => { filters.age = step(AGES, filters.age, d); });
  s.button(`Transfer\n${filters.listed ? 'Listed only' : 'Anyone'}`, 506, 60, 124, 30, () => { filters.listed = !filters.listed; v.page = 0; }, { active: filters.listed });

  const key = JSON.stringify(filters) + g.date + g.transfers.length;
  if (searchCache?.key !== key) {
    const all = Object.values(g.teams).flatMap(t => t.squad).filter(p => matchesSearch(g, p));
    searchCache = { key, list: all.sort((a, b) => valueOf(g, b) - valueOf(g, a)) };
  }
  const list = searchCache.list;
  const per = 17, pages = Math.ceil(list.length / per);
  s.panel(10, 94, 620, 316);
  const heads: [string, number][] = [['Name', 16], ['Age', 196], ['Pos', 226], ['Club', 286], ['Value', 520], ['Apps/Gls', 600]];
  heads.forEach(([h, x]) => s.text(h, x, 96, { font: 'MY1', colour: C.gold, align: h === 'Name' || h === 'Club' ? 'left' : 'center' }));
  list.slice(v.page * per, v.page * per + per).forEach((p, i) => {
    const y = 110 + i * 17.5;
    const st = g.players[p.id];
    const club = g.teams[st.clubId];
    const yy = Math.round(y);
    s.text(fit(listName(p), 170, 'MY2'), 16, yy, { font: 'MY2', colour: st.listed ? C.yellow : C.white });
    s.text(String(p.age), 196, yy + 1, { font: 'MY2', colour: C.cyan, align: 'center' });
    s.text(fit(positionCode(p), 56, 'MY1'), 226, yy + 2, { font: 'MY1', colour: C.gold, align: 'center' });
    s.text(fit(club.shortName, 170, 'MY2'), 286, yy, { font: 'MY2', colour: C.text });
    tagBox(s, DIVISION_TAGS[g.clubs[club.id].division], 458, yy, '#003c8a');
    s.text(money(valueOf(g, p)), 520, yy + 1, { font: 'MY2', colour: C.gold, align: 'center' });
    const lg = st.stats.PL;
    s.text(`${lg.apps + lg.subs + st.stats.LC.apps + st.stats.FAC.apps}/${lg.goals + st.stats.LC.goals + st.stats.FAC.goals}`, 600, yy + 1, { font: 'MY2', colour: C.cyan, align: 'center' });
    s.area(10, yy, 620, 17, { onClick: () => go({ kind: 'profile', player: p, team: club, back: v, tab: 'transfer' }) });
  });
  if (!list.length) s.text('Nobody matches.', W / 2, 240, { font: 'MY4', colour: C.text, align: 'center' });
  pager(s, v.page, pages, p => { v.page = p; });
  s.button(`${list.length} players.  Budget ${money(g.clubs[g.humanClubId].transferBudget)}`, 165, 414, 310, 30, undefined, { font: 'MY2' });
  s.doneBar('Done', () => go({ kind: 'menu' }));
}

// ------------------------------------------------------------------ bids and contracts

/** A step up or down in an amount, sized to it. */
function feeStep(v: number) { return v < 1e6 ? 25000 : v < 1e7 ? 250000 : 500000; }
function wageStep(v: number) { return v < 10000 ? 500 : v < 50000 ? 1000 : 5000; }

function amountRow(s: Screen, y: number, value: string, down: () => void, up: () => void, bigDown: () => void, bigUp: () => void) {
  s.button('<<', 120, y, 60, 34, bigDown, { font: 'MY4' });
  s.button('<', 184, y, 60, 34, down, { font: 'MY4' });
  s.blueBox(value, 250, y, 140, 34, { font: 'MY5' });
  s.button('>', 396, y, 60, 34, up, { font: 'MY4' });
  s.button('>>', 460, y, 60, 34, bigUp, { font: 'MY4' });
}

export function drawBid(s: Screen, v: Extract<View, { kind: 'bid' }>) {
  const g = game();
  const p = playerById(g, v.playerId);
  if (!p) { go(v.back); return; }
  const st = g.players[p.id];
  const seller = g.teams[st.clubId];
  const talks = openTalks(g, p.id);
  s.background();
  clubTitle(s, seller.id, `${p.name} (${seller.shortName})`);
  dateTag(s);
  s.text('Make An Offer', W / 2, 62, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 100, 600, 306);
  const lines: [string, string][] = [
    ['Value', money(valueOf(g, p))],
    ['Transfer status', st.listed ? 'Transfer listed' : 'Not for sale'],
    ['Your transfer budget', money(g.clubs[g.humanClubId].transferBudget)],
  ];
  if (talks?.stage === 'countered' && talks.asking) lines.push([`${seller.shortName} want`, money(talks.asking)]);
  lines.forEach(([a, b], i) => {
    s.text(a, 60, 112 + i * 20, { font: 'MY3', colour: C.text });
    s.text(b, 580, 112 + i * 20, { font: 'MY3', colour: C.yellow, align: 'right' });
  });
  const set = (f: number) => { v.fee = Math.max(0, roundMoney(f)); v.message = undefined; };
  amountRow(s, 210, money(v.fee), () => set(v.fee - feeStep(v.fee)), () => set(v.fee + feeStep(v.fee)),
    () => set(v.fee * 0.8), () => set(v.fee * 1.25));
  s.text('Transfer fee', W / 2, 252, { font: 'MY2', colour: C.text, align: 'center' });
  if (v.message) s.paragraph(v.message, 60, 290, 520, 'MY3', C.yellow);
  if (talks?.stage === 'bid' && talks.to === g.humanClubId) s.text(`Your offer of ${money(talks.fee)} is with ${seller.name}.`, W / 2, 360, { font: 'MY3', colour: C.cyan, align: 'center' });
  s.button('Make\nOffer', 10, 414, 153, 30, () => {
    const r = makeBid(g, p.id, v.fee);
    v.message = typeof r === 'string' ? r : `Your offer of ${money(v.fee)} has gone to ${seller.name}. They will reply tomorrow.`;
  });
  if (talks?.stage === 'countered' && talks.to === g.humanClubId) {
    s.button(`Pay\n${money(talks.asking ?? 0)}`, 165, 414, 153, 30, () => {
      const e = meetAskingPrice(g, talks.id);
      if (e) v.message = e;
      else if (talks.stage === 'terms') go({ kind: 'terms', talksId: talks.id, wage: talks.demand!.wage, years: talks.demand!.years, back: v.back });
      else v.message = `${p.name} does not want to join you.`;
    });
  }
  if (talks && talks.to === g.humanClubId) s.button('Withdraw', 320, 414, 153, 30, () => { withdraw(g, talks.id); v.message = 'You have withdrawn.'; });
  s.button('Asking\nPrice?', 477, 414, 153, 30, () => { v.message = st.listed ? `${seller.name} would want about ${money(askingPrice(g, p, g.humanClubId))}.` : `${seller.name} have not said what they want for him.`; });
  s.doneBar('Done', () => go(v.back));
}

export function drawTerms(s: Screen, v: Extract<View, { kind: 'terms' }>) {
  const g = game();
  const t = g.talks.find(x => x.id === v.talksId);
  const p = t && playerById(g, t.playerId);
  if (!t || !p) { go(v.back); return; }
  s.background();
  clubTitle(s, t.to, p.name);
  dateTag(s);
  s.text(t.renewal ? 'New Contract' : 'Personal Terms', W / 2, 62, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 100, 600, 306);
  const current = g.players[p.id].contract;
  const lines: [string, string][] = [
    ['He is asking for', t.demand ? `${money(t.demand.wage)} a week, ${t.demand.years} year${t.demand.years > 1 ? 's' : ''}` : '-'],
    ['Current contract', `${money(current.wage)} a week to 30.6.${current.expires}`],
    ['Your wage bill', `${money(wageBill(g, t.to))} of ${money(g.clubs[t.to].wageBudget)} a week`],
  ];
  if (!t.renewal) lines.push(['Transfer fee agreed', money(t.fee)]);
  lines.forEach(([a, b], i) => {
    s.text(a, 60, 112 + i * 20, { font: 'MY3', colour: C.text });
    s.text(b, 580, 112 + i * 20, { font: 'MY3', colour: C.yellow, align: 'right' });
  });
  const open = t.stage === 'terms' && !v.done;
  const setWage = (w: number) => { v.wage = roundWage(Math.max(500, w)); v.message = undefined; };
  amountRow(s, 206, `${money(v.wage)}`, () => setWage(v.wage - wageStep(v.wage)), () => setWage(v.wage + wageStep(v.wage)),
    () => setWage(v.wage * 0.9), () => setWage(v.wage * 1.1));
  s.text('A week', W / 2, 244, { font: 'MY2', colour: C.text, align: 'center' });
  s.button(`${v.years} year${v.years > 1 ? 's' : ''}`, 250, 262, 140, 30, () => { v.years = (v.years % 5) + 1; }, { arrows: true, font: 'MY3', onRightClick: () => { v.years = ((v.years + 3) % 5) + 1; } });
  if (v.message) s.paragraph(v.message, 60, 310, 520, 'MY3', v.done ? C.cyan : C.yellow);
  s.button('Offer\nContract', 10, 414, 153, 30, open ? () => {
    const r = offerTerms(g, t.id, v.wage, v.years);
    v.message = r.text;
    if (r.ok) { v.done = true; autosaveNow(); }
  } : undefined);
  s.button('Meet His\nDemands', 165, 414, 153, 30, open && t.demand ? () => { v.wage = t.demand!.wage; v.years = t.demand!.years; } : undefined);
  s.button('Break Off\nTalks', 320, 414, 153, 30, open ? () => { withdraw(g, t.id); v.message = 'Talks are off.'; v.done = true; } : undefined);
  s.doneBar('Done', () => go(v.back));
}

export function drawOffer(s: Screen, v: Extract<View, { kind: 'offer' }>) {
  const g = game();
  const t = g.talks.find(x => x.id === v.talksId);
  const p = t && playerById(g, t.playerId);
  if (!t || !p) { go(v.back); return; }
  s.background();
  clubTitle(s, t.to, g.teams[t.to].name);
  dateTag(s);
  s.text('Transfer Offer', W / 2, 62, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 100, 600, 306);
  s.paragraph(`${g.teams[t.to].name} have offered ${money(t.fee)} for ${p.name}. His value is about ${money(valueOf(g, p))}.`, 40, 120, 560, 'MY4', C.text);
  if (v.message) s.text(v.message, W / 2, 300, { font: 'MY3', colour: C.yellow, align: 'center' });
  const live = t.stage === 'bid';
  s.button('Accept\nOffer', 10, 414, 153, 30, live ? () => { v.message = acceptBid(g, t.id) ?? 'Offer accepted.'; } : undefined);
  s.button('Reject\nOffer', 165, 414, 153, 30, live ? () => { rejectBid(g, t.id); v.message = 'Offer rejected.'; } : undefined);
  s.doneBar('Done', () => go(v.back));
}

// ------------------------------------------------------------------ finances and board

function boardWord(b: number) {
  return b >= 85 ? 'Delighted' : b >= 70 ? 'Very pleased' : b >= 55 ? 'Pleased' : b >= 40 ? 'Satisfied' : b >= 25 ? 'Concerned' : 'Very concerned';
}

export function drawFinances(s: Screen) {
  const g = game();
  const club = g.clubs[g.humanClubId];
  s.background();
  clubTitle(s, g.humanClubId, g.teams[g.humanClubId].name);
  dateTag(s);
  s.text('Board & Finances', W / 2, 62, { font: 'MY6', colour: C.white, align: 'center' });
  s.panel(20, 100, 600, 306);
  const rows: [string, string][] = [
    ['Bank balance', money(club.balance)],
    ['Transfer budget', money(club.transferBudget)],
    ['Wage bill', `${money(wageBill(g, club.id))} a week`],
    ['Wage budget', `${money(club.wageBudget)} a week`],
    ['Gate receipts', money(club.income.gate)],
    ['TV money', money(club.income.tv)],
    ['Prize money', money(club.income.prize)],
    ['Player sales', money(club.income.sales)],
    ['Wages paid', money(club.spend.wages)],
    ['Transfer fees paid', money(club.spend.fees)],
  ];
  rows.forEach(([a, b], i) => {
    const y = 108 + i * 18;
    s.text(a, 40, y, { font: 'MY3', colour: C.text });
    s.text(b, 330, y, { font: 'MY3', colour: i < 4 ? C.yellow : C.cyan, align: 'right' });
  });
  const pos = leagueTable(g).findIndex(r => r.clubId === g.humanClubId) + 1;
  s.text('Board confidence', 470, 108, { font: 'MY3', colour: C.text, align: 'center' });
  s.rect(370, 132, 200, 18, '#000');
  s.rect(371, 133, Math.round(198 * g.board / 100), 16, g.board >= 40 ? '#1c8a1c' : C.orange);
  s.text(boardWord(g.board), 470, 156, { font: 'MY4', colour: C.yellow, align: 'center' });
  s.paragraph(`The board expect the club to finish about ${ordinal(expectedFinish(g))}. You are ${ordinal(pos)}.`, 370, 190, 220, 'MY3', C.text);
  s.doneBar('Done', () => go({ kind: 'menu' }));
}

// ------------------------------------------------------------------ saves

export function drawSaves(s: Screen, v: Extract<View, { kind: 'saves' }>) {
  const g = ui.game;
  s.background();
  s.titleBar('Saved Games');
  dateTag(s);
  s.panel(10, 60, 620, 350);
  const list = saves ?? [];
  const per = 16, pages = Math.ceil(list.length / per);
  s.text('The game saves itself as you play. Click a date to go back to it.', W / 2, 64, { font: 'MY2', colour: C.text, align: 'center' });
  list.slice(v.page * per, v.page * per + per).forEach((sv, i) => {
    const y = 86 + i * 20;
    const now = g && sv.date === g.date;
    s.text(longDate(sv.date), 20, y, { font: 'MY3', colour: now ? C.yellow : C.white });
    s.text(sv.club, 620, y, { font: 'MY3', colour: C.text, align: 'right' });
    s.area(10, y, 620, 20, { onClick: () => { v.confirm = sv.date; v.message = undefined; } });
  });
  if (!saves) s.text('Reading saves...', W / 2, 220, { font: 'MY4', colour: C.text, align: 'center' });
  else if (!list.length) s.text('No saves yet.', W / 2, 220, { font: 'MY4', colour: C.text, align: 'center' });
  pager(s, v.page, pages, p => { v.page = p; });
  s.button('Download\nSave File', 165, 414, 153, 30, g ? () => { exportSave(g); v.message = 'Save file downloaded.'; } : undefined);
  s.button('Load From\nFile', 320, 414, 153, 30, () => {
    importSave().then(loaded => {
      if (!loaded) { v.message = 'That is not a save file.'; ui.screen.render(); return; }
      resetMatchday();
      begin(loaded);
      autosaveNow();
      ui.screen.render();
    });
  });
  if (v.message) s.text(v.message, W / 2, 396, { font: 'MY2', colour: C.yellow, align: 'center' });
  s.doneBar('Done', () => go(g ? { kind: 'menu' } : { kind: 'title' }));
  if (v.confirm) {
    const date = v.confirm;
    s.area(0, 0, W, 480, { onClick: () => { v.confirm = undefined; } });
    s.rect(98, 168, 444, 140, '#000');
    s.rect(100, 170, 440, 136, C.boxBlue);
    s.text(`Go back to ${longDate(date)}?`, W / 2, 186, { font: 'MY4', colour: C.white, align: 'center' });
    if (g && date < g.date) s.text('Anything you have done since will be lost.', W / 2, 214, { font: 'MY2', colour: C.orange, align: 'center' });
    s.button('Yes', 120, 252, 190, 34, () => {
      v.confirm = undefined;
      loadSave(date).then(loaded => { resetMatchday(); begin(loaded); autosaveNow(); ui.screen.render(); }, () => { v.message = 'That save could not be read.'; ui.screen.render(); });
    }, { font: 'MY4' });
    s.button('No', 330, 252, 190, 34, () => { v.confirm = undefined; }, { font: 'MY4' });
  }
}

// ------------------------------------------------------------------ the day's results and the season's end

export function drawDayResults(s: Screen, v: Extract<View, { kind: 'dayResults' }>) {
  const g = game();
  const list = fixturesOn(g, g.date).filter(f => f.result).sort((a, b) => (a.comp === b.comp ? 0 : a.comp === 'PL' ? -1 : 1));
  const per = 18, pages = Math.ceil(list.length / per);
  s.background();
  s.titleBar(`Results: ${longDate(g.date)}`);
  dateTag(s);
  s.panel(10, 60, 620, 350);
  let lastComp = '';
  let y = 64;
  for (const f of list.slice(v.page * per, v.page * per + per)) {
    const name = COMP_NAMES[f.comp] + (f.comp === 'PL' ? '' : ` ${f.round}`);
    if (name !== lastComp) { s.text(name, W / 2, y, { font: 'MY2', colour: C.gold, align: 'center' }); y += 16; lastComp = name; }
    const hl = (id: string) => (id === g.humanClubId ? C.yellow : C.white);
    s.text(fit(g.teams[f.home].name, 240, 'MY2'), 290, y, { font: 'MY2', colour: hl(f.home), align: 'right' });
    s.text(fit(scoreLine(g, f), 100, 'MY2'), W / 2, y, { font: 'MY2', colour: C.cyan, align: 'center' });
    s.text(fit(g.teams[f.away].name, 240, 'MY2'), 350, y, { font: 'MY2', colour: hl(f.away) });
    y += 17;
  }
  if (!list.length) s.text('No other matches today.', W / 2, 220, { font: 'MY4', colour: C.text, align: 'center' });
  pager(s, v.page, pages, p => { v.page = p; });
  s.button('View\nTables', 165, 414, 310, 30, () => go({ kind: 'table', back: v }));
  s.doneBar('Done', () => go({ kind: 'menu' }));
}

export function drawOver(s: Screen) {
  const g = game();
  const table = leagueTable(g);
  const pos = table.findIndex(r => r.clubId === g.humanClubId) + 1;
  const me = g.teams[g.humanClubId];
  s.background();
  clubTitle(s, me.id, 'End Of Season');
  dateTag(s);
  s.panel(20, 70, 600, 330);
  s.text(`${me.name} finished ${ordinal(pos)}`, W / 2, 90, { font: 'MY6', colour: C.white, align: 'center' });
  s.text(`${g.teams[table[0].clubId].name} are champions.`, W / 2, 140, { font: 'MY4', colour: C.cyan, align: 'center' });
  const cupLine = (c: 'LC' | 'FAC') => g.cups[c].winner ? `${COMP_NAMES[c]}: ${g.teams[g.cups[c].winner!].name}` : '';
  s.text(cupLine('LC'), W / 2, 170, { font: 'MY3', colour: C.text, align: 'center' });
  s.text(cupLine('FAC'), W / 2, 190, { font: 'MY3', colour: C.text, align: 'center' });
  s.text(`The board are ${boardWord(g.board).toLowerCase()} (expected ${ordinal(expectedFinish(g))}).`, W / 2, 230, { font: 'MY3', colour: C.yellow, align: 'center' });
  s.paragraph('The next season is still to be built: for now the game ends here. Your saves stay, so you can go back to any date and play it again.', 60, 270, 520, 'MY3', C.text);
  s.button('Final\nTable', 10, 414, 153, 30, () => go({ kind: 'table', back: { kind: 'over' } }));
  s.button('Competition\nInfo', 165, 414, 153, 30, () => go({ kind: 'competitions' }));
  s.button('Save Game\n& Rewind', 320, 414, 153, 30, () => { refreshSaves(); go({ kind: 'saves', page: 0 }); });
  s.doneBar('Done', () => go({ kind: 'menu' }));
}
