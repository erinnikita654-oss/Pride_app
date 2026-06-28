const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const user = tg.initDataUnsafe?.user || null;
// dev-login: ?dev=<telegram_id> — войти как этот игрок для тестирования вне Telegram
const devUid = new URLSearchParams(location.search).get('dev');
const telegramId = user?.id || devUid || null;
const username = user?.username || '';
const firstName = user?.first_name || 'Игрок';

// --- Аналитика ---
function track(event, props = {}) {
  try { window.posthog?.capture(event, props); } catch (e) {}
}

if (telegramId) {
  try {
    window.posthog?.identify(String(telegramId), {
      username,
      first_name: firstName,
      platform: 'telegram',
    });
    window.Rollbar?.configure({ payload: { person: { id: String(telegramId), username } } });
  } catch (e) {}
}

track('app_opened', { platform: telegramId ? 'telegram' : 'web' });

// Веб-версия: ник хранится в localStorage
const isWeb = !telegramId;
const WEB_NICKNAME_KEY = 'pride_nickname';

let myRegistrations = new Set();

// --- Навигация ---

function switchTab(target) {
  document.querySelectorAll('.nav-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  hideAllScreens();
  document.querySelector(`.nav-item[data-tab="${target}"]`).classList.add('active');
  document.getElementById(`tab-${target}`).classList.add('active');
  track('tab_view', { tab: target });
  if (target === 'rating') loadRating();
  if (target === 'legends') loadLegends();
  if (target === 'players') loadAllPlayers();
  if (target === 'challenges') loadChallenges();
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// --- Все прошедшие игры ---

let allGamesMonth = 'june';

document.getElementById('btn-all-games').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-all-games').classList.remove('hidden');
  loadAllGames();
});

document.getElementById('all-games-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.nav-item').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === 'games')
  );
  document.getElementById('tab-games').classList.add('active');
});

document.getElementById('all-games-month-select').addEventListener('change', e => {
  allGamesMonth = e.target.value;
  loadAllGames();
});

async function loadAllGames() {
  const container = document.getElementById('all-games-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/all-past-games?month=${allGamesMonth}`);
    const games = await res.json();

    if (!games.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>Нет данных</p></div>`;
      return;
    }

    container.innerHTML = games.map(g => `
      <div class="past-game-card" data-col="${g.colIndex}" data-label="${g.label}">
        <div>
          <div class="past-game-date">🗓 ${g.label}</div>
          ${g.tournamentName ? `<div class="past-game-tournament">${g.tournamentName}</div>` : ''}
        </div>
        <div class="past-game-arrow">›</div>
      </div>`).join('');

    container.querySelectorAll('.past-game-card').forEach(card => {
      card.addEventListener('click', () => {
        openGameResults(card.dataset.col, card.dataset.label, 'all-games', allGamesMonth);
      });
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

document.getElementById('back-btn').addEventListener('click', () => {
  hideAllScreens();
  if (gameResultsFrom === 'player') {
    document.getElementById('screen-player').classList.remove('hidden');
  } else if (gameResultsFrom === 'all-games') {
    document.getElementById('screen-all-games').classList.remove('hidden');
  } else if (gameResultsFrom === 'tournaments') {
    document.getElementById('screen-my-tournaments').classList.remove('hidden');
  } else {
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'games')
    );
    document.getElementById('tab-games').classList.add('active');
  }
});

// --- Утилиты ---

function showToast(message, type = '') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  });
}

// Ближайший турнир
// Навигация О клубе и Правила
document.getElementById('home-stats-btn').addEventListener('click', () => {
  openClubStats();
});

document.getElementById('club-stats-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === 'games'));
  document.getElementById('tab-games').classList.add('active');
});

async function openClubStats() {
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-club-stats').classList.remove('hidden');

  const container = document.getElementById('club-stats-content');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch('/api/club-stats');
    const d = await res.json();

    container.innerHTML = `
      <div class="club-stats-grid">
        <div class="club-stat-card">
          <div class="club-stat-value">${d.totalGames}</div>
          <div class="club-stat-label">Турниров проведено</div>
        </div>
        <div class="club-stat-card">
          <div class="club-stat-value">${d.totalPlayers}</div>
          <div class="club-stat-label">Игроков в клубе</div>
        </div>
        <div class="club-stat-card" style="grid-column: 1 / -1">
          <div class="club-stat-value">${d.totalParticipations}</div>
          <div class="club-stat-label">Участий в турнирах</div>
        </div>
      </div>
      <div class="club-stat-highlight">
        <div class="club-stat-highlight-label">👑 Чемпион клуба</div>
        <div class="club-stat-highlight-name">${d.champion?.name || '—'}</div>
        <div class="club-stat-highlight-sub">${d.champion?.wins || 0} побед</div>
      </div>
      <div class="club-stat-highlight">
        <div class="club-stat-highlight-label">🔥 Самый активный</div>
        <div class="club-stat-highlight-name">${d.mostActive?.name || '—'}</div>
        <div class="club-stat-highlight-sub">${d.mostActive?.games || 0} участий</div>
      </div>
      <div class="club-stat-highlight">
        <div class="club-stat-highlight-label">⚡ Рекорд очков за игру</div>
        <div class="club-stat-highlight-name">${d.bestResult} очков</div>
        <div class="club-stat-highlight-sub">${d.bestResultPlayer}</div>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

document.getElementById('home-about-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-about').classList.remove('hidden');
});

document.getElementById('home-rules-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-rules').classList.remove('hidden');
});

document.getElementById('home-rating-btn').addEventListener('click', () => switchTab('rating'));

document.getElementById('about-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === 'games'));
  document.getElementById('tab-games').classList.add('active');
});

document.getElementById('rules-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === 'games'));
  document.getElementById('tab-games').classList.add('active');
});

// Аккордеон правил
document.querySelectorAll('.rules-card').forEach(card => {
  card.addEventListener('click', () => {
    const ruleId = card.dataset.rule;
    const body = document.getElementById(`rule-${ruleId}`);
    const isOpen = !body.classList.contains('hidden');
    document.querySelectorAll('.rules-body').forEach(b => b.classList.add('hidden'));
    document.querySelectorAll('.rules-card').forEach(c => c.classList.remove('open'));
    if (!isOpen) {
      body.classList.remove('hidden');
      card.classList.add('open');
    }
  });
});

// --- Прошедшие игры ---

async function loadPastGames() {
  const container = document.getElementById('past-games-list');
  try {
    const res = await fetch('/api/past-games');
    const games = await res.json();

    if (!games.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>Нет данных</p></div>`;
      return;
    }

    container.innerHTML = games.map(g => `
      <div class="past-game-card" data-col="${g.colIndex}" data-label="${g.label}">
        <div>
          <div class="past-game-date">🗓 ${g.label}</div>
          ${g.tournamentName ? `<div class="past-game-tournament">${g.tournamentName}</div>` : ''}
        </div>
        <div class="past-game-arrow">›</div>
      </div>`).join('');

    container.querySelectorAll('.past-game-card').forEach(card => {
      card.addEventListener('click', () => {
        openGameResults(card.dataset.col, card.dataset.label);
      });
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

let gameResultsFrom = 'games';
let playerOverallFrom = 'players';

async function openGameResults(colIndex, label, from = 'games', month = 'june') {
  track('game_results_view', { label, month, from });
  gameResultsFrom = from;
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const screen = document.getElementById('screen-results');
  screen.classList.remove('hidden');
  document.getElementById('results-title').textContent = `Результаты — ${label}`;
  const container = document.getElementById('results-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/game-results?col=${colIndex}&month=${month}`);
    const data = await res.json();
    const players = data.players || data;
    const tournamentName = data.tournamentName || null;

    if (tournamentName) {
      document.getElementById('results-title').textContent = tournamentName;
    }

    if (!players.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>Нет данных</p></div>`;
      return;
    }

    container.innerHTML = players.map(p => {
      const placeClass = p.place === 1 ? 'gold' : p.place === 2 ? 'silver' : p.place === 3 ? 'bronze' : '';
      const place = p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : `${p.place}`;
      return `
        <div class="rating-item" style="cursor:pointer" data-nickname="${p.first_name}">
          <div class="rating-place ${placeClass}">${place}</div>
          <div class="rating-name">${p.first_name}</div>
          <div class="rating-score">${p.rating} очк.</div>
        </div>`;
    }).join('');

    container.querySelectorAll('.rating-item[data-nickname]').forEach(el => {
      el.addEventListener('click', () => openPlayerOverall(el.dataset.nickname, 'results'));
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

// --- Рейтинг ---

let currentMonth = 'june';
let allPlayers = [];

document.getElementById('rating-month-select').addEventListener('change', e => {
  currentMonth = e.target.value;
  document.getElementById('rating-search').value = '';
  loadRating();
});

document.getElementById('rating-search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? allPlayers.filter(p => p.first_name.toLowerCase().includes(q)) : allPlayers;
  renderRating(filtered);
});

async function loadRating() {
  const container = document.getElementById('rating-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/rating?month=${currentMonth}`);
    allPlayers = await res.json();
    renderRating(allPlayers);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

function renderRating(players) {
  const container = document.getElementById('rating-list');

  if (!players.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">🏆</div><p>Никого не найдено</p></div>`;
    return;
  }

  const FINAL_SPOTS = 27;
  let addedDivider = false;

  container.innerHTML = players.map(p => {
    const isFinalist = p.place <= FINAL_SPOTS;
    const placeClass = p.place === 1 ? 'gold' : p.place === 2 ? 'silver' : p.place === 3 ? 'bronze' : '';
    const place = p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : `${p.place}`;

    let divider = '';
    if (!isFinalist && !addedDivider) {
      addedDivider = true;
      divider = `<div class="rating-divider">— вне финала —</div>`;
    }

    return `${divider}
      <div class="rating-item ${isFinalist ? 'finalist' : 'non-finalist'}" style="cursor:pointer" data-nickname="${p.first_name}">
        <div class="rating-place ${placeClass}">${place}</div>
        <div class="rating-name">
          ${p.first_name}
          ${isFinalist ? '<span class="finalist-badge">финал</span>' : ''}
        </div>
        <div class="rating-score">${p.rating} очк.</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.rating-item[data-nickname]').forEach(el => {
    el.addEventListener('click', () => openPlayerStats(el.dataset.nickname, currentMonth));
  });
}

async function openPlayerStats(nickname, month) {
  track('player_stats_view', { month });
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const screen = document.getElementById('screen-player');
  screen.classList.remove('hidden');

  const letter = (nickname || '?')[0].toUpperCase();
  document.getElementById('player-avatar').textContent = letter;
  document.getElementById('player-nickname').textContent = nickname;
  document.getElementById('player-stats').innerHTML = '<div class="loading">Загрузка...</div>';
  document.getElementById('player-games').innerHTML = '';

  try {
    const res = await fetch(`/api/player-stats?nickname=${encodeURIComponent(nickname)}&month=${month}`);
    const s = await res.json();

    if (!s.found) {
      document.getElementById('player-stats').innerHTML = `<div class="stat-card wide"><div class="stat-label">Нет данных за этот месяц</div></div>`;
      return;
    }

    const bestPlaceText = s.bestPlace ? `${s.bestPlace} место` : '—';

    document.getElementById('player-stats').innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${s.gamesPlayed}</div>
        <div class="stat-label">Игр сыграно</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.totalPoints}</div>
        <div class="stat-label">Очков за месяц</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${s.bestPoints}</div>
        <div class="stat-label">Лучший результат</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${bestPlaceText}</div>
        <div class="stat-label">Лучшее место</div>
      </div>`;

    document.getElementById('player-games').innerHTML = `
      <div class="section-title" style="margin-bottom:10px">Результаты по играм</div>
      <div class="list">
        ${s.games.map(g => `
          <div class="past-game-card" data-col="${g.idx}" data-label="${g.label}" data-month="${month}">
            <div>
              <div class="past-game-date">🗓 ${g.label}</div>
              ${g.tournamentName ? `<div class="past-game-tournament">${g.tournamentName}</div>` : ''}
              <div style="font-size:12px;color:var(--hint);margin-top:2px">${g.place} место из ${g.total}</div>
            </div>
            <div style="text-align:right">
              <div style="font-weight:700;color:var(--gold)">${g.pts} очк.</div>
              <div style="font-size:12px;color:var(--hint)">Результаты ›</div>
            </div>
          </div>`).join('')}
      </div>`;

    document.getElementById('player-games').querySelectorAll('.past-game-card').forEach(card => {
      card.addEventListener('click', () => {
        openGameResults(card.dataset.col, card.dataset.label, 'player', card.dataset.month);
      });
    });
  } catch (e) {
    document.getElementById('player-stats').innerHTML = `<div class="empty-state"><p>Ошибка загрузки</p></div>`;
  }
}

document.getElementById('player-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === 'rating'));
  document.getElementById('tab-rating').classList.add('active');
});

// --- Авторизация по нику ---

let clubNickname = null;

// --- Все игроки ---

let allPlayersList = [];

document.getElementById('players-search').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const filtered = q ? allPlayersList.filter(p => p.name.toLowerCase().includes(q)) : allPlayersList;
  renderPlayersList(filtered);
});

let progressChartInstance = null;
let progressChartAvgInstance = null;
let currentProgressNickname = null;
let progressFrom = 'overall';
let progressMonths = null;
let progressClubMap = {};
let progressPeriod = 6;
let progressClubMode = 'all'; // 'all' — весь клуб, 'top' — ТОП-30 по очкам месяца

document.getElementById('progress-back-btn').addEventListener('click', () => {
  hideAllScreens();
  if (progressFrom === 'profile') {
    document.getElementById('screen-profile').classList.remove('hidden');
  } else {
    document.getElementById('screen-player-overall').classList.remove('hidden');
  }
});

document.getElementById('open-progress-btn').addEventListener('click', () => {
  if (currentProgressNickname) openProgressChart(currentProgressNickname, 'overall');
});

async function openProgressChart(nickname, from = 'overall') {
  track('progress_chart_view', { from });
  // Дублируем как tab_view, чтобы график попадал в инсайт «Tab popularity» рядом с вкладками
  track('tab_view', { tab: 'progress' });
  progressFrom = from;
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-progress').classList.remove('hidden');
  document.getElementById('progress-title').textContent = `Прогресс — ${nickname}`;

  try {
    const [res, clubRes] = await Promise.all([
      fetch(`/api/player-overall?nickname=${encodeURIComponent(nickname)}`),
      fetch('/api/club-averages'),
    ]);
    const d = await res.json();
    progressClubMap = await clubRes.json().catch(() => ({}));

    if (!d.months || !d.months.length) { progressMonths = null; return; }
    progressMonths = d.months;
    renderProgressCharts(progressPeriod);
  } catch (e) {
    console.error(e);
  }
}

function renderProgressCharts(period) {
  if (!progressMonths) return;
  progressPeriod = period;
  document.querySelectorAll('.period-btn').forEach(b =>
    b.classList.toggle('active', Number(b.dataset.period) === period));
  document.querySelectorAll('.club-avg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === progressClubMode));

  if (progressChartInstance) { progressChartInstance.destroy(); progressChartInstance = null; }
  if (progressChartAvgInstance) { progressChartAvgInstance.destroy(); progressChartAvgInstance = null; }

  // Последние N месяцев, от старых к новым
  const ordered = [...progressMonths].slice(0, period).reverse();
  const labels = ordered.map(m => m.label);
    const points = ordered.map(m => m.monthTotal);
    const wins   = ordered.map(m => m.wins);
    const avg = ordered.map(m => m.gamesPlayed > 0 ? Math.round(m.monthTotal / m.gamesPlayed) : 0);
    // Поддержка старого формата (число) и нового ({ all, top })
    const clubAvg = ordered.map(m => {
      const v = progressClubMap[m.key];
      if (v == null) return null;
      return typeof v === 'number' ? v : (v[progressClubMode] ?? null);
    });

    // Накопительное среднее: суммарные очки / суммарные игры до каждого месяца
    let cumPoints = 0, cumGames = 0;
    const cumulativeAvg = ordered.map(m => {
      cumPoints += m.monthTotal;
      cumGames  += m.gamesPlayed;
      return cumGames > 0 ? Math.round(cumPoints / cumGames) : 0;
    });

    const ctx = document.getElementById('progress-chart').getContext('2d');
    progressChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Очки',
            data: points,
            borderColor: '#c9a227',
            backgroundColor: 'rgba(201,162,39,0.15)',
            borderWidth: 2,
            pointBackgroundColor: '#c9a227',
            pointRadius: 5,
            tension: 0.3,
            fill: true,
            yAxisID: 'y',
          },
          {
            label: 'Победы',
            data: wins,
            borderColor: '#e74c3c',
            backgroundColor: 'rgba(231,76,60,0.1)',
            borderWidth: 2,
            pointBackgroundColor: '#e74c3c',
            pointRadius: 5,
            tension: 0.3,
            fill: false,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#e0d5c5', font: { size: 13 } },
          },
        },
        scales: {
          x: {
            ticks: { color: '#a89880', font: { size: 11 }, autoSkip: true, maxTicksLimit: 6, maxRotation: 40, minRotation: 0 },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            beginAtZero: true,
            min: 0,
            ticks: { color: '#c9a227' },
            grid: { color: 'rgba(201,162,39,0.1)' },
            title: { display: true, text: 'Очки', color: '#c9a227' },
          },
          y1: {
            position: 'right',
            beginAtZero: true,
            min: 0,
            ticks: { color: '#e74c3c', stepSize: 1, precision: 0 },
            grid: { drawOnChartArea: false },
            title: { display: true, text: 'Победы', color: '#e74c3c' },
          },
        },
      },
    });
    const ctx2 = document.getElementById('progress-chart-avg').getContext('2d');
    progressChartAvgInstance = new Chart(ctx2, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Среднее за месяц',
            data: avg,
            borderColor: '#2ecc71',
            backgroundColor: 'rgba(46,204,113,0.15)',
            borderWidth: 2,
            pointBackgroundColor: '#2ecc71',
            pointRadius: 5,
            tension: 0.3,
            fill: true,
          },
          {
            label: 'Общее среднее',
            data: cumulativeAvg,
            borderColor: '#9b59b6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [6, 3],
            pointBackgroundColor: '#9b59b6',
            pointRadius: 3,
            tension: 0.3,
            fill: false,
          },
          {
            label: progressClubMode === 'top' ? 'Среднее ТОП-30' : 'Среднее по клубу',
            data: clubAvg,
            borderColor: '#5dade2',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [2, 3],
            pointBackgroundColor: '#5dade2',
            pointRadius: 3,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { labels: { color: '#e0d5c5', font: { size: 13 } } },
        },
        scales: {
          x: {
            ticks: { color: '#a89880', font: { size: 11 }, autoSkip: true, maxTicksLimit: 6, maxRotation: 40, minRotation: 0 },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            ticks: { color: '#2ecc71' },
            grid: { color: 'rgba(46,204,113,0.1)' },
            title: { display: true, text: 'Avg очки', color: '#2ecc71' },
          },
        },
      },
    });
}

// Переключатель периода графика (3 / 6 / 12 месяцев)
document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const p = Number(btn.dataset.period);
    track('progress_period_change', { period: p });
    renderProgressCharts(p);
  });
});

// Переключатель базы сравнения (весь клуб / ТОП-30 по очкам месяца)
document.querySelectorAll('.club-avg-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    progressClubMode = btn.dataset.mode;
    track('progress_club_mode_change', { mode: progressClubMode });
    renderProgressCharts(progressPeriod);
  });
});

document.getElementById('player-overall-back-btn').addEventListener('click', () => {
  hideAllScreens();
  if (playerOverallFrom === 'results') {
    document.getElementById('screen-results').classList.remove('hidden');
  } else if (playerOverallFrom === 'legends') {
    document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === 'legends'));
    document.getElementById('tab-legends').classList.add('active');
  } else {
    document.querySelectorAll('.nav-item').forEach(t => t.classList.toggle('active', t.dataset.tab === 'players'));
    document.getElementById('tab-players').classList.add('active');
  }
});

async function loadAllPlayers() {
  const container = document.getElementById('players-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const res = await fetch('/api/all-players');
    allPlayersList = await res.json();
    renderPlayersList(allPlayersList);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

function renderPlayersList(players) {
  const container = document.getElementById('players-list');
  if (!players.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">👤</div><p>Никого не найдено</p></div>`;
    return;
  }
  container.innerHTML = players.map(p => {
    const letter = (p.name || '?')[0].toUpperCase();
    const monthsLabel = p.months === 1 ? '1 месяц' : p.months < 5 ? `${p.months} месяца` : `${p.months} месяцев`;
    return `
      <div class="player-card" data-nickname="${p.name}">
        <div class="player-card-avatar">${letter}</div>
        <div class="player-card-info">
          <div class="player-card-name">${p.name}</div>
          <div class="player-card-sub">Играет ${monthsLabel}</div>
        </div>
        <div class="player-card-pts">${p.totalPoints} очк.</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.player-card').forEach(card => {
    card.addEventListener('click', () => openPlayerOverall(card.dataset.nickname));
  });
}

async function openPlayerOverall(nickname, from = 'players') {
  track('player_overall_view', { from });
  playerOverallFrom = from;
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-player-overall').classList.remove('hidden');

  currentProgressNickname = nickname;
  document.getElementById('overall-avatar').textContent = (nickname || '?')[0].toUpperCase();
  document.getElementById('overall-nickname').textContent = nickname;
  document.getElementById('overall-header-stats').innerHTML = '';

  const container = document.getElementById('overall-content');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/player-overall?nickname=${encodeURIComponent(nickname)}`);
    const d = await res.json();

    if (!d.months || !d.months.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>Нет данных</p></div>`;
      return;
    }

    const avgPts = d.totalGames > 0 ? Math.round(d.totalPoints / d.totalGames) : 0;
    const winPct = d.totalGames > 0 ? Math.round(d.totalWins / d.totalGames * 100) : 0;
    document.getElementById('overall-header-stats').innerHTML = `
      <div class="overall-header-stat">
        <div class="overall-header-stat-value">${d.totalGames}</div>
        <div class="overall-header-stat-label">игр</div>
      </div>
      <div class="overall-header-stat">
        <div class="overall-header-stat-value">${d.totalWins}</div>
        <div class="overall-header-stat-label">побед</div>
      </div>
      <div class="overall-header-stat">
        <div class="overall-header-stat-value">${avgPts}</div>
        <div class="overall-header-stat-label">avg очки</div>
      </div>
      <div class="overall-header-stat">
        <div class="overall-header-stat-value">${winPct}%</div>
        <div class="overall-header-stat-label">% побед</div>
      </div>`;

    const winsWord = n => n === 1 ? 'победа' : n < 5 ? 'победы' : 'побед';
    const bp = d.allBestPlace ? `${d.allBestPlace} место` : '—';

    const overallHTML = `
      <div class="overall-card">
        <div class="overall-title">⚡ За всё время</div>
        <div class="profile-stats">
          <div class="stat-card"><div class="stat-value">${d.totalGames}</div><div class="stat-label">Игр</div></div>
          <div class="stat-card"><div class="stat-value">${d.totalPoints}</div><div class="stat-label">Очков</div></div>
          <div class="stat-card"><div class="stat-value">${d.allBestPoints}</div><div class="stat-label">Лучший рез.</div></div>
          <div class="stat-card"><div class="stat-value">${bp}</div><div class="stat-label">Лучшее место</div></div>
          <div class="stat-card wide">
            <div class="stat-value">${d.totalWins} <span style="font-size:18px">${winsWord(d.totalWins)}</span></div>
            <div class="stat-label">🏆 Первых мест</div>
          </div>
        </div>
      </div>`;

    const monthsHTML = d.months.map(m => {
      const mbp = m.bestPlace ? `${m.bestPlace} место` : '—';
      const winsTag = m.wins > 0 ? `<div class="month-result-wins">🏆 ${m.wins} ${winsWord(m.wins)}</div>` : '';
      return `
        <div class="month-result-card">
          <div class="month-result-header">
            <div class="month-result-title">${m.label}</div>
            ${winsTag}
          </div>
          <div class="month-result-grid">
            <div class="month-stat"><div class="month-stat-value">${m.gamesPlayed}</div><div class="month-stat-label">Игр</div></div>
            <div class="month-stat"><div class="month-stat-value">${m.monthTotal}</div><div class="month-stat-label">Очков</div></div>
            <div class="month-stat"><div class="month-stat-value">${m.bestPoints}</div><div class="month-stat-label">Лучший рез.</div></div>
            <div class="month-stat"><div class="month-stat-value">${mbp}</div><div class="month-stat-label">Лучшее место</div></div>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = monthsHTML;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

async function loadLegends() {
  const container = document.getElementById('legends-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch('/api/legends');
    const legends = await res.json();

    if (!legends.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">👑</div><p>Нет данных</p></div>`;
      return;
    }

    const placeClass = p => p === 1 ? 'gold' : p === 2 ? 'silver' : p === 3 ? 'bronze' : '';
    const placeIcon  = p => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : `${p}`;
    const itemClass  = p => p === 1 ? 'top1' : p === 2 ? 'top2' : p === 3 ? 'top3' : '';
    const winsWord   = n => n === 1 ? 'победа' : n < 5 ? 'победы' : 'побед';

    container.innerHTML = legends.map(p => `
      <div class="legend-item ${itemClass(p.place)}" style="cursor:pointer" data-nickname="${p.name}">
        <div class="legend-place ${placeClass(p.place)}">${placeIcon(p.place)}</div>
        <div class="legend-name">${p.name}</div>
        <div class="legend-wins">
          <div class="legend-wins-count">${p.count}</div>
          <div class="legend-wins-label">${winsWord(p.count)}</div>
        </div>
      </div>`).join('');

    container.querySelectorAll('.legend-item[data-nickname]').forEach(el => {
      el.addEventListener('click', () => openPlayerOverall(el.dataset.nickname, 'legends'));
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

async function initAuth() {
  if (isWeb) {
    // Веб-версия: ник из localStorage
    const saved = localStorage.getItem(WEB_NICKNAME_KEY);
    if (saved) {
      clubNickname = saved;
      maybeShowProgressPromo();
    } else {
      showNicknameScreen();
    }
    loadPastGames();
    return;
  }

  const res = await fetch(`/api/profile/${telegramId}`);
  const profile = await res.json();

  loadPastGames();

  if (profile && profile.first_name) {
    clubNickname = profile.first_name;
    maybeShowProgressPromo();
  } else {
    showNicknameScreen();
  }
}

function showNicknameScreen() {
  document.getElementById('screen-nickname').classList.remove('hidden');
  document.body.classList.add('nickname-active');
}

function hideNicknameScreen() {
  document.getElementById('screen-nickname').classList.add('hidden');
  document.body.classList.remove('nickname-active');
}

document.getElementById('nickname-cancel').addEventListener('click', () => {
  if (clubNickname) hideNicknameScreen();
});

document.getElementById('profile-btn').addEventListener('click', () => {
  openProfile();
});

document.getElementById('profile-edit-btn').addEventListener('click', () => {
  document.getElementById('screen-profile').classList.add('hidden');
  showNicknameScreen();
  document.getElementById('nickname-input').value = clubNickname || '';
});

document.getElementById('profile-results-btn').addEventListener('click', () => {
  openMyResults();
});

document.getElementById('my-tournaments-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.getElementById('screen-profile').classList.remove('hidden');
});

async function openMyTournaments() {
  track('my_tournaments_view');
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-my-tournaments').classList.remove('hidden');

  const container = document.getElementById('my-tournaments-content');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  const nick = clubNickname;
  if (!nick) {
    container.innerHTML = `<div class="empty-state"><p>Ник не задан</p></div>`;
    return;
  }

  try {
    const res = await fetch(`/api/player-tournaments?nickname=${encodeURIComponent(nick)}`);
    const tournaments = await res.json();

    if (!tournaments.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🎯</div><p>Нет турниров</p></div>`;
      return;
    }

    container.innerHTML = tournaments.map(t => {
      const winBadge = t.isWinner ? `<span class="tournament-win-badge">🏆 Победа</span>` : '';
      const name = t.tournamentName || t.label;
      return `
        <div class="tournament-card" data-col="${t.colIdx}" data-month="${t.month}" data-label="${t.label}">
          <div class="tournament-card-left">
            <div class="tournament-card-date">🗓 ${t.dateISO}</div>
            <div class="tournament-card-name">${name}</div>
            ${winBadge}
          </div>
          <div class="tournament-card-pts">${t.pts}<span class="tournament-card-pts-label"> очк.</span></div>
        </div>`;
    }).join('');

    container.querySelectorAll('.tournament-card').forEach(card => {
      card.addEventListener('click', () => {
        openGameResults(card.dataset.col, card.dataset.label, 'tournaments', card.dataset.month);
      });
    });
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

document.getElementById('my-results-back-btn').addEventListener('click', () => {
  hideAllScreens();
  document.getElementById('screen-profile').classList.remove('hidden');
});

async function openMyResults() {
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-my-results').classList.remove('hidden');

  if (!telegramId && !isWeb) return;

  const container = document.getElementById('my-results-content');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = isWeb
      ? await fetch(`/api/player-overall?nickname=${encodeURIComponent(clubNickname)}`)
      : await fetch(`/api/my-results/${telegramId}`);
    const d = await res.json();

    if (!d.months || !d.months.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📊</div><p>Нет данных — ник не найден в таблицах</p></div>`;
      return;
    }

    const bestPlaceStr = d.allBestPlace ? `${d.allBestPlace} место` : '—';
    const winsWord = n => n === 1 ? 'победа' : n < 5 ? 'победы' : 'побед';

    const overallHTML = `
      <div class="overall-card">
        <div class="overall-title">⚡ Итого за всё время</div>
        <div class="profile-stats">
          <div class="stat-card">
            <div class="stat-value">${d.totalGames}</div>
            <div class="stat-label">Игр сыграно</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${d.totalPoints}</div>
            <div class="stat-label">Очков всего</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${d.allBestPoints}</div>
            <div class="stat-label">Лучший результат</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${bestPlaceStr}</div>
            <div class="stat-label">Лучшее место</div>
          </div>
          <div class="stat-card wide">
            <div class="stat-value">${d.totalWins} <span style="font-size:18px">${winsWord(d.totalWins)}</span></div>
            <div class="stat-label">🏆 Первых мест</div>
          </div>
        </div>
      </div>`;

    const monthsHTML = d.months.map(m => {
      const bp = m.bestPlace ? `${m.bestPlace} место` : '—';
      const winsTag = m.wins > 0
        ? `<div class="month-result-wins">🏆 ${m.wins} ${winsWord(m.wins)}</div>`
        : '';
      return `
        <div class="month-result-card">
          <div class="month-result-header">
            <div class="month-result-title">${m.label}</div>
            ${winsTag}
          </div>
          <div class="month-result-grid">
            <div class="month-stat">
              <div class="month-stat-value">${m.gamesPlayed}</div>
              <div class="month-stat-label">Игр</div>
            </div>
            <div class="month-stat">
              <div class="month-stat-value">${m.monthTotal}</div>
              <div class="month-stat-label">Очков</div>
            </div>
            <div class="month-stat">
              <div class="month-stat-value">${m.bestPoints}</div>
              <div class="month-stat-label">Лучший рез.</div>
            </div>
            <div class="month-stat">
              <div class="month-stat-value">${bp}</div>
              <div class="month-stat-label">Лучшее место</div>
            </div>
          </div>
        </div>`;
    }).join('');

    container.innerHTML = overallHTML + monthsHTML;
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

function hideAllScreens() {
  ['screen-profile', 'screen-results', 'screen-nickname', 'screen-player',
   'screen-all-games', 'screen-my-results', 'screen-player-overall',
   'screen-about', 'screen-rules', 'screen-my-tournaments', 'screen-progress',
   'screen-club-stats', 'screen-nick-suggest']
    .forEach(id => document.getElementById(id).classList.add('hidden'));
}

async function openProfile() {
  track('profile_view');
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-profile').classList.remove('hidden');

  const letter = (clubNickname || '?')[0].toUpperCase();
  document.getElementById('profile-avatar').textContent = letter;
  document.getElementById('profile-nickname').textContent = clubNickname || 'Гость';

  if (!telegramId && !isWeb) return;

  const container = document.getElementById('profile-content');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = isWeb
      ? await fetch(`/api/player-overall?nickname=${encodeURIComponent(clubNickname)}`)
      : await fetch(`/api/my-results/${telegramId}`);
    const d = await res.json();

    if (!d.months || !d.months.length) {
      container.innerHTML = `<div class="stat-card wide" style="margin-bottom:12px">
        <div class="stat-label" style="font-size:14px;line-height:1.6;text-align:center">
          Ник не найден в таблице.<br>Нажми <strong>«Изменить ник»</strong> и введи точно как в рейтинге.
        </div>
      </div>`;
      return;
    }

    const winsWord = n => n === 1 ? 'победа' : n < 5 ? 'победы' : 'побед';
    const bp = d.allBestPlace ? `${d.allBestPlace} место` : '—';

    const overallHTML = `
      <div class="overall-card" style="margin-bottom:12px">
        <div class="overall-title">⚡ За всё время</div>
        <div class="profile-stats">
          <div class="stat-card"><div class="stat-value">${d.totalGames}</div><div class="stat-label">Игр</div></div>
          <div class="stat-card"><div class="stat-value">${d.totalPoints}</div><div class="stat-label">Очков</div></div>
          <div class="stat-card"><div class="stat-value">${d.allBestPoints}</div><div class="stat-label">Лучший рез.</div></div>
          <div class="stat-card"><div class="stat-value">${bp}</div><div class="stat-label">Лучшее место</div></div>
          <div class="stat-card wide">
            <div class="stat-value">${d.totalWins} <span style="font-size:18px">${winsWord(d.totalWins)}</span></div>
            <div class="stat-label">🏆 Первых мест</div>
          </div>
        </div>
      </div>`;

    const current = d.months[0];
    const cbp = current.bestPlace ? `${current.bestPlace} место` : '—';
    const winsTag = current.wins > 0 ? `<div class="month-result-wins">🏆 ${current.wins} ${winsWord(current.wins)}</div>` : '';
    const currentHTML = `
      <div class="month-result-card" style="margin-bottom:12px">
        <div class="month-result-header">
          <div class="month-result-title">${current.label}</div>
          ${winsTag}
        </div>
        <div class="month-result-grid">
          <div class="month-stat"><div class="month-stat-value">${current.gamesPlayed}</div><div class="month-stat-label">Игр</div></div>
          <div class="month-stat"><div class="month-stat-value">${current.monthTotal}</div><div class="month-stat-label">Очков</div></div>
          <div class="month-stat"><div class="month-stat-value">${current.bestPoints}</div><div class="month-stat-label">Лучший рез.</div></div>
          <div class="month-stat"><div class="month-stat-value">${cbp}</div><div class="month-stat-label">Лучшее место</div></div>
        </div>
      </div>`;

    const tournamentsBtn = `<button class="profile-results-btn" id="profile-tournaments-btn" style="margin:12px 0">Мои турниры</button>`;
    const progressBtn = `<button class="progress-btn" id="profile-progress-btn" style="margin:0 0 12px">📈 График прогресса</button>`;
    container.innerHTML = overallHTML + tournamentsBtn + progressBtn + currentHTML;
    document.getElementById('profile-tournaments-btn').addEventListener('click', () => openMyTournaments());
    document.getElementById('profile-progress-btn').addEventListener('click', () => openProgressChart(clubNickname, 'profile'));
  } catch (e) {
    container.innerHTML = '<div class="empty-state"><p>Ошибка загрузки</p></div>';
  }
}

async function saveNickname(nickname) {
  if (isWeb) {
    localStorage.setItem(WEB_NICKNAME_KEY, nickname);
    window.location.reload();
    return;
  }
  const res = await fetch('/api/profile/set-nickname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId, nickname, username, firstName })
  });
  if (res.ok) {
    window.location.reload();
  } else {
    document.getElementById('nickname-btn').disabled = false;
    document.getElementById('nickname-btn').textContent = 'Войти в клуб';
    showToast('Ошибка, попробуй ещё раз', 'error');
  }
}

document.getElementById('nickname-btn').addEventListener('click', async () => {
  const input = document.getElementById('nickname-input');
  const nickname = input.value.trim();
  if (nickname.length < 2) {
    input.style.borderColor = '#c0392b';
    return;
  }

  const btn = document.getElementById('nickname-btn');
  btn.disabled = true;
  btn.textContent = 'Проверяем...';

  try {
    const res = await fetch(`/api/suggest-nickname?q=${encodeURIComponent(nickname)}`);
    const data = await res.json();

    if (data.exact) {
      // Точное совпадение — сохраняем канонический ник
      await saveNickname(data.canonical);
    } else if (data.suggestions.length > 0) {
      // Есть похожий — показываем диалог
      btn.disabled = false;
      btn.textContent = 'Войти в клуб';
      const suggested = data.suggestions[0];
      document.getElementById('nick-suggest-name').textContent = suggested;
      document.getElementById('screen-nick-suggest').classList.remove('hidden');
      document.body.classList.add('nickname-active');

      document.getElementById('nick-suggest-yes').onclick = async () => {
        document.getElementById('screen-nick-suggest').classList.add('hidden');
        document.body.classList.remove('nickname-active');
        await saveNickname(suggested);
      };
      document.getElementById('nick-suggest-no').onclick = async () => {
        document.getElementById('screen-nick-suggest').classList.add('hidden');
        document.body.classList.remove('nickname-active');
        await saveNickname(nickname);
      };
    } else {
      // Нет похожих — сохраняем как есть
      await saveNickname(nickname);
    }
  } catch (e) {
    await saveNickname(nickname);
  }
});

// --- Промо графика прогресса (показываем один раз всем вошедшим) ---
const PROGRESS_PROMO_KEY = 'pride_progress_promo_seen';

function maybeShowProgressPromo() {
  if (!clubNickname) return;
  if (localStorage.getItem(PROGRESS_PROMO_KEY)) return;
  document.getElementById('progress-promo').classList.remove('hidden');
  localStorage.setItem(PROGRESS_PROMO_KEY, 'shown'); // показываем ровно один раз
  track('progress_promo_shown');
}

// Закрыть промо, запомнив выбранное действие: 'open' | 'later' | 'backdrop'.
// Действие пишем и в флаг localStorage (перетирает 'shown'), и в аналитику.
function closeProgressPromo(action) {
  document.getElementById('progress-promo').classList.add('hidden');
  localStorage.setItem(PROGRESS_PROMO_KEY, action);
  track('progress_promo_action', { action });
}

document.getElementById('promo-open-btn').addEventListener('click', () => {
  closeProgressPromo('open');
  if (clubNickname) openProgressChart(clubNickname, 'promo');
});

document.getElementById('promo-later-btn').addEventListener('click', () => {
  closeProgressPromo('later');
});

// Тап по затемнению вне карточки — закрыть
document.getElementById('progress-promo').addEventListener('click', (e) => {
  if (e.target.id === 'progress-promo') closeProgressPromo('backdrop');
});

// ===== Фича «Вызовы» (фронт) =====
let chConfig = { challengesEnabled: false };
let chPickerPlayers = [];
let chPickerTournament = null;

function chEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function chAva(name, dim) {
  const l = (String(name || '?').trim()[0] || '?').toUpperCase();
  return `<div class="ch-ava${dim ? ' dim' : ''}">${chEsc(l)}</div>`;
}
const CH_DOW = ['вс','пн','вт','ср','чт','пт','сб'];
const CH_MON = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
function chFmtDate(iso, sheetDate) {
  const d = iso ? new Date(iso) : null;
  if (d && !isNaN(d)) {
    const hh = String(d.getHours()).padStart(2,'0'), mm = String(d.getMinutes()).padStart(2,'0');
    return `${CH_DOW[d.getDay()]}, ${d.getDate()} ${CH_MON[d.getMonth()]} ${hh}:${mm}`;
  }
  return sheetDate || '';
}

async function initChallenges() {
  try { chConfig = await (await fetch('/api/config')).json(); }
  catch (e) { chConfig = { challengesEnabled: false }; }
  if (!chConfig.challengesEnabled || !telegramId) return;
  document.querySelector('.nav-challenges')?.classList.remove('hidden');
  document.querySelector('.bottom-nav')?.classList.add('nav5');
  chUpdateBadge();
}

async function chUpdateBadge() {
  if (!chConfig.challengesEnabled || !telegramId) return;
  try {
    const inc = await (await fetch(`/api/challenges/incoming/${encodeURIComponent(telegramId)}`)).json();
    const badge = document.getElementById('ch-nav-badge');
    if (Array.isArray(inc) && inc.length) { badge.textContent = inc.length; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch (e) {}
}

async function loadChallenges() {
  const box = document.getElementById('challenges-content');
  box.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    const [tournaments, incoming, mine, standings] = await Promise.all([
      fetch('/api/challenges/tournaments').then(r => r.json()),
      fetch(`/api/challenges/incoming/${encodeURIComponent(telegramId)}`).then(r => r.json()),
      fetch(`/api/challenges/mine/${encodeURIComponent(telegramId)}`).then(r => r.json()),
      fetch('/api/challenges/standings').then(r => r.json()),
    ]);
    box.innerHTML =
      chRenderTournaments(tournaments) +
      chRenderIncoming(incoming) +
      chRenderMine(mine) +
      chRenderStandings(standings);
    chUpdateBadge();
  } catch (e) {
    box.innerHTML = '<div class="ch-empty">Ошибка загрузки</div>';
  }
}

function chRenderTournaments(list) {
  let html = '<div class="ch-sec">Ближайшие турниры</div>';
  if (!list || !list.length) return html + '<div class="ch-empty">Пока нет предстоящих турниров</div>';
  return html + list.map(t => `
    <div class="ch-card"><div class="ch-tourn">
      <div class="ch-meta"><div class="ch-nm">${chEsc(t.title)}</div><div class="ch-subt">${chFmtDate(t.starts_at, t.sheet_date)}</div></div>
      <button class="ch-btn-sm ch-do-challenge" data-tid="${chEsc(t.id)}" data-title="${chEsc(t.title)}">⚔️ Вызвать</button>
    </div></div>`).join('');
}

function chRenderIncoming(list) {
  const inc = (list || []).filter(c => c.status === 'pending');
  let html = `<div class="ch-sec">Входящие · ${inc.length}</div>`;
  if (!inc.length) return html + '<div class="ch-empty">Нет новых вызовов</div>';
  return html + inc.map(c => `
    <div class="ch-card incoming">
      <div class="ch-vs">${chAva(c.challenger_name)}<div class="ch-meta">
        <div class="ch-nm">${chEsc(c.challenger_name)} <span class="sword">⚔️</span> ты</div>
        <div class="ch-subt">${chEsc(c.games?.title || '')} · ${chFmtDate(c.games?.starts_at, c.games?.sheet_date)}</div>
      </div></div>
      <div class="ch-btns">
        <button class="ch-btn ch-btn-gold ch-accept" data-id="${chEsc(c.id)}">Принять</button>
        <button class="ch-btn ch-btn-out ch-decline" data-id="${chEsc(c.id)}">Отклонить</button>
      </div>
    </div>`).join('');
}

function chOutcome(c) {
  const iAmCh = String(c.challenger_id) === String(telegramId);
  const my = iAmCh ? c.challenger_points : c.opponent_points;
  const opp = iAmCh ? c.opponent_points : c.challenger_points;
  let won = null;
  if (c.result === 'draw') won = 'draw';
  else if (c.result === 'challenger_win') won = iAmCh ? 'win' : 'loss';
  else if (c.result === 'opponent_win') won = iAmCh ? 'loss' : 'win';
  return { my, opp, won };
}

function chRenderMine(list) {
  const show = (list || []).filter(c =>
    c.status === 'accepted' || c.status === 'resolved' || c.status === 'void' ||
    (c.status === 'pending' && String(c.challenger_id) === String(telegramId)));
  let html = '<div class="ch-sec">Мои дуэли</div>';
  if (!show.length) return html + '<div class="ch-empty">Дуэлей пока нет</div>';
  return html + show.map(c => {
    const iAmCh = String(c.challenger_id) === String(telegramId);
    const other = iAmCh ? c.opponent_name : c.challenger_name;
    let pill = '', extra = '';
    if (c.status === 'pending') {
      pill = '<span class="ch-pill ch-pill-wait">Ожидает ответа</span>';
      extra = `<button class="ch-btn-out ch-cancel" data-id="${chEsc(c.id)}" style="margin-top:10px;padding:7px 14px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer">Отозвать</button>`;
    } else if (c.status === 'accepted') {
      pill = '<span class="ch-pill ch-pill-acc">Принят · ждём результат</span>';
    } else if (c.status === 'void') {
      pill = '<span class="ch-pill ch-pill-void">Отмена (неявка)</span>';
    } else if (c.status === 'resolved') {
      const o = chOutcome(c);
      const cls = o.won === 'win' ? 'ch-pill-win' : o.won === 'loss' ? 'ch-pill-loss' : 'ch-pill-draw';
      const lbl = o.won === 'win' ? `Победа ${o.my}:${o.opp}` : o.won === 'loss' ? `Поражение ${o.my}:${o.opp}` : `Ничья ${o.my}:${o.opp}`;
      pill = `<span class="ch-pill ${cls}">${lbl}</span>`;
    }
    return `<div class="ch-card"><div class="ch-row">
      <div class="ch-vs">${chAva(other)}<div class="ch-meta">
        <div class="ch-nm">ты <span class="sword">⚔️</span> ${chEsc(other)}</div>
        <div class="ch-subt">${chEsc(c.games?.title || '')} · ${chFmtDate(c.games?.starts_at, c.games?.sheet_date)}</div>
      </div></div>${pill}
    </div>${extra}</div>`;
  }).join('');
}

function chRenderStandings(list) {
  let html = '<div class="ch-sec">Таблица дуэлянтов</div>';
  if (!list || !list.length) return html + '<div class="ch-empty">Пока нет сыгранных дуэлей</div>';
  const rows = list.map((r, i) => {
    const me = String(r.player) === String(telegramId) ? ' class="me"' : '';
    const place = i < 3 ? `<span class="gold">${i + 1}</span>` : (i + 1);
    return `<tr${me}><td>${place}</td><td>${chEsc(r.name)}</td><td>${r.wins}</td><td>${r.losses}</td><td>${r.draws}</td></tr>`;
  }).join('');
  return html + `<div class="ch-card" style="padding:6px 12px"><table class="ch-std">
    <tr><th>#</th><th>Игрок</th><th>В</th><th>П</th><th>Н</th></tr>${rows}</table></div>`;
}

async function chAction(url, okMsg) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ telegramId }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) { showToast(okMsg, 'success'); loadChallenges(); }
    else showToast(j.error || 'Ошибка', 'error');
  } catch (e) { showToast('Ошибка сети', 'error'); }
}

// Делегирование кликов на вкладке «Вызовы»
document.getElementById('challenges-content').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  if (btn.classList.contains('ch-do-challenge')) openChallengePicker(btn.dataset.tid, btn.dataset.title);
  else if (btn.classList.contains('ch-accept')) chAction(`/api/challenges/${btn.dataset.id}/accept`, 'Вызов принят!');
  else if (btn.classList.contains('ch-decline')) chAction(`/api/challenges/${btn.dataset.id}/decline`, 'Вызов отклонён');
  else if (btn.classList.contains('ch-cancel')) chAction(`/api/challenges/${btn.dataset.id}/cancel`, 'Вызов отозван');
});

// --- Выбор соперника ---
async function openChallengePicker(tournamentId, title) {
  chPickerTournament = { id: tournamentId, title };
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-picker').classList.remove('hidden');
  document.getElementById('picker-tournament').textContent = title || '';
  document.getElementById('picker-search').value = '';
  const listEl = document.getElementById('picker-list');
  listEl.innerHTML = '<div class="loading">Загрузка...</div>';
  try {
    chPickerPlayers = await (await fetch(`/api/challenges/players?exclude=${encodeURIComponent(telegramId)}`)).json();
    chRenderPicker(chPickerPlayers);
  } catch (e) { listEl.innerHTML = '<div class="ch-empty">Ошибка загрузки</div>'; }
}

function chRenderPicker(players) {
  const listEl = document.getElementById('picker-list');
  if (!players.length) { listEl.innerHTML = '<div class="ch-empty">Никого не найдено</div>'; return; }
  listEl.innerHTML = players.map(p => `
    <div class="ch-card" style="padding:11px 14px"><div class="ch-row">
      <div class="ch-vs">${chAva(p.name)}<div class="ch-meta">
        <div class="ch-nm">${chEsc(p.name)}</div><div class="ch-subt">@${chEsc(p.username || '—')}</div>
      </div></div>
      <button class="ch-btn-sm ch-pick" data-oid="${chEsc(p.telegramId)}">Вызвать</button>
    </div></div>`).join('');
}

document.getElementById('picker-search').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  chRenderPicker(q ? chPickerPlayers.filter(p => (p.name || '').toLowerCase().includes(q) || (p.username || '').toLowerCase().includes(q)) : chPickerPlayers);
});

document.getElementById('picker-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('.ch-pick'); if (!btn) return;
  btn.disabled = true;
  try {
    const r = await fetch('/api/challenges', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournamentId: chPickerTournament.id, challengerId: telegramId, opponentId: btn.dataset.oid }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      showToast('Вызов отправлен! ⚔️', 'success');
      document.getElementById('screen-picker').classList.add('hidden');
      switchTab('challenges');
    } else { showToast(j.error || 'Ошибка', 'error'); btn.disabled = false; }
  } catch (e2) { showToast('Ошибка сети', 'error'); btn.disabled = false; }
});

document.getElementById('picker-back-btn').addEventListener('click', () => {
  document.getElementById('screen-picker').classList.add('hidden');
  switchTab('challenges');
});

initAuth();
initChallenges();
