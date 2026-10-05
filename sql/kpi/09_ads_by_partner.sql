-- Mécaniques de jeu — impressions et vues uniques des pubs, par partenaire x region
-- impressions = ad serves; completed_views = watched to the end; unique_viewers = distinct players.
-- Partner comes from seeds/partners.csv (normalizes 'Red bull' / 'Red Bull', etc.).
-- Serves are aggregated per player before the join to stay under the MCP 60 s timeout.
WITH {{COMMON}},
ads AS (
  SELECT a.id,
         COALESCE((SELECT pm.partner FROM partner_map pm
                    WHERE LOWER(a.advertiser) LIKE CONCAT('%', pm.pattern, '%')
                    ORDER BY pm.priority LIMIT 1), TRIM(a.advertiser)) AS partner
  FROM rctapi_minigame_ads a
  JOIN campaign c ON a.edition_id = c.edition_id
),
per_player AS (
  SELECT ads.partner, s.rpp_player_id,
         COUNT(*) AS impressions,
         SUM(s.completed_at IS NOT NULL) AS completed_views
  FROM rctapi_minigame_participation_ad_serves s
  JOIN ads ON ads.id = s.rpp_ad_id
  GROUP BY ads.partner, s.rpp_player_id
)
SELECT c.code AS campaign, pp.partner, pl.region_code,
       SUM(pp.impressions) AS impressions,
       SUM(pp.completed_views) AS completed_views,
       COUNT(*) AS unique_viewers
FROM per_player pp
JOIN players pl ON pl.rpp_player_id = pp.rpp_player_id
CROSS JOIN campaign c
GROUP BY c.code, pp.partner, pl.region_code
ORDER BY pp.partner, pl.region_code
