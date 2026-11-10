// Track Record: how the model has really done against real lines this season.

import { api, empty, esc, fmtDay, loading, pct, signedPct } from '../ui.js';
import { calibrationChart } from '../charts.js';

function verdict(r) {
  const row = r.closing.find((x) => x.threshold === 0.02);
  if (!row?.n) return { title: 'Not enough bets to judge yet', body: 'The model has flagged too few props so far.' };
  const interval = `between ${signedPct(row.ci.low)} and ${signedPct(row.ci.high)}`;
  if (row.ci.low > 0) {
    return {
      title: 'Early signs of an edge, on a small sample',
      body: `Props the model rated at +2% or better returned ${signedPct(row.roi)} against closing lines. The likely true figure is ${interval}. A few weeks of results can still flatter a model, so keep checking this page.`,
    };
  }
  return {
    title: 'No proven edge yet',
    body: `Props the model rated at +2% or better returned ${signedPct(row.roi)} against closing lines, and the likely true figure is ${interval}. That range includes losing money, so these estimates are a research aid, not a reason to bet.`,
  };
}

const rowsFor = (rows) =>
  rows
    .map((r) => `<tr><th scope="row">+${Math.round(r.threshold * 100)}% or better</th>
      <td class="num">${r.n.toLocaleString()}</td><td class="num">${pct(r.winPct, 1)}</td><td class="num">${signedPct(r.roi)}</td>
      <td class="num faint">${r.ci ? `${signedPct(r.ci.low, 0)} to ${signedPct(r.ci.high, 0)}` : '—'}</td></tr>`)
    .join('');

const roiTable = (rows) => `<div class="table-wrap"><table class="data compact">
  <thead><tr><th scope="col">Estimated EV</th><th scope="col" class="num">Bets</th><th scope="col" class="num">Won</th><th scope="col" class="num">ROI</th><th scope="col" class="num">90% range</th></tr></thead>
  <tbody>${rowsFor(rows)}</tbody></table></div>`;

export async function recordView(view, { isCurrent }) {
  let res = await api('/api/record');
  while (!res.data && res.building && isCurrent()) {
    view.innerHTML = loading('Replaying this season against real lines. This takes about a minute the first time.');
    await new Promise((r) => setTimeout(r, 2500));
    res = await api('/api/record');
  }
  if (!isCurrent()) return;
  if (!res.data) {
    view.innerHTML = empty('Track record unavailable', res.error || 'Finished games with saved lines could not be loaded.');
    return;
  }
  const r = res.data;
  const v = verdict(r);
  const points = r.calibration.filter((c) => c.n >= 30);

  view.innerHTML = `
    <div class="page-head"><div><h1>Track record</h1>
      <p class="sub">${r.samples.toLocaleString()} DraftKings props from ${r.gamesTested} games, ${fmtDay(r.firstDate)} to ${fmtDay(r.lastDate)}. Each forecast used only the games played before it.</p></div></div>

    <section class="card verdict"><h2>${esc(v.title)}</h2><p>${esc(v.body)}</p></section>

    <div class="tiles">
      <div class="tile"><span>Market's forecast error</span><b class="mono">${r.logLoss.market.toFixed(4)}</b><small>Log loss of DraftKings' no-vig prices. Lower is better.</small></div>
      <div class="tile"><span>Blended forecast error</span><b class="mono">${r.logLoss.blend.toFixed(4)}</b><small>${Math.round(r.weight * 100)}% model and ${Math.round((1 - r.weight) * 100)}% market.</small></div>
      <div class="tile"><span>Model-only forecast error</span><b class="mono">${r.logLoss.modelOnly.toFixed(4)}</b><small>Why the app doesn't use the model on its own.</small></div>
      <div class="tile"><span>Overs that hit</span><b class="mono">${pct(r.blind.over.winPct, 1)}</b><small>Betting every over returned ${signedPct(r.blind.over.roi)}; every under, ${signedPct(r.blind.under.roi)}.</small></div>
    </div>

    <div class="two-col">
      <section class="card">
        <h2>Against closing lines</h2>
        <p class="muted">Flat $1 on the better side of each prop the model rated at this level or better.</p>
        ${roiTable(r.closing)}
      </section>
      <section class="card">
        <h2>Against opening lines</h2>
        <p class="muted">Softer than closing lines, but you can't always get these prices or bet them at any size.</p>
        ${roiTable(r.opening)}
      </section>
    </div>

    <div class="two-col">
      <section class="card">
        <h2>Are the probabilities honest?</h2>
        <p class="muted">Dots on the diagonal mean that when we say 55%, it hits 55% of the time. Bigger dots hold more props.</p>
        <div id="cal" class="chart-host"></div>
      </section>
      <section class="card">
        <h2>Calibration results</h2>
        <div class="table-wrap"><table class="data compact">
          <thead><tr><th scope="col" class="num">Predicted over</th><th scope="col" class="num">Actual over</th><th scope="col" class="num">Props</th></tr></thead>
          <tbody>${points.map((c) => `<tr><td class="num">${pct(c.predicted, 1)}</td><td class="num">${pct(c.actual, 1)}</td><td class="num">${c.n.toLocaleString()}</td></tr>`).join('')}</tbody>
        </table></div>
        <h3>First half vs second half, +2% or better</h3>
        <p class="muted">First: ${r.halves.first.n} bets, ${signedPct(r.halves.first.roi)}. Second: ${r.halves.second.n} bets, ${signedPct(r.halves.second.roi)}. A big swing between halves is a sign of noise.</p>
        <h3>By side, +2% or better</h3>
        <p class="muted">Overs: ${r.sides.over.n} bets, ${signedPct(r.sides.over.roi)}. Unders: ${r.sides.under.n} bets, ${signedPct(r.sides.under.roi)}.</p>
      </section>
    </div>

    <section class="card">
      <h2>What this test can't tell you</h2>
      <ul class="plain-list">
        <li>It covers only a few weeks of one season, and props in the same game move together, so the true sample is smaller than the bet count suggests.</li>
        <li>Prices are the last ones ESPN kept for each game, which may not be the exact closing number.</li>
        <li>Your book may limit you, or offer a worse price than the one tested here.</li>
        <li>Player absences aren't in the model, so the market is often ahead of it when a teammate is ruled out. The player page's "Without" filters help you check those by hand.</li>
      </ul>
    </section>`;
  const host = document.getElementById('cal');
  host.innerHTML = calibrationChart(points, host.clientWidth || 400);
}
