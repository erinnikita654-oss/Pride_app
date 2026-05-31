const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const user = tg.initDataUnsafe?.user || null;
const telegramId = user?.id || null;
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
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => switchTab(item.dataset.tab));
});

// --- Все прошедшие игры ---

let allGamesMonth = 'may';

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

async function openGameResults(colIndex, label, from = 'games', month = 'may') {
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

let currentMonth = 'may';
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
  progressFrom = from;
  hideAllScreens();
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('screen-progress').classList.remove('hidden');
  document.getElementById('progress-title').textContent = `Прогресс — ${nickname}`;

  if (progressChartInstance) { progressChartInstance.destroy(); progressChartInstance = null; }
  if (progressChartAvgInstance) { progressChartAvgInstance.destroy(); progressChartAvgInstance = null; }

  try {
    const res = await fetch(`/api/player-overall?nickname=${encodeURIComponent(nickname)}`);
    const d = await res.json();

    if (!d.months || !d.months.length) return;

    // Последние 12 месяцев, от старых к новым
    const ordered = [...d.months].slice(0, 12).reverse();
    const labels = ordered.map(m => m.label);
    const points = ordered.map(m => m.monthTotal);
    const wins   = ordered.map(m => m.wins);
    const avg = ordered.map(m => m.gamesPlayed > 0 ? Math.round(m.monthTotal / m.gamesPlayed) : 0);

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
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            labels: { color: '#e0d5c5', font: { size: 13 } },
          },
        },
        scales: {
          x: {
            ticks: { color: '#a89880', font: { size: 10 }, maxRotation: 45 },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            position: 'left',
            ticks: { color: '#c9a227' },
            grid: { color: 'rgba(201,162,39,0.1)' },
            title: { display: true, text: 'Очки', color: '#c9a227' },
          },
          y1: {
            position: 'right',
            ticks: { color: '#e74c3c', stepSize: 1 },
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
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#e0d5c5', font: { size: 13 } } },
        },
        scales: {
          x: {
            ticks: { color: '#a89880', font: { size: 10 }, maxRotation: 45 },
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
  } catch (e) {
    console.error(e);
  }
}

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
   'screen-club-stats']
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

document.getElementById('nickname-btn').addEventListener('click', async () => {
  const input = document.getElementById('nickname-input');
  const nickname = input.value.trim();
  if (nickname.length < 2) {
    input.style.borderColor = '#c0392b';
    return;
  }

  const btn = document.getElementById('nickname-btn');
  btn.disabled = true;
  btn.textContent = 'Сохраняем...';

  if (isWeb) {
    // Веб: сохраняем только в localStorage
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
    btn.disabled = false;
    btn.textContent = 'Войти в клуб';
    showToast('Ошибка, попробуй ещё раз', 'error');
  }
});

initAuth();
