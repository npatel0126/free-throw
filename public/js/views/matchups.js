// Defense vs position: what each team allows to guards, forwards and centers.

import { api, esc, heat, logo, num, signedPct } from '../ui.js';
import { MARKETS } from '/shared/math.js';

const state = { window: 'season', pos: 'G', sort: 'pts', dir: -1, tonight: false };
const COLS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'pra'];

export async function matchupsView(view, { isCurrent }) {
  const load = () => api(`/api/dvp${state.window === 'season' ? '' : `?window=${state.window}`}`);
  let data = await load();
  if (!isCurrent()) return;

  function render() {
    const entries = data.teams
      .map((t) => ({ team: t, row: data.rows[t.id], opp: data.matchups[t.id] }))
      .filter((e) => e.row && (!state.tonight || e.opp));
    entries.sort((a, b) => state.dir * ((a.row[state.pos][state.sort].per36 ?? 0) - (b.row[state.pos][state.sort].per36 ?? 0)));
    const windows = [['season', 'Season'], ['10', 'Last 10'], ['5', 'Last 5']];
    const positions = [['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centers']];
    const lg = data.leagueRates[state.pos];
    view.innerHTML = `
      <div class="page-head"><div><h1>Defense vs position</h1>
      <p class="sub">What each defense allows per 36 minutes, from ${data.games} box scores this season. Shading runs from tough to soft, and rank 30 is softest.</p></div></div>
      <div class="filters filter-row">
        <div class="chips" role="group" aria-label="Position">${positions.map(([k, l]) => `<button type="button" class="chip ${state.pos === k ? 'on' : ''}" data-pos="${k}" aria-pressed="${state.pos === k}">${l}</button>`).join('')}</div>
        <div class="chips" role="group" aria-label="Time window">${windows.map(([k, l]) => `<button type="button" class="chip ${state.window === k ? 'on' : ''}" data-window="${k}" aria-pressed="${state.window === k}">${l}</button>`).join('')}</div>
        <label class="check"><input id="tonight" type="checkbox" ${state.tonight ? 'checked' : ''}> Playing today only</label>
      </div>
      <div class="table-wrap"><table class="data dvp-table">
        <thead><tr><th scope="col" class="col-player">Defense</th><th scope="col">Today</th><th scope="col" class="num">GP</th>
        ${COLS.map((c) => `<th scope="col" class="num" ${state.sort === c ? `aria-sort="${state.dir > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" data-sort="${c}">${MARKETS[c].short}${state.sort === c ? `<span aria-hidden="true">${state.dir > 0 ? ' ▲' : ' ▼'}</span>` : ''}</button></th>`).join('')}</tr></thead>
        <tbody>
        ${entries
          .map(({ team, row, opp }) => `<tr>
            <th scope="row" class="col-player"><span class="team-cell"><img src="${logo(team.abbr)}" alt="" width="22" height="22" loading="lazy">${esc(team.short ?? team.name)}</span></th>
            <td class="muted">${opp ? `vs ${esc(opp.abbr)}` : ''}</td>
            <td class="num faint">${row.games}</td>
            ${COLS.map((c) => {
              const cell = row[state.pos][c];
              if (cell.per36 == null) return '<td class="num faint">—</td>';
              return `<td class="num" data-tip="Rank ${cell.rank} of 30 · ${signedPct(cell.vsLeague, 0)} vs league (${num(lg[c])})"><span class="pill" style="${heat(cell.rank / 30, 10)}">${num(cell.per36)}<small class="rank">${cell.rank}</small></span></td>`;
            }).join('')}
          </tr>`)
          .join('')}
        <tr class="total"><th scope="row" class="col-player">League average</th><td></td><td></td>${COLS.map((c) => `<td class="num">${num(lg[c])}</td>`).join('')}</tr>
        </tbody></table></div>
      <p class="note">ESPN only tags players as guard, forward or center, so a point guard and a shooting guard share a bucket. Early in the season these numbers rest on few games, and the projections regress them toward average for that reason.</p>`;
  }
  render();

  const onClick = async (e) => {
    const pos = e.target.closest('[data-pos]');
    if (pos) {
      state.pos = pos.dataset.pos;
      render();
      return;
    }
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      state.dir = state.sort === sort.dataset.sort ? -state.dir : -1;
      state.sort = sort.dataset.sort;
      render();
      return;
    }
    const win = e.target.closest('[data-window]');
    if (win) {
      state.window = win.dataset.window;
      data = await load();
      if (isCurrent()) render();
    }
  };
  const onChange = (e) => {
    if (e.target.id === 'tonight') {
      state.tonight = e.target.checked;
      render();
    }
  };
  view.addEventListener('click', onClick);
  view.addEventListener('change', onChange);
  return () => {
    view.removeEventListener('click', onClick);
    view.removeEventListener('change', onChange);
  };
}
