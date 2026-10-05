-- Prix et distribution — per prize x partner x region (one row per promotion)
-- Roll up to partner level by summing inventory / won / released / net_awarded, then recompute ratios.
-- KPIs: prix gagnés, prix échangés, prix restants, rythme vs plan linéaire.
-- Unredeemed coupons are released back to stock after a timeout
-- (release_reason = 'rpp_unredeemed_timeout'), so:
--   net_awarded = won - released        (inventory actually consumed)
--   remaining   = inventory - net_awarded
-- Plan = inventory spread evenly between promotion start_date and end_date.
-- pacing_index < 0.9 => UNDER, > 1.1 => OVER (tolerance to confirm per prize tier).
WITH {{COMMON}},
promos AS (
  SELECT p.id AS promotion_id, p.quantity AS inventory, p.start_date, p.end_date,
         (SELECT pi.title FROM rctapi_promotion_items pi
           WHERE pi.promotion_id = p.id
           ORDER BY pi.language = 'fr' DESC LIMIT 1) AS prize_fr,
         (SELECT MIN(g.region_code) FROM rctapi_promotion_province pp
           JOIN rctapi_provinces pr ON pr.id = pp.province_id
           JOIN geo g ON g.province_code = pr.name
           WHERE pp.promotion_id = p.id) AS region_code
  FROM rctapi_promotions p
  JOIN campaign c ON p.campaign = c.promotion_campaign
),
promos_partner AS (
  SELECT pr.*,
         COALESCE((SELECT pm.partner FROM partner_map pm
                    WHERE LOWER(pr.prize_fr) LIKE CONCAT('%', pm.pattern, '%')
                    ORDER BY pm.priority LIMIT 1), 'À associer (seeds/partners.csv)') AS partner
  FROM promos pr
),
grants AS (
  SELECT g.promotion_id,
         COUNT(*) AS won,
         SUM(g.activation_id IS NOT NULL) AS redeemed,
         SUM(g.release_reason = 'rpp_unredeemed_timeout') AS released,
         SUM(g.deleted_at IS NOT NULL AND g.activation_id IS NULL
             AND COALESCE(g.release_reason, '') <> 'rpp_unredeemed_timeout') AS other_removed
  FROM rctapi_promotion_grant g
  JOIN promos pr ON pr.promotion_id = g.promotion_id
  WHERE g.type = 'rpp_instant_prize'
  GROUP BY g.promotion_id
)
SELECT c.code AS campaign, pr.region_code, pr.partner, pr.prize_fr, pr.promotion_id,
       pr.inventory,
       COALESCE(gr.won, 0) AS won,
       COALESCE(gr.redeemed, 0) AS redeemed,
       COALESCE(gr.released, 0) AS released_to_stock,
       COALESCE(gr.other_removed, 0) AS other_removed,
       COALESCE(gr.won, 0) - COALESCE(gr.released, 0) AS net_awarded,
       pr.inventory - (COALESCE(gr.won, 0) - COALESCE(gr.released, 0)) AS remaining,
       ROUND(COALESCE(gr.redeemed, 0) / NULLIF(gr.won, 0), 4) AS redemption_rate,
       ROUND(pr.inventory * LEAST(1, GREATEST(0,
         TIMESTAMPDIFF(SECOND, pr.start_date, LEAST(UTC_TIMESTAMP(), pr.end_date))
         / TIMESTAMPDIFF(SECOND, pr.start_date, pr.end_date)))) AS planned_to_date,
       ROUND((COALESCE(gr.won, 0) - COALESCE(gr.released, 0)) / NULLIF(pr.inventory * LEAST(1, GREATEST(0,
         TIMESTAMPDIFF(SECOND, pr.start_date, LEAST(UTC_TIMESTAMP(), pr.end_date))
         / TIMESTAMPDIFF(SECOND, pr.start_date, pr.end_date))), 0), 3) AS pacing_index
FROM promos_partner pr
CROSS JOIN campaign c
LEFT JOIN grants gr ON gr.promotion_id = pr.promotion_id
ORDER BY pr.partner, pr.prize_fr, pr.region_code
