// Cheat sheets: pre-filtered views of the board. Every row is free.

import { empty, esc, fmtSlateDate, loading } from '../ui.js';
import { loadBoard, propTable, withSide } from '../boarddata.js';
import { impliedProb } from '/shared/math.js';
import { legFromRow, toggleLeg } from '../slip.js';

const l10 = (r) => r.sideRates.l10;

const SHEETS = {
  streaks: {
    name: 'Prop streaks',
    blurb: 'Players who have cleared the line on the same side at least 5 games in a row. Books see these too, so a streak is a place to start looking.',
    columns: ['player', 'prop', 'price', 'last10', 'streak', 'l5', 'l10', 'l20', 'season', 'h2h', 'dvp', 'ev', 'add'],
    build: (rows) =>
      rows
        .map((r) => withSide(r, r.streakOver >= r.streakUnder ? 'over' : 'under'))
        .filter((r) => r.sideStreak >= 5)
        .sort((a, b) => b.sideStreak - a.sideStreak),
  },
  soft: {
    name: 'Soft spots',
    blurb: 'Overs at least 60% over the last 10 games against one of the five softest defenses for that position and stat.',
    columns: ['player', 'prop', 'price', 'last10', 'dvp', 'l5', 'l10', 'l20', 'h2h', 'proj', 'ev', 'add'],
    build: (rows) =>
      rows
        .map((r) => withSide(r, 'over'))
        .filter((r) => r.dvpRank >= 26 && l10(r).n >= 5 && l10(r).rate >= 0.6)
        .sort((a, b) => b.dvpRank + l10(b).rate * 10 - (a.dvpRank + l10(a).rate * 10)),
  },
  tough: {
    name: 'Tough spots',
    blurb: 'Unders at least 60% over the last 10 games against one of the five toughest defenses for that position and stat.',
    columns: ['player', 'prop', 'price', 'last10', 'dvp', 'l5', 'l10', 'l20', 'h2h', 'proj', 'ev', 'add'],
    build: (rows) =>
      rows
        .map((r) => withSide(r, 'under'))
        .filter((r) => r.dvpRank != null && r.dvpRank <= 5 && l10(r).n >= 5 && l10(r).rate >= 0.6)
        .sort((a, b) => a.dvpRank - l10(a).rate * 10 - (b.dvpRank - l10(b).rate * 10)),
  },
  moved: {
    name: 'Line movement',
    blurb: 'Numbers that have changed since opening, with the biggest moves first. The side shown is the direction the line moved.',
    columns: ['player', 'prop', 'price', 'move', 'last10', 'l10', 'proj', 'ev', 'add'],
    build: (rows) =>
      rows
        .filter((r) => r.openLine != null && r.openLine !== r.line)
        .map((r) => withSide(r, r.line > r.openLine ? 'over' : 'under'))
        .sort((a, b) => Math.abs(b.line - b.openLine) / b.line - Math.abs(a.line - a.openLine) / a.line),
  },
  juice: {
    name: 'Price movement',
    blurb: 'The number held, but the price moved at least 4 percentage points of implied chance. The side shown is the one that got more expensive.',
    columns: ['player', 'prop', 'price', 'priceMove', 'last10', 'l10', 'proj', 'ev', 'add'],
    build: (rows) =>
      rows
        .filter((r) => r.openLine === r.line && r.openOver != null)
        .map((r) => ({ r, shift: impliedProb(r.over) - impliedProb(r.openOver) }))
        .filter(({ shift }) => Math.abs(shift) >= 0.04)
        .sort((a, b) => Math.abs(b.shift) - Math.abs(a.shift))
        .map(({ r, shift }) => withSide(r, shift > 0 ? 'over' : 'under')),
  },
  gaps: {
    name: 'Recent form gaps',
    blurb: "Lines furthest from the player's last-5 average. Recent form is often noise, and the market may know why a player's role changed.",
    columns: ['player', 'prop', 'price', 'last10', 'avg5', 'l5', 'l10', 'l20', 'proj', 'ev', 'add'],
    build: (rows) =>
      rows
        .filter((r) => r.rates.l5.n === 5 && r.line >= 4.5)
        .map((r) => withSide(r, r.rates.l5.avg > r.line ? 'over' : 'under'))
        .sort((a, b) => Math.abs(b.rates.l5.avg - b.line) / b.line - Math.abs(a.rates.l5.avg - a.line) / a.line)
        .slice(0, 60),
  },
  ev: {
    name: 'Model leans',
    blurb: 'Every prop with a positive estimate. The backtest has not shown these beat the closing line, so treat this as a shortlist to research.',
    columns: ['player', 'prop', 'price', 'last10', 'est', 'ev', 'proj', 'l10', 'l20', 'dvp', 'add'],
    build: (rows) =>
      rows
        .map((r) => withSide(r))
        .filter((r) => r.sideEv > 0)
        .sort((a, b) => b.sideEv - a.sideEv),
  },
};

let current = 'streaks';

export async function sheetsView(view, { params, isCurrent }) {
  const res = await loadBoard((p) => {
    view.innerHTML = loading(p);
  }, isCurrent);
  if (!res || !isCurrent()) return;
  const data = res.data;
  if (SHEETS[params.get('s')]) current = params.get('s');

  const render = () => {
    const sheet = SHEETS[current];
    const rows = sheet.build(data.rows);
    view.innerHTML = `
      <div class="page-head"><div><h1>Cheat sheets</h1><p class="sub">${esc(fmtSlateDate(data.date))} · every row is free</p></div></div>
      <div class="tabs" role="tablist">
        ${Object.entries(SHEETS).map(([k, s]) => `<button type="button" role="tab" aria-selected="${k === current}" class="tab ${k === current ? 'on' : ''}" data-sheet="${k}">${esc(s.name)} <small>${s.build(data.rows).length}</small></button>`).join('')}
      </div>
      <p class="sheet-blurb">${esc(sheet.blurb)}</p>
      ${rows.length ? propTable(rows, sheet.columns) : empty('Nothing qualifies right now', 'This sheet fills in as lines move and more games are posted.')}`;
  };
  render();

  const onClick = (e) => {
    const tab = e.target.closest('[data-sheet]');
    if (tab) {
      current = tab.dataset.sheet;
      render();
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const [athlete, market, side] = add.dataset.add.split('|');
      const r = SHEETS[current].build(data.rows).find((x) => x.key === `${athlete}|${market}` && x.sideName === side);
      if (r) toggleLeg(legFromRow(r));
      return;
    }
    const row = e.target.closest('tr[data-row]');
    if (row && !e.target.closest('a,button')) {
      const [id, m] = row.dataset.row.split('|');
      location.hash = `#/player/${id}?m=${m}`;
    }
  };
  const onSlip = () => render();
  view.addEventListener('click', onClick);
  document.addEventListener('slipchange', onSlip);
  return () => {
    view.removeEventListener('click', onClick);
    document.removeEventListener('slipchange', onSlip);
  };
}
