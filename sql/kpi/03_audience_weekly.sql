-- Audience et engagement — weekly active users, by region
-- Week = ISO week starting Monday (switch to the Couche-Tard fiscal week once the calendar is seeded).
WITH {{COMMON}}
SELECT c.code AS campaign,
       DATE_SUB(s.contest_date, INTERVAL WEEKDAY(s.contest_date) DAY) AS week_start,
       pl.region_code,
       COUNT(DISTINCT s.rpp_player_id) AS wau,
       SUM(s.status IN ('won', 'lost', 'draw')) AS games_played
FROM rctapi_rpp_game_sessions s
JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
JOIN players pl ON pl.rpp_player_id = s.rpp_player_id
GROUP BY c.code, week_start, pl.region_code
ORDER BY week_start, pl.region_code
