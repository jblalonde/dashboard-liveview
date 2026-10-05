-- Impact commercial — coupon activations in store (numerator of coupon contribution to traffic)
WITH {{COMMON}}
SELECT c.code AS campaign,
       DATE(CONVERT_TZ(a.created_at, 'UTC', c.tz)) AS day,
       COALESCE(pl.region_code, 'UNASSIGNED') AS region_code,
       COUNT(*) AS coupon_activations,
       COUNT(DISTINCT a.user_id) AS redeeming_users
FROM rctapi_promotion_activations a
JOIN rctapi_promotions p ON p.id = a.promotion_id
JOIN campaign c ON p.campaign = c.promotion_campaign
LEFT JOIN players pl ON pl.user_id = a.user_id
WHERE a.deleted_at IS NULL
GROUP BY c.code, day, region_code
ORDER BY day, region_code
