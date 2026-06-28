-- ============================================================
-- Фича «Вызовы» (дуэли игроков) — схема БД
-- Применить в Supabase: Dashboard → SQL Editor → Run.
-- Идемпотентно (IF NOT EXISTS), можно гонять повторно.
-- ============================================================

-- 1) Расширяем games под расписание из присланного формата.
--    (title, date, max_players, buy_in, description, created_at уже есть)
alter table public.games add column if not exists link text;        -- ссылка t.me/...
alter table public.games add column if not exists starts_at timestamptz; -- дата+время старта
alter table public.games add column if not exists sheet_date text;   -- 'ДД.ММ.ГГГГ' — ключ для очков из листа

-- 2) Таблица вызовов
create table if not exists public.challenges (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references public.games(id) on delete cascade,
  challenger_id     text not null,            -- telegram_id вызывающего
  opponent_id       text not null,            -- telegram_id соперника
  status            text not null default 'pending',
    -- pending | accepted | declined | cancelled | expired | auto_cancelled | resolved | void
  result            text,                     -- challenger_win | opponent_win | draw | void
  challenger_points integer,
  opponent_points   integer,
  created_at        timestamptz not null default now(),
  responded_at      timestamptz,
  resolved_at       timestamptz,
  constraint challenges_no_self check (challenger_id <> opponent_id)
);

-- Одна дуэль на пару за турнир (в обе стороны) — для активных вызовов.
-- Реализуем через нормализованную пару (меньший_id, больший_id) в частичном уникальном индексе.
create unique index if not exists challenges_unique_pair_per_tournament
  on public.challenges (
    tournament_id,
    least(challenger_id, opponent_id),
    greatest(challenger_id, opponent_id)
  )
  where status in ('pending','accepted','resolved');

-- Быстрые выборки
create index if not exists challenges_by_tournament on public.challenges (tournament_id);
create index if not exists challenges_by_opponent   on public.challenges (opponent_id, status);
create index if not exists challenges_by_challenger on public.challenges (challenger_id, status);

-- 3) Вью таблицы дуэлянтов (W–L–D) из решённых дуэлей.
create or replace view public.challenge_standings as
with results as (
  select challenger_id as player,
         case when result='challenger_win' then 1 else 0 end as win,
         case when result='opponent_win'   then 1 else 0 end as loss,
         case when result='draw'            then 1 else 0 end as draw
  from public.challenges where status='resolved'
  union all
  select opponent_id as player,
         case when result='opponent_win'   then 1 else 0 end as win,
         case when result='challenger_win' then 1 else 0 end as loss,
         case when result='draw'            then 1 else 0 end as draw
  from public.challenges where status='resolved'
)
select player,
       sum(win)::int  as wins,
       sum(loss)::int as losses,
       sum(draw)::int as draws,
       (sum(win)-sum(loss))::int as net
from results
group by player
order by wins desc, net desc;

-- Примечание: RLS не включаем — доступ только через сервер (service role), как у users/games.
