-- Audience et engagement — daily, by region
-- Grain: campaign x day x region. KPIs: inscriptions, joueurs actifs (DAU), parties jouées.
-- Distinct players are additive across regions (a player has one province),
-- but NOT across days: use 02_audience_period.sql for period-level uniques.
WITH {{COMMON}},
games AS (
  SELECT s.contest_date AS day, pl.region_code,
         SUM(s.status IN ('won', 'lost', 'draw')) AS games_played,
         SUM(s.status = 'quit') AS games_quit,
         COUNT(DISTINCT s.rpp_player_id) AS active_players
  FROM rctapi_rpp_game_sessions s
  JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
  JOIN players pl ON pl.rpp_player_id = s.rpp_player_id
  GROUP BY s.contest_date, pl.region_code
),
signups AS (
  SELECT DATE(CONVERT_TZ(pl.created_at, 'UTC', c.tz)) AS day, pl.region_code,
         COUNT(*) AS signups
  FROM players pl
  JOIN campaign c ON pl.created_at BETWEEN c.start_at AND c.end_at
  GROUP BY day, pl.region_code
),
grid AS (
  SELECT day, region_code FROM games
  UNION
  SELECT day, region_code FROM signups
)
SELECT c.code AS campaign, gr.day, gr.region_code,
       COALESCE(su.signups, 0) AS signups,
       COALESCE(ga.active_players, 0) AS active_players,
       COALESCE(ga.games_played, 0) AS games_played,
       COALESCE(ga.games_quit, 0) AS games_quit
FROM grid gr
CROSS JOIN campaign c
LEFT JOIN games ga ON ga.day = gr.day AND ga.region_code = gr.region_code
LEFT JOIN signups su ON su.day = gr.day AND su.region_code = gr.region_code
ORDER BY gr.day, gr.region_code
