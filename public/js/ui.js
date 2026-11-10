// Small helpers shared by every view.

import { fmtAmerican } from '/shared/math.js';

export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function api(path) {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong loading this page.');
  return data;
}

export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const signedPct = (x, d = 1) =>
  x == null || Number.isNaN(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;
export const num = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : Number(x).toFixed(d));
export const price = fmtAmerican;

export const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const fmtDay = (iso) =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
export const fmtSlateDate = (date) =>
  new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

export const logo = (abbr) => `https://a.espncdn.com/i/teamlogos/nba/500/${String(abbr).toLowerCase()}.png`;

export function ago(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  return `${Math.round(min / 60)} hr ago`;
}

export const loading = (msg = 'Loading') =>
  `<div class="state"><div class="spinner" aria-hidden="true"></div><p>${esc(msg)}</p></div>`;
export const errorState = (msg) =>
  `<div class="state"><h2>This page couldn't load</h2><p>${esc(msg)}</p><button class="btn" data-retry type="button">Try again</button></div>`;
export const empty = (title, body = '') =>
  `<div class="state"><h2>${esc(title)}</h2>${body ? `<p>${esc(body)}</p>` : ''}</div>`;

// Hit-rate shading: diverges around 50% in the two chart hues, and fades out on
// tiny samples so one lucky game can't look like a strong signal.
export function heat(value, n = 10) {
  if (value == null) return '';
  const strength = Math.min(0.6, 0.14 + Math.abs(value - 0.5) * 1.25);
  const trust = Math.min(n / 5, 1);
  const color = value >= 0.5 ? '--over-rgb' : '--under-rgb';
  return `background:rgb(var(${color}) / ${(strength * trust).toFixed(3)})`;
}

const luminance = (hex) => {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const validColor = (c) => /^[0-9a-f]{6}$/i.test(c || '');

const isNeutral = (hex) => hex.slice(0, 2) === hex.slice(2, 4) && hex.slice(2, 4) === hex.slice(4, 6);
const lighten = (hex, amount) =>
  [0, 2, 4]
    .map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16);
      return Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
    })
    .join('');

// A team color that reads as a background behind white text on our navy. Bright
// primaries give way to the team's second color, near-black navies get lifted so
// they stand out from the page, and pure black teams use a dark silver.
export function teamFill(color, alt) {
  for (const c of [color, alt]) {
    if (!validColor(c) || isNeutral(c)) continue;
    const l = luminance(c);
    if (l > 0.3) continue;
    return `#${l < 0.025 ? lighten(c, 0.22) : c}`;
  }
  return '#6b7380';
}

// A team color bright enough to use as a thin accent line.
export function teamRail(color, alt) {
  const usable = [color, alt].find((c) => validColor(c) && luminance(c) > 0.12);
  return usable ? `#${usable}` : '#a7aeb6';
}

export const ordinal = (n) => {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
};

// A game's card: tip time, teams and lines before the game, the score once it starts.
export function matchupCard(g, { tag = 'div', attrs = '', on = false } = {}) {
  const started = g.state && g.state !== 'pre';
  const spread = g.spread == null ? '—' : g.spread === 0 ? 'Even' : `${g.spread < 0 ? g.home.abbr : g.away.abbr} -${Math.abs(g.spread)}`;
  const team = (t) => `<img src="${logo(t.abbr)}" alt="" width="44" height="44" loading="lazy"><span>${esc(t.abbr)}</span>`;
  const middle = started
    ? `<div class="matchup-tip"><b class="${g.state === 'in' ? 'live' : ''}">${esc(g.statusText)}</b></div>`
    : `<div class="matchup-tip"><b>${fmtTime(g.start)}</b><small>Tip</small></div>`;
  const stats = started
    ? `<div class="matchup-stats"><div><small>${esc(g.away.abbr)}</small><b class="matchup-score">${esc(g.away.score ?? '')}</b></div><div><small>${esc(g.home.abbr)}</small><b class="matchup-score">${esc(g.home.score ?? '')}</b></div></div>`
    : `<div class="matchup-stats">
        <div><small>Spread</small><b>${esc(spread)}</b></div>
        <div><small>Total</small><b>${esc(g.total ?? '—')}</b></div>
        <div><small>Implied</small><b>${num(g.impliedAway)}–${num(g.impliedHome)}</b></div>
      </div>`;
  return `<${tag} class="matchup ${on ? 'on' : ''}" style="--a:${teamFill(g.away.color, g.away.alt)};--b:${teamFill(g.home.color, g.home.alt)}" ${attrs}>
    <div class="matchup-teams"><div class="matchup-team">${team(g.away)}</div>${middle}<div class="matchup-team"><span>${esc(g.home.abbr)}</span><img src="${logo(g.home.abbr)}" alt="" width="44" height="44" loading="lazy"></div></div>
    ${stats}
  </${tag}>`;
}

const tip = () => document.getElementById('tooltip');

export function showTooltip(html, x, y) {
  const el = tip();
  el.innerHTML = html;
  el.hidden = false;
  const box = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8);
  const top = y - box.height - 12 < 8 ? y + 16 : y - box.height - 12;
  el.style.transform = `translate(${left}px, ${top}px)`;
}
export const hideTooltip = () => {
  tip().hidden = true;
};

// Any element with data-tip gets a tooltip, on mouse or keyboard focus.
export function initTooltips() {
  document.addEventListener('mousemove', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (target) showTooltip(target.dataset.tip, e.clientX, e.clientY);
    else hideTooltip();
  });
  document.addEventListener('focusin', (e) => {
    const target = e.target.closest?.('[data-tip]');
    if (!target) return;
    const r = target.getBoundingClientRect();
    showTooltip(target.dataset.tip, r.left + r.width / 2, r.top);
  });
  document.addEventListener('focusout', hideTooltip);
  // A headshot or logo that fails to load shouldn't leave a broken-image icon.
  document.addEventListener('error', (e) => {
    if (e.target?.tagName === 'IMG') e.target.classList.add('img-missing');
  }, true);
}

const shortStatus = (s) => (/day/i.test(s) ? 'GTD' : /quest/i.test(s) ? 'Q' : /doubt/i.test(s) ? 'D' : /prob/i.test(s) ? 'P' : s);

export const injuryBadge = (injury) => {
  if (!injury) return '';
  const status = injury.status || '';
  const out = /out/i.test(status);
  return `<span class="badge ${out ? 'badge-out' : 'badge-q'}" data-tip="${esc(esc(injury.note || status))}">${out ? 'OUT' : esc(shortStatus(status))}</span>`;
};
