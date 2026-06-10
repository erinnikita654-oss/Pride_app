// Снимает ответы всех GET-эндпоинтов и сохраняет в файл для сравнения до/после рефакторинга
import { writeFileSync } from 'fs';

const BASE = 'http://localhost:' + (process.env.TEST_PORT || 3100);
const OUT = process.argv[2] || 'baseline.json';

const endpoints = [
  '/api/rating',
  '/api/rating?month=june',
  '/api/rating?month=may',
  '/api/rating?month=april',
  '/api/rating?month=may2025',
  '/api/rating?month=nonexistent',
  '/api/player-stats?nickname=XR&month=may',
  '/api/player-stats?nickname=PRIDE&month=april',
  '/api/player-stats?nickname=' + encodeURIComponent('Ерин Никита') + '&month=may',
  '/api/player-stats?nickname=' + encodeURIComponent('Никита Ерин') + '&month=may2025',
  '/api/player-stats?nickname=nobody123',
  '/api/player-stats',
  '/api/past-games',
  '/api/all-past-games?month=may',
  '/api/all-past-games?month=june',
  '/api/all-past-games',
  '/api/all-players',
  '/api/player-overall?nickname=XR',
  '/api/player-overall?nickname=' + encodeURIComponent('Ерин Никита'),
  '/api/player-overall?nickname=' + encodeURIComponent('Начальник Голубей'),
  '/api/player-overall',
  '/api/legends',
  '/api/club-averages',
  '/api/game-results?col=5&month=may',
  '/api/game-results?col=999&month=may',
  '/api/game-results',
  '/api/player-tournaments?nickname=' + encodeURIComponent('Ерин Никита'),
  '/api/player-tournaments?nickname=XR',
  '/api/player-tournaments',
  '/api/club-stats',
  '/api/suggest-nickname?q=' + encodeURIComponent('ерин никита'),
  '/api/suggest-nickname?q=' + encodeURIComponent('никита ерин'),
  '/api/suggest-nickname?q=xr',
  '/api/suggest-nickname?q=' + encodeURIComponent('асакура'),
  '/api/suggest-nickname?q=a',
  '/api/games',
];

const results = {};
for (const ep of endpoints) {
  try {
    const r = await fetch(BASE + ep);
    let body;
    try { body = await r.json(); } catch { body = '(not json)'; }
    results[ep] = { status: r.status, body };
    console.log(r.status, ep);
  } catch (e) {
    results[ep] = { error: e.message };
    console.log('ERR', ep, e.message);
  }
}

writeFileSync(OUT, JSON.stringify(results, null, 2));
console.log('\nSaved to', OUT);
