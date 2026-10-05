-- Audience — app downloads per day, by app (banner) and source
-- Not attributed to paid media: iOS gives the App Store source type only, Android gives totals.
-- No province split is available.
-- Also returns the same number of days BEFORE launch (in_campaign = 0) as a baseline.
WITH {{COMMON}}
SELECT c.code AS campaign, o.observation_date AS day,
       (o.observation_date >= c.start_date) AS in_campaign,
       o.ct_ios_first_time_downloads AS couche_tard_ios,
       o.ck_ios_first_time_downloads AS circle_k_ios,
       o.ct_android_daily_user_installs AS couche_tard_android,
       o.ck_android_daily_user_installs AS circle_k_android,
       -- iOS first-time downloads coming from a web referrer (QR codes, landing pages, web ads)
       COALESCE(JSON_EXTRACT(o.ct_ios_dimensions, '$."First-time download"."Web referrer"."Product page"'), 0)
         + COALESCE(JSON_EXTRACT(o.ct_ios_dimensions, '$."First-time download"."Web referrer"."Store sheet"'), 0)
         + COALESCE(JSON_EXTRACT(o.ct_ios_dimensions, '$."First-time download"."Web referrer"."No page"'), 0) AS couche_tard_ios_web_referrer,
       COALESCE(JSON_EXTRACT(o.ck_ios_dimensions, '$."First-time download"."Web referrer"."Product page"'), 0)
         + COALESCE(JSON_EXTRACT(o.ck_ios_dimensions, '$."First-time download"."Web referrer"."Store sheet"'), 0)
         + COALESCE(JSON_EXTRACT(o.ck_ios_dimensions, '$."First-time download"."Web referrer"."No page"'), 0) AS circle_k_ios_web_referrer
FROM rctapi_analytics_daily_observations o
JOIN campaign c
  ON o.observation_date BETWEEN DATE_SUB(c.start_date, INTERVAL DATEDIFF(c.end_date, c.start_date) + 1 DAY)
                            AND c.end_date
ORDER BY o.observation_date
