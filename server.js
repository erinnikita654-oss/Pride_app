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
  may:   '675526994',
  april: '321291646',
  march: '118856136',
};
const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/1t92y6HNg9RPPBENU6ydda8KqJoCSVRDEIZmDwjk0Jn0/export?format=csv&gid=';

const normalize = s => (s || '').trim().toLowerCase();

// Кэш листов: { gid -> { lines, ts } }
const sheetCache = {};
const CACHE_TTL = 60_000; // 60 секунд

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
      .slice(0, 10)
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

  try {
    const lines = await fetchSheetLines(SHEETS.may);
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
