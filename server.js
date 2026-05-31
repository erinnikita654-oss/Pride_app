import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

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

const OLD_SPREADSHEET_ID = '1t92y6HNg9RPPBENU6ydda8KqJoCSVRDEIZmDwjk0Jn0';

const SHEETS = {
  may:           { id: OLD_SPREADSHEET_ID, gid: '675526994' },
  april:         { id: OLD_SPREADSHEET_ID, gid: '321291646' },
  march:         { id: OLD_SPREADSHEET_ID, gid: '118856136' },
  february2026:  { id: OLD_SPREADSHEET_ID, gid: '305465181' },
  january2026:   { id: OLD_SPREADSHEET_ID, gid: '428800634' },
  december2025:  { id: OLD_SPREADSHEET_ID, gid: '1294058741' },
  november2025:  { id: OLD_SPREADSHEET_ID, gid: '1988320718' },
  october2025:   { id: OLD_SPREADSHEET_ID, gid: '1379545018' },
  september2025: { id: OLD_SPREADSHEET_ID, gid: '1793837804' },
  august2025:    { id: OLD_SPREADSHEET_ID, gid: '679730074' },
  july2025:      { id: OLD_SPREADSHEET_ID, gid: '27800889' },
  june2025:      { id: OLD_SPREADSHEET_ID, gid: '1130704950' },
  may2025:       { id: OLD_SPREADSHEET_ID, gid: '276254797' },
  april2025:     { id: OLD_SPREADSHEET_ID, gid: '417165698' },
};

const sheetsAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64 || 'e30=', 'base64').toString('utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth: sheetsAuth });

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

const ALIASES = {
  'prosto khorosh': 'XR',
  'dranaqueen': 'DramaQueen',
  'нагибатор 2000': 'Нагибатор2000',
  'алексей б': 'Алексей B',
};

function resolveName(name) {
  const n = (name || '').trim();
  return ALIASES[normalize(n)] || n;
}

// Кэш листов: { "spreadsheetId:gid" -> { lines, ts } }
const sheetCache = {};
const CACHE_TTL = 300_000; // 5 минут

// Кэш названий листов: { spreadsheetId -> { gid -> title } }
const sheetTitleCache = {};

async function getSheetTitle(spreadsheetId, gid) {
  if (!sheetTitleCache[spreadsheetId]) {
    const meta = await sheetsApi.spreadsheets.get({ spreadsheetId });
    sheetTitleCache[spreadsheetId] = {};
    for (const sheet of meta.data.sheets) {
      sheetTitleCache[spreadsheetId][sheet.properties.sheetId.toString()] = sheet.properties.title;
    }
  }
  return sheetTitleCache[spreadsheetId][gid];
}

async function fetchSheetLines(spreadsheetId, gid) {
  const cacheKey = `${spreadsheetId}:${gid}`;
  const cached = sheetCache[cacheKey];
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.lines;

  let lines;

  if (spreadsheetId === OLD_SPREADSHEET_ID) {
    // Старая публичная таблица — читаем через CSV
    const response = await fetch(
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`
    );
    if (!response.ok) throw new Error('Ошибка загрузки таблицы');
    const csv = await response.text();
    lines = csv.trim().split('\n').map(line =>
      line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
    );
  } else {
    // Приватная таблица — читаем через API
    const title = await getSheetTitle(spreadsheetId, gid);
    const apiResponse = await sheetsApi.spreadsheets.values.get({
      spreadsheetId,
      range: title,
    });
    lines = (apiResponse.data.values || []).map(row =>
      row.map(c => (c || '').toString().trim())
    );
  }

  sheetCache[cacheKey] = { lines, ts: Date.now() };
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
    const lines = await fetchSheetLines(SHEETS.may.id, SHEETS.may.gid);
    const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
    const dataRows = lines.slice(2);

    const playerRow = dataRows.find(cols => normalize(resolveName(cols[nameIdx])) === normalize(nickname));

    if (playerRow) {
      monthPoints = parseInt(playerRow[totalIdx]) || 0;
      for (const { idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts > 0) { gamesPlayed++; if (pts > bestGame) bestGame = pts; }
      }
      foundInSheet = true;
    }

    const ranked = dataRows
      .map(cols => ({ name: resolveName(cols[nameIdx]), pts: parseInt(cols[totalIdx]) || 0 }))
      .filter(p => p.name && p.pts > 0)
      .sort((a, b) => b.pts - a.pts);

    const idx = ranked.findIndex(p => normalize(p.name) === normalize(nickname));
    if (idx !== -1) rank = idx + 1;
  } catch (e) {}

  res.json({ nickname, monthPoints, gamesPlayed, bestGame, rank, foundInSheet, memberSince: user.created_at });
});

// --- Рейтинг (Google Sheets) ---

app.get('/api/rating', async (req, res) => {
  const sheet = SHEETS[req.query.month] || SHEETS.may;
  try {
    const lines = await fetchSheetLines(sheet.id, sheet.gid);
    const { nameIdx, totalIdx } = detectSheetStructure(lines);

    const players = lines.slice(2)
      .map(cols => ({ first_name: resolveName(cols[nameIdx]), rating: parseInt(cols[totalIdx]) || 0 }))
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

  const monthKey = month || 'may';
  const sheet = SHEETS[monthKey] || SHEETS.may;
  try {
    const [lines, winnersMap] = await Promise.all([
      fetchSheetLines(sheet.id, sheet.gid),
      loadWinnersMap(),
    ]);
    const { nameIdx, dateCols } = detectSheetStructure(lines);
    const dataRows = lines.slice(2);

    const playerRow = dataRows.find(cols => normalize(resolveName(cols[nameIdx])) === normalize(nickname));
    if (!playerRow) return res.json({ found: false });

    const year = SHEET_YEAR[monthKey] || 2026;
    let totalPoints = 0, gamesPlayed = 0, bestPoints = 0, bestPlace = null;
    const games = [];

    for (const { label, idx } of dateCols) {
      const pts = parseInt(playerRow[idx]) || 0;
      if (pts === 0) continue;

      const dateISO = ruDateToISO(label, year);
      const actualWinner = dateISO ? winnersMap.get(dateISO) : null;
      const isWinner = actualWinner && normalize(resolveName(actualWinner)) === normalize(nickname);

      const dayParticipants = dataRows
        .map(cols => parseInt(cols[idx]) || 0)
        .filter(p => p > 0)
        .sort((a, b) => b - a);

      const scoreRank = dayParticipants.indexOf(pts) + 1;
      const place = isWinner ? 1 : (scoreRank === 1 && actualWinner ? 2 : scoreRank);

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
    const lines = await fetchSheetLines(SHEETS.may.id, SHEETS.may.gid);
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
  const sheet = SHEETS[req.query.month] || SHEETS.may;
  try {
    const lines = await fetchSheetLines(sheet.id, sheet.gid);
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

  const winnersMap = await loadWinnersMap();

  for (const [key, sheet] of Object.entries(SHEETS)) {
    try {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      const playerRow = dataRows.find(cols => normalize(resolveName(cols[nameIdx])) === normalize(nickname));
      if (!playerRow) continue;

      const monthTotal = parseInt(playerRow[totalIdx]) || 0;
      if (monthTotal === 0) continue;

      const year = SHEET_YEAR[key];
      let gamesPlayed = 0, bestPoints = 0, bestPlace = null, wins = 0;

      for (const { label, idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts === 0) continue;

        const dateISO = ruDateToISO(label, year);
        const actualWinner = dateISO ? winnersMap.get(dateISO) : null;
        const isWinner = actualWinner && normalize(resolveName(actualWinner)) === normalize(nickname);

        const scores = dataRows.map(cols => parseInt(cols[idx]) || 0).filter(p => p > 0).sort((a, b) => b - a);
        const scoreRank = scores.indexOf(pts) + 1;
        const place = isWinner ? 1 : (scoreRank === 1 && actualWinner ? 2 : scoreRank);

        gamesPlayed++;
        if (pts > bestPoints) bestPoints = pts;
        if (bestPlace === null || place < bestPlace) bestPlace = place;
        if (isWinner) wins++;
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

    for (const [key, sheet] of Object.entries(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, totalIdx } = detectSheetStructure(lines);

      lines.slice(2).forEach(cols => {
        const name = resolveName(cols[nameIdx]);
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

  const winnersMap = await loadWinnersMap();

  for (const [key, sheet] of Object.entries(SHEETS)) {
    try {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      const playerRow = dataRows.find(cols => normalize(resolveName(cols[nameIdx])) === normalize(nickname));
      if (!playerRow) continue;

      const monthTotal = parseInt(playerRow[totalIdx]) || 0;
      if (monthTotal === 0) continue;

      const year = SHEET_YEAR[key];
      let gamesPlayed = 0, bestPoints = 0, bestPlace = null, wins = 0;

      for (const { label, idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts === 0) continue;

        const dateISO = ruDateToISO(label, year);
        const actualWinner = dateISO ? winnersMap.get(dateISO) : null;
        const isWinner = actualWinner && normalize(resolveName(actualWinner)) === normalize(nickname);

        const scores = dataRows.map(cols => parseInt(cols[idx]) || 0).filter(p => p > 0).sort((a, b) => b - a);
        const scoreRank = scores.indexOf(pts) + 1;
        const place = isWinner ? 1 : (scoreRank === 1 && actualWinner ? 2 : scoreRank);

        gamesPlayed++;
        if (pts > bestPoints) bestPoints = pts;
        if (bestPlace === null || place < bestPlace) bestPlace = place;
        if (isWinner) wins++;
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

    for (const sheet of Object.values(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      for (const { idx } of dateCols) {
        // Найти максимальный результат в этой игре
        const scores = dataRows.map(cols => ({
          name: resolveName(cols[nameIdx]),
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

  const monthKey = req.query.month || 'may';
  const sheet = SHEETS[monthKey] || SHEETS.may;
  try {
    const [lines, winnersMap] = await Promise.all([
      fetchSheetLines(sheet.id, sheet.gid),
      loadWinnersMap(),
    ]);
    const { nameIdx, dateCols } = detectSheetStructure(lines);

    // Находим дату по индексу колонки
    const col = dateCols.find(c => c.idx === colIndex);
    const dateISO = col ? ruDateToISO(col.label, SHEET_YEAR[monthKey] || 2026) : null;
    const actualWinner = dateISO ? winnersMap.get(dateISO) : null;
    const winnerNorm = actualWinner ? normalize(actualWinner) : null;

    const all = lines.slice(2)
      .map(cols => ({ first_name: resolveName(cols[nameIdx]), rating: parseInt(cols[colIndex]) || 0 }))
      .filter(p => p.first_name !== '' && p.rating > 0)
      .sort((a, b) => b.rating - a.rating);

    // Победитель — первым, остальные по очкам
    const winner = winnerNorm ? all.find(p => normalize(p.first_name) === winnerNorm) : null;
    const others = all.filter(p => !winnerNorm || normalize(p.first_name) !== winnerNorm);

    const result = [];
    if (winner) result.push({ ...winner, place: 1 });
    others.forEach((p, i) => result.push({ ...p, place: (winner ? i + 2 : i + 1) }));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


const NEW_SPREADSHEET_ID = '1LMiGLPmt2GQduqCg4SpWv5-9jUHKb5BIVw2PM5OjG7w';

const SHEET_YEAR = {
  may: 2026, april: 2026, march: 2026,
  february2026: 2026, january2026: 2026,
  december2025: 2025, november2025: 2025, october2025: 2025,
  september2025: 2025, august2025: 2025, july2025: 2025,
  june2025: 2025, may2025: 2025, april2025: 2025,
};
const RU_MONTHS = {
  'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
  'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
  'янв.':1,'февр.':2,'мар.':3,'апр.':4,'июн.':6,
  'июл.':7,'авг.':8,'сент.':9,'окт.':10,'нояб.':11,'дек.':12,
};

function ruDateToISO(label, year) {
  const s = label.trim();
  if (/^\d{1,2}\.\d{2}$/.test(s)) {
    const [d, m] = s.split('.');
    return `${d.padStart(2,'0')}.${m}.${year}`;
  }
  const parts = s.split(' ');
  if (parts.length < 2) return null;
  const day = parseInt(parts[0]);
  const month = RU_MONTHS[parts[1].toLowerCase()];
  if (!day || !month) return null;
  return `${String(day).padStart(2,'0')}.${String(month).padStart(2,'0')}.${year}`;
}

const WINNER_EXCLUDE = ['FINAL OF THE MONTH', 'SEASON TOURNAMENT', 'ЛЕТНЕГО СЕЗОНА'];
const WINNER_DATE_CORRECTIONS = { '03.02.2026': '02.02.2026' };

let winnersMapCache = null;
let winnersMapTs = 0;

async function loadWinnersMap() {
  if (winnersMapCache && Date.now() - winnersMapTs < CACHE_TTL) return winnersMapCache;
  const lines = await fetchSheetLines(NEW_SPREADSHEET_ID, '0');
  const map = new Map();
  lines.slice(1).forEach(row => {
    if (!row[0] || !row[2]) return;
    if (WINNER_EXCLUDE.some(e => row[1]?.toUpperCase().includes(e))) return;
    const date = WINNER_DATE_CORRECTIONS[row[0].trim()] || row[0].trim();
    map.set(date, resolveName(row[2].trim()));
  });
  winnersMapCache = map;
  winnersMapTs = Date.now();
  return map;
}

app.get('/api/analyze-new-sheet', async (req, res) => {
  const NEW_ID = '1LMiGLPmt2GQduqCg4SpWv5-9jUHKb5BIVw2PM5OjG7w';
  try {
    const newLines = await fetchSheetLines(NEW_ID, '0');
    const EXCLUDE = ['FINAL OF THE MONTH', 'SEASON TOURNAMENT', 'ЛЕТНЕГО СЕЗОНА'];
    const dataRows = newLines.slice(1).filter(r => r[0] && r[2] && !EXCLUDE.some(e => r[1]?.toUpperCase().includes(e)));
    const DATE_CORRECTIONS = { '03.02.2026': '02.02.2026' };
    const newWinners = dataRows.map(r => r[2].trim());
    const newDates   = new Set(dataRows.map(r => DATE_CORRECTIONS[r[0].trim()] || r[0].trim()));

    // Собираем игроков и даты из старых таблиц
    const oldPlayers = new Set();
    const oldDates   = new Set();

    for (const [key, sheet] of Object.entries(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, dateCols } = detectSheetStructure(lines);
      lines.slice(2).forEach(cols => {
        const name = resolveName(cols[nameIdx]);
        if (name) oldPlayers.add(normalize(name));
      });
      const year = SHEET_YEAR[key];
      dateCols.forEach(({ label }) => {
        const iso = ruDateToISO(label, year);
        if (iso) oldDates.add(iso);
      });
    }

    // Победители: применяем алиас к именам из новой таблицы
    const missingWinners = [...new Set(
      newWinners.filter(w => !oldPlayers.has(normalize(resolveName(w))))
    )];

    // Даты не найденные в старых таблицах
    const missingDates = [...newDates].filter(d => !oldDates.has(d)).sort();

    // Показываем примеры дат из разных листов
    const dateSamples = {};
    for (const [key, sheet] of Object.entries(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { dateCols } = detectSheetStructure(lines);
      if (dateCols.length > 0) dateSamples[key] = dateCols.slice(0, 3).map(d => d.label);
    }

    // Строки с несовпадающими датами
    const missingRows = newLines.slice(1).filter(r => r[0] && missingDates.includes(r[0].trim()));

    res.json({ totalTournaments: dataRows.length, missingWinners, missingDates, missingRows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
