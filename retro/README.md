# Bilan d'apprentissage RPP 2026 (internal)

Live: https://claude.ai/artifact/4JMZN8fdSx2QAdWystc3h8. Internal only: don't share with the client.

15 findings, each set out as **number → what it means → proposal**, from three sources:

| File | Source | Content |
|---|---|---|
| `data/jira-rppprev.json` | Jira RPPREV (Atlassian MCP) | Issue counts, sprints (actual start → close), bugs by month, team throughput |
| `data/harvest-ctrpp.json` | Harvest CTRPP (Composio) | Hours by week, by task and by month, budget, planned dates. Team-level only. |
| `data/campagne-rpp-2026.json` | Couche-Tard MCP | Verified campaign facts (funnel, retention, gifts, inventory, stores by region…) |

```bash
python3 retro/build.py   # -> retro/dist/index.html
```

## Data caveats (shown in the page)
- **Jira resolution dates aren't usable for timing.** 124 tickets were closed within 3 minutes on
  2026-07-21 when sprint 5 closed. Lead time and weekly throughput are therefore not shown. Only
  tickets done per sprint are shown, and with this caveat.
- **Story points** are on 18 % of tickets only, so velocity is shown in tickets and hours, not in points.
- **Harvest and Jira aren't linked**: no time entry references a ticket, so there's no cost per
  feature.
- **Store counts** come from the app's store table, split by postal code. They should be checked
  against the real store network.
- **Team-level only**: no per-person metrics.

## Action plan
Each proposal has a status (À discuter / Retenue / Écartée), stored in the artifact database at
`plan/rpp-2026` and shared by everyone who can open the page. Contributors and above can change it.
The plan can be exported as Markdown (copy, or download a `.md` file) to paste into Jira or
Confluence.
