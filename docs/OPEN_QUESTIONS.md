# Open questions & suggested additions

## A. Decisions needed before building

1. **Comparison to FY26**: compare each campaign with the previous edition, aligned by campaign day
   (RPP 2026 vs RPP 2025)? Or with the same fiscal weeks in FY26? Or show both?
2. **BU/banner attribution for digital KPIs**: use the player's home store, the store chosen in the
   app, or the store of their last transaction?
3. **"Active user"**: does opening the app count, or does the user have to play?
4. **"New player"**: first play ever on any Circle K game, or first play in this edition?
5. **Successful referral**: is it the referee signing up, or the referee playing for the first time?
6. **Store traffic / LIFT**: do we measure player activity only, or incremental activity against a
   control group? Is there a holdout?
7. **Prize plan**: who owns the expected distribution curve per prize and partner? What tolerance
   defines under- or over-distribution?
8. **Serving layer**: BI tool or custom app? Do customers log in (per-customer access), or do they
   receive exports only?
9. **Freshness**: real-time, hourly or D+1? This drives cost and complexity.
10. **Exact or approximate distinct counts**: is ~1% HLL error acceptable on screen? Exports could
    still use exact counts.

## B. Data likely not in the Couche-Tard MCP (to confirm)

- MMP installs by media source (paid vs organic)
- Paid media spend (needed for CPI / ROAS)
- Prize plan curve and initial inventory per prize
- Ad server impressions per partner, if they aren't logged as in-app events
- The FY26 baseline for KPIs that didn't exist last year

## C. KPIs worth adding

| KPI | Why |
|---|---|
| Funnel: install → signup → first play → prize won → prize redeemed | Shows where players drop off. Most of the data is already in the 23 KPIs |
| Redemption rate (redeemed / won) and median time to redeem | The current list has volumes but no rate |
| Cost per install / per new player, ROAS | Ties paid media to results. Requires spend data |
| D1 / D7 / D30 retention by signup cohort | More robust than the repeat-visit rate alone |
| Loyalty link rate (players linked to a loyalty account) | Store traffic and LIFT can only be measured for linked players, so this caps those KPIs |
| Incremental lift vs control (store visits, revenue) | Customers will ask how much of the result is incremental |
| Marketing opt-in rate (push / email) | Measures CRM value left after the campaign |
| Prize budget burn ($ value awarded vs budget) | Pacing in dollars, not only units |
| Fraud / excluded activity rate | Shows that the numbers are clean |
| Data freshness per tile | Builds trust in a shared dashboard |
