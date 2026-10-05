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
| Refresh | The page runs the 12 report queries through the viewer's **Couche-Tard MCP** connector (`run_query`), 2 at a time, fastest first. It takes about 2 to 3 minutes for a full campaign. |
| Campaign list | It first tries `rctapi_minigame_editions`. If the table doesn't exist yet, it falls back to the campaign list embedded from `seeds/campaigns.csv`. |
| Snapshot | Each query's raw result is stored in the artifact's shared database (`campaigns/<code>/results/<qid>`, plus `campaigns/<code>` for the "data as of" time). Only editors can write it. Everyone with access reads it. |
| Viewers without the connector | They see the last published snapshot, with its "Données au" timestamp. |
| Live campaigns | While a campaign has `status = live`, an editor's open page refreshes every 30 minutes. |

The first time an editor opens the page with the connector, it fills the snapshot automatically.

## Filters and comparisons

- **Campaign**: from the editions table, or from the seed list until that table exists.
- **Period**: the whole campaign, or one Monday-to-Sunday week.
- **BU**: All, Eastern (ATL + QC), ATL, QC, CC or WC.
- **Banner**: Couche-Tard = QC, Circle K = the rest. For downloads, the banner selects the app.
- **Comparison**:
  - **Previous period**: the previous week. For the whole campaign, only downloads have a baseline:
    the same number of days before launch.
  - **FY26**: uses `comparison_edition_id`, aligned on campaign day (day N vs day N). It shows "n/d"
    until a comparable edition exists.

KPIs that only exist for the whole campaign or as a current stock (new players, repeat-visit rate,
mechanics, remaining prizes) say so on their tile.

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
