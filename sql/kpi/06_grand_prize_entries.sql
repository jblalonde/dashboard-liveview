-- Prix et distribution — participations au grand prix, by day x region x source
-- Until minigame_entries gets edition_id, the edition is resolved by date window.
WITH {{COMMON}}
SELECT c.code AS campaign,
       DATE(CONVERT_TZ(e.created_at, 'UTC', c.tz)) AS day,
       pl.region_code,
       e.source,
       SUM(e.quantity) AS entries,
       COUNT(DISTINCT e.rpp_player_id) AS players
FROM rctapi_minigame_entries e
JOIN campaign c ON e.created_at BETWEEN c.start_at AND c.end_at
JOIN players pl ON pl.rpp_player_id = e.rpp_player_id
GROUP BY c.code, day, pl.region_code, e.source
ORDER BY day, pl.region_code, e.source
