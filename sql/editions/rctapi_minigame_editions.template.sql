-- =============================================================================
-- TEMPLATE: rctapi_minigame_editions (proposal for the dev team)
-- =============================================================================
-- Goal: one row per campaign (RPP 2026, 31DOCK, ...) so the dashboard and the
-- campaign report can filter every KPI by edition.
--
-- Until this table exists in production (and is readable by the MCP role),
-- the dashboard reads the same columns from seeds/campaigns.csv.
-- Column names match one-to-one, so switching sources is a single change in
-- the `campaign` CTE at the top of each sql/kpi/*.sql file.
-- =============================================================================

CREATE TABLE rctapi_minigame_editions (
  id                     INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  code                   VARCHAR(64)  NOT NULL UNIQUE,      -- 'rpp-2026', '31dock'
  name_fr                VARCHAR(255) NOT NULL,
  name_en                VARCHAR(255) NOT NULL,
  game_type              VARCHAR(64)  NOT NULL,             -- 'rpp', ...
  start_at               DATETIME     NOT NULL,             -- UTC
  end_at                 DATETIME     NOT NULL,             -- UTC, last moment of play
  redemption_end_at      DATETIME     NULL,                 -- UTC, last moment prizes can be redeemed
  timezone               VARCHAR(64)  NOT NULL DEFAULT 'America/Toronto',
  fiscal_year            VARCHAR(8)   NULL,                 -- 'FY27' (Couche-Tard fiscal year)
  promotion_campaign     VARCHAR(64)  NULL,                 -- = rctapi_promotions.campaign
  purchase_campaign_id   VARCHAR(128) NULL,                 -- = *_purchase_*.campaign_id (LIFT/NPE)
  comparison_edition_id  INT          NULL,                 -- previous edition for like-for-like
  status                 ENUM('draft','planned','live','closed') NOT NULL DEFAULT 'draft',
  created_at             DATETIME     NOT NULL,
  updated_at             DATETIME     NOT NULL,
  deleted_at             DATETIME     NULL,
  CONSTRAINT fk_edition_comparison FOREIGN KEY (comparison_edition_id)
    REFERENCES rctapi_minigame_editions (id)
);

-- Region scope per edition: some campaigns may not run in every region.
CREATE TABLE rctapi_minigame_edition_regions (
  edition_id      INT NOT NULL,
  contest_region  ENUM('atlantic','quebec','central','western') NOT NULL,
  PRIMARY KEY (edition_id, contest_region),
  FOREIGN KEY (edition_id) REFERENCES rctapi_minigame_editions (id)
);

-- RPP 2026 = edition 1, matching edition_id already used in
-- rctapi_minigame_ads / _badges / _bonus_actions.
INSERT INTO rctapi_minigame_editions
  (id, code, name_fr, name_en, game_type, start_at, end_at, redemption_end_at, timezone, fiscal_year,
   promotion_campaign, purchase_campaign_id, comparison_edition_id, status, created_at, updated_at)
VALUES
  (1, 'rpp-2026', 'RPP 2026', 'RPP 2026', 'rpp',
   '2026-07-21 04:00:00', '2026-09-15 03:59:59', '2026-09-20 03:59:59', 'America/Toronto', 'FY27',
   'rpp-2026', 'rpp-2026', NULL, 'closed', NOW(), NOW());

-- =============================================================================
-- Required follow-up: put edition_id on the activity tables.
-- Without it, KPIs fall back to the date window, which breaks as soon as two
-- editions overlap or a player plays several editions.
-- Backfill = 1 for all existing rows (RPP 2026 is the only edition so far).
-- =============================================================================
ALTER TABLE rctapi_minigame_participations             ADD COLUMN edition_id INT NULL, ADD INDEX (edition_id, created_at);
ALTER TABLE rctapi_rpp_game_sessions                   ADD COLUMN edition_id INT NULL, ADD INDEX (edition_id, contest_date);
ALTER TABLE rctapi_minigame_entries                    ADD COLUMN edition_id INT NULL, ADD INDEX (edition_id, created_at);
ALTER TABLE rctapi_minigame_participation_ad_serves    ADD COLUMN edition_id INT NULL, ADD INDEX (edition_id, serving_date);
ALTER TABLE rctapi_minigame_participation_bonus_actions ADD COLUMN edition_id INT NULL, ADD INDEX (edition_id, created_at);
ALTER TABLE rctapi_minigame_participation_badges       ADD COLUMN edition_id INT NULL;
ALTER TABLE rctapi_minigame_referrals                  ADD COLUMN edition_id INT NULL;
ALTER TABLE rctapi_minigame_purchase_attributions      ADD COLUMN edition_id INT NULL;
ALTER TABLE rctapi_minigame_prize_transfers            ADD COLUMN edition_id INT NULL;
-- Prize coupons: map rctapi_promotions.campaign -> editions.promotion_campaign
-- (or add rctapi_promotions.edition_id).
-- Also: grant SELECT on rctapi_minigame_editions (+ _regions) to the MCP role.
