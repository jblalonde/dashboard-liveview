-- Rétention par semaine de 1re partie — J1, J7, J30 (exact day after the first game)
-- eligible_dN = players whose day N still falls inside the play window (others cannot be measured).
WITH {{COMMON}},
days AS (
  SELECT DISTINCT s.rpp_player_id, s.contest_date AS d
  FROM rctapi_rpp_game_sessions s
  JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
  WHERE s.status IN ('won', 'lost', 'draw')
),
first_day AS (
  SELECT rpp_player_id, MIN(d) AS d0 FROM days GROUP BY rpp_player_id
),
flags AS (
  SELECT f.rpp_player_id, f.d0,
         MAX(x.d = DATE_ADD(f.d0, INTERVAL 1 DAY)) AS r1,
         MAX(x.d = DATE_ADD(f.d0, INTERVAL 7 DAY)) AS r7,
         MAX(x.d = DATE_ADD(f.d0, INTERVAL 30 DAY)) AS r30
  FROM first_day f
  JOIN days x ON x.rpp_player_id = f.rpp_player_id AND x.d IN (DATE_ADD(f.d0, INTERVAL 1 DAY), DATE_ADD(f.d0, INTERVAL 7 DAY), DATE_ADD(f.d0, INTERVAL 30 DAY), f.d0)
  GROUP BY f.rpp_player_id, f.d0
)
SELECT c.code AS campaign,
       DATE_SUB(fl.d0, INTERVAL WEEKDAY(fl.d0) DAY) AS cohort_week,
       pl.region_code,
       COUNT(*) AS players,
       SUM(DATE_ADD(fl.d0, INTERVAL 1 DAY) <= c.end_date) AS eligible_d1,
       SUM(fl.r1) AS retained_d1,
       SUM(DATE_ADD(fl.d0, INTERVAL 7 DAY) <= c.end_date) AS eligible_d7,
       SUM(fl.r7) AS retained_d7,
       SUM(DATE_ADD(fl.d0, INTERVAL 30 DAY) <= c.end_date) AS eligible_d30,
       SUM(fl.r30) AS retained_d30
FROM flags fl
JOIN players pl ON pl.rpp_player_id = fl.rpp_player_id
CROSS JOIN campaign c
GROUP BY c.code, cohort_week, pl.region_code
ORDER BY cohort_week, pl.region_code
