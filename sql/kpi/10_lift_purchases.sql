-- Impact commercial — LIFT purchases attributed to the game, by day x region
-- Scope: purchases matched via the 'checkout' bonus action (phone number at the till).
-- Not total store revenue. No store id is available, so region = player's province.
WITH {{COMMON}}
SELECT c.code AS campaign,
       DATE(CONVERT_TZ(pa.occurred_at, 'UTC', c.tz)) AS day,
       pl.region_code,
       COUNT(*) AS lift_transactions,
       SUM(pa.total_price) AS lift_revenue,
       SUM(pa.item_count) AS items,
       SUM(pa.eligible_upc_count) AS eligible_items,
       COUNT(DISTINCT pa.rpp_player_id) AS buyers
FROM rctapi_minigame_purchase_attributions pa
JOIN campaign c ON pa.campaign_id = c.purchase_campaign_id
JOIN players pl ON pl.rpp_player_id = pa.rpp_player_id
WHERE pa.event_type = 'LIFT' AND pa.status = 'credited'
GROUP BY c.code, day, pl.region_code
ORDER BY day, pl.region_code
