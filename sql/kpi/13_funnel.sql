-- Entonnoir joueur — inscrits pendant la campagne -> ont joué -> ont gagné un prix -> ont échangé un prix
-- Player-level: each step counts distinct players from the base (signed up during the play window).
-- App downloads are aggregate-only and cannot be linked to players: they are NOT a funnel step.
WITH {{COMMON}},
base AS (
  SELECT pl.rpp_player_id, pl.user_id, pl.region_code
  FROM players pl JOIN campaign c ON pl.created_at BETWEEN c.start_at AND c.end_at
),
played AS (
  SELECT DISTINCT s.rpp_player_id
  FROM rctapi_rpp_game_sessions s
  JOIN campaign c ON s.contest_date BETWEEN c.start_date AND c.end_date
  WHERE s.status IN ('won', 'lost', 'draw')
),
won AS (
  SELECT DISTINCT g.client_id AS user_id
  FROM rctapi_promotion_grant g
  JOIN rctapi_promotions p ON p.id = g.promotion_id
  JOIN campaign c ON p.campaign = c.promotion_campaign
  WHERE g.type = 'rpp_instant_prize'
),
redeemed AS (
  SELECT DISTINCT a.user_id
  FROM rctapi_promotion_activations a
  JOIN rctapi_promotions p ON p.id = a.promotion_id
  JOIN campaign c ON p.campaign = c.promotion_campaign
  WHERE a.deleted_at IS NULL
)
SELECT c.code AS campaign, b.region_code,
       COUNT(*) AS signed_up,
       SUM(pd.rpp_player_id IS NOT NULL) AS played,
       SUM(w.user_id IS NOT NULL) AS won_prize,
       SUM(r.user_id IS NOT NULL) AS redeemed_prize
FROM base b
LEFT JOIN played pd ON pd.rpp_player_id = b.rpp_player_id
LEFT JOIN won w ON w.user_id = b.user_id
LEFT JOIN redeemed r ON r.user_id = b.user_id
CROSS JOIN campaign c
GROUP BY c.code, b.region_code
ORDER BY b.region_code
