-- Carte de chaleur — games started by local day of week x hour, by region
-- dow: 1 = lundi ... 7 = dimanche (ISO).
WITH {{COMMON}}
SELECT c.code AS campaign,
       WEEKDAY(CONVERT_TZ(s.started_at, 'UTC', c.tz)) + 1 AS dow,
       HOUR(CONVERT_TZ(s.started_at, 'UTC', c.tz)) AS hour,
       pl.region_code,
       COUNT(*) AS games
FROM rctapi_rpp_game_sessions s
JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
JOIN players pl ON pl.rpp_player_id = s.rpp_player_id
WHERE s.status IN ('won', 'lost', 'draw')
GROUP BY c.code, dow, hour, pl.region_code
ORDER BY dow, hour, pl.region_code
