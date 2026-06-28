// ============================================================
// Фича «Вызовы» (дуэли игроков). Роуты под флагом CHALLENGES_ENABLED.
// registerChallengeRoutes(app, deps) — deps прокидываются из server.js,
// чтобы переиспользовать supabase, чтение листов и резолв ников.
// ============================================================

// Аккаунты-двойники с чужим ником — НЕ участвуют в вызовах (см. концепт).
// Канонические: Асакура ХАО → 1719603564, Ерин Никита → 200646836.
const DUP_EXCLUDED = new Set(['199021029', '601656888', '55441020']);

const ACCEPT_DEADLINE_HOUR_MSK = 20; // фикс: принять можно до 20:00 МСК игрового дня
const MAX_DUELS_PER_TOURNAMENT = 2;

export function registerChallengeRoutes(app, deps) {
  const {
    supabase, fetchSheetLines, detectSheetStructure, findPlayerRow,
    ruDateToISO, SHEETS, SHEET_YEAR, bot,
  } = deps;

  // Отправить уведомление в Telegram (best-effort, не ломает флоу при ошибке)
  async function notify(telegramId, text) {
    if (!bot) return;
    try { await bot.sendMessage(telegramId, text, { parse_mode: 'HTML' }); }
    catch (e) { console.error('[notify] не удалось отправить', telegramId, e.message); }
  }

  async function tournamentLabel(tournamentId) {
    const { data: t } = await supabase.from('games').select('title, sheet_date').eq('id', tournamentId).single();
    return t ? (t.title || t.sheet_date) : 'турнир';
  }

  const enabled = () => process.env.CHALLENGES_ENABLED === '1';
  const guard = (req, res, next) => enabled() ? next() : res.status(404).json({ error: 'Раздел недоступен' });

  // Дедлайн принятия: 20:00 МСК (UTC+3) дня турнира по sheet_date 'ДД.ММ.ГГГГ'.
  function acceptDeadline(sheetDate) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(sheetDate || '');
    if (!m) return null;
    const [, d, mo, y] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, ACCEPT_DEADLINE_HOUR_MSK - 3, 0, 0));
  }

  // Очки игрока (по нику) за дату 'ДД.ММ.ГГГГ' из рейтинговых листов. null — не играл/не найдено.
  async function pointsForDate(nickname, sheetDate) {
    for (const [key, sheet] of Object.entries(SHEETS)) {
      try {
        const lines = await fetchSheetLines(sheet.id, sheet.gid);
        const { nameIdx, dateCols } = detectSheetStructure(lines);
        const col = dateCols.find(c => ruDateToISO(c.label, SHEET_YEAR[key]) === sheetDate);
        if (!col) continue;
        const row = findPlayerRow(lines.slice(2), nameIdx, nickname);
        if (!row) return null;
        const pts = parseInt(row[col.idx]);
        return Number.isFinite(pts) && pts > 0 ? pts : null;
      } catch (e) { /* следующий лист */ }
    }
    return null;
  }

  // Профиль игрока (ник) по telegram_id.
  async function nickOf(telegramId) {
    const { data } = await supabase.from('users').select('first_name').eq('telegram_id', telegramId).single();
    return data?.first_name || null;
  }

  // Сколько у игрока ПРИНЯТЫХ дуэлей на турнире.
  async function acceptedCount(tournamentId, telegramId) {
    const { count } = await supabase.from('challenges')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId).eq('status', 'accepted')
      .or(`challenger_id.eq.${telegramId},opponent_id.eq.${telegramId}`);
    return count || 0;
  }

  // ---- Список игроков, которых можно вызвать (app-юзеры, без себя и дубль-аккаунтов) ----
  app.get('/api/challenges/players', guard, async (req, res) => {
    const exclude = String(req.query.exclude || '');
    const { data, error } = await supabase.from('users')
      .select('telegram_id, first_name, username').order('first_name');
    if (error) return res.status(500).json({ error: error.message });
    const list = (data || [])
      .filter(u => String(u.telegram_id) !== exclude && !DUP_EXCLUDED.has(String(u.telegram_id)) && u.first_name)
      .map(u => ({ telegramId: String(u.telegram_id), name: u.first_name, username: u.username || null }));
    res.json(list);
  });

  // ---- Список ближайших турниров (для UI вызова) ----
  app.get('/api/challenges/tournaments', guard, async (req, res) => {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase.from('games')
      .select('id, title, starts_at, sheet_date, link, description')
      .gte('starts_at', nowIso).order('starts_at', { ascending: true });
    if (error) return res.status(500).json({ error: error.message });
    res.json(data || []);
  });

  // ---- Создать вызов ----
  app.post('/api/challenges', guard, async (req, res) => {
    const { tournamentId, challengerId, opponentId } = req.body || {};
    if (!tournamentId || !challengerId || !opponentId)
      return res.status(400).json({ error: 'Не хватает параметров' });
    if (String(challengerId) === String(opponentId))
      return res.status(400).json({ error: 'Нельзя вызвать самого себя' });
    if (DUP_EXCLUDED.has(String(challengerId)) || DUP_EXCLUDED.has(String(opponentId)))
      return res.status(400).json({ error: 'Этот аккаунт не участвует в вызовах' });

    // оба — пользователи приложения
    const { data: users } = await supabase.from('users').select('telegram_id')
      .in('telegram_id', [challengerId, opponentId]);
    if (!users || users.length < 2)
      return res.status(400).json({ error: 'Вызвать можно только того, кто заходил в приложение' });

    // турнир существует и ещё не прошёл дедлайн
    const { data: t } = await supabase.from('games')
      .select('id, sheet_date, starts_at').eq('id', tournamentId).single();
    if (!t) return res.status(404).json({ error: 'Турнир не найден' });
    const dl = acceptDeadline(t.sheet_date);
    if (dl && Date.now() > dl.getTime())
      return res.status(400).json({ error: 'Приём вызовов на этот турнир закрыт (после 20:00)' });

    const { data, error } = await supabase.from('challenges')
      .insert({ tournament_id: tournamentId, challenger_id: String(challengerId), opponent_id: String(opponentId) })
      .select().single();
    if (error) {
      if (error.code === '23505')
        return res.status(409).json({ error: 'Дуэль с этим игроком на этот турнир уже есть' });
      return res.status(500).json({ error: error.message });
    }
    // Уведомление 1: тебе бросили вызов
    const chName = await nickOf(challengerId);
    const tLabel = await tournamentLabel(tournamentId);
    notify(opponentId, `⚔️ <b>${chName || 'Игрок'}</b> вызвал тебя на дуэль!\n\nТурнир: ${tLabel}\n\nОткрой приложение, чтобы принять или отклонить.`);
    res.json({ success: true, challenge: data });
  });

  // ---- Принять вызов ----
  app.post('/api/challenges/:id/accept', guard, async (req, res) => {
    const { telegramId } = req.body || {};
    const { data: ch } = await supabase.from('challenges').select('*').eq('id', req.params.id).single();
    if (!ch) return res.status(404).json({ error: 'Вызов не найден' });
    if (String(ch.opponent_id) !== String(telegramId))
      return res.status(403).json({ error: 'Принять может только вызванный игрок' });
    if (ch.status !== 'pending') return res.status(400).json({ error: 'Вызов уже не активен' });

    const { data: t } = await supabase.from('games').select('sheet_date').eq('id', ch.tournament_id).single();
    const dl = acceptDeadline(t?.sheet_date);
    if (dl && Date.now() > dl.getTime())
      return res.status(400).json({ error: 'Время принятия истекло (после 20:00)' });

    // лимит 2 принятых дуэли на турнир — у обоих
    for (const uid of [ch.challenger_id, ch.opponent_id]) {
      if (await acceptedCount(ch.tournament_id, uid) >= MAX_DUELS_PER_TOURNAMENT)
        return res.status(400).json({ error: 'У одного из игроков уже 2 дуэли на этот турнир' });
    }

    const { error } = await supabase.from('challenges')
      .update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', ch.id);
    if (error) return res.status(500).json({ error: error.message });

    // авто-отмена: если у игрока стало 2 принятых — гасим его прочие висящие на этот турнир
    for (const uid of [ch.challenger_id, ch.opponent_id]) {
      if (await acceptedCount(ch.tournament_id, uid) >= MAX_DUELS_PER_TOURNAMENT) {
        await supabase.from('challenges').update({ status: 'auto_cancelled' })
          .eq('tournament_id', ch.tournament_id).eq('status', 'pending')
          .or(`challenger_id.eq.${uid},opponent_id.eq.${uid}`);
      }
    }
    // Уведомление 2: твой вызов приняли
    const accName = await nickOf(ch.opponent_id);
    const accLabel = await tournamentLabel(ch.tournament_id);
    await notify(ch.challenger_id, `✅ <b>${accName || 'Игрок'}</b> принял твой вызов!\n\nТурнир: ${accLabel}\n\nДуэль начнётся!`);
    res.json({ success: true });
  });

  // ---- Отклонить вызов ----
  app.post('/api/challenges/:id/decline', guard, async (req, res) => {
    const { telegramId } = req.body || {};
    const { data: ch } = await supabase.from('challenges').select('*').eq('id', req.params.id).single();
    if (!ch) return res.status(404).json({ error: 'Вызов не найден' });
    if (String(ch.opponent_id) !== String(telegramId))
      return res.status(403).json({ error: 'Отклонить может только вызванный игрок' });
    if (ch.status !== 'pending') return res.status(400).json({ error: 'Вызов уже не активен' });
    const { error } = await supabase.from('challenges')
      .update({ status: 'declined', responded_at: new Date().toISOString() }).eq('id', ch.id);
    if (error) return res.status(500).json({ error: error.message });
    // Уведомление 3: твой вызов отклонили
    const decName = await nickOf(ch.opponent_id);
    const decLabel = await tournamentLabel(ch.tournament_id);
    await notify(ch.challenger_id, `❌ <b>${decName || 'Игрок'}</b> отклонил твой вызов.\n\nТурнир: ${decLabel}`);
    res.json({ success: true });
  });

  // ---- Отозвать свой вызов ----
  app.post('/api/challenges/:id/cancel', guard, async (req, res) => {
    const { telegramId } = req.body || {};
    const { data: ch } = await supabase.from('challenges').select('*').eq('id', req.params.id).single();
    if (!ch) return res.status(404).json({ error: 'Вызов не найден' });
    if (String(ch.challenger_id) !== String(telegramId))
      return res.status(403).json({ error: 'Отозвать может только вызывающий' });
    if (ch.status !== 'pending') return res.status(400).json({ error: 'Вызов уже не активен' });
    const { error } = await supabase.from('challenges').update({ status: 'cancelled' }).eq('id', ch.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  });

  // ---- Входящие вызовы (мне, ожидают ответа) ----
  app.get('/api/challenges/incoming/:telegramId', guard, async (req, res) => {
    const { data, error } = await supabase.from('challenges')
      .select('*, games(title, sheet_date, starts_at)')
      .eq('opponent_id', req.params.telegramId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(await withNicks(data));
  });

  // ---- Мои дуэли (активные + история) ----
  app.get('/api/challenges/mine/:telegramId', guard, async (req, res) => {
    const id = req.params.telegramId;
    const { data, error } = await supabase.from('challenges')
      .select('*, games(title, sheet_date, starts_at)')
      .or(`challenger_id.eq.${id},opponent_id.eq.${id}`)
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(await withNicks(data));
  });

  // ---- Публичная доска дуэлей (активные + завершённые) ----
  app.get('/api/challenges/board', guard, async (req, res) => {
    const { data, error } = await supabase.from('challenges')
      .select('*, games(title, sheet_date, starts_at)')
      .in('status', ['accepted', 'pending', 'resolved']).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(await withNicks(data));
  });

  // ---- Количество непросмотренных событий (для бейджа) ----
  // Считает: входящие вызовы (pending, opponent=me) +
  //          ответы на мои вызовы (accepted/declined, challenger=me, responded_at > since) +
  //          результаты моих дуэлей (resolved, resolved_at > since).
  app.get('/api/challenges/unseen/:telegramId', guard, async (req, res) => {
    const id = req.params.telegramId;
    const since = req.query.since || '1970-01-01T00:00:00Z';
    let count = 0;
    // входящие вызовы (всегда)
    const { count: inc } = await supabase.from('challenges').select('id', { count: 'exact', head: true })
      .eq('opponent_id', id).eq('status', 'pending');
    count += (inc || 0);
    // ответы на мои вызовы (accepted/declined после since)
    const { count: resp } = await supabase.from('challenges').select('id', { count: 'exact', head: true })
      .eq('challenger_id', id).in('status', ['accepted', 'declined']).gte('responded_at', since);
    count += (resp || 0);
    // результаты моих дуэлей (resolved после since)
    const { count: res1 } = await supabase.from('challenges').select('id', { count: 'exact', head: true })
      .or(`challenger_id.eq.${id},opponent_id.eq.${id}`).eq('status', 'resolved').gte('resolved_at', since);
    count += (res1 || 0);
    res.json({ count });
  });

  // ---- Таблица дуэлянтов (W–L–D) ----
  app.get('/api/challenges/standings', guard, async (req, res) => {
    const { data, error } = await supabase.from('challenge_standings').select('*');
    if (error) return res.status(500).json({ error: error.message });
    // подмешиваем ник (player = telegram_id)
    const ids = (data || []).map(r => r.player);
    const { data: us } = await supabase.from('users').select('telegram_id, first_name').in('telegram_id', ids);
    const nameMap = Object.fromEntries((us || []).map(u => [String(u.telegram_id), u.first_name]));
    res.json((data || []).map(r => ({ ...r, name: nameMap[String(r.player)] || r.player })));
  });

  // ---- Расчёт результатов турнира по очкам (ручной/админский триггер) ----
  app.post('/api/challenges/resolve', guard, async (req, res) => {
    const { tournamentId } = req.body || {};
    if (!tournamentId) return res.status(400).json({ error: 'Не указан tournamentId' });
    const result = await resolveTournament(tournamentId);
    res.json(result);
  });

  // Подмешать ники участников к списку вызовов.
  async function withNicks(rows) {
    if (!rows || !rows.length) return rows || [];
    const ids = [...new Set(rows.flatMap(r => [r.challenger_id, r.opponent_id]))];
    const { data: us } = await supabase.from('users').select('telegram_id, first_name').in('telegram_id', ids);
    const m = Object.fromEntries((us || []).map(u => [String(u.telegram_id), u.first_name]));
    return rows.map(r => ({
      ...r,
      challenger_name: m[String(r.challenger_id)] || r.challenger_id,
      opponent_name: m[String(r.opponent_id)] || r.opponent_id,
    }));
  }

  // Расчёт всех принятых дуэлей турнира по очкам из листа.
  async function resolveTournament(tournamentId) {
    const { data: t } = await supabase.from('games').select('sheet_date').eq('id', tournamentId).single();
    if (!t?.sheet_date) return { error: 'У турнира нет sheet_date' };
    const { data: duels } = await supabase.from('challenges').select('*')
      .eq('tournament_id', tournamentId).eq('status', 'accepted');
    let resolved = 0, voided = 0;
    for (const ch of (duels || [])) {
      const [chNick, opNick] = await Promise.all([nickOf(ch.challenger_id), nickOf(ch.opponent_id)]);
      const [chPts, opPts] = await Promise.all([
        chNick ? pointsForDate(chNick, t.sheet_date) : null,
        opNick ? pointsForDate(opNick, t.sheet_date) : null,
      ]);
      let patch;
      if (chPts == null || opPts == null) {
        patch = { status: 'void', result: 'void' }; voided++;
      } else {
        const result = chPts > opPts ? 'challenger_win' : opPts > chPts ? 'opponent_win' : 'draw';
        patch = { status: 'resolved', result, challenger_points: chPts, opponent_points: opPts }; resolved++;
      }
      await supabase.from('challenges')
        .update({ ...patch, resolved_at: new Date().toISOString() }).eq('id', ch.id);
      // Уведомление 4: результат дуэли (обоим)
      if (patch.status === 'resolved') {
        const tLabel4 = await tournamentLabel(ch.tournament_id);
        const winMsg = (winner, loser, wPts, lPts) =>
          `🏆 <b>Результат дуэли</b>\n\n${tLabel4}\n\n<b>${winner}</b> ${wPts} : ${lPts} ${loser}\n\nПобеда!`;
        const loseMsg = (winner, loser, wPts, lPts) =>
          `😤 <b>Результат дуэли</b>\n\n${tLabel4}\n\n<b>${winner}</b> ${wPts} : ${lPts} ${loser}\n\nВ следующий раз повезёт!`;
        const drawMsg = (a, b, pts) =>
          `🤝 <b>Результат дуэли</b>\n\n${tLabel4}\n\n${a} ${pts} : ${pts} ${b}\n\nНичья!`;
        if (patch.result === 'challenger_win') {
          notify(ch.challenger_id, winMsg(chNick, opNick, chPts, opPts));
          notify(ch.opponent_id, loseMsg(chNick, opNick, chPts, opPts));
        } else if (patch.result === 'opponent_win') {
          notify(ch.opponent_id, winMsg(opNick, chNick, opPts, chPts));
          notify(ch.challenger_id, loseMsg(opNick, chNick, opPts, chPts));
        } else {
          notify(ch.challenger_id, drawMsg(chNick, opNick, chPts));
          notify(ch.opponent_id, drawMsg(opNick, chNick, chPts));
        }
      }
    }
    return { tournamentId, resolved, voided, total: (duels || []).length };
  }

  // ---- Парсер расписания → турниры в games ----
  // Формат:
  //   День недели
  //   ДД месяц, ЧЧ:ММ
  //   Название (ссылка)
  //   Описание (опционально)
  //   (пустая строка — разделитель)
  const RU_MONTHS_PARSE = {
    'января':1,'февраля':2,'марта':3,'апреля':4,'мая':5,'июня':6,
    'июля':7,'августа':8,'сентября':9,'октября':10,'ноября':11,'декабря':12,
  };
  function parseSchedule(text) {
    const blocks = text.trim().split(/\n\s*\n/).filter(b => b.trim());
    const results = [];
    for (const block of blocks) {
      const lines = block.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length < 2) continue;
      // строка 0 — день недели (пропускаем), строка 1 — дата+время
      let dateLineIdx = 0;
      // если первая строка — день недели (Среда, Четверг...), пропускаем
      if (/^(понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)$/i.test(lines[0])) dateLineIdx = 1;
      const dateLine = lines[dateLineIdx];
      const dm = dateLine.match(/(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)[,.]?\s*(\d{1,2}):(\d{2})/i);
      if (!dm) continue;
      const day = parseInt(dm[1]), month = RU_MONTHS_PARSE[dm[2].toLowerCase()], hh = parseInt(dm[3]), mm = parseInt(dm[4]);
      const year = month >= 1 ? 2026 : 2026; // текущий год
      const pad = n => String(n).padStart(2, '0');
      const sheetDate = `${pad(day)}.${pad(month)}.${year}`;
      const mskOffset = 3;
      const startsAt = new Date(Date.UTC(year, month - 1, day, hh - mskOffset, mm)).toISOString();

      const titleLine = lines[dateLineIdx + 1] || '';
      const linkMatch = titleLine.match(/\((https?:\/\/[^)]+)\)/);
      const link = linkMatch ? linkMatch[1] : null;
      const title = titleLine.replace(/\s*\(https?:\/\/[^)]+\)\s*/g, '').trim();

      const description = lines.slice(dateLineIdx + 2).join(' ').trim() || null;

      results.push({ title, sheetDate, startsAt, link, description, day, month, year });
    }
    return results;
  }

  app.post('/api/challenges/schedule', guard, async (req, res) => {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: 'Передайте text с расписанием' });
    const parsed = parseSchedule(text);
    if (!parsed.length) return res.status(400).json({ error: 'Не удалось распознать ни одного турнира' });
    const created = [];
    const pad = n => String(n).padStart(2, '0');
    for (const t of parsed) {
      // проверяем дубль по sheet_date
      const { data: existing } = await supabase.from('games').select('id').eq('sheet_date', t.sheetDate).limit(1);
      if (existing && existing.length) { created.push({ ...t, skipped: true }); continue; }
      const { data: row, error } = await supabase.from('games').insert({
        title: t.title, date: t.startsAt, starts_at: t.startsAt,
        sheet_date: t.sheetDate, link: t.link, description: t.description, max_players: 9,
      }).select().single();
      if (error) { created.push({ ...t, error: error.message }); continue; }
      created.push({ ...t, id: row.id, inserted: true });
    }
    res.json({ total: parsed.length, created });
  });

  // экспорт для возможного авто-вызова из server.js
  return { resolveTournament, parseSchedule };
}
