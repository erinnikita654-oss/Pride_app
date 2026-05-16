import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Получить все игры
app.get('/api/games', async (req, res) => {
  const { data, error } = await supabase
    .from('games_with_count')
    .select('*')
    .gte('date', new Date().toISOString())
    .order('date', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Записаться на игру
app.post('/api/games/:id/register', async (req, res) => {
  const { telegramId, username, firstName } = req.body;
  const gameId = req.params.id;

  // Найти или создать пользователя
  let { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', telegramId)
    .single();

  if (!user) {
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ telegram_id: telegramId, username, first_name: firstName, rating: 0 })
      .select()
      .single();
    if (error) return res.status(500).json({ error: error.message });
    user = newUser;
  }

  // Проверить, не записан ли уже
  const { data: existing } = await supabase
    .from('registrations')
    .select('id')
    .eq('user_id', user.id)
    .eq('game_id', gameId)
    .single();

  if (existing) return res.status(400).json({ error: 'Вы уже записаны на эту игру' });

  // Проверить количество мест
  const { data: game } = await supabase
    .from('games')
    .select('*, registrations(count)')
    .eq('id', gameId)
    .single();

  const regCount = game.registrations[0]?.count || 0;
  if (regCount >= game.max_players) {
    return res.status(400).json({ error: 'Мест нет, все места заняты' });
  }

  const { error } = await supabase
    .from('registrations')
    .insert({ user_id: user.id, game_id: gameId });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// Отменить запись
app.delete('/api/games/:id/register', async (req, res) => {
  const { telegramId } = req.body;
  const gameId = req.params.id;

  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId)
    .single();

  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  const { error } = await supabase
    .from('registrations')
    .delete()
    .eq('user_id', user.id)
    .eq('game_id', gameId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

const SHEETS = {
  may:   '675526994',
  april: '321291646',
};
const SHEET_BASE = 'https://docs.google.com/spreadsheets/d/1t92y6HNg9RPPBENU6ydda8KqJoCSVRDEIZmDwjk0Jn0/export?format=csv&gid=';

// Получить рейтинг из Google Sheets
app.get('/api/rating', async (req, res) => {
  const month = req.query.month || 'may';
  const gid = SHEETS[month] || SHEETS.may;

  try {
    const response = await fetch(SHEET_BASE + gid);
    if (!response.ok) throw new Error('Ошибка загрузки таблицы');

    const csv = await response.text();
    const lines = csv.trim().split('\n');

    const players = lines
      .map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const name = cols[3] || '';
        const points = parseInt(cols[22]) || 0;
        return { first_name: name, rating: points };
      })
      .filter(p => p.first_name !== '' && p.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .map((p, i) => ({ ...p, place: i + 1 }));

    res.json(players);
  } catch (e) {
    console.error('Ошибка рейтинга:', e.message);
    res.status(500).json({ error: 'Не удалось загрузить рейтинг' });
  }
});

// Вспомогательная функция — парсинг CSV листа
async function fetchSheetLines(gid) {
  const response = await fetch(SHEET_BASE + gid);
  if (!response.ok) throw new Error('Ошибка загрузки таблицы');
  const csv = await response.text();
  return csv.trim().split('\n').map(line =>
    line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
  );
}

// Статистика конкретного игрока за месяц
app.get('/api/player-stats', async (req, res) => {
  const { nickname, month } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Укажите nickname' });

  const gid = SHEETS[month] || SHEETS.may;

  try {
    const lines = await fetchSheetLines(gid);
    const dataRows = lines.slice(2);

    // Найти колонки дат (между 4 и 21 включительно)
    const header = lines[1] || [];
    const dateCols = [];
    for (let i = 4; i < 22; i++) {
      if (header[i] && header[i].trim() !== '') dateCols.push({ label: header[i], idx: i });
    }

    const normalize = s => (s || '').trim().toLowerCase();
    const playerRow = dataRows.find(cols => normalize(cols[3]) === normalize(nickname));

    if (!playerRow) return res.json({ found: false });

    let totalPoints = 0, gamesPlayed = 0, bestPoints = 0, bestPlace = null;
    const games = [];

    for (const { label, idx } of dateCols) {
      const pts = parseInt(playerRow[idx]) || 0;
      if (pts === 0) continue;

      // Место среди участников этой игры
      const dayParticipants = dataRows
        .map(cols => parseInt(cols[idx]) || 0)
        .filter(p => p > 0)
        .sort((a, b) => b - a);

      const place = dayParticipants.indexOf(pts) + 1;

      gamesPlayed++;
      totalPoints += pts;
      if (pts > bestPoints) bestPoints = pts;
      if (bestPlace === null || place < bestPlace) bestPlace = place;

      games.push({ label, pts, place, total: dayParticipants.length });
    }

    res.json({ found: true, gamesPlayed, totalPoints, bestPoints, bestPlace, games });
  } catch (e) {
    console.error('Ошибка player-stats:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Получить прошедшие игры (последние 3 даты с данными)
app.get('/api/past-games', async (req, res) => {
  try {
    const lines = await fetchSheetLines(SHEETS.may);

    // Строка 2 (индекс 1) — заголовки с датами
    const header = lines[1] || [];

    // Найти колонки с датами (между Игрок=3 и Итого=22)
    const dateCols = [];
    for (let i = 4; i < 22; i++) {
      if (header[i] && header[i] !== '') {
        // Проверить что есть хоть один игрок с данными в этой колонке
        const hasData = lines.slice(2).some(row => parseInt(row[i]) > 0);
        if (hasData) dateCols.push({ label: header[i], colIndex: i });
      }
    }

    // Вернуть последние 3
    res.json(dateCols.slice(-3).reverse());
  } catch (e) {
    console.error('Ошибка past-games:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Результаты конкретной игры по индексу колонки
app.get('/api/game-results', async (req, res) => {
  const colIndex = parseInt(req.query.col);
  if (isNaN(colIndex)) return res.status(400).json({ error: 'Укажите col' });

  try {
    const lines = await fetchSheetLines(SHEETS.may);

    const players = lines.slice(2)
      .map(cols => ({
        first_name: cols[3] || '',
        rating: parseInt(cols[colIndex]) || 0,
      }))
      .filter(p => p.first_name !== '' && p.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .map((p, i) => ({ ...p, place: i + 1 }));

    res.json(players);
  } catch (e) {
    console.error('Ошибка game-results:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Получить базовый профиль
app.get('/api/profile/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('first_name, username')
    .eq('telegram_id', req.params.telegramId)
    .single();
  res.json(user || null);
});

// Получить статистику профиля
app.get('/api/profile-stats/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_id', req.params.telegramId)
    .single();

  if (!user) return res.status(404).json({ error: 'Не найден' });

  const nickname = user.first_name || '';
  let monthPoints = 0, gamesPlayed = 0, bestGame = 0, rank = null, foundInSheet = false;

  try {
    const lines = await fetchSheetLines(SHEETS.may);
    const dataRows = lines.slice(2);

    const normalize = s => (s || '').trim().toLowerCase();
    const playerRow = dataRows.find(cols => normalize(cols[3]) === normalize(nickname));

    if (playerRow) {
      monthPoints = parseInt(playerRow[22]) || 0;
      for (let i = 4; i < 22; i++) {
        const pts = parseInt(playerRow[i]) || 0;
        if (pts > 0) { gamesPlayed++; if (pts > bestGame) bestGame = pts; }
      }
      foundInSheet = true;
    }

    const ranked = dataRows
      .map(cols => ({ name: cols[3], pts: parseInt(cols[22]) || 0 }))
      .filter(p => p.name && p.pts > 0)
      .sort((a, b) => b.pts - a.pts);

    const idx = ranked.findIndex(p => normalize(p.name) === normalize(nickname));
    if (idx !== -1) rank = idx + 1;
  } catch (e) {}

  res.json({
    nickname,
    monthPoints,
    gamesPlayed,
    bestGame,
    rank,
    foundInSheet,
    memberSince: user.created_at,
  });
});

// Сохранить ник
app.post('/api/profile/set-nickname', async (req, res) => {
  const { telegramId, nickname, username, firstName } = req.body;
  if (!nickname || nickname.trim().length < 2) {
    return res.status(400).json({ error: 'Ник слишком короткий' });
  }

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId)
    .single();

  if (existing) {
    await supabase.from('users').update({ first_name: nickname.trim() }).eq('telegram_id', telegramId);
  } else {
    await supabase.from('users').insert({ telegram_id: telegramId, username, first_name: nickname.trim(), rating: 0 });
  }

  res.json({ success: true });
});

// Получить мои записи
app.get('/api/my-registrations/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', req.params.telegramId)
    .single();

  if (!user) return res.json([]);

  const { data, error } = await supabase
    .from('registrations')
    .select('game_id')
    .eq('user_id', user.id);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data.map(r => r.game_id));
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
