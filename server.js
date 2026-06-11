import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import Rollbar from 'rollbar';

dotenv.config();

const rollbar = new Rollbar({
  accessToken: '7e0282d8ad5b448fbdf25c0e7455e8a2',
  captureUncaught: true,
  captureUnhandledRejections: true,
  environment: 'production',
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --- Google Sheets: константы ---

// Старая публичная таблица — рейтинговые листы по месяцам (читается через CSV export)
const OLD_SPREADSHEET_ID = '1t92y6HNg9RPPBENU6ydda8KqJoCSVRDEIZmDwjk0Jn0';
// Новая приватная таблица — итоги турниров: дата, название, победитель (читается через API)
const NEW_SPREADSHEET_ID = '1LMiGLPmt2GQduqCg4SpWv5-9jUHKb5BIVw2PM5OjG7w';

const SHEETS = {
  june:          { id: OLD_SPREADSHEET_ID, gid: '1627150203' },
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

// Текущий месяц — дефолт для всех экранов; при переходе на новый месяц поменять здесь
const CURRENT_MONTH = 'june';

const MONTH_NAMES = {
  june: 'Июнь 2026',
  may: 'Май 2026', april: 'Апрель 2026', march: 'Март 2026',
  february2026: 'Февраль 2026', january2026: 'Январь 2026',
  december2025: 'Декабрь 2025', november2025: 'Ноябрь 2025',
  october2025: 'Октябрь 2025', september2025: 'Сентябрь 2025',
  august2025: 'Август 2025', july2025: 'Июль 2025',
  june2025: 'Июнь 2025', may2025: 'Май 2025', april2025: 'Апрель 2025',
};

const MONTH_ORDER = ['june', 'may', 'april', 'march', 'february2026', 'january2026', 'december2025', 'november2025', 'october2025', 'september2025', 'august2025', 'july2025', 'june2025', 'may2025', 'april2025'];

const SHEET_YEAR = {
  june: 2026, may: 2026, april: 2026, march: 2026,
  february2026: 2026, january2026: 2026,
  december2025: 2025, november2025: 2025, october2025: 2025,
  september2025: 2025, august2025: 2025, july2025: 2025,
  june2025: 2025, may2025: 2025, april2025: 2025,
};

// Турниры, не считающиеся победами (финалы сезонов)
const WINNER_EXCLUDE = ['FINAL OF THE MONTH', 'ЛЕТНЕГО СЕЗОНА', 'ВЕСЕННЕГО СЕЗОНА'];

// Игроки, скрытые из всех экранов (данные хранятся, но не отображаются)
const HIDDEN_PLAYERS = new Set(['klu4']);

// Исправления опечаток в датах новой таблицы
const WINNER_DATE_CORRECTIONS = { '03.02.2026': '02.02.2026' };

// Ручные записи турниров — опережающий источник, пока официальная таблица отстаёт.
// Формат: [{ date: "ДД.ММ.ГГГГ", name: "Название", winner: "Ник" }].
// Официальная таблица ВСЕГДА перекрывает: ручная запись влияет только на даты,
// которых ещё нет в официальной (см. loadNewTableMaps). Когда официальные данные
// появляются — ручная автоматически перестаёт учитываться, её можно удалить из файла.
let MANUAL_TOURNAMENTS = [];
try {
  MANUAL_TOURNAMENTS = JSON.parse(readFileSync(join(__dirname, 'manual-tournaments.json'), 'utf8'));
} catch (e) {
  MANUAL_TOURNAMENTS = [];
}

// --- Нормализация имён ---

const normalize = s => (s || '').trim().toLowerCase();

const ALIASES = {
  // Ручные алиасы
  'prosto khorosh': 'XR',
  'dranaqueen': 'DramaQueen',
  'нагибатор 2000': 'Нагибатор2000',
  'алексей б': 'Алексей B',
  'ростислав': 'Начальник Голубей',
  'vorokon': 'VoroKon',
  // Регистр
  'boris': 'BORIS',
  'coldvan': 'coldvan',
  'ddg': 'DDG',
  'doom': 'doom',
  'drnkl': 'drnkl',
  'las': 'LAS',
  'martyn': 'Martyn',
  'mclovin': 'McLovin',
  'persona': 'PERSONA',
  'rezus': 'rezus',
  'shegale': 'SheGale',
  'younghomie': 'YoungHomie',
  'zotka': 'zotka',
  'александр спб': 'Александр СПБ',
  'лао': 'Лао',
  'макс stfu': 'Макс stfu',
  'непросто саша': 'непросто саша',
  'валерий вв': 'ВалерийВВ',
  'владимир 13': 'Владимир13',
  'янах': 'Яна Х',
  'асакура хао': 'Асакура Хао',
  'codecayn': 'Codecayn',
  'doc': 'Doc',
  'kukuruska': 'Kukuruska',
  'stonefold': 'Stonefold',
  'trixter9871': 'Trixter9871',
  'zzz': 'ZZZ',
  'зеленый феникс': 'Зеленый феникс',
  'паровозик thomas': 'Паровозик THOMAS',
  'еду ниже': 'ЕдуНиже',
  'kamaz': 'KAMAZ',
  'q.switch': 'Q.Switch',
  'voop_voop': 'Voop_Voop',
  'два литра светлого': 'Два Литра Светлого',
  'оляля': 'ОляЛя',
  'cocacall': 'CocaCall',
  'ed': 'ED',
  'ra': 'RA',
  'начальник голубей': 'Начальник Голубей',
  // Имя/фамилия в разном порядке
  'никита ерин': 'Ерин Никита',
  'захаров андрей': 'Андрей Захаров',
  // Точка в конце
  'станислав к.': 'Станислав К',
  'алексей п.': 'Алексей П',
  'сергей ш.': 'Сергей Ш',
  'диана с.': 'Диана С',
  'анастасия г.': 'Анастасия Г',
  'стас в.': 'Стас В',
  'андрей ф.': 'Андрей Ф',
  'александр к.': 'Александр К',
  // Пробел / слитно / разделитель
  'discipline pay off': 'Discipline payoff',
  'иришка чикипики': 'Иришка Чики Пики',
  'coca call': 'CocaCall',
  'не просто саша': 'непросто саша',
  'voopvoop': 'Voop_Voop',
  'voop-voop': 'Voop_Voop',
  'mr.fish': 'MrFish',
  'артемкоз': 'Артём Коз',
  // е/ё, э/е
  'артём': 'Артем',
  'тёма аноним': 'Тема Аноним',
  'артём91': 'Артем91',
  'лёха': 'Леха',
  'данёчек': 'Данечек',
  'йённифер': 'Йеннифер',
  'аннет': 'Аннэт',
  'александр риэлтор': 'Александр Риелтор',
  // Апостроф / без
  "paratan": "ParaTan'",
  // Спецсимволы
  'nuriya\\_xo': 'Nuriya_Xo',
  // 0 вместо o
  'doomwo0w': 'DoomWoow',
  'doomw0w': 'DoomWoow',
  // Опечатки / варианты
  'хиханьки': 'хаханьки',
  'сашка жаркий': 'Саша Жаркий',
  'mohamed allin': 'Mohammed Allin',
  'kilfish': 'killfish',
  'kseniia k': 'Ksenia K',
  'ниолай': 'Николай',
  'chost': 'Ghost',
  'фямис': 'Фянис',
  'goggi': 'Gogi',
  'saxap': 'Saxar',
  'joper': 'Joker',
  'ирана19': 'Ирина 19',
  'dmitry': 'Dmitriy',
  'archi': 'Аrchi',
};

function resolveName(name) {
  const n = (name || '').trim();
  return ALIASES[normalize(n)] || n;
}

// Имя из таблицы (сырое) соответствует запрошенному нику? Резолвится только сырое имя
const matchesNick = (rawName, nickname) => normalize(resolveName(rawName)) === normalize(nickname);

// --- Даты ---

const RU_MONTHS = {
  'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
  'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
  'янв.':1,'февр.':2,'мар.':3,'апр.':4,'июн.':6,
  'июл.':7,'авг.':8,'сент.':9,'окт.':10,'нояб.':11,'дек.':12,
};

// "27 мая" / "4 июн." / "27.05" -> "27.05.2026"; null если не распарсилось
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

// --- Чтение листов ---

const CACHE_TTL = 300_000; // 5 минут

// Кэш листов: { "spreadsheetId:gid" -> { lines, ts } }
const sheetCache = {};

// Кэш названий листов приватной таблицы: { spreadsheetId -> { gid -> title } }
const sheetTitleCache = {};

const sheetsAuth = new google.auth.GoogleAuth({
  credentials: JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64 || 'e30=', 'base64').toString('utf8')),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheetsApi = google.sheets({ version: 'v4', auth: sheetsAuth });

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

function findPlayerRow(dataRows, nameIdx, nickname) {
  return dataRows.find(cols => matchesNick(cols[nameIdx], nickname));
}

// --- Новая таблица: победители и названия турниров ---

// Один проход по новой таблице даёт обе мапы (date -> winner, date -> tournament name)
let newTableCache = null;
let newTableTs = 0;

async function loadNewTableMaps() {
  if (newTableCache && Date.now() - newTableTs < CACHE_TTL) return newTableCache;
  const lines = await fetchSheetLines(NEW_SPREADSHEET_ID, '0');
  const winners = new Map();
  const names = new Map();
  lines.slice(1).forEach(row => {
    if (!row[0]) return;
    const date = WINNER_DATE_CORRECTIONS[row[0].trim()] || row[0].trim();
    if (row[1]) names.set(date, row[1].trim());
    if (row[2] && !WINNER_EXCLUDE.some(e => row[1]?.toUpperCase().includes(e))) {
      winners.set(date, resolveName(row[2].trim()));
    }
  });

  // Подмешиваем ручные записи только для того, чего ещё нет в официальной таблице.
  // Название и победитель проверяются раздельно: официальное название может уже быть,
  // а победитель — ещё нет (тогда подтянем победителя из ручной записи).
  for (const t of MANUAL_TOURNAMENTS) {
    if (!t.date) continue;
    const date = (WINNER_DATE_CORRECTIONS[t.date.trim()] || t.date.trim());
    if (t.name && !names.has(date)) names.set(date, t.name.trim());
    if (t.winner && !winners.has(date) && !WINNER_EXCLUDE.some(e => (t.name || '').toUpperCase().includes(e))) {
      winners.set(date, resolveName(t.winner.trim()));
    }
  }

  newTableCache = { winners, names };
  newTableTs = Date.now();
  return newTableCache;
}

const loadWinnersMap = async () => (await loadNewTableMaps()).winners;
const loadTournamentNamesMap = async () => (await loadNewTableMaps()).names;

// --- Общая статистика игрока по всем месяцам (для my-results и player-overall) ---

async function computePlayerOverall(nickname) {
  const months = [];
  let totalGames = 0, totalPoints = 0, allBestPoints = 0, allBestPlace = null, totalWins = 0;

  const winnersMap = await loadWinnersMap();

  for (const [key, sheet] of Object.entries(SHEETS)) {
    try {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      const playerRow = findPlayerRow(dataRows, nameIdx, nickname);
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
        const isWinner = actualWinner && matchesNick(actualWinner, nickname);

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
  return { nickname, totalGames, totalPoints, allBestPoints, allBestPlace, totalWins, months };
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
  const { telegramId, nickname, username } = req.body;
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
    const lines = await fetchSheetLines(SHEETS[CURRENT_MONTH].id, SHEETS[CURRENT_MONTH].gid);
    const { nameIdx, totalIdx, dateCols } = detectSheetStructure(lines);
    const dataRows = lines.slice(2);

    const playerRow = findPlayerRow(dataRows, nameIdx, nickname);

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
  const sheet = SHEETS[req.query.month] || SHEETS[CURRENT_MONTH];
  try {
    const lines = await fetchSheetLines(sheet.id, sheet.gid);
    const { nameIdx, totalIdx } = detectSheetStructure(lines);

    const players = lines.slice(2)
      .map(cols => ({ first_name: resolveName(cols[nameIdx]), rating: parseInt(cols[totalIdx]) || 0 }))
      .filter(p => p.first_name !== '' && p.rating > 0 && !HIDDEN_PLAYERS.has(normalize(p.first_name)))
      .sort((a, b) => b.rating - a.rating)
      .map((p, i) => ({ ...p, place: i + 1 }));

    res.json(players);
  } catch (e) {
    res.status(500).json({ error: 'Не удалось загрузить рейтинг' });
  }
});

// Статистика игрока за один месяц, с разбивкой по играм
app.get('/api/player-stats', async (req, res) => {
  const { nickname, month } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Укажите nickname' });

  const monthKey = month || CURRENT_MONTH;
  const sheet = SHEETS[monthKey] || SHEETS[CURRENT_MONTH];
  try {
    const [lines, { winners: winnersMap, names: namesMap }] = await Promise.all([
      fetchSheetLines(sheet.id, sheet.gid),
      loadNewTableMaps(),
    ]);
    const { nameIdx, dateCols } = detectSheetStructure(lines);
    const dataRows = lines.slice(2);

    const playerRow = findPlayerRow(dataRows, nameIdx, nickname);
    if (!playerRow) return res.json({ found: false });

    const year = SHEET_YEAR[monthKey] || 2026;
    let totalPoints = 0, gamesPlayed = 0, bestPoints = 0, bestPlace = null;
    const games = [];

    for (const { label, idx } of dateCols) {
      const pts = parseInt(playerRow[idx]) || 0;
      if (pts === 0) continue;

      const dateISO = ruDateToISO(label, year);
      const actualWinner = dateISO ? winnersMap.get(dateISO) : null;
      const isWinner = actualWinner && matchesNick(actualWinner, nickname);

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
      const tournamentName = namesMap.get(dateISO) || null;
      games.push({ label, idx, pts, place, total: dayParticipants.length, tournamentName });
    }

    res.json({ found: true, gamesPlayed, totalPoints, bestPoints, bestPlace, games });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Прошедшие игры ---

// Последние 3 игры текущего месяца
app.get('/api/past-games', async (req, res) => {
  try {
    const [lines, namesMap] = await Promise.all([
      fetchSheetLines(SHEETS[CURRENT_MONTH].id, SHEETS[CURRENT_MONTH].gid),
      loadTournamentNamesMap(),
    ]);
    const { dateCols } = detectSheetStructure(lines);

    const withData = dateCols
      .filter(({ idx }) => lines.slice(2).some(row => parseInt(row[idx]) > 0))
      .map(({ label, idx }) => {
        const dateISO = ruDateToISO(label, SHEET_YEAR[CURRENT_MONTH]);
        return { label, colIndex: idx, tournamentName: namesMap.get(dateISO) || null };
      });

    res.json(withData.slice(-3).reverse());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Все прошедшие игры за выбранный месяц
app.get('/api/all-past-games', async (req, res) => {
  const monthKey = req.query.month || CURRENT_MONTH;
  const sheet = SHEETS[monthKey] || SHEETS[CURRENT_MONTH];
  try {
    const [lines, namesMap] = await Promise.all([
      fetchSheetLines(sheet.id, sheet.gid),
      loadTournamentNamesMap(),
    ]);
    const { dateCols } = detectSheetStructure(lines);
    const year = SHEET_YEAR[monthKey] || 2026;

    const withData = dateCols
      .filter(({ idx }) => lines.slice(2).some(row => parseInt(row[idx]) > 0))
      .map(({ label, idx }) => {
        const dateISO = ruDateToISO(label, year);
        return { label, colIndex: idx, tournamentName: namesMap.get(dateISO) || null };
      })
      .reverse();

    res.json(withData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Мои результаты — статистика по всем месяцам (по telegram id)
app.get('/api/my-results/:telegramId', async (req, res) => {
  const { data: user } = await supabase
    .from('users').select('*').eq('telegram_id', req.params.telegramId).single();

  if (!user) return res.status(404).json({ error: 'Не найден' });

  res.json(await computePlayerOverall(user.first_name || ''));
});

// Общая статистика конкретного игрока по всем месяцам (по нику)
app.get('/api/player-overall', async (req, res) => {
  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Укажите nickname' });

  res.json(await computePlayerOverall(nickname));
});

// Все игроки — сводный список по всем месяцам
app.get('/api/all-players', async (req, res) => {
  try {
    const playerMap = {};

    for (const sheet of Object.values(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, totalIdx } = detectSheetStructure(lines);

      lines.slice(2).forEach(cols => {
        const name = resolveName(cols[nameIdx]);
        const pts  = parseInt(cols[totalIdx]) || 0;
        if (!name || pts === 0 || HIDDEN_PLAYERS.has(normalize(name))) return;
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

// Легенды клуба — топ-15 по количеству побед за всё время (из новой таблицы)
app.get('/api/legends', async (req, res) => {
  try {
    const winnersMap = await loadWinnersMap();
    const wins = {};

    winnersMap.forEach(winner => {
      const name = resolveName(winner);
      if (HIDDEN_PLAYERS.has(normalize(name))) return;
      wins[name] = (wins[name] || 0) + 1;
    });

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

// Результаты одной игры (колонка листа)
app.get('/api/game-results', async (req, res) => {
  const colIndex = parseInt(req.query.col);
  if (isNaN(colIndex)) return res.status(400).json({ error: 'Укажите col' });

  const monthKey = req.query.month || CURRENT_MONTH;
  const sheet = SHEETS[monthKey] || SHEETS[CURRENT_MONTH];
  try {
    const [lines, { winners: winnersMap, names: namesMap }] = await Promise.all([
      fetchSheetLines(sheet.id, sheet.gid),
      loadNewTableMaps(),
    ]);
    const { nameIdx, dateCols } = detectSheetStructure(lines);

    // Находим дату по индексу колонки
    const col = dateCols.find(c => c.idx === colIndex);
    const dateISO = col ? ruDateToISO(col.label, SHEET_YEAR[monthKey] || 2026) : null;
    const actualWinner = dateISO ? winnersMap.get(dateISO) : null;
    const winnerNorm = actualWinner ? normalize(actualWinner) : null;

    const all = lines.slice(2)
      .map(cols => ({ first_name: resolveName(cols[nameIdx]), rating: parseInt(cols[colIndex]) || 0 }))
      .filter(p => p.first_name !== '' && p.rating > 0 && !HIDDEN_PLAYERS.has(normalize(p.first_name)))
      .sort((a, b) => b.rating - a.rating);

    // Победитель — первым, остальные по очкам
    const winner = winnerNorm ? all.find(p => normalize(p.first_name) === winnerNorm) : null;
    const others = all.filter(p => !winnerNorm || normalize(p.first_name) !== winnerNorm);

    const result = [];
    if (winner) result.push({ ...winner, place: 1 });
    others.forEach((p, i) => result.push({ ...p, place: (winner ? i + 2 : i + 1) }));

    const tournamentName = dateISO ? (namesMap.get(dateISO) || null) : null;
    res.json({ tournamentName, players: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Все турниры игрока за всё время
app.get('/api/player-tournaments', async (req, res) => {
  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'Укажите nickname' });

  try {
    const { winners: winnersMap, names: tournamentMap } = await loadNewTableMaps();
    const tournaments = [];

    for (const [key, sheet] of Object.entries(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      const playerRow = findPlayerRow(dataRows, nameIdx, nickname);
      if (!playerRow) continue;

      const year = SHEET_YEAR[key];

      for (const { label, idx } of dateCols) {
        const pts = parseInt(playerRow[idx]) || 0;
        if (pts === 0) continue;

        const dateISO = ruDateToISO(label, year);
        if (!dateISO) continue;

        const actualWinner = winnersMap.get(dateISO);
        const isWinner = actualWinner && matchesNick(actualWinner, nickname);

        tournaments.push({
          dateISO,
          label,
          pts,
          tournamentName: tournamentMap.get(dateISO) || null,
          isWinner,
          month: key,
          colIdx: idx,
        });
      }
    }

    tournaments.sort((a, b) => {
      const [da, ma, ya] = a.dateISO.split('.').map(Number);
      const [db, mb, yb] = b.dateISO.split('.').map(Number);
      return new Date(yb, mb - 1, db) - new Date(ya, ma - 1, da);
    });

    res.json(tournaments);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Статистика клуба
app.get('/api/club-stats', async (req, res) => {
  try {
    const winnersMap = await loadWinnersMap();

    // Победы по игрокам (из новой таблицы)
    const winsCount = {};
    winnersMap.forEach(winner => {
      if (HIDDEN_PLAYERS.has(normalize(winner))) return;
      winsCount[winner] = (winsCount[winner] || 0) + 1;
    });
    const champion = Object.entries(winsCount).sort((a, b) => b[1] - a[1])[0];

    // Статистика из рейтинговых листов
    let totalGames = 0, totalParticipations = 0, bestResult = 0, bestResultPlayer = '';
    const playerGamesCount = {};

    for (const sheet of Object.values(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, dateCols } = detectSheetStructure(lines);
      const dataRows = lines.slice(2);

      totalGames += dateCols.filter(({ idx }) => dataRows.some(row => parseInt(row[idx]) > 0)).length;

      dataRows.forEach(cols => {
        const name = resolveName(cols[nameIdx]);
        if (!name || HIDDEN_PLAYERS.has(normalize(name))) return;
        for (const { idx } of dateCols) {
          const pts = parseInt(cols[idx]) || 0;
          if (pts > 0) {
            totalParticipations++;
            playerGamesCount[name] = (playerGamesCount[name] || 0) + 1;
            if (pts > bestResult) { bestResult = pts; bestResultPlayer = name; }
          }
        }
      });
    }

    const mostActive = Object.entries(playerGamesCount).sort((a, b) => b[1] - a[1])[0];

    res.json({
      totalTournaments: winnersMap.size,
      totalPlayers: Object.keys(playerGamesCount).length,
      totalGames,
      totalParticipations,
      bestResult,
      bestResultPlayer,
      champion: champion ? { name: champion[0], wins: champion[1] } : null,
      mostActive: mostActive ? { name: mostActive[0], games: mostActive[1] } : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Среднее очков за игру по клубу для каждого месяца (для сравнения на графике игрока).
// Ответ: { monthKey: { all, top } } — all: сумма всех очков месяца / число всех участий;
// top: то же, но только по ТОП-30 игроков месяца по сумме очков (активное ядро клуба).
const CLUB_AVG_TOP_N = 30;
app.get('/api/club-averages', async (req, res) => {
  try {
    const result = {};
    for (const [key, sheet] of Object.entries(SHEETS)) {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, dateCols } = detectSheetStructure(lines);
      const players = new Map(); // имя -> { sum, games }
      lines.slice(2).forEach(cols => {
        const name = resolveName(cols[nameIdx]);
        if (!name || HIDDEN_PLAYERS.has(normalize(name))) return;
        for (const { idx } of dateCols) {
          const pts = parseInt(cols[idx]) || 0;
          if (pts > 0) {
            const p = players.get(name) || { sum: 0, games: 0 };
            p.sum += pts;
            p.games++;
            players.set(name, p);
          }
        }
      });
      const avgOf = list => {
        let sum = 0, games = 0;
        for (const p of list) { sum += p.sum; games += p.games; }
        return games > 0 ? Math.round(sum / games) : 0;
      };
      const allList = [...players.values()];
      const topList = [...allList].sort((a, b) => b.sum - a.sum).slice(0, CLUB_AVG_TOP_N);
      result[key] = { all: avgOf(allList), top: avgOf(topList) };
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Подсказка ника при регистрации ---

// Расстояние Левенштейна
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

app.get('/api/suggest-nickname', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.json({ exact: false, suggestions: [] });

  const input = q.trim();
  const inputNorm = normalize(input);
  const inputNoSpace = inputNorm.replace(/\s/g, '');

  // Собираем всех игроков из всех листов
  const playerSet = new Set();
  for (const sheet of Object.values(SHEETS)) {
    try {
      const lines = await fetchSheetLines(sheet.id, sheet.gid);
      const { nameIdx, totalIdx } = detectSheetStructure(lines);
      lines.slice(2).forEach(cols => {
        const name = resolveName(cols[nameIdx]);
        const pts = parseInt(cols[totalIdx]) || 0;
        if (name && pts > 0 && !HIDDEN_PLAYERS.has(normalize(name))) playerSet.add(name);
      });
    } catch (e) {}
  }

  const players = [...playerSet];

  // 1. Точное совпадение (с учётом регистра через алиасы)
  const exactMatch = players.find(p => normalize(resolveName(p)) === normalize(resolveName(input)));
  if (exactMatch) return res.json({ exact: true, canonical: resolveName(exactMatch), suggestions: [] });

  // 2. Поиск похожих — только для ников длиннее 3 символов
  if (inputNorm.length <= 3) return res.json({ exact: false, suggestions: [] });

  const scored = players.map(p => {
    const pNorm = normalize(p);
    const pNoSpace = pNorm.replace(/\s/g, '');
    const dist = levenshtein(inputNorm, pNorm);
    const distNoSpace = levenshtein(inputNoSpace, pNoSpace);
    // "contains" только если оба ника достаточно длинные
    const contains = inputNorm.length >= 4 && pNorm.length >= 4 && (pNorm.includes(inputNorm) || inputNorm.includes(pNorm));
    return { name: p, dist: Math.min(dist, distNoSpace), contains };
  });

  const suggestions = scored
    .filter(p => p.dist <= 2 || p.contains)
    .sort((a, b) => {
      if (a.contains && !b.contains) return -1;
      if (!a.contains && b.contains) return 1;
      return a.dist - b.dist;
    })
    .slice(0, 1)
    .map(p => p.name);

  res.json({ exact: false, suggestions });
});

app.use(rollbar.errorHandler());

app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));
