// Tonight's slate: lines, implied scores and injury reports for each game.

import { api, empty, esc, fmtSlateDate, matchupCard } from '../ui.js';

const isReportable = (i) => !/^active$/i.test(i.status || '');

function injuryList(team, list) {
  const rows = list.filter(isReportable);
  if (!rows.length) return `<div class="inj-col"><h4>${esc(team.abbr)}</h4><p class="muted">None reported</p></div>`;
  return `<div class="inj-col"><h4>${esc(team.abbr)}</h4><ul>${rows
    .map((i) => `<li data-tip="${esc(esc(i.note))}"><a href="#/player/${esc(i.id)}">${esc(i.name)}</a> <small class="${/out/i.test(i.status) ? 'status-out' : 'status-q'}">${esc(i.status)}</small></li>`)
    .join('')}</ul></div>`;
}

export async function gamesView(view, { isCurrent }) {
  const { date, games } = await api('/api/slate');
  if (!isCurrent()) return;
  if (!games.length) {
    view.innerHTML = empty('No games scheduled', 'Check back when the next slate is posted.');
    return;
  }
  view.innerHTML = `
    <div class="page-head"><h1>Games</h1><p class="sub">${esc(fmtSlateDate(date))} · ${games.length} ${games.length === 1 ? 'game' : 'games'}</p></div>
    <div class="game-grid">
      ${games
        .map((g) => {
          const reported = g.awayInjuries.filter(isReportable).length + g.homeInjuries.filter(isReportable).length;
          return `<article class="card game-card">
            ${matchupCard(g)}
            <details><summary>Injury report (${reported})</summary><div class="inj-grid">${injuryList(g.away, g.awayInjuries)}${injuryList(g.home, g.homeInjuries)}</div></details>
          </article>`;
        })
        .join('')}
    </div>`;
}
