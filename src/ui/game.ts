// The game: CM 97/98's screens over a 2026/27 season. Pick a Premier League
// club, then play day by day from the main menu. Everything is drawn on one
// 640x480 canvas; state.ts holds the screen on show and the game.

import {
  drawConfirm, drawInfo, drawMatch, drawMatchday, drawProfile, drawResult, drawSquad, drawTacticsView, matchKey,
} from './matchday';
import {
  drawBid, drawCompetitions, drawCup, drawDayResults, drawFinances, drawFixtures, drawMenu, drawNews, drawNewsList,
  drawOffer, drawOver, drawPickClub, drawSaves, drawScorers, drawSearch, drawTable, drawTerms, drawTitle,
  drawTransfersList, refreshSaves,
} from './screens';
import { Screen } from './retro/screen';
import { ui } from './state';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const backdrop: { image: HTMLImageElement | undefined } = { image: undefined };
const screen = new Screen(canvas, backdrop);
ui.screen = screen;
// Keys only reach the page once it has focus, which an embedded page lacks until clicked.
canvas.addEventListener('pointerdown', () => window.focus());

const photo = window.CM_ASSETS?.backdrops.BOBBY;
if (photo) {
  const img = new Image();
  img.onload = () => { backdrop.image = img; screen.render(); };
  img.src = photo;
}

screen.draw = s => {
  const v = ui.view;
  switch (v.kind) {
    case 'title': return drawTitle(s);
    case 'pickClub': return drawPickClub(s);
    case 'menu': return drawMenu(s);
    case 'news': return drawNews(s);
    case 'newsList': return drawNewsList(s, v);
    case 'competitions': return drawCompetitions(s);
    case 'table': return drawTable(s, v);
    case 'fixtures': return drawFixtures(s, v);
    case 'cup': return drawCup(s, v);
    case 'scorers': return drawScorers(s, v);
    case 'transfersList': return drawTransfersList(s, v);
    case 'squad': return drawSquad(s, v);
    case 'profile': return drawProfile(s, v);
    case 'search': return drawSearch(s, v);
    case 'bid': return drawBid(s, v);
    case 'terms': return drawTerms(s, v);
    case 'offer': return drawOffer(s, v);
    case 'finances': return drawFinances(s);
    case 'saves': return drawSaves(s, v);
    case 'matchday': return drawMatchday(s);
    case 'tactics': return drawTacticsView(s, v);
    case 'confirm': return drawConfirm(s);
    case 'match': return drawMatch(s);
    case 'info': return drawInfo(s, v.tab);
    case 'result': return drawResult(s);
    case 'dayResults': return drawDayResults(s, v);
    case 'over': return drawOver(s);
  }
};

document.addEventListener('keydown', e => {
  if (matchKey(e)) { e.preventDefault(); screen.render(); }
});

// A screen that changes the view while drawing (say, news with nothing left) draws again.
const render = screen.render.bind(screen);
screen.render = () => {
  for (let i = 0; i < 3; i++) {
    const before = ui.view;
    render();
    if (ui.view === before) break;
  }
};

refreshSaves();
screen.render();

// For poking at the game from the browser console.
(window as unknown as { cm: typeof ui }).cm = ui;
