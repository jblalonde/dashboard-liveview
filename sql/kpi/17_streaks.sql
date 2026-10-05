-- Séries de jours consécutifs — longest run of consecutive play days per player, recomputed from
-- game sessions (the stored longest_streak field disagrees with the sessions for ~13% of players).
WITH {{COMMON}},
days AS (
  SELECT DISTINCT s.rpp_player_id, s.contest_date AS d
  FROM rctapi_rpp_game_sessions s
  JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
  WHERE s.status IN ('won', 'lost', 'draw')
),
runs AS (
  SELECT rpp_player_id, DATE_SUB(d, INTERVAL ROW_NUMBER() OVER (PARTITION BY rpp_player_id ORDER BY d) DAY) AS grp
  FROM days
),
longest AS (
  SELECT rpp_player_id, MAX(n) AS streak
  FROM (SELECT rpp_player_id, grp, COUNT(*) AS n FROM runs GROUP BY rpp_player_id, grp) t
  GROUP BY rpp_player_id
)
SELECT c.code AS campaign, pl.region_code,
       CASE WHEN l.streak >= 30 THEN '30+' WHEN l.streak >= 14 THEN '14-29' WHEN l.streak >= 7 THEN '7-13'
            WHEN l.streak >= 4 THEN '4-6' WHEN l.streak >= 2 THEN '2-3' ELSE '1' END AS bucket,
       COUNT(*) AS players,
       MAX(l.streak) AS max_streak
FROM longest l
JOIN players pl ON pl.rpp_player_id = l.rpp_player_id
CROSS JOIN campaign c
GROUP BY c.code, pl.region_code, bucket
ORDER BY pl.region_code, bucket
