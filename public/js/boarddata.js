// Shared access to the props board, used by the Props and Cheat Sheets pages,
// plus the table renderer both of them draw with.

import { api, esc, heat, injuryBadge, num, pct, price, signedPct, fmtTime, logo, teamRail } from './ui.js';
import { MARKETS } from '/shared/math.js';
import { inSlip } from './slip.js';
import { miniBars } from './charts.js';

// Polls while the server is building and resolves once a board exists.
export async function loadBoard(onProgress, isCurrent) {
  for (;;) {
    const res = await api('/api/board');
    if (res.data) return res;
    if (res.error && !res.building) throw new Error(res.error);
    onProgress(res.progress);
    await new Promise((r) => setTimeout(r, 1500));
    if (!isCurrent()) return null;
  }
}

// Fixes a row to one side and pre-computes what the columns show for that side.
export function withSide(r, side = r.side) {
  const over = side === 'over';
  const rates = {};
  for (const [k, v] of Object.entries(r.rates)) rates[k] = { n: v.n, rate: over ? v.over : v.under, avg: v.avg };
  return {
    ...r,
    sideName: side,
    sidePrice: over ? r.over : r.under,
    sideProb: over ? r.probOver : r.probUnder,
    sideFair: over ? r.fairOver : r.fairUnder,
    sideEv: over ? r.evOver : r.evUnder,
    sideStreak: over ? r.streakOver : r.streakUnder,
    sideRates: rates,
    gap: r.proj - r.line,
  };
}

const rateCell = (rate, label, tipName) => {
  if (!rate || !rate.n) return `<td class="num center" data-label="${label}"><span class="pill pill-empty">—</span></td>`;
  const hits = Math.round(rate.rate * rate.n);
  const text = rate.n < 5 ? `${hits}/${rate.n}` : pct(rate.rate);
  return `<td class="num center" data-label="${label}" data-tip="${tipName}: ${hits} of ${rate.n} games · avg ${num(rate.avg)}"><span class="pill" style="${heat(rate.rate, rate.n)}">${text}</span></td>`;
};

const COLUMNS = {
  player: {
    label: 'Player',
    cls: 'col-player',
    sort: 'name',
    cell: (r) => `<td class="col-player"><a class="player-cell" href="#/player/${esc(r.athleteId)}?m=${r.market}">
        <i class="rail" style="--rail:${teamRail(r.teamColor, r.teamAlt)}"></i>
        <img src="${esc(r.headshot || logo(r.team))}" alt="" loading="lazy" width="44" height="44">
        <span><strong>${esc(r.name)}</strong> ${injuryBadge(r.injury)}
        <small>${esc(r.pos)} · ${esc(r.team)} ${r.home ? 'vs' : '@'} ${esc(r.opp)} · ${fmtTime(r.start)}</small></span></a></td>`,
  },
  prop: {
    label: 'Prop',
    cell: (r) => {
      const move = r.openLine != null && r.openLine !== r.line
        ? `<small class="moved">was ${esc(r.openLine)}</small>`
        : '';
      return `<td class="col-prop"><div class="prop-line"><span class="side side-${r.sideName}" aria-label="${r.sideName}">${r.sideName === 'over' ? 'O' : 'U'}</span><b>${esc(r.line)}</b><span class="mkt">${MARKETS[r.market].short}</span></div>${move}<small class="prop-price">${price(r.sidePrice)}</small></td>`;
    },
  },
  price: {
    label: 'Price',
    numeric: true,
    tip: 'DraftKings price for this side',
    sort: 'sidePrice',
    cell: (r) => `<td class="num col-price" data-tip="Over ${price(r.over)} · Under ${price(r.under)}">${price(r.sidePrice)}</td>`,
  },
  last10: {
    label: 'Last 10',
    center: true,
    tip: 'Each bar is a game, oldest to newest. Teal hit this side and red missed. The line is the prop number.',
    cell: (r) => `<td class="center col-last10" data-label="Last 10" data-tip="Last ${r.recent.length} games, oldest first: ${r.recent.join(', ')}">${miniBars(r.recent, r.line, r.sideName)}</td>`,
  },
  proj: {
    label: 'Model',
    numeric: true,
    tip: 'Our own stat projection before blending with the market',
    sort: 'gap',
    cell: (r) => `<td class="num" data-label="Model">${num(r.proj)}<small class="delta">${r.gap >= 0 ? '+' : '−'}${Math.abs(r.gap).toFixed(1)}</small></td>`,
  },
  est: {
    label: 'Est.',
    numeric: true,
    tip: 'Estimated chance this side wins: 15% model, 85% market',
    sort: 'sideProb',
    cell: (r) => `<td class="num" data-label="Est." data-tip="Market's no-vig chance: ${pct(r.sideFair, 1)}">${pct(r.sideProb, 1)}</td>`,
  },
  ev: {
    label: 'Est. EV',
    numeric: true,
    tip: 'Estimated profit per $1 at this price. See Track Record for how far to trust it.',
    sort: 'sideEv',
    cell: (r) => `<td class="num ${r.sideEv > 0 ? 'ev-pos' : 'faint'}" data-label="Est. EV" data-tip="Estimated chance: ${pct(r.sideProb, 1)} · market's no-vig chance: ${pct(r.sideFair, 1)}">${signedPct(r.sideEv)}</td>`,
  },
  l5: { label: 'L5', center: true, tip: 'Hit rate for this side, last 5 games', sort: 'l5', cell: (r) => rateCell(r.sideRates.l5, 'L5', 'Last 5') },
  l10: { label: 'L10', center: true, tip: 'Last 10 games', sort: 'l10', cell: (r) => rateCell(r.sideRates.l10, 'L10', 'Last 10') },
  l20: { label: 'L20', center: true, tip: 'Last 20 games, reaching into last season early on', sort: 'l20', cell: (r) => rateCell(r.sideRates.l20, 'L20', 'Last 20') },
  season: { label: 'Szn', center: true, tip: 'This season', sort: 'season', cell: (r) => rateCell(r.sideRates.season, 'Szn', 'This season') },
  h2h: { label: 'H2H', center: true, tip: 'Against this opponent, this season and last', sort: 'h2h', cell: (r) => rateCell(r.sideRates.h2h, 'H2H', `Vs ${esc(r.opp)}`) },
  streak: {
    label: 'Streak',
    center: true,
    tip: 'Straight games this side has cleared the line',
    sort: 'sideStreak',
    cell: (r) => `<td class="num center ${r.sideStreak >= 5 ? 'streak-hot' : r.sideStreak >= 3 ? '' : 'faint'}" data-label="Streak">${r.sideStreak}</td>`,
  },
  dvp: {
    label: 'DvP',
    center: true,
    tip: `Opponent's rank against this position: 1 is toughest, 30 softest. Teal means the matchup helps this side.`,
    sort: 'dvpRank',
    cell: (r) => {
      if (r.dvpRank == null) return '<td class="num center" data-label="DvP"><span class="pill pill-empty">—</span></td>';
      // Shade by whether the matchup helps this side: a soft defense hurts an under.
      const helps = r.sideName === 'over' ? r.dvpRank / 30 : 1 - r.dvpRank / 30;
      return `<td class="num center" data-label="DvP" data-tip="${esc(r.opp)} allows ${num(r.dvpPer36)} ${MARKETS[r.market].short} per 36 to ${esc(r.pos)}s (${signedPct(r.dvpVs, 0)} vs league)"><span class="pill" style="${heat(helps, 10)}">${r.dvpRank}</span></td>`;
    },
  },
  move: {
    label: 'Open → Now',
    numeric: true,
    cell: (r) => `<td class="num col-wide" data-label="Open → Now">${esc(r.openLine ?? '—')} → ${esc(r.line)}</td>`,
  },
  priceMove: {
    label: 'Over price',
    numeric: true,
    cell: (r) => `<td class="num col-wide" data-label="Over price">${price(r.openOver)} → ${price(r.over)}</td>`,
  },
  avg5: {
    label: 'L5 avg',
    numeric: true,
    cell: (r) => `<td class="num" data-label="L5 avg">${num(r.rates.l5.avg)}</td>`,
  },
  add: {
    label: '',
    cell: (r) => {
      const on = inSlip({ athleteId: r.athleteId, market: r.market, side: r.sideName, line: r.line });
      return `<td class="col-add"><button type="button" class="add-btn ${on ? 'on' : ''}" data-add="${esc(r.key)}|${r.sideName}" aria-pressed="${on}" aria-label="${on ? 'Remove from' : 'Add to'} slip: ${esc(r.name)} ${r.sideName} ${esc(r.line)} ${MARKETS[r.market].label}">${on ? '✓' : '+'}</button></td>`;
    },
  },
};

export const sortValue = (r, key) => {
  if (['l5', 'l10', 'l20', 'season', 'h2h'].includes(key)) {
    const v = r.sideRates[key];
    return v?.n ? v.rate : -1;
  }
  return r[key];
};

export function propTable(rows, columns, sort) {
  const head = columns
    .map((c) => {
      const col = COLUMNS[c];
      const active = sort && sort.key === col.sort;
      const inner = sort && col.sort
        ? `<button type="button" data-sort="${col.sort}">${col.label}${active ? `<span aria-hidden="true">${sort.dir > 0 ? ' ▲' : ' ▼'}</span>` : ''}</button>`
        : col.label;
      const aria = active ? ` aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : '';
      const align = col.numeric ? 'num' : col.center ? 'center' : '';
      return `<th scope="col" class="${align} ${col.cls ?? ''}"${col.tip ? ` data-tip="${esc(col.tip)}"` : ''}${aria}>${inner}</th>`;
    })
    .join('');
  const body = rows
    .map((r) => `<tr data-row="${esc(r.key)}">${columns.map((c) => COLUMNS[c].cell(r)).join('')}</tr>`)
    .join('');
  return `<div class="table-wrap"><table class="data props-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
