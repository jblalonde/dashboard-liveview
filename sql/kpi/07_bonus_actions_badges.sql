-- Mécaniques de jeu — actions bonus et défis (badges), by region
WITH {{COMMON}},
eligible AS (
  SELECT pl.region_code, COUNT(*) AS players
  FROM players pl JOIN campaign c ON pl.created_at <= c.end_at
  GROUP BY pl.region_code
)
SELECT c.code AS campaign, 'bonus_action' AS kind, b.`key`, b.title_fr, pl.region_code,
       COUNT(*) AS completions,
       COUNT(DISTINCT pb.rpp_player_id) AS players,
       ROUND(COUNT(DISTINCT pb.rpp_player_id) / MAX(el.players), 4) AS completion_rate,
       MAX(el.players) AS eligible_players
FROM rctapi_minigame_bonus_actions b
JOIN campaign c ON b.edition_id = c.edition_id
JOIN rctapi_minigame_participation_bonus_actions pb ON pb.rpp_bonus_action_id = b.id
JOIN players pl ON pl.rpp_player_id = pb.rpp_player_id
JOIN eligible el ON el.region_code = pl.region_code
GROUP BY c.code, b.`key`, b.title_fr, pl.region_code
UNION ALL
SELECT c.code, 'badge', bd.`key`, bd.title_fr, pl.region_code,
       COUNT(*),
       COUNT(DISTINCT pb.rpp_player_id),
       ROUND(COUNT(DISTINCT pb.rpp_player_id) / MAX(el.players), 4),
       MAX(el.players)
FROM rctapi_minigame_badges bd
JOIN campaign c ON bd.edition_id = c.edition_id
JOIN rctapi_minigame_participation_badges pb ON pb.rpp_badge_id = bd.id AND pb.is_earned = 1
JOIN players pl ON pl.rpp_player_id = pb.rpp_player_id
JOIN eligible el ON el.region_code = pl.region_code
GROUP BY c.code, bd.`key`, bd.title_fr, pl.region_code
ORDER BY kind, `key`, region_code
