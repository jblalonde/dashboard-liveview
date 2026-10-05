-- Prix offerts à un ami — transfers created during the campaign, by region of the sender
WITH {{COMMON}}
SELECT c.code AS campaign, pl.region_code,
       COUNT(*) AS gifts_sent,
       SUM(t.status = 'claimed') AS gifts_claimed,
       SUM(t.status = 'expired') AS gifts_expired,
       SUM(t.status = 'pending') AS gifts_pending,
       SUM(t.status = 'cancelled') AS gifts_cancelled,
       COUNT(DISTINCT t.sender_user_id) AS senders,
       COUNT(DISTINCT CASE WHEN t.status = 'claimed' THEN t.recipient_user_id END) AS recipients
FROM rctapi_minigame_prize_transfers t
JOIN campaign c ON t.created_at BETWEEN c.start_at AND c.redemption_end_at
JOIN players pl ON pl.user_id = t.sender_user_id
GROUP BY c.code, pl.region_code
ORDER BY pl.region_code
