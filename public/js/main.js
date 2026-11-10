import { esc, errorState, initTooltips, loading, logo } from './ui.js';
import { initSlip } from './slip.js';
import { boardView } from './views/board.js';
import { playerView } from './views/player.js';
import { gamesView } from './views/games.js';
import { linesView } from './views/lines.js';
import { matchupsView } from './views/matchups.js';
import { sheetsView } from './views/sheets.js';
import { calcView } from './views/calc.js';
import { recordView } from './views/record.js';

const view = document.getElementById('view');

const ROUTES = {
  '': { nav: 'props', title: 'Props', render: boardView },
  games: { nav: 'games', title: 'Games', render: gamesView },
  lines: { nav: 'lines', title: 'Lines', render: linesView },
  matchups: { nav: 'matchups', title: 'Matchups', render: matchupsView },
  sheets: { nav: 'sheets', title: 'Cheat Sheets', render: sheetsView },
  calc: { nav: 'calc', title: 'Calculators', render: calcView },
  record: { nav: 'record', title: 'Track Record', render: recordView },
  player: { nav: null, title: 'Player', render: playerView },
};

let cleanup = null;
let renderId = 0;

async function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const [section, ...rest] = path.split('/');
  const entry = ROUTES[section] ?? ROUTES[''];
  const params = new URLSearchParams(query || '');

  cleanup?.();
  cleanup = null;
  const id = ++renderId;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === entry.nav;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${entry.title} · Free Throw`;
  window.scrollTo(0, 0);
  view.innerHTML = loading();
  try {
    const stop = await entry.render(view, { id: rest[0], params, isCurrent: () => id === renderId });
    if (id === renderId) cleanup = stop ?? null;
    else stop?.();
  } catch (err) {
    if (id === renderId) view.innerHTML = errorState(err.message);
  }
}

view.addEventListener('click', (e) => {
  if (e.target.closest('[data-retry]')) route();
});

// --- Player search ------------------------------------------------------------

let directory = null;
const input = document.getElementById('search');
const results = document.getElementById('search-results');

async function loadDirectory() {
  if (directory) return directory;
  const res = await fetch('/api/players');
  directory = res.ok ? await res.json() : [];
  return directory;
}

function renderSearch() {
  const q = input.value.trim().toLowerCase();
  if (!q || !directory) {
    results.hidden = true;
    return;
  }
  const hits = directory
    .filter((p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q)
    .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
    .slice(0, 8);
  results.innerHTML = hits.length
    ? hits
        .map(
          (p) => `<a href="#/player/${esc(p.id)}"><img src="${esc(p.headshot || logo(p.team))}" alt="" loading="lazy"><span>${esc(p.name)}</span><small>${esc(p.team)} · ${esc(p.pos)}</small></a>`,
        )
        .join('')
    : '<p class="search-none">No player by that name</p>';
  results.hidden = false;
}

input.addEventListener('focus', () => loadDirectory().then(renderSearch));
input.addEventListener('input', () => loadDirectory().then(renderSearch));
input.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    input.value = '';
    results.hidden = true;
    input.blur();
  }
  if (e.key === 'Enter') results.querySelector('a')?.click();
});
results.addEventListener('click', () => {
  input.value = '';
  results.hidden = true;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search')) results.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) {
    e.preventDefault();
    input.focus();
  }
});

initTooltips();
initSlip();
window.addEventListener('hashchange', route);
route();
