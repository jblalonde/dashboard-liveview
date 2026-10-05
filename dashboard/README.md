# Live dashboard

One HTML page, published as a claude.ai artifact, that queries the Couche-Tard MCP itself.

Live: https://claude.ai/artifact/Hg4NZXJHQ9QDvJgvw7dZFD

```
dashboard/src/index.html   page shell (filters, sections)
dashboard/src/styles.css   design tokens, light + dark
dashboard/src/app.js       MCP calls, result parsing, KPI engine, charts, export
dashboard/build.py         -> dashboard/dist/index.html (single file, data embedded)
```

```bash
python3 dashboard/build.py
```

The build embeds `sql/kpi/*.sql` (geo, partner and players CTEs pre-rendered),
`seeds/campaigns.csv`, `seeds/geo_region.csv` and `semantic/kpis.yml`. Change those files, rebuild,
then republish `dashboard/dist/index.html` to the same artifact URL.

## How data flows

| Step | What happens |
|---|---|
| Refresh | The page runs the 18 report queries through the viewer's **Couche-Tard MCP** connector (`run_query`), 2 at a time, fastest first. It takes about 3 to 4 minutes for a full campaign. |
| Campaign list | It first tries `rctapi_minigame_editions`. If the table doesn't exist yet, it falls back to the campaign list embedded from `seeds/campaigns.csv`. |
| Snapshot | Each query's raw result is stored in the artifact's shared database (`campaigns/<code>/results/<qid>`, plus `campaigns/<code>` for the "data as of" time). Only editors can write it. Everyone with access reads it. |
| Viewers without the connector | They see the last published snapshot, with its "Données au" timestamp. |
| Live campaigns | While a campaign has `status = live`, an editor's open page refreshes every 30 minutes. |

The first time an editor opens the page with the connector, it fills the snapshot automatically.

## Layout

The page is organized in tabs, so each view stays short:

| Tab | Content |
|---|---|
| Vue d'ensemble | 4 headline KPIs with sparklines (joueurs uniques, parties, prix échangés, téléchargements), 4 secondary KPIs, the active-player trend with the comparison period dashed, the split by BU, the player funnel, and auto-generated points of attention (pacing, unused inventory, redemption rate, data gaps) |
| Audience | 9 audience KPIs; active players (Total / Par BU toggle), signups, downloads vs pre-launch, retention J1/J7/J30 by first-play week, consecutive-day streaks, play heatmap |
| Prix | 6 prize KPIs; won vs redeemed per day, pacing per partner (bar + 100 % marker + status), grand-prize entries by source, prizes gifted to a friend |
| Mécaniques | Bonus actions, badges, ads per partner, SMS/email consents |
| Commercial | LIFT KPIs, coupons per day, LIFT revenue per week; store traffic flagged as missing |
| Définitions | Every KPI with its French definition, source and data status |

The selected tab is kept in the link (`#prix`, `#audience`…) and in the viewer's browser.
Every chart has a "Tableau" toggle that shows its data.

## Bilan (Wrapped-style recap)

Once a campaign has ended, a **Voir le bilan** button opens a full-screen story of 13 screens. Each
screen shows one headline number, from the same snapshot, for the selected BU and banner:

- players and new players
- games played, with the pace (one game every N seconds)
- return rate and active days per player
- the peak day
- the leading BU
- prizes won and redeemed, and the most-redeemed partner
- grand-prize entries
- the most popular bonus action and referrals
- ad reach and the top partner
- download lift vs before launch
- LIFT sales
- a summary

Controls:
- Navigation: tap or click (left side goes back), swipe, or arrow keys.
- Space pauses; Escape closes.
- Screens auto-advance every 6.5 s; with reduced motion, there's no auto-advance or count-up.
- The last screen offers **Télécharger la carte**: a 1080×1350 PNG summary to share.
- Linking to the page with `#bilan` opens the recap directly.

Screens whose data is missing are skipped.

## Filters and comparisons

- **Campaign**: from the editions table, or from the seed list until that table exists.
- **Period**:
  - Toute la campagne. Prize redemptions then also count the coupon redemption window.
  - 7 derniers jours.
  - Each Monday-to-Sunday week.
  - **Personnalisée**: any date range within the campaign. A custom range that matches the whole
    campaign or a week is detected automatically, so unique players stay exact.
  - On any other custom range, unique players and active days per player show "Disponible pour
    toute la campagne ou une semaine", because distinct counts can't be summed across days.
- **BU**: All, Eastern (ATL + QC), ATL, QC, CC or WC.
- **Banner**: Couche-Tard = QC, Circle K = the rest. For downloads, the banner selects the app.
- **Comparison**:
  - **Previous period**: the window of the same length just before the selected one. It is hidden
    when that window would start before launch, except for downloads, which compare with the same
    number of days before launch.
  - **FY26**: uses `comparison_edition_id`, aligned on campaign day.
  - A change is shown only when the comparison exists. Otherwise the tile stays quiet.

## Export

- **Exporter les KPI**: the visible tiles with their filters, comparison, source status and
  "data as of" time.
- **Exporter les données**: every dataset in long format.

Both are CSV files with semicolons and French decimals, which open directly in Excel (fr-CA).

## Sharing with the client

The artifact is private by default; share it from the page's Share menu. Because the page declares a
connector, it can't be shared through a public link. Share it with people in the organization or
with invited guests. People without the connector only read the snapshot.

## Charts

Apache ECharts 6.1.0, loaded from jsDelivr, rendered as SVG. Colors come from the page tokens and are
redrawn when the theme changes. Regions keep fixed colors (ATL, QC, CC, WC = slots 1 to 4).
Every chart has a "Voir les données" table.
