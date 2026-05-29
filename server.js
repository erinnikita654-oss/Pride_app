import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Google Sheets ---

const SHEETS = {
  may:           '675526994',
  april:         '321291646',
  march:         '118856136',
  february2026:  '305465181',
  january2026:   '428800634',
  december2025:  '1294058741',
  november2025:  '1988320718',
  october2025:   '1379545018',
  september2025: '1793837804',
  august2025:    '679730074',
  july2025:      '27800889',
  june2025:      '1130704950',
  may2025:       '276254797',
  april2025:     '417165698',
};
const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/1t92y6HNg9RPPBENU6ydda8KqJoCSVRDEIZmDwjk0Jn0/export?format=csv&gid=';

const MONTH_NAMES = {
  may: 'Май 2026', april: 'Апрель 2026', march: 'Март 2026',
  february2026: 'Февраль 2026', january2026: 'Январь 2026',
  december2025: 'Декабрь 2025', november2025: 'Ноябрь 2025',
  october2025: 'Октябрь 2025', september2025: 'Сентябрь 2025',
  august2025: 'Август 2025', july2025: 'Июль 2025',
  june2025: 'Июнь 2025', may2025: 'Май 2025', april2025: 'Апрель 2025',
};
const MONTH_ORDER = ['may', 'april', 'march', 'february2026', 'january2026', 'december2025', 'november2025', 'october2025', 'september2025', 'august2025', 'july2025', 'june2025', 'may2025', 'april2025'];

const normalize = s => (s || '').trim().toLowerCase();

// Кэш листов: { gid -> { lines, ts } }
const sheetCache = {};
const CACHE_TTL = 300_000; // 5 минут

async function fetchSheetLines(gid) {
  const cached = sheetCache[gid];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.lines;

  const response = await fetch(SHEET_BASE + gid);
  if (!response.ok) throw new Error('Ошибка загрузки таблицы');
  const csv = await response.text();
  const lines = csv.trim().split('\n').map(line =>
    line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  );
  sheetCache[gid] = { lines, ts: Date.now() };
  return lines;
}

function detectSheetStructure(lines) {
  const header = lines[1] || [];
  const nameIdx  = header.findIndex(c => normalize(c) === 'игрок');
  const totalIdx = header.findIndex(c => normalize(c) === 'итого');
  const resolvedName  = nameIdx  >= 0 ? nameIdx  : 3;
  const resolvedTotal = totalIdx >= 0 ? totalIdx : 22;
  const dateCols = [];
  for (let i = resolvedName + 1; i < resolvedTotal; i++) {
    if (header[i] && header[i].trim() !== '') {
      dateCols.push({ label: header[i].trim(), idx: i });
    }
  }
  return { nameIdx: resolvedName, totalIdx: resolvedTotal, dateCols };
}

// --- Игры (Supabase) ---

app.get('/api/games', async (req, res) => {
  const { data, error } = await supabase
    .from('games_with_count')
    .select('*')
    .gte('date', new Date().toISOString())
    .order('date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/games/:id/register', async (req, res) => {
  const { telegramId, username, firstName } = req.body;
  const gameId = req.params.id;

  let { data: user } = await supabase
    .from('users').select('*').eq('telegram_id', telegramId).single();

  if (!user) {
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ telegram_id: telegramId, username, first_name: firstName, rating: 0 })
      .select().single();
    if (error) return res.status(500).json({ error: error.message });
    user = newUser;
  }

  const { data: existing } = await supabase
    .from('registrations').select('id')
    .eq('user_id', user.id).eq('game_id', gameId).single();

  if (existing) return res.status(400).json({ error: 'Вы уже записаны на эту игру' });

  const { data: game } = await supabase
    .from('games').select('*, registrations(count)').eq('id', gameId).single();

  if ((game.registrations[0]?.count || 0) >= game.max_players) {
    return res.status(400).json({ error: 'Мест нет, все места заняты' });
  }

  const { error } = await supabase
    .from('registrations').insert({ user_id: user.id, game_id: gameId });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.delete('/api/games/:id/register', async (req, res) => {
  const { telegramId } = req.body;
  const gameId = req.params.id;

  const { data: user } = await supabase
    .from('users').select('id').eq('telegram_id', telegramId).single();

  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const { error } = await supabase
    .from('registrations').delete()
    .eq('user_id', user.id).eq('game_id', gameId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/my-registrations/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('id').eq('telegram_id', req.params.telegramId).single();

  if (!user) return res.json([]);

  const { data, error } = await supabase
    .from('registrations').select('game_id').eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(r => r.game_id));
});

// --- Профиль (Supabase) ---

app.get('/api/profile/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('first_name, username')
    .eq('telegram_id', req.params.telegramId).single();
  res.json(user || null);
});

app.post('/api/profile/set-nickname', async (req, res) => {
  const { telegramId, nickname, username, firstName } = req.body;
  if (!nickname || nickname.trim().length < 2) {
    return res.status(400).json({ error: 'Ник слишком короткий' });
  }

  const { data: existing } = await supabase
    .from('users').select('id').eq('telegram_id', telegramId).single();

  if (existing) {
    await supabase.from('users')
      .update({ first_name: nickname.trim() }).eq('telegram_id', telegramId);
  } else {
    await supabase.from('users')
      .insert({ telegram_id: telegramId, username, first_name: nickname.trim(), rating: 0 });
  }

  res.json({ success: true });
});

app.get('/api/profile-stats/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('*').eq('telegram_id', req.params.telegramId).single();

  if (!user) return res.status(404).json({ error: 'Не найден' });

  const nickname = user.first_name || '';
  let monthPoints = 0, gamesPlayed = 0, bestGame = 0, rank = null, foundInSheet = false;

  try {
    const lines = await fetchSheetLines(SHEETS.may);
    const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
    const dataRows = lines.slice(2);

    const playerRow = dataRows.find(cols => normalize(cols[nameIdx]) === normalize(nickname));

    if (playerRow) {
      monthPoints = parseInt(playerRow[totalIdx]) || 0;
      for (const { idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts > 0) { gamesPlayed++; if (pts > bestGame) bestGame = pts; }
      }
      foundInSheet = true;
    }

    const ranked = dataRows
      .map(cols => ({ name: cols[nameIdx], pts: parseInt(cols[totalIdx]) || 0 }))
      .filter(p => p.name && p.pts > 0)
      .sort((a, b) => b.pts - a.pts);

    const idx = ranked.findIndex(p => normalize(p.name) === normalize(nickname));
    if (idx !== -1) rank = idx + 1;
  } catch (e) {}

  res.json({ nickname, monthPoints, gamesPlayed, bestGame, rank, foundInSheet, memberSince: user.created_at });
});

// --- Рейтинг (Google Sheets) ---

app.get('/api/rating', async (req, res) => {
  const gid = SHEETS[req.query.month] || SHEETS.may;
  try {
    const lines = await fetchSheetLines(gid);
    const { nameIdx, totalIdx } = detectSheetStructure(lines);

    const players = lines.slice(2)
      .map(cols => ({ first_name: cols[nameIdx] || '', rating: parseInt(cols[totalIdx]) || 0 }))
      .filter(p => p.first_name !== '' && p.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .map((p, i) => ({ ...p, place: i + 1 }));

    res.json(players);
  } catch (e) {
    res.status(500).json({ error: 'Не удалось загрузить рейтинг' });
  }
});

app.get('/api/player-stats', async (req, res) => {
  const { nickname, month } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Укажите nickname' });

  const gid = SHEETS[month] || SHEETS.may;
  try {
    const lines = await fetchSheetLines(gid);
    const { nameIdx, dateCols } = detectSheetStructure(lines);
    const dataRows = lines.slice(2);

    const playerRow = dataRows.find(cols => normalize(cols[nameIdx]) === normalize(nickname));
    if (!playerRow) return res.json({ found: false });

    let totalPoints = 0, gamesPlayed = 0, bestPoints = 0, bestPlace = null;
    const games = [];

    for (const { label, idx } of dateCols) {
      const pts = parseInt(playerRow[idx]) || 0;
      if (pts === 0) continue;

      const dayParticipants = dataRows
        .map(cols => parseInt(cols[idx]) || 0)
        .filter(p => p > 0)
        .sort((a, b) => b - a);

      const place = dayParticipants.indexOf(pts) + 1;
      gamesPlayed++;
      totalPoints += pts;
      if (pts > bestPoints) bestPoints = pts;
      if (bestPlace === null || place < bestPlace) bestPlace = place;
      games.push({ label, idx, pts, place, total: dayParticipants.length });
    }

    res.json({ found: true, gamesPlayed, totalPoints, bestPoints, bestPlace, games });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Прошедшие игры ---

app.get('/api/past-games', async (req, res) => {
  try {
    const lines = await fetchSheetLines(SHEETS.may);
    const { dateCols } = detectSheetStructure(lines);

    const withData = dateCols
      .filter(({ idx }) => lines.slice(2).some(row => parseInt(row[idx]) > 0))
      .map(({ label, idx }) => ({ label, colIndex: idx }));

    res.json(withData.slice(-3).reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Все прошедшие игры за выбранный месяц
app.get('/api/all-past-games', async (req, res) => {
  const gid = SHEETS[req.query.month] || SHEETS.may;
  try {
    const lines = await fetchSheetLines(gid);
    const { dateCols } = detectSheetStructure(lines);

    const withData = dateCols
      .filter(({ idx }) => lines.slice(2).some(row => parseInt(row[idx]) > 0))
      .map(({ label, idx }) => ({ label, colIndex: idx }))
      .reverse();

    res.json(withData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Мои результаты — статистика по всем месяцам
app.get('/api/my-results/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('*').eq('telegram_id', req.params.telegramId).single();

  if (!user) return res.status(404).json({ error: 'Не найден' });

  const nickname = user.first_name || '';
  const months = [];
  let totalGames = 0, totalPoints = 0, allBestPoints = 0, allBestPlace = null, totalWins = 0;

  for (const [key, gid] of Object.entries(SHEETS)) {
    try {
      const lines = await fetchSheetLines(gid);
      const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      const playerRow = dataRows.find(cols => normalize(cols[nameIdx]) === normalize(nickname));
      if (!playerRow) continue;

      const monthTotal = parseInt(playerRow[totalIdx]) || 0;
      if (monthTotal === 0) continue;

      let gamesPlayed = 0, bestPoints = 0, bestPlace = null, wins = 0;

      for (const { idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts === 0) continue;

        const scores = dataRows
          .map(cols => parseInt(cols[idx]) || 0)
          .filter(p => p > 0)
          .sort((a, b) => b - a);

        const place = scores.indexOf(pts) + 1;
        gamesPlayed++;
        if (pts > bestPoints) bestPoints = pts;
        if (bestPlace === null || place < bestPlace) bestPlace = place;
        if (place === 1) wins++;
      }

      totalGames  += gamesPlayed;
      totalPoints += monthTotal;
      if (bestPoints > allBestPoints) allBestPoints = bestPoints;
      if (allBestPlace === null || (bestPlace && bestPlace < allBestPlace)) allBestPlace = bestPlace;
      totalWins += wins;

      months.push({ key, label: MONTH_NAMES[key], gamesPlayed, monthTotal, bestPoints, bestPlace, wins });
    } catch (e) {}
  }

  months.sort((a, b) => MONTH_ORDER.indexOf(a.key) - MONTH_ORDER.indexOf(b.key));
  res.json({ nickname, totalGames, totalPoints, allBestPoints, allBestPlace, totalWins, months });
});

// Все игроки — сводный список по всем месяцам
app.get('/api/all-players', async (req, res) => {
  try {
    const playerMap = {};

    for (const [key, gid] of Object.entries(SHEETS)) {
      const lines = await fetchSheetLines(gid);
      const { nameIdx, totalIdx } = detectSheetStructure(lines);

      lines.slice(2).forEach(cols => {
        const name = (cols[nameIdx] || '').trim();
        const pts  = parseInt(cols[totalIdx]) || 0;
        if (!name || pts === 0) return;
        if (!playerMap[name]) playerMap[name] = { name, totalPoints: 0, months: 0 };
        playerMap[name].totalPoints += pts;
        playerMap[name].months++;
      });
    }

    const players = Object.values(playerMap)
      .sort((a, b) => b.totalPoints - a.totalPoints);

    res.json(players);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Общая статистика конкретного игрока по всем месяцам
app.get('/api/player-overall', async (req, res) => {
  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Укажите nickname' });

  const months = [];
  let totalGames = 0, totalPoints = 0, allBestPoints = 0, allBestPlace = null, totalWins = 0;

  for (const [key, gid] of Object.entries(SHEETS)) {
    try {
      const lines = await fetchSheetLines(gid);
      const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      const playerRow = dataRows.find(cols => normalize(cols[nameIdx]) === normalize(nickname));
      if (!playerRow) continue;

      const monthTotal = parseInt(playerRow[totalIdx]) || 0;
      if (monthTotal === 0) continue;

      let gamesPlayed = 0, bestPoints = 0, bestPlace = null, wins = 0;

      for (const { idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts === 0) continue;

        const scores = dataRows
          .map(cols => parseInt(cols[idx]) || 0)
          .filter(p => p > 0).sort((a, b) => b - a);

        const place = scores.indexOf(pts) + 1;
        gamesPlayed++;
        if (pts > bestPoints) bestPoints = pts;
        if (bestPlace === null || place < bestPlace) bestPlace = place;
        if (place === 1) wins++;
      }

      totalGames  += gamesPlayed;
      totalPoints += monthTotal;
      if (bestPoints > allBestPoints) allBestPoints = bestPoints;
      if (allBestPlace === null || (bestPlace && bestPlace < allBestPlace)) allBestPlace = bestPlace;
      totalWins += wins;

      months.push({ key, label: MONTH_NAMES[key], gamesPlayed, monthTotal, bestPoints, bestPlace, wins });
    } catch (e) {}
  }

  months.sort((a, b) => MONTH_ORDER.indexOf(a.key) - MONTH_ORDER.indexOf(b.key));
  res.json({ nickname, totalGames, totalPoints, allBestPoints, allBestPlace, totalWins, months });
});

// Легенды клуба — топ-10 по количеству первых мест за всё время
app.get('/api/legends', async (req, res) => {
  try {
    const wins = {};

    for (const gid of Object.values(SHEETS)) {
      const lines = await fetchSheetLines(gid);
      const { nameIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      for (const { idx } of dateCols) {
        // Найти максимальный результат в этой игре
        const scores = dataRows.map(cols => ({
          name: (cols[nameIdx] || '').trim(),
          pts: parseInt(cols[idx]) || 0,
        })).filter(p => p.name && p.pts > 0);

        if (!scores.length) continue;

        const maxPts = Math.max(...scores.map(p => p.pts));
        // Все кто набрал максимум — получают победу (учитываем ничью)
        scores.filter(p => p.pts === maxPts).forEach(p => {
          wins[p.name] = (wins[p.name] || 0) + 1;
        });
      }
    }

    const legends = Object.entries(wins)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15)
      .map((p, i) => ({ ...p, place: i + 1 }));

    res.json(legends);
  } catch (e) {
    console.error('Ошибка legends:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/game-results', async (req, res) => {
  const colIndex = parseInt(req.query.col);
  if (isNaN(colIndex)) return res.status(400).json({ error: 'Укажите col' });

  const gid = SHEETS[req.query.month] || SHEETS.may;
  try {
    const lines = await fetchSheetLines(gid);
    const { nameIdx } = detectSheetStructure(lines);

    const players = lines.slice(2)
      .map(cols => ({ first_name: cols[nameIdx] || '', rating: parseInt(cols[colIndex]) || 0 }))
      .filter(p => p.first_name !== '' && p.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .map((p, i) => ({ ...p, place: i + 1 }));

    res.json(players);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
