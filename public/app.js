const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const user = tg.initDataUnsafe?.user || null;
const telegramId = user?.id || null;
const username = user?.username || '';
const firstName = user?.first_name || 'Игрок';

let myRegistrations = new Set();

// --- Навигация ---

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('screen-results').classList.add('hidden');
    tab.classList.add('active');
    document.getElementById(`tab-${target}`).classList.add('active');
    if (target === 'rating') loadRating();
  });
});

document.getElementById('back-btn').addEventListener('click', () => {
  document.getElementById('screen-results').classList.add('hidden');
  document.getElementById('tab-games').classList.add('active');
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

// --- Будущие игры ---

async function loadGames() {
  const container = document.getElementById('games-list');
  try {
    const [gamesRes, myRegsRes] = await Promise.all([
      fetch('/api/games'),
      telegramId ? fetch(`/api/my-registrations/${telegramId}`) : Promise.resolve({ json: () => [] })
    ]);
    const games = await gamesRes.json();
    const myRegs = await myRegsRes.json();
    myRegistrations = new Set(myRegs);

    if (!games.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🃏</div><p>Пока нет запланированных игр</p></div>`;
    } else {
      container.innerHTML = games.slice(0, 3).map(game => renderGameCard(game)).join('');
      attachGameListeners();
    }
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

function renderGameCard(game) {
  const regCount = game.reg_count || 0;
  const fillPct = Math.min(100, (regCount / game.max_players) * 100);
  const isFull = regCount >= game.max_players;
  const isRegistered = myRegistrations.has(game.id);

  let btnHtml = '';
  if (!telegramId) {
    btnHtml = `<button class="btn" disabled>Войдите через Telegram</button>`;
  } else if (isRegistered) {
    btnHtml = `
      <div class="badge-registered">✓ Вы записаны</div>
      <button class="btn btn-cancel" data-game="${game.id}" data-action="cancel">Отменить запись</button>`;
  } else if (isFull) {
    btnHtml = `<button class="btn" disabled>Мест нет</button>`;
  } else {
    btnHtml = `<button class="btn btn-register" data-game="${game.id}" data-action="register">Записаться</button>`;
  }

  return `
    <div class="game-card" id="game-${game.id}">
      <div class="game-title">${game.title}</div>
      <div class="game-info">
        <span>📅 <strong>${formatDate(game.date)}</strong></span>
        ${game.buy_in ? `<span>💰 Бай-ин: <strong>${game.buy_in}</strong></span>` : ''}
        ${game.description ? `<span>📝 ${game.description}</span>` : ''}
      </div>
      <div class="game-slots">
        <div class="slots-bar"><div class="slots-fill" style="width:${fillPct}%"></div></div>
        <span class="slots-text">${regCount}/${game.max_players}</span>
      </div>
      ${btnHtml}
    </div>`;
}

function attachGameListeners() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gameId = btn.dataset.game;
      const action = btn.dataset.action;
      btn.disabled = true;
      btn.textContent = 'Загрузка...';
      try {
        if (action === 'register') await registerForGame(gameId);
        else await cancelRegistration(gameId);
        await loadGames();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = action === 'register' ? 'Записаться' : 'Отменить запись';
      }
    });
  });
}

async function registerForGame(gameId) {
  const res = await fetch(`/api/games/${gameId}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId, username, firstName })
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Ошибка', 'error'); throw new Error(); }
  showToast('Вы записаны на игру!', 'success');
  tg.HapticFeedback?.notificationOccurred('success');
}

async function cancelRegistration(gameId) {
  const res = await fetch(`/api/games/${gameId}/register`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId })
  });
  const data = await res.json();
  if (!res.ok) { showToast(data.error || 'Ошибка', 'error'); throw new Error(); }
  showToast('Запись отменена', '');
}

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
        <div class="past-game-date">🗓 ${g.label}</div>
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

async function openGameResults(colIndex, label) {
  document.getElementById('tab-games').classList.remove('active');
  const screen = document.getElementById('screen-results');
  screen.classList.remove('hidden');
  document.getElementById('results-title').textContent = `Результаты — ${label}`;
  const container = document.getElementById('results-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/game-results?col=${colIndex}`);
    const players = await res.json();

    if (!players.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>Нет данных</p></div>`;
      return;
    }

    container.innerHTML = players.map(p => {
      const placeClass = p.place === 1 ? 'gold' : p.place === 2 ? 'silver' : p.place === 3 ? 'bronze' : '';
      const place = p.place === 1 ? '🥇' : p.place === 2 ? '🥈' : p.place === 3 ? '🥉' : `${p.place}`;
      return `
        <div class="rating-item">
          <div class="rating-place ${placeClass}">${place}</div>
          <div class="rating-name">${p.first_name}</div>
          <div class="rating-score">${p.rating} очк.</div>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

// --- Рейтинг ---

let currentMonth = 'may';

document.addEventListener('click', e => {
  const btn = e.target.closest('.month-btn');
  if (!btn) return;
  document.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentMonth = btn.dataset.month;
  loadRating();
});

async function loadRating() {
  const container = document.getElementById('rating-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';

  try {
    const res = await fetch(`/api/rating?month=${currentMonth}`);
    const players = await res.json();

    if (!players.length) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🏆</div><p>Рейтинг пуст</p></div>`;
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
        <div class="rating-item ${isFinalist ? 'finalist' : 'non-finalist'}">
          <div class="rating-place ${placeClass}">${place}</div>
          <div class="rating-name">
            ${p.first_name}
            ${isFinalist ? '<span class="finalist-badge">финал</span>' : ''}
          </div>
          <div class="rating-score">${p.rating} очк.</div>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

// --- Авторизация по нику ---

let clubNickname = null;

async function initAuth() {
  if (!telegramId) {
    loadGames();
    loadPastGames();
    return;
  }

  const res = await fetch(`/api/profile/${telegramId}`);
  const profile = await res.json();

  if (profile && profile.first_name) {
    clubNickname = profile.first_name;
    loadGames();
    loadPastGames();
  } else {
    document.getElementById('screen-nickname').classList.remove('hidden');
  }
}

document.getElementById('nickname-cancel').addEventListener('click', () => {
  if (clubNickname) {
    document.getElementById('screen-nickname').classList.add('hidden');
  }
});

document.getElementById('profile-btn').addEventListener('click', () => {
  const input = document.getElementById('nickname-input');
  input.value = clubNickname || '';
  document.getElementById('screen-nickname').classList.remove('hidden');
});

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

  const res = await fetch('/api/profile/set-nickname', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ telegramId, nickname, username, firstName })
  });

  if (res.ok) {
    clubNickname = nickname;
    document.getElementById('screen-nickname').classList.add('hidden');
    loadGames();
    loadPastGames();
  } else {
    btn.disabled = false;
    btn.textContent = 'Войти в клуб';
    showToast('Ошибка, попробуй ещё раз', 'error');
  }
});

initAuth();
