// OpenAPI 3.0 спецификация PRIDE Poker Club API.
// Отдаётся на /api/docs (Swagger UI) и /api/openapi.json — только при DOCS_ENABLED=1.
// Описания согласованы со SPEC.md. Месяцы (param month) — ключи из SHEETS.

const MONTHS = [
  'june', 'may', 'april', 'march', 'february2026', 'january2026',
  'december2025', 'november2025', 'october2025', 'september2025',
  'august2025', 'july2025', 'june2025', 'may2025', 'april2025',
];

const monthParam = {
  name: 'month', in: 'query', required: false,
  description: 'Ключ месяца. По умолчанию — текущий (`june`).',
  schema: { type: 'string', enum: MONTHS, default: 'june' },
};
const nicknameParam = {
  name: 'nickname', in: 'query', required: true,
  description: 'Ник игрока (любой известный вариант — прогоняется через resolveName/ALIASES).',
  schema: { type: 'string' }, example: 'XR',
};
const telegramIdPath = {
  name: 'telegramId', in: 'path', required: true,
  description: 'Telegram ID пользователя.',
  schema: { type: 'string' }, example: '463021572',
};

const errorResponse = (desc) => ({
  description: desc,
  content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } },
});

export const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'PRIDE Poker Club API',
    version: '1.0.0',
    description:
      'API мини-аппа покерного клуба PRIDE. Рейтинги и статистика — из Google Sheets; ' +
      'игры, записи и профили — из Supabase. Все ответы JSON; ошибки — `{ error: string }` со статусом 400/404/500.',
  },
  servers: [
    { url: 'https://prideapp-production.up.railway.app', description: 'Production (Railway)' },
    { url: 'http://localhost:3000', description: 'Local' },
  ],
  tags: [
    { name: 'Рейтинг и статистика', description: 'Данные из Google-таблиц (рейтинги, турниры, игроки).' },
    { name: 'Игры и профиль', description: 'Данные из Supabase (записи на игры, профили, ники).' },
  ],
  paths: {
    '/api/rating': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Рейтинг месяца',
        description: 'Список игроков месяца с местами: `[{ first_name, rating, place }]`.',
        parameters: [monthParam],
        responses: {
          200: { description: 'Рейтинг месяца', content: { 'application/json': { example: [
            { first_name: 'Окунь', rating: 467, place: 1 },
            { first_name: 'Алексей Б.', rating: 278, place: 2 },
          ] } } },
          500: errorResponse('Ошибка загрузки таблицы'),
        },
      },
    },
    '/api/player-stats': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Статистика игрока за месяц',
        description: 'Разбивка по играм месяца.',
        parameters: [nicknameParam, monthParam],
        responses: {
          200: { description: 'Статистика игрока', content: { 'application/json': { example: {
            found: true, gamesPlayed: 2, totalPoints: 210, bestPoints: 183, bestPlace: 1,
            games: [{ label: '10 июн.', idx: 7, pts: 183, place: 1, total: 13, tournamentName: 'BLACK LION TOURNAMENT' }],
          } } } },
          400: errorResponse('Не указан nickname'),
          500: errorResponse('Ошибка сервера'),
        },
      },
    },
    '/api/player-overall': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Общая статистика игрока по всем месяцам',
        parameters: [nicknameParam],
        responses: {
          200: { description: 'Сводная статистика', content: { 'application/json': { example: {
            nickname: 'XR', totalGames: 40, totalPoints: 1850, allBestPoints: 358, allBestPlace: 1, totalWins: 3,
            months: [{ key: 'june', label: 'Июнь 2026', gamesPlayed: 4, monthTotal: 228, bestPoints: 135, bestPlace: 3, wins: 0 }],
          } } } },
          400: errorResponse('Не указан nickname'),
        },
      },
    },
    '/api/my-results/{telegramId}': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Общая статистика по telegram id',
        description: 'То же, что `/api/player-overall`, но ник берётся из Supabase по telegram id.',
        parameters: [telegramIdPath],
        responses: { 200: { description: 'Сводная статистика' }, 404: errorResponse('Пользователь не найден') },
      },
    },
    '/api/past-games': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Последние 3 игры текущего месяца',
        responses: { 200: { description: 'Список игр' } },
      },
    },
    '/api/all-past-games': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Все игры месяца (свежие первыми)',
        parameters: [monthParam],
        responses: { 200: { description: 'Список игр' } },
      },
    },
    '/api/game-results': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Результаты одной игры',
        description: 'Победитель — первым: `{ tournamentName, players: [{ first_name, rating, place }] }`.',
        parameters: [
          { name: 'col', in: 'query', required: true, description: 'Индекс колонки игры в листе.', schema: { type: 'integer' }, example: 7 },
          monthParam,
        ],
        responses: { 200: { description: 'Результаты игры' }, 400: errorResponse('Не указан col') },
      },
    },
    '/api/all-players': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Сводный список игроков за всё время',
        description: '`[{ name, totalPoints, months }]`.',
        responses: { 200: { description: 'Список игроков' } },
      },
    },
    '/api/player-tournaments': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Все турниры игрока (новые первыми)',
        parameters: [nicknameParam],
        responses: {
          200: { description: 'Турниры игрока', content: { 'application/json': { example: [
            { dateISO: '2026-06-10', label: '10 июн.', pts: 183, tournamentName: 'BLACK LION TOURNAMENT', isWinner: true, month: 'june', colIdx: 7 },
          ] } } },
          400: errorResponse('Не указан nickname'),
        },
      },
    },
    '/api/legends': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Легенды клуба — топ-15 по победам за всё время',
        responses: { 200: { description: 'Топ-15 по победам' } },
      },
    },
    '/api/club-stats': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Агрегаты клуба',
        description: 'Турниров проведено, игроков, участий, рекорд очков за игру, чемпион, самый активный.',
        responses: { 200: { description: 'Агрегаты клуба' } },
      },
    },
    '/api/club-averages': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Среднее очков за игру по клубу по месяцам',
        description: '`{ monthKey: { all, top } }` — `all` по всем участиям, `top` только по ТОП-30 игроков месяца. Линия сравнения на графике прогресса.',
        responses: { 200: { description: 'Средние по месяцам', content: { 'application/json': { example: {
          june: { all: 57, top: 66 }, may: { all: 52, top: 67 },
        } } } } },
      },
    },
    '/api/suggest-nickname': {
      get: {
        tags: ['Рейтинг и статистика'],
        summary: 'Подсказка ника при регистрации',
        description: '`{ exact, canonical?, suggestions: [0..1] }` — точное совпадение через алиасы либо fuzzy (Левенштейн ≤2 или подстрока, минимум 4 символа).',
        parameters: [{ name: 'q', in: 'query', required: true, description: 'Введённый ник (мин. 2 символа).', schema: { type: 'string' }, example: 'ерин никита' }],
        responses: { 200: { description: 'Результат подсказки' } },
      },
    },

    '/api/games': {
      get: {
        tags: ['Игры и профиль'],
        summary: 'Предстоящие игры с количеством записавшихся',
        responses: { 200: { description: 'Список игр' }, 500: errorResponse('Supabase недоступен') },
      },
    },
    '/api/games/{id}/register': {
      post: {
        tags: ['Игры и профиль'],
        summary: 'Запись на игру',
        description: 'Создаёт юзера при первом обращении; проверка дубля и лимита мест.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['telegramId'],
          properties: { telegramId: { type: 'string' }, username: { type: 'string' }, firstName: { type: 'string' } },
        }, example: { telegramId: '463021572', username: 'it_can_vizit', firstName: 'key' } } } },
        responses: { 200: { description: 'Записан' }, 400: errorResponse('Дубль или нет мест') },
      },
      delete: {
        tags: ['Игры и профиль'],
        summary: 'Отмена записи на игру',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['telegramId'], properties: { telegramId: { type: 'string' } },
        }, example: { telegramId: '463021572' } } } },
        responses: { 200: { description: 'Запись отменена' } },
      },
    },
    '/api/my-registrations/{telegramId}': {
      get: {
        tags: ['Игры и профиль'],
        summary: 'ID игр, на которые записан пользователь',
        parameters: [telegramIdPath],
        responses: { 200: { description: 'Массив id игр' } },
      },
    },
    '/api/profile/{telegramId}': {
      get: {
        tags: ['Игры и профиль'],
        summary: 'Профиль пользователя',
        description: '`{ first_name, username }` или `null`, если не зарегистрирован.',
        parameters: [telegramIdPath],
        responses: { 200: { description: 'Профиль или null', content: { 'application/json': { example: { first_name: 'key', username: 'it_can_vizit' } } } } },
      },
    },
    '/api/profile/set-nickname': {
      post: {
        tags: ['Игры и профиль'],
        summary: 'Установка ника',
        description: 'Upsert по telegram_id (мин. 2 символа). При ошибке записи в Supabase отдаёт 500 (а не «молчаливый успех»).',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['telegramId', 'nickname'],
          properties: { telegramId: { type: 'string' }, nickname: { type: 'string', minLength: 2 }, username: { type: 'string' }, firstName: { type: 'string' } },
        }, example: { telegramId: '463021572', nickname: 'key', username: 'it_can_vizit' } } } },
        responses: {
          200: { description: 'Сохранено', content: { 'application/json': { example: { success: true } } } },
          400: errorResponse('Ник слишком короткий'),
          500: errorResponse('База недоступна / не удалось сохранить ник'),
        },
      },
    },
    '/api/profile-stats/{telegramId}': {
      get: {
        tags: ['Игры и профиль'],
        summary: 'Краткая статистика текущего месяца для профиля',
        description: 'Очки, игры, лучший результат, место в рейтинге.',
        parameters: [telegramIdPath],
        responses: { 200: { description: 'Статистика профиля' }, 404: errorResponse('Не найден') },
      },
    },
  },
};
