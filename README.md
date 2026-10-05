# dashboard-liveview

Campaign KPI dashboard (one filter per `rctapi_minigame_editions` edition), shareable and exportable to the customer.

- `docs/ARCHITECTURE.md` — layers, data model, additivity rules, comparisons, pacing, sharing
- `docs/DATA_MAPPING.md` — KPI → Couche-Tard MCP tables, regions/banners, gaps, why some data isn't in the MCP
- `docs/OPEN_QUESTIONS.md` — decisions needed, data gaps, suggested extra KPIs
- `semantic/kpis.yml` — the 23 KPI definitions with source and availability status
- `sql/README.md` — the campaign report template: how the campaign filter works, the 12 standard queries
- `sql/editions/rctapi_minigame_editions.template.sql` — proposed editions table + `edition_id` migrations for the dev team
- `seeds/` — campaigns registry, province → region (ATL/QC/CC/WC) mapping, partner mapping
- `scripts/render_sql.py` — renders `sql/kpi/*.sql` for one campaign into `build/<campaign>/`

```bash
python3 scripts/render_sql.py --campaign rpp-2026
```
