# Campaign report template

Every campaign is reported on the same data points. These SQL templates produce them for **one
campaign at a time**. The campaign is the filter.

## How it works

```
seeds/campaigns.csv  ──┐                      (today: editions table not deployed)
                       ├─► scripts/render_sql.py --campaign <code> ─► build/<code>/*.sql
rctapi_minigame_editions ┘   --source table    (once the table is pushed)
seeds/geo_region.csv   ─► province → region → rollup → banner
seeds/partners.csv     ─► keyword → partner (ads + prizes)
```

Each `sql/kpi/*.sql` starts with `WITH {{COMMON}}`. The renderer replaces that placeholder with four
shared CTEs:

| CTE | Content |
|---|---|
| `campaign` | One row: `edition_id`, `code`, play window (`start_at`/`end_at`, UTC), `redemption_end_at`, `tz`, local `start_date`/`end_date`, `promotion_campaign`, `purchase_campaign_id` |
| `geo` | Province → `region_code` (ATL / QC / CC / WC) → `client_rollup` (Eastern = ATL + QC, Central, Western) → `banner` |
| `partner_map` | Lowercase keyword → partner, with priority |
| `players` | Game players with region, **excluding** banned players, testers and employees |

```bash
python3 scripts/render_sql.py --campaign rpp-2026                 # from seeds/campaigns.csv
python3 scripts/render_sql.py --campaign rpp-2026 --source table  # from rctapi_minigame_editions
```

### Adding a campaign (e.g. 31DOCK)

1. Fill in its row in `seeds/campaigns.csv`: dates, `promotion_campaign` (the value of
   `rctapi_promotions.campaign`) and `purchase_campaign_id`.
2. Run `python3 scripts/render_sql.py --campaign 31dock`.
3. Once `rctapi_minigame_editions` is pushed with the same columns (see
   `sql/editions/rctapi_minigame_editions.template.sql`), use `--source table` and stop maintaining
   the CSV.

## The standard report

| File | KPIs | Grain |
|---|---|---|
| `01_audience_daily.sql` | Inscriptions, joueurs actifs (DAU), parties jouées | day × region |
| `02_audience_period.sql` | Joueurs uniques, nouveaux joueurs aux jeux Circle K, taux de visites répétées, DAU moyen, parties par jour actif | campaign × region |
| `03_audience_weekly.sql` | WAU | week × region |
| `04_prizes_by_promotion.sql` | Prix gagnés / échangés / remis en stock / restants, rythme vs plan linéaire | prize × partner × region |
| `05_prizes_daily.sql` | Prix gagnés par jour (pacing curve) | day × region |
| `06_grand_prize_entries.sql` | Participations au grand prix | day × region × source |
| `07_bonus_actions_badges.sql` | Actions bonus et défis (badges), taux de complétion | action × region |
| `08_referrals.sql` | Parrainages réussis, parrains | region |
| `09_ads_by_partner.sql` | Impressions, vues complètes, vues uniques | partner × region |
| `10_lift_purchases.sql` | Revenus LIFT, transactions, dépense moyenne, articles/panier | day × region |
| `11_coupon_redemptions_daily.sql` | Coupons activés en magasin | day × region |
| `12_app_downloads_daily.sql` | Téléchargements (per app; iOS web-referrer share) | day |

Roll a region up to `client_rollup` or to the total by **summing** counts. This works for distinct
players too, because each player has exactly one province. Recompute ratios from the summed
numerators and denominators. Don't sum distinct players **across days or weeks**: use `02` for
period-level uniques.

## Business rules in the queries

- **Play window ≠ redemption window.** RPP 2026 was played from 2026-07-21 to 2026-09-14, and coupons
  could be redeemed until 2026-09-19.
- **Prize stock is recycled.** A coupon not redeemed in time is released back to inventory
  (`release_reason = 'rpp_unredeemed_timeout'`), so:
  - `net_awarded = won − released_to_stock`
  - `remaining = inventory − net_awarded`
  - Pacing compares `net_awarded` with the linear plan.
- **Banner** is derived from the region: QC = Couche-Tard, the rest = Circle K. This is only
  approximate in Atlantic Canada, which also has about 171 Couche-Tard stores (see
  `docs/DATA_MAPPING.md`).
- **Timezone:** `America/Toronto` for day boundaries. `contest_date` is already a local date.

## Validation (RPP 2026, run on 2026-10-05 through the MCP)

| Query | Runtime | Check |
|---|---|---|
| 01 | ~28 s | 244 rows, 4 regions, 0 unassigned |
| 02 | ~16 s | 343,588 unique players |
| 04 | ~7 s | inventory 1,497,400 · won 2,145,927 · released 1,667,598 · remaining 1,019,071 |
| 06 | ~31 s | 4 sources × 4 regions |
| 09 | ~37 s | 9 partners |
| others | < 10 s | |

Queries 01, 06 and 09 are close to the MCP's **60 s timeout**. The dashboard should run these
templates in the warehouse load job, not live against the MCP.
