-- Prix et distribution — participations au grand prix, by day x region
-- Sources are pivoted into columns to stay far below the MCP's 1000-row limit.
-- Until minigame_entries gets edition_id, the edition is resolved by date window.
WITH {{COMMON}}
SELECT c.code AS campaign,
       DATE(CONVERT_TZ(e.created_at, 'UTC', c.tz)) AS day,
       pl.region_code,
       SUM(e.quantity) AS entries,
       SUM(CASE WHEN e.source = 'gameplay' THEN e.quantity ELSE 0 END) AS entries_gameplay,
       SUM(CASE WHEN e.source = 'badge' THEN e.quantity ELSE 0 END) AS entries_badge,
       SUM(CASE WHEN e.source = 'bonus' THEN e.quantity ELSE 0 END) AS entries_bonus,
       SUM(CASE WHEN e.source = 'referral' THEN e.quantity ELSE 0 END) AS entries_referral,
       SUM(CASE WHEN e.source NOT IN ('gameplay', 'badge', 'bonus', 'referral') THEN e.quantity ELSE 0 END) AS entries_other
FROM rctapi_minigame_entries e
JOIN campaign c ON e.created_at BETWEEN c.start_at AND c.end_at
JOIN players pl ON pl.rpp_player_id = e.rpp_player_id
GROUP BY c.code, day, pl.region_code
ORDER BY day, pl.region_code
