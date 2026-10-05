-- Consentements — SMS and email opt-in flags recorded on the game participation, by region.
-- Counts consents only; what each consent allows (game messages vs. banner marketing) must be
-- confirmed with the business before calling it a marketing database.
WITH {{COMMON}}
SELECT c.code AS campaign, pl.region_code,
       COUNT(*) AS participations,
       SUM(p.sms_opt_in = 1) AS sms_opt_in,
       SUM(p.email_opt_in = 1) AS email_opt_in,
       SUM(p.sms_opt_in = 1 AND p.email_opt_in = 1) AS both_opt_in,
       SUM(p.sms_opt_in = 1 OR p.email_opt_in = 1) AS any_opt_in
FROM rctapi_minigame_participations p
JOIN campaign c ON p.created_at BETWEEN c.start_at AND c.end_at
JOIN players pl ON pl.user_id = p.user_id
WHERE p.deleted_at IS NULL
GROUP BY c.code, pl.region_code
ORDER BY pl.region_code
