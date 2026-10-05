#!/usr/bin/env python3
"""Build the live dashboard into one self-contained HTML file.

    python3 dashboard/build.py   ->  dashboard/dist/index.html

Inlines dashboard/src/{styles.css,app.js} into dashboard/src/index.html and
embeds, as JSON, everything the page needs to query the Couche-Tard MCP itself:
  - the report templates (sql/kpi/*.sql) with the shared geo/partner/players CTEs
    already rendered; only the `campaign` CTE is built in the browser
  - the campaign registry (seeds/campaigns.csv), used until
    rctapi_minigame_editions is deployed
  - the region seed and the KPI definitions (semantic/kpis.yml)
"""
import csv
import json
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import render_sql  # noqa: E402

SRC = ROOT / "dashboard" / "src"
DIST = ROOT / "dashboard" / "dist"


def main():
    shared = ",\n".join([render_sql.geo_cte(), render_sql.partner_cte(), render_sql.PLAYERS_CTE])
    queries = {}
    for tpl in sorted((ROOT / "sql" / "kpi").glob("*.sql")):
        qid = "q" + tpl.name[:2]
        body = tpl.read_text(encoding="utf-8")
        queries[qid] = {"file": tpl.name, "sql": body.replace("{{COMMON}}", "{{CAMPAIGN}},\n" + shared)}

    data = {
        "queries": queries,
        "campaigns": list(csv.DictReader(open(ROOT / "seeds/campaigns.csv", encoding="utf-8"))),
        "regions": list(csv.DictReader(open(ROOT / "seeds/geo_region.csv", encoding="utf-8"))),
        "kpis": yaml.safe_load(open(ROOT / "semantic/kpis.yml", encoding="utf-8"))["kpis"],
    }
    html = (SRC / "index.html").read_text(encoding="utf-8")
    html = html.replace("/*__STYLES__*/", (SRC / "styles.css").read_text(encoding="utf-8"))
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    html = html.replace("/*__DATA__*/", payload)
    html = html.replace("/*__APP__*/", (SRC / "app.js").read_text(encoding="utf-8"))
    DIST.mkdir(parents=True, exist_ok=True)
    out = DIST / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"{out} ({len(html) // 1024} KB)")


if __name__ == "__main__":
    main()
