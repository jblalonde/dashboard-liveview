#!/usr/bin/env python3
"""Render the campaign report SQL for one campaign.

    python3 scripts/render_sql.py --campaign rpp-2026                 # reads seeds/campaigns.csv
    python3 scripts/render_sql.py --campaign rpp-2026 --source table  # reads rctapi_minigame_editions

Every sql/kpi/*.sql template starts with `WITH {{COMMON}}`. This script replaces
that placeholder with the shared CTEs:
  campaign     one row: play window, redemption end, timezone, campaign slugs
  geo          province -> region (ATL/QC/CC/WC) -> client rollup -> banner
  partner_map  lowercase keyword -> partner (ads advertiser, prize title)
  players      game players with region, excluding banned / tester / employee
Output goes to build/<campaign>/*.sql, ready to run against the MySQL `rctapi` schema.
"""
import argparse
import csv
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent


def campaign_cte(code, source):
    if source == "table":
        return f"""campaign AS (
  SELECT e.id AS edition_id, e.code, e.timezone AS tz,
         e.start_at, e.end_at, e.redemption_end_at,
         DATE(CONVERT_TZ(e.start_at, 'UTC', e.timezone)) AS start_date,
         DATE(CONVERT_TZ(e.end_at, 'UTC', e.timezone)) AS end_date,
         e.promotion_campaign, e.purchase_campaign_id
  FROM rctapi_minigame_editions e
  WHERE e.code = '{code}' AND e.deleted_at IS NULL
)"""
    rows = {r["code"]: r for r in csv.DictReader(open(ROOT / "seeds/campaigns.csv", encoding="utf-8"))}
    c = rows.get(code)
    if c is None:
        raise SystemExit(f"unknown campaign '{code}'. Known: {', '.join(rows)}")
    if "TBD" in (c["start_at_local"], c["end_at_local"]):
        raise SystemExit(f"campaign '{code}' has no dates yet in seeds/campaigns.csv")
    return f"""campaign AS (
  SELECT {c['edition_id'] or 'NULL'} AS edition_id, '{c['code']}' AS code, '{c['timezone']}' AS tz,
         CONVERT_TZ(TIMESTAMP('{c['start_at_local']}'), '{c['timezone']}', 'UTC') AS start_at,
         CONVERT_TZ(TIMESTAMP('{c['end_at_local']}'), '{c['timezone']}', 'UTC') AS end_at,
         CONVERT_TZ(TIMESTAMP('{c['redemption_end_at_local']}'), '{c['timezone']}', 'UTC') AS redemption_end_at,
         DATE('{c['start_at_local']}') AS start_date,
         DATE('{c['end_at_local']}') AS end_date,
         '{c['promotion_campaign']}' AS promotion_campaign,
         '{c['purchase_campaign_id']}' AS purchase_campaign_id
)"""


def geo_cte():
    rows = list(csv.DictReader(open(ROOT / "seeds/geo_region.csv", encoding="utf-8")))
    values = ",\n    ".join(
        f"ROW('{r['province_code']}', '{r['region_code']}', '{r['client_rollup']}', '{r['banner_default']}')"
        for r in rows
    )
    return f"""geo (province_code, region_code, client_rollup, banner) AS (
  VALUES
    {values}
)"""


def partner_cte():
    rows = list(csv.DictReader(open(ROOT / "seeds/partners.csv", encoding="utf-8")))
    values = ",\n    ".join(
        "ROW({}, '{}', '{}')".format(r["priority"], r["pattern"].replace("'", "''"), r["partner"].replace("'", "''"))
        for r in rows
    )
    return f"""partner_map (priority, pattern, partner) AS (
  VALUES
    {values}
)"""


PLAYERS_CTE = """players AS (
  SELECT p.id AS rpp_player_id, p.user_id, p.created_at,
         COALESCE(g.region_code, 'UNASSIGNED') AS region_code,
         COALESCE(g.client_rollup, 'UNASSIGNED') AS client_rollup,
         COALESCE(g.banner, 'UNASSIGNED') AS banner
  FROM rctapi_minigame_players p
  LEFT JOIN geo g ON g.province_code = p.province
  LEFT JOIN craft_ctapi_clients cl ON cl.id = p.user_id
  WHERE p.banned_at IS NULL
    AND COALESCE(cl.is_tester, 0) = 0
    AND COALESCE(cl.is_employee, 0) = 0
)"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--campaign", required=True, help="campaign code, e.g. rpp-2026")
    ap.add_argument("--source", choices=["seed", "table"], default="seed")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    common = ",\n".join([campaign_cte(args.campaign, args.source), geo_cte(), partner_cte(), PLAYERS_CTE])
    out = pathlib.Path(args.out or ROOT / "build" / args.campaign)
    out.mkdir(parents=True, exist_ok=True)
    for tpl in sorted((ROOT / "sql/kpi").glob("*.sql")):
        sql = tpl.read_text(encoding="utf-8").replace("{{COMMON}}", common)
        (out / tpl.name).write_text(sql, encoding="utf-8")
        print(out / tpl.name)


if __name__ == "__main__":
    main()
