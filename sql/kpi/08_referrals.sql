-- Mécaniques de jeu — parrainage, by region of the referrer
-- Only converted referrals are logged; invites sent are not tracked yet.
WITH {{COMMON}}
SELECT c.code AS campaign, pl.region_code,
       COUNT(DISTINCT r.referrer_rpp_player_id) AS referrers,
       COUNT(*) AS successful_referrals
FROM rctapi_minigame_referrals r
JOIN campaign c ON r.created_at BETWEEN c.start_at AND c.end_at
JOIN players pl ON pl.rpp_player_id = r.referrer_rpp_player_id
GROUP BY c.code, pl.region_code
ORDER BY pl.region_code
