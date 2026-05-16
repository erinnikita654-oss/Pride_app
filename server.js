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

const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/1t92y6HNg9RPPBENU6ydda8KqJoCSVRDEIZmDwjk0Jn0/export?format=csv&gid=675526994';

// Получить рейтинг из Google Sheets
app.get('/api/rating', async (req, res) => {
  try {
    const response = await fetch(SHEET_CSV_URL);
    if (!response.ok) throw new Error('Ошибка загрузки таблицы');

    const csv = await response.text();
    const lines = csv.trim().split('\n');

    const players = lines
      .map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        const name = cols[3] || '';    // колонка D
        const points = parseInt(cols[22]) || 0; // колонка W
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
