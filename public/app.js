const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

const user = tg.initDataUnsafe?.user || null;
const telegramId = user?.id || null;
const username = user?.username || '';
const firstName = user?.first_name || 'Игрок';

let myRegistrations = new Set();

// Навигация по вкладкам
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`tab-${target}`).classList.add('active');
    if (target === 'rating') loadRating();
  });
});

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

// Загрузка игр
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
      return;
    }

    container.innerHTML = games.map(game => renderGameCard(game)).join('');
    attachGameListeners();
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
      <button class="btn btn-cancel" data-game="${game.id}" data-action="cancel">Отменить запись</button>
    `;
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
    </div>
  `;
}

function attachGameListeners() {
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const gameId = btn.dataset.game;
      const action = btn.dataset.action;

      btn.disabled = true;
      btn.textContent = 'Загрузка...';

      try {
        if (action === 'register') {
          await registerForGame(gameId);
        } else {
          await cancelRegistration(gameId);
        }
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

let currentMonth = 'may';

document.addEventListener('click', e => {
  const btn = e.target.closest('.month-btn');
  if (!btn) return;
  document.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentMonth = btn.dataset.month;
  loadRating();
});

// Загрузка рейтинга
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

    // Разделитель перед незачётными
    let addedDivider = false;

    container.innerHTML = players.map((p) => {
      const placeNum = p.place;
      const isFinalist = placeNum <= FINAL_SPOTS;
      const placeClass = placeNum === 1 ? 'gold' : placeNum === 2 ? 'silver' : placeNum === 3 ? 'bronze' : '';
      const place = placeNum === 1 ? '🥇' : placeNum === 2 ? '🥈' : placeNum === 3 ? '🥉' : `${placeNum}`;
      const name = p.first_name || 'Игрок';

      let divider = '';
      if (!isFinalist && !addedDivider) {
        addedDivider = true;
        divider = `<div class="rating-divider">— вне финала —</div>`;
      }

      return `${divider}
        <div class="rating-item ${isFinalist ? 'finalist' : 'non-finalist'}">
          <div class="rating-place ${placeClass}">${place}</div>
          <div class="rating-name">
            ${name}
            ${isFinalist ? '<span class="finalist-badge">финал</span>' : ''}
          </div>
          <div class="rating-score">${p.rating} очк.</div>
        </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠️</div><p>Ошибка загрузки</p></div>`;
  }
}

loadGames();
