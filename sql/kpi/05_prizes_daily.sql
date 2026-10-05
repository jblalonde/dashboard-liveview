-- Prix et distribution — daily awards by region (feeds the pacing curve)
WITH {{COMMON}},
promos AS (
  SELECT p.id AS promotion_id,
         (SELECT MIN(g.region_code) FROM rctapi_promotion_province pp
           JOIN rctapi_provinces pr ON pr.id = pp.province_id
           JOIN geo g ON g.province_code = pr.name
           WHERE pp.promotion_id = p.id) AS region_code
  FROM rctapi_promotions p
  JOIN campaign c ON p.campaign = c.promotion_campaign
)
SELECT c.code AS campaign,
       DATE(CONVERT_TZ(g.created_at, 'UTC', c.tz)) AS day,
       pr.region_code,
       COUNT(*) AS won,
       SUM(g.activation_id IS NOT NULL) AS redeemed_from_day,
       SUM(g.release_reason = 'rpp_unredeemed_timeout') AS released_from_day
FROM rctapi_promotion_grant g
JOIN promos pr ON pr.promotion_id = g.promotion_id
CROSS JOIN campaign c
WHERE g.type = 'rpp_instant_prize'
GROUP BY c.code, day, pr.region_code
ORDER BY day, pr.region_code
