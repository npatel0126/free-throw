// Hand-built SVG charts. Every bar and dot has a hover tooltip through data-tip,
// and the game log below the hit chart is its table view.

import { esc, fmtDay, pct } from './ui.js';
import { statOf, MARKETS } from '/shared/math.js';

const niceMax = (v) => {
  if (v <= 4) return Math.max(v, 2);
  const step = v <= 10 ? 2 : v <= 25 ? 5 : v <= 60 ? 10 : 20;
  return Math.ceil(v / step) * step;
};

export function hitChart(games, market, line, width) {
  if (!games.length) return '<p class="muted chart-empty">No games match this filter.</p>';
  const list = [...games].reverse(); // oldest on the left, so it reads forward in time
  const values = list.map((g) => statOf(g, market));
  const height = 290;
  const m = { top: 26, right: 50, bottom: 38, left: 30 };
  const plotW = Math.max(120, width - m.left - m.right);
  const plotH = height - m.top - m.bottom;
  const yMax = niceMax(Math.max(...values, line + 1));
  const y = (v) => m.top + plotH - (v / yMax) * plotH;
  const band = plotW / list.length;
  const barW = Math.max(2, Math.min(44, band - 4));
  const showValues = band >= 18;
  const labelEvery = band >= 40 ? 1 : Math.ceil(40 / band);

  const ticks = [0, yMax / 2, yMax]
    .map((t) => `<line x1="${m.left}" x2="${m.left + plotW}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
      <text x="${m.left - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${Number.isInteger(t) ? t : t.toFixed(1)}</text>`)
    .join('');

  const bars = list
    .map((g, i) => {
      const v = values[i];
      const cx = m.left + band * i + band / 2;
      const x = cx - barW / 2;
      const top = y(v);
      const h = y(0) - top;
      const paint = v > line ? 'fill="url(#bar-over)"' : v < line ? 'fill="url(#bar-under)"' : 'class="bar-push"';
      const r = Math.min(7, barW / 2, h);
      const path = h > 0
        ? `M${x},${y(0)}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${y(0)}Z`
        : '';
      const tip = esc(`<strong>${fmtDay(g.date)} ${g.home ? 'vs' : '@'} ${esc(g.oppAbbr)}</strong><br>${v} ${MARKETS[market].short} · ${g.min} min<br>${v > line ? 'Over' : v < line ? 'Under' : 'Push'} ${line}${g.score ? ` · ${esc(g.result)} ${esc(g.score)}` : ''}`);
      return `<g data-tip="${tip}">
        <rect x="${m.left + band * i}" y="${m.top}" width="${band}" height="${plotH + m.bottom}" fill="transparent"/>
        ${path ? `<path d="${path}" ${paint}/>` : `<line x1="${x}" x2="${x + barW}" y1="${y(0)}" y2="${y(0)}" class="zero-bar"/>`}
        ${showValues ? `<text x="${cx}" y="${top - 6}" class="val" text-anchor="middle">${v}</text>` : ''}
        ${i % labelEvery === 0 ? `<text x="${cx}" y="${height - 20}" class="axis-strong" text-anchor="middle">${g.home ? '' : '@'}${esc(g.oppAbbr)}</text><text x="${cx}" y="${height - 5}" class="axis" text-anchor="middle">${new Date(g.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</text>` : ''}
      </g>`;
    })
    .join('');

  const label = String(line);
  const chipW = label.length * 8 + 12;
  return `<div class="legend" aria-hidden="true"><span><i class="swatch swatch-over"></i>Over the line</span><span><i class="swatch swatch-under"></i>Under the line</span></div>
    <svg class="hit-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(MARKETS[market].label)} in ${list.length} games against a line of ${line}. Exact values are in the game log below.">
      <defs>
        <linearGradient id="bar-over" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17d3bc"/><stop offset="0.55" stop-color="#0ea896"/><stop offset="1" stop-color="#0a7a70"/></linearGradient>
        <linearGradient id="bar-under" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a85"/><stop offset="0.55" stop-color="#f7486a"/><stop offset="1" stop-color="#a82c4a"/></linearGradient>
      </defs>
      ${ticks}
      ${bars}
      <line x1="${m.left}" x2="${m.left + plotW}" y1="${y(line)}" y2="${y(line)}" class="threshold"/>
      <rect x="${m.left + plotW + 2}" y="${y(line) - 11}" width="${chipW}" height="22" rx="6" class="threshold-chip"/>
      <text x="${m.left + plotW + 2 + chipW / 2}" y="${y(line) + 5}" class="threshold-label" text-anchor="middle">${label}</text>
    </svg>`;
}

// A row-sized version of the hit chart, colored by whether each game hit the side shown.
export function miniBars(values, line, side, width = 116, height = 32) {
  const slots = 10;
  const shown = values.slice(-slots);
  const max = Math.max(...shown, line * 1.25, 1);
  const step = width / slots;
  const barW = step * 0.72;
  const offset = slots - shown.length;
  const bars = shown
    .map((v, i) => {
      const hit = side === 'over' ? v > line : v < line;
      const h = Math.max(2, (v / max) * height);
      return `<rect x="${((i + offset) * step).toFixed(1)}" y="${(height - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" class="${hit ? 'hit' : 'miss'}"/>`;
    })
    .join('');
  const ly = (height - (line / max) * height).toFixed(1);
  return `<svg class="mini-bars" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${bars}<line x1="0" x2="${width}" y1="${ly}" y2="${ly}"/></svg>`;
}

// Predicted vs actual over rate, with the diagonal as perfect calibration.
export function calibrationChart(points, width) {
  const size = Math.min(width, 440);
  const m = { top: 12, right: 12, bottom: 42, left: 46 };
  const plot = size - m.left - m.right;
  const lo = 0.2;
  const hi = 0.8;
  const pos = (v) => (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo);
  const x = (v) => m.left + pos(v) * plot;
  const y = (v) => m.top + plot - pos(v) * plot;
  const ticks = [0.2, 0.35, 0.5, 0.65, 0.8];
  const grid = ticks
    .map((t) => `<line x1="${x(t)}" x2="${x(t)}" y1="${m.top}" y2="${m.top + plot}" class="grid"/>
      <line x1="${m.left}" x2="${m.left + plot}" y1="${y(t)}" y2="${y(t)}" class="grid"/>
      <text x="${x(t)}" y="${m.top + plot + 16}" class="axis" text-anchor="middle">${Math.round(t * 100)}%</text>
      <text x="${m.left - 6}" y="${y(t) + 4}" class="axis" text-anchor="end">${Math.round(t * 100)}%</text>`)
    .join('');
  const dots = points
    .map((p) => {
      const r = Math.max(4, Math.min(11, Math.sqrt(p.n) / 3));
      return `<circle cx="${x(p.predicted)}" cy="${y(p.actual)}" r="${r}" class="dot" tabindex="0" data-tip="${esc(`Predicted ${pct(p.predicted, 1)} over<br>Actually hit ${pct(p.actual, 1)}<br>${p.n.toLocaleString()} props`)}"/>`;
    })
    .join('');
  return `<svg class="cal-chart" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Calibration: predicted chance of the over against how often it actually hit. The table beside this chart lists the same results.">
    ${grid}
    <line x1="${x(lo)}" y1="${y(lo)}" x2="${x(hi)}" y2="${y(hi)}" class="diagonal"/>
    ${dots}
    <text x="${m.left + plot / 2}" y="${size - 6}" class="axis" text-anchor="middle">Predicted chance of over</text>
    <text transform="translate(12 ${m.top + plot / 2}) rotate(-90)" class="axis" text-anchor="middle">Actual over rate</text>
  </svg>`;
}
