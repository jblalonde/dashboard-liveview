# Data mapping: Couche-Tard MCP (MySQL `rctapi`)

Explored on 2026-10-05 through the read-only Couche-Tard MCP. The figures below are a snapshot taken
that day. Use them to reconcile against later, not as final numbers.

## 1. Campaign / edition key

There is **no readable `rctapi_minigame_editions` table**. Either it doesn't exist under that name or
this read-only role can't see it. The MCP schema snapshot dates from 2026-04-16. To confirm with the
dev team.

The campaign is identified in three different ways:

| Where | Key | Values seen |
|---|---|---|
| `rctapi_minigame_ads`, `rctapi_minigame_badges`, `rctapi_minigame_bonus_actions` | `edition_id` INT | `1` only |
| `rctapi_promotions.campaign` (prize coupons) | ENUM | `rpp-2026`, `road-to-rewards-2026` |
| `rctapi_minigame_purchase_attributions.campaign_id`, `rctapi_campaign_purchase_events.campaign_id` | VARCHAR | `rpp-2026`, `taxi-2026` |

`31DOCK` doesn't appear anywhere in this database.

**The activity tables have no `edition_id`.** That covers players, game sessions, entries, prize
grants and ad serves. `rctapi_minigame_players` has one row per user across all editions (unique on
`user_id`). For now, activity can only be tied to an edition by:

- the date window (RPP 2026 ran from 2026-07-21 to about 2026-09-20), or
- `promotions.campaign` for prizes, or
- `edition_id` on the configuration tables (ads, badges, bonus actions).

**Action for the dev team, needed before a second edition runs:** add `edition_id` to
`minigame_players` (or to a per-edition participation table), `rpp_game_sessions`,
`minigame_entries`, `minigame_participation_ad_serves`,
`minigame_participation_bonus_actions`, `minigame_referrals` and
`minigame_purchase_attributions`. Make `edition_id` readable to the MCP role. Until then,
`dim_campaign` in the warehouse has to map `edition_id`, the campaign slug and the date window by
hand.

## 2. BU, region and banner

- **BU:** take the player's province (`rctapi_minigame_players.province`) and look it up in
  `rctapi_provinces.business_unit_id`, which links to `rctapi_business_units`. There are 3 BUs:
  Eastern Canada (QC + Atlantic), Ontario and Western Canada.
- **Contest region:** `contest_region` / `contest_region_snapshot` takes the values atlantic,
  quebec, central and western. Prize inventory is split by these 4 regions, so this level is finer
  than BU for pacing.
- **Banner:** no game event is tied to a store. `rctapi_stores.brand`
  (`couche-tard`/`circle-k`) exists but nothing in the game links to it. The best available
  stand-in is the app the player uses, from `rctapi_user_app_target.app_target`:
  - `QC` = Couche-Tard app, `CA` = Circle K app.
  - About 24k players have no app target, so they go to "Unassigned".
  - Some players have both targets, so we need a rule to pick one (e.g. the most recent
    `last_login_at`).
  - App downloads are split by app directly (`ct_*` / `ck_*`).
- **Store level is not available** for any KPI with the current data.

## 3. KPI → source

Status: ✅ available · 🟡 partial or uses a stand-in · ❌ not in the MCP

### Audience et engagement

| # | KPI | Status | Source / logic | Snapshot |
|---|---|---|---|---|
| 1 | Téléchargements via média payant | 🟡 | `rctapi_analytics_daily_observations`: daily, per app (CT/CK) and OS. iOS gives the App Store source type (`Web referrer`, `App referrer`, `App Store search`, `App Store browse`) under `*_ios_dimensions` → `"First-time download"`. Android gives totals only. **There is no paid-media attribution and no province.** | 2026-07-21: CK iOS 3,907, of which 2,049 came from a web referrer |
| 2 | Inscriptions | ✅ | `rctapi_minigame_players.created_at`. New app accounts: `craft_ctapi_clients.dateCreated` | 363,858 players |
| 3 | Nouveaux joueurs aux jeux Circle K | 🟡 | All players are new, because RPP 2026 is edition 1. "New to *any* CK game" needs an anti-join with the earlier games (`rctapi_labatt_*`, `rctapi_nhl_game_participations`, `rctapi_games_external_participation`) | |
| 4 | Joueurs uniques | ✅ | `COUNT(DISTINCT rpp_player_id)` from `rctapi_rpp_game_sessions` | |
| 5 | DAU | ✅ | `rctapi_user_login_days` (surface `rpp_webview` + `rpp_browser`, by `login_date`). Alternative: distinct players per `contest_date` in `rpp_game_sessions` | 2026-08-01: about 65k |
| 6 | WAU | ✅ | Same source, distinct users per fiscal week | |
| 7 | Sessions par utilisateur | 🟡 | There is no app-session table for the game, and `login_count` = 0 on webview. Stand-ins: game sessions per active player per day, or active days per player | |
| 8 | Taux de visites répétées | ✅ | Players with 2 or more active days in the period ÷ active players (`user_login_days` or `rpp_game_sessions`). Also available: `current_streak`/`longest_streak` | |
| 9 | Parties jouées | ✅ | `rctapi_rpp_game_sessions`, status `won`/`lost`/`draw` (`quit` and `in_progress` shown separately). Rounds are in `rctapi_rpp_game_rounds`. Separate mini-game: `rctapi_rpp_national_day_sessions` | about 4.4M sessions |

### Prix et distribution

| # | KPI | Status | Source / logic | Snapshot |
|---|---|---|---|---|
| 1 | Prix instantanés gagnés | ✅ | `rctapi_promotion_grant` where `type='rpp_instant_prize'` (joined to `rctapi_promotions.campaign='rpp-2026'`), plus gift cards in `rctapi_rpp_gift_card_codes` (Pet Valu / Chico, $15) | 2,145,927 coupons; 8,610 gift cards |
| 2 | Prix instantanés échangés | ✅ | `rctapi_promotion_activations` on the RPP promotions (or `promotion_grant.activation_id IS NOT NULL`). Prize transfers: `rctapi_minigame_prize_transfers` (claimed / expired / pending) | 473,616 activations, 120,024 users |
| 3 | Prix restants | ✅ | `rctapi_promotions.quantity` minus grants, per promotion. **176 promotions = 53 prizes × up to 4 regions.** Expired grants (`deleted_at`) are counted as awarded, unless the business wants them returned to stock | initial inventory 1,497,400 |
| 4 | Rythme de distribution / partenaire | 🟡 | Actual: grants per promotion per day. Plan: a flat line between `start_date` and `end_date` (two waves: 07-21 → 08-23 and 08-18 → 09-20). **There is no partner column.** We need a seed table mapping each prize to its brand/partner (Takis, Hershey, Red Bull, Guru, Electrolit, Celsius, C4, private label…) | |
| 5 | Participations au grand prix | ✅ | `SUM(quantity)` from `rctapi_minigame_entries`, by `source` (gameplay / badge / bonus / referral) and `contest_region_snapshot` | about 13.6M entries |

### Mécaniques de jeu

| # | KPI | Status | Source / logic | Snapshot |
|---|---|---|---|---|
| 1 | Actions bonus et défis | ✅ | `rctapi_minigame_participation_bonus_actions` joined to `rctapi_minigame_bonus_actions` (8 actions). Badges / challenges: `rctapi_minigame_participation_badges` (`is_earned`) joined to `rctapi_minigame_badges` (10) | e.g. email opt-in 64,097; watch_ad 169,108 |
| 2 | Parrainage | 🟡 | Successful referrals: `rctapi_minigame_referrals` (status `converted` only). **Participation is not tracked**: invites sent and links shared are not logged, and `referral_prompt_seen_at` is always NULL | 6,342 converted, 5,248 referrers |
| 3 | Impressions / vues uniques des pubs | ✅ | `rctapi_minigame_participation_ad_serves` joined to `rctapi_minigame_ads.advertiser`. Impressions = serves, completed views = `completed_at IS NOT NULL`, unique = distinct `rpp_player_id`. **Advertiser names need cleaning** (`Red bull` vs `Red Bull`) | 25 ads, 10 advertisers |

### Impact commercial

| # | KPI | Status | Source / logic | Snapshot |
|---|---|---|---|---|
| 1 | Trafic en magasin | ❌ | No usable visit data: the beacons (`craft_ctapi_client_visiting_pos`) record nothing after 2026-07-21, and `rctapi_visits` only covers checkout-free stores. Closest stand-in: coupon activations. **Needs POS data** | |
| 2 | Contribution des coupons au trafic | 🟡 | The numerator (coupon activations) is available. The denominator (store traffic) is missing | |
| 3 | Revenus via LIFT | 🟡 | `rctapi_minigame_purchase_attributions` where `event_type='LIFT'`, `total_price`. **This only covers purchases attributed through the `checkout` bonus action (phone number at the till), not all LIFT revenue. There is no store.** `credited` = matched to a player; `not_found` = no matching player | credited: 3,415 tx / $44.7k; not_found: 1,922 tx / $39.1k |
| 4 | Transactions LIFT | 🟡 | Same source, count | |
| 5 | Dépense moyenne par transaction | 🟡 | `SUM(total_price) / COUNT(*)` | |
| 6 | Articles dans le panier | 🟡 | `AVG(item_count)`. Eligible items: `eligible_upc_count` | |

## 4. Comparisons

- **FY26:** RPP 2026 is edition 1, since all players were created from 2026-07-21. **There is no FY26
  baseline in this database for the game KPIs.** Only app-level series have one:
  - downloads, since 2013
  - accounts
  - coupon activations
  - login days (`mobile` surface only since 2026-08-13)
- **Previous period:** available for every KPI inside the campaign window.

## 5. Data quality and technical notes

- **Freshness:** the database is live (accounts and activations as of 2026-10-05). The RPP game
  stopped around 2026-09-17 to 09-20.
- **`rctapi_rpp_activity_events` is an outbound event queue, not a source of truth.** Its events stop
  on 2026-09-11. Use the transactional tables instead.
- **Exclusions:** `craft_ctapi_clients.is_employee` and `is_tester`, `rctapi_minigame_players.banned_at`
  and `deleted_at`, and test rows (e.g. `basket_id = 'probe-*'`, `event_type IS NULL`).
- **Timezone:** timestamps look like UTC. Days start at 04:00Z, which is midnight Eastern time.
  `contest_date` is already a local date.
- **Performance:** a full aggregate on `rpp_game_sessions` (4.4M rows) hits the MCP's **60 s
  timeout**. Queries that filter on an indexed column (`contest_date`, `login_date`,
  `promotion_id`, `rpp_player_id`) are fast. This confirms the dashboard shouldn't query the MCP
  live. Load the data into the warehouse incrementally, by `id` or `updated_at`.
- **PII** (phone, email, name) is blocked at the database level. The serving layer should stay
  aggregate-only.

## 6. Data still needed outside this database

1. Paid-media attribution for installs: an install-tracking tool (MMP) or UTM / deep-link data.
2. POS data for store traffic, coupon contribution and the store/banner breakdown. The full LIFT
   extract (not just attributed purchases) also belongs here.
3. A prize → partner mapping, with the planned distribution curve if it isn't linear.
4. The `editions` table, or a confirmation of `edition_id` for RPP 2026 and 31DOCK.
5. A FY26 baseline for the game KPIs, if one exists in another system (previous campaigns).
