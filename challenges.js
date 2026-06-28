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
    ruDateToISO, SHEETS, SHEET_YEAR,
  } = deps;

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

    // нет повторного вызова после отказа на этот турнир (для этой пары)
    const { data: declined } = await supabase.from('challenges').select('id')
      .eq('tournament_id', tournamentId).eq('status', 'declined')
      .or(`and(challenger_id.eq.${challengerId},opponent_id.eq.${opponentId}),and(challenger_id.eq.${opponentId},opponent_id.eq.${challengerId})`);
    if (declined && declined.length)
      return res.status(400).json({ error: 'Этот игрок уже отклонил вызов на этот турнир' });

    const { data, error } = await supabase.from('challenges')
      .insert({ tournament_id: tournamentId, challenger_id: String(challengerId), opponent_id: String(opponentId) })
      .select().single();
    if (error) {
      // частичный уникальный индекс → активная дуэль для пары уже есть
      if (error.code === '23505')
        return res.status(409).json({ error: 'Дуэль с этим игроком на этот турнир уже есть' });
      return res.status(500).json({ error: error.message });
    }
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

  // ---- Публичная доска активных дуэлей ----
  app.get('/api/challenges/board', guard, async (req, res) => {
    const { data, error } = await supabase.from('challenges')
      .select('*, games(title, sheet_date, starts_at)')
      .in('status', ['accepted', 'pending']).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json(await withNicks(data));
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
    }
    return { tournamentId, resolved, voided, total: (duels || []).length };
  }

  // экспорт для возможного авто-вызова из server.js
  return { resolveTournament };
}
