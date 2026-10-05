# Campaign KPI Dashboard — Architecture

Status: draft v0.1 (2026-10-05). Source mappings marked **TBD** must be confirmed against the Couche-Tard MCP.

## 1. Goal

One dashboard, shareable and exportable to the customer, covering the 23 campaign KPIs in
`semantic/kpis.yml`. Every KPI can be broken down by:

- **Campaign**: `rctapi_minigame_editions` (RPP 2026, 31DOCK, …)
- **BU**
- **Banner**
- **Period** (day / week / fiscal period / whole campaign)

Each KPI is compared against the **previous period** and **FY26**.

## 2. Guiding principles

1. **Define each KPI once.** The SQL lives in one semantic layer. The dashboard, the exports and any
   ad-hoc MCP query all read from that layer, so the numbers always match.
2. **Don't let the dashboard query raw sources live.** The MCP is good for exploration and for
   answering ad-hoc questions. The dashboard reads pre-aggregated marts, so it stays fast and its
   numbers don't drift during the day.
3. **Every dimension and fact row carries the campaign key.** `edition_id` is the backbone.
4. **Respect additivity.** Distinct counts and ratios can't be summed across BU, banner or day (see §5).
5. **Make every number traceable.** Each tile shows its definition, source, freshness and caveats.

## 3. Layers

```
 Sources (via warehouse behind the MCP)
 ├─ Game platform (rctapi_*)        editions, players, sessions, plays, prizes, bonus actions, referrals
 ├─ App / MMP (TBD)                 installs by media source (paid vs organic)
 ├─ Ad server (TBD)                 partner ad impressions / unique views
 ├─ Loyalty / coupons (TBD)         coupon issuance + redemption, member ↔ player link
 └─ POS / LIFT (TBD)                transactions, revenue, basket items, store
        │
        ▼
 [1] staging        1:1 cleaned copies, typed, timezone-normalized, test/employee/fraud flags
        ▼
 [2] core           conformed dimensions + atomic facts (see §4)
        ▼
 [3] KPI marts      kpi_daily (edition × day × BU × banner × kpi) + distinct-count sketches
        ▼
 [4] serving        dashboard API / BI layer → screen, CSV/XLSX, PDF snapshot
```

Suggested tooling: dbt (or the warehouse's equivalent) for layers 1–3, with tests and docs. Schedule
an incremental daily build, plus intraday refreshes for the game-platform KPIs.

## 4. Core model

### Conformed dimensions

| Dimension | Key | Notes |
|---|---|---|
| `dim_campaign` | `edition_id` | From `rctapi_minigame_editions`: name, code, start/end, BUs and banners in scope, **comparison edition** (e.g. RPP 2026 → RPP 2025) |
| `dim_date` | `date` | Calendar + **Couche-Tard fiscal calendar** (FY, period, fiscal week) + `campaign_day_n` per edition |
| `dim_bu` | `bu_id` | |
| `dim_banner` | `banner_id` | |
| `dim_store` | `store_id` | → BU, banner, region, timezone |
| `dim_partner` | `partner_id` | Prize and ad partners |
| `dim_prize` | `prize_id` | → partner, tier (instant / grand prize), planned inventory |
| `dim_player` | `player_id` | Signup date, first-play date per edition, home store/BU/banner, loyalty link, flags |

### Facts (atomic grain)

| Fact | Grain | Feeds KPIs |
|---|---|---|
| `fct_install` | install | Téléchargements via média payant |
| `fct_signup` | account | Inscriptions |
| `fct_session` | session | DAU/WAU, sessions/user, repeat visit |
| `fct_play` | game played | Parties jouées, joueurs uniques, nouveaux joueurs |
| `fct_prize_award` | prize instance won | Prix gagnés, rythme |
| `fct_prize_redemption` | redemption | Prix échangés |
| `fct_prize_inventory_snapshot` | prize × day | Prix restants |
| `fct_prize_plan` | prize × day (planned) | Pacing baseline (**input data, probably not in the MCP**) |
| `fct_grand_prize_entry` | entry | Participations grand prix |
| `fct_bonus_action` | completion | Actions bonus / défis |
| `fct_referral` | invite | Parrainage |
| `fct_ad_event` | impression | Impressions / vues uniques par partenaire |
| `fct_store_visit` | identified visit | Trafic en magasin |
| `fct_coupon_redemption` | redemption | Contribution des coupons |
| `fct_lift_transaction` | transaction | Revenus, transactions, panier |

### Attributing BU and banner

Decide the rule for each fact and document it:

- **In-store events** (POS, coupons, redemptions) use the store where the event happened.
- **Digital events** (plays, sessions, signups) use the player's home store or the store chosen in the
  app. Players with no store go to an explicit `Unassigned` bucket. Don't drop them.

## 5. Additivity

This rule matters most for keeping the KPIs correct and the dashboard fast.

| Type | Examples | How it's stored | How it rolls up |
|---|---|---|---|
| Additive | downloads, signups, plays, prizes won, revenue, transactions, impressions | sums | sum |
| Distinct count | unique players, new players, DAU, WAU, unique ad views | **HLL sketch** per edition × day × BU × banner (or precomputed per grain) | merge sketches, then estimate |
| Ratio | sessions/user, repeat-visit rate, avg spend, items/basket, coupon share | **numerator + denominator** stored separately | sum(num) / sum(den). Never average the averages |
| Stock (semi-additive) | prizes remaining | daily snapshot | sum across prizes, last value across time |
| Derived vs plan | distribution pacing | actual vs `fct_prize_plan` | computed at query time |

If exact distinct counts are needed, for example for the contractual customer export, compute them
at each published grain rather than relying on sketches. Sketches have ~1% error.

## 6. Comparisons

- **Previous period** means the immediately preceding window of the same length.
- **FY26** is ambiguous. Pick one meaning per view:
  - **Like-for-like campaign** (recommended for campaigns): compare with the edition in
    `dim_campaign.comparison_edition_id`, aligned on `campaign_day_n`, not on calendar date.
  - **Same fiscal period, FY26**: the same fiscal weeks one year earlier, for KPIs that aren't tied to
    a campaign, such as store traffic and LIFT.
- Show the delta as an absolute value and as a percentage. Show "n/a" when the baseline is missing,
  for example a KPI that didn't exist in FY26. Never show 0.

## 7. Distribution pacing (sous/sur-distribution)

```
expected_to_date(prize, partner, d) = Σ planned_units over plan days ≤ d
pacing_index = actual_awarded_to_date / expected_to_date
status = UNDER if pacing_index < 1 - tol, OVER if > 1 + tol, else ON_TRACK
projected_runout_date = today + remaining / trailing_7d_avg_awards
```

Requirements:

- Store the **plan curve** per prize per day. A flat line from start to end is fine as v1.
- Set the **tolerance** per prize tier, for example ±10%.
- Send an **alert** (email/Slack) when a status flips, and when the projected run-out date falls
  before the campaign end date.

## 8. Customer sharing and export

- Show **aggregates only**. Suppress small cells (e.g. < 10 players) at the BU × banner × day grain.
- Never put PII (player IDs, emails) in the serving layer.
- Restrict at row level by customer / edition if more than one customer can access the tool.
- Stamp every view and export with "Data as of <timestamp>" and a definitions appendix generated from
  `kpis.yml`.
- Make exports read the same API as the screen: CSV/XLSX for the data, PDF for the snapshot.
- Lock numbers for closed campaigns (a frozen final snapshot) so customer reports don't change
  after the fact.

## 9. Data quality and freshness

- dbt tests: unique and not-null keys, referential integrity to `dim_campaign`, and checks that
  values stay in range (e.g. redeemed ≤ won).
- **Reconciliations**: prizes won + remaining = initial inventory, and LIFT totals against finance.
- **Freshness SLA per source**, shown on each tile. For example: game platform ~1 h, POS/LIFT D+1 or
  D+2, MMP D+1.
- Exclusions: test accounts, employees, QA editions, fraud/bot flags. Apply them in staging so every
  KPI uses the same rules.
- Timezones: store-local day boundaries for in-store KPIs, and one documented rule for digital KPIs.

## 10. Serving options (to decide)

| Option | Pros | Cons |
|---|---|---|
| BI tool (Looker / Power BI / Looker Studio) on the marts | Fastest to ship, export and sharing included | Less custom branding, per-viewer licence cost |
| Custom app (e.g. Phoenix LiveView, as the repo name suggests) | Live updates, full branding, custom pacing alerts | More to build and maintain |

The marts and the semantic layer are the same either way, so build those first.

## 11. Open questions

See `docs/OPEN_QUESTIONS.md`.
