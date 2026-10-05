#!/usr/bin/env python3
"""Build the internal retrospective page: retro/dist/index.html.

Inlines retro/src/{styles.css,app.js} and the verified data files in retro/data/:
  harvest-ctrpp.json      Harvest hours (team-level aggregates, via Composio)
  jira-rppprev.json       Jira RPPREV issues, sprints, bugs (team-level)
  campagne-rpp-2026.json  Campaign facts from the Couche-Tard MCP
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
data = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((ROOT / "data").glob("*.json"))}
html = (ROOT / "src/index.html").read_text(encoding="utf-8")
html = html.replace("/*__STYLES__*/", (ROOT / "src/styles.css").read_text(encoding="utf-8"))
html = html.replace("/*__DATA__*/", json.dumps(data, ensure_ascii=False).replace("</", "<\\/"))
html = html.replace("/*__APP__*/", (ROOT / "src/app.js").read_text(encoding="utf-8"))
out = ROOT / "dist/index.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding="utf-8")
print(f"{out} ({len(html) // 1024} KB)")
