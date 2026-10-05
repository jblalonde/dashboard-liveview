-- Audience et engagement — whole campaign, by region
-- KPIs: joueurs uniques, nouveaux joueurs aux jeux Circle K, DAU moyen,
--       taux de visites répétées, parties par jour actif (proxy sessions/utilisateur).
-- For a sub-period (week, previous period) narrow the contest_date filter.
WITH {{COMMON}},
player_activity AS (
  SELECT s.rpp_player_id,
         COUNT(DISTINCT s.contest_date) AS active_days,
         SUM(s.status IN ('won', 'lost', 'draw')) AS games_played
  FROM rctapi_rpp_game_sessions s
  JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
  GROUP BY s.rpp_player_id
),
prior_ck_players AS (
  -- Users who played another Circle K / Couche-Tard game before this campaign
  SELECT DISTINCT x.user_id FROM (
    SELECT user_id, started_at AS ts FROM rctapi_labatt_game_session
    UNION ALL SELECT user_id, created_at FROM rctapi_nhl_game_participations
    UNION ALL SELECT user_id, created_at FROM rctapi_games_external_participation
    UNION ALL SELECT client_id, created_at FROM craft_ctapi_game_participations
  ) x
  JOIN campaign c ON x.ts < c.start_at
)
SELECT c.code AS campaign, pl.region_code,
       COUNT(*) AS unique_players,
       SUM(pp.user_id IS NULL) AS new_to_ck_games,
       SUM(pa.active_days >= 2) AS repeat_players,
       ROUND(SUM(pa.active_days >= 2) / COUNT(*), 4) AS repeat_visit_rate,
       SUM(pa.games_played) AS games_played,
       SUM(pa.active_days) AS player_days,
       ROUND(SUM(pa.games_played) / SUM(pa.active_days), 3) AS games_per_active_day,
       ROUND(SUM(pa.active_days) / (DATEDIFF(c.end_date, c.start_date) + 1), 1) AS avg_dau
FROM player_activity pa
JOIN players pl ON pl.rpp_player_id = pa.rpp_player_id
LEFT JOIN prior_ck_players pp ON pp.user_id = pl.user_id
CROSS JOIN campaign c
GROUP BY c.code, pl.region_code, c.end_date, c.start_date
ORDER BY pl.region_code
