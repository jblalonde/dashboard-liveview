(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants and embedded report definition (built by dashboard/build.py)
  // ---------------------------------------------------------------------------
  const DATA = JSON.parse(document.getElementById('report-data').textContent);
  const SERVER = 'Couche-Tard MCP';
  const TOOL = 'run_query';
  // Fast queries first so the page fills progressively; at most 2 in flight.
  const QUERY_ORDER = ['q12', 'q10', 'q08', 'q15', 'q18', 'q04', 'q05', 'q11', 'q07', 'q03', 'q02', 'q13', 'q01', 'q09', 'q14', 'q16', 'q06', 'q17'];
  const CONCURRENCY = 2;
  const LIVE_REFRESH_MS = 30 * 60 * 1000;

  const REGION_ORDER = ['ATL', 'QC', 'CC', 'WC'];
  const REGION_LABEL = { ATL: 'Atlantique', QC: 'Québec', CC: 'Centre', WC: 'Ouest', UNASSIGNED: 'Non attribué' };
  const REGION_VAR = { ATL: '--r-atl', QC: '--r-qc', CC: '--r-cc', WC: '--r-wc' };
  const REGION_META = {};
  for (const r of DATA.regions) REGION_META[r.region_code] = { banner: r.banner_default, rollup: r.client_rollup };
  const REGION_OPTIONS = [
    { id: 'all', label: 'Toutes les BU', regions: REGION_ORDER },
    { id: 'Eastern', label: 'Eastern (ATL + QC)', regions: ['ATL', 'QC'] },
    ...REGION_ORDER.map((c) => ({ id: c, label: `${c} · ${REGION_LABEL[c]}`, regions: [c] })),
  ];
  const KPI_DEF = Object.fromEntries(DATA.kpis.map((k) => [k.id, k]));
  const TABS = ['overview', 'audience', 'prix', 'mecaniques', 'commercial', 'definitions'];

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------
  const nf = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const compact = new Intl.NumberFormat('fr-CA', { notation: 'compact', maximumFractionDigits: 1 });
  const money = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' });
  const dayFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayLong = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const stampFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Toronto' });
  const FMT = {
    int: (v) => nf.format(v),
    dec1: (v) => nf1.format(v),
    dec2: (v) => nf2.format(v),
    pct: (v) => `${nf1.format(v * 100)} %`,
    pct0: (v) => `${nf.format(v * 100)} %`,
    money: (v) => money.format(v),
    money2: (v) => money2.format(v),
    short: (v) => (Math.abs(v) >= 10000 ? compact.format(v) : nf.format(v)),
  };
  const fmtDay = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
  const fmtDayLong = (iso) => dayLong.format(new Date(`${iso}T00:00:00Z`));

  // ---------------------------------------------------------------------------
  // Date helpers (ISO yyyy-mm-dd, calendar days, no timezone drift)
  // ---------------------------------------------------------------------------
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const toIso = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
  const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
  const mondayOf = (iso) => { const d = toDate(iso); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };
  const localDate = (utcIso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(utcIso));
  const todayIn = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
  const minIso = (a, b) => (a < b ? a : b);
  const maxIso = (a, b) => (a > b ? a : b);
  function eachDay(d0, d1) { const out = []; for (let d = d0; d <= d1; d = addDays(d, 1)) out.push(d); return out; }

  // ---------------------------------------------------------------------------
  // Campaign registry: seeds/campaigns.csv until rctapi_minigame_editions exists
  // ---------------------------------------------------------------------------
  function campaignFromSeed(r) {
    const has = (v) => v && v !== 'TBD';
    return {
      code: r.code,
      name: r.name_fr || r.code,
      editionId: has(r.edition_id) ? Number(r.edition_id) : null,
      start: has(r.start_at_local) ? r.start_at_local.slice(0, 10) : null,
      end: has(r.end_at_local) ? r.end_at_local.slice(0, 10) : null,
      redemptionEnd: has(r.redemption_end_at_local) ? r.redemption_end_at_local.slice(0, 10) : (has(r.end_at_local) ? r.end_at_local.slice(0, 10) : null),
      startLocal: r.start_at_local,
      endLocal: r.end_at_local,
      redemptionEndLocal: has(r.redemption_end_at_local) ? r.redemption_end_at_local : r.end_at_local,
      tz: r.timezone || 'America/Toronto',
      fiscalYear: has(r.fiscal_year) ? r.fiscal_year : null,
      promotionCampaign: has(r.promotion_campaign) ? r.promotion_campaign : '',
      purchaseCampaignId: has(r.purchase_campaign_id) ? r.purchase_campaign_id : '',
      comparisonId: r.comparison_edition_id ? Number(r.comparison_edition_id) : null,
      status: r.status || 'draft',
      source: 'seed',
    };
  }
  function campaignFromTable(r) {
    const tz = r.timezone || 'America/Toronto';
    const end = r.end_at ? localDate(r.end_at, tz) : null;
    return {
      code: r.code,
      name: r.name_fr || r.code,
      editionId: r.id,
      start: r.start_at ? localDate(r.start_at, tz) : null,
      end,
      redemptionEnd: r.redemption_end_at ? localDate(r.redemption_end_at, tz) : end,
      tz,
      fiscalYear: r.fiscal_year || null,
      promotionCampaign: r.promotion_campaign || '',
      purchaseCampaignId: r.purchase_campaign_id || '',
      comparisonId: r.comparison_edition_id || null,
      status: r.status || 'draft',
      source: 'table',
    };
  }
  const isReady = (c) => !!(c && c.start && c.end);
  const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

  function campaignCte(c) {
    if (c.source === 'table') {
      return `campaign AS (
  SELECT e.id AS edition_id, e.code, e.timezone AS tz,
         e.start_at, e.end_at, e.redemption_end_at,
         DATE(CONVERT_TZ(e.start_at, 'UTC', e.timezone)) AS start_date,
         DATE(CONVERT_TZ(e.end_at, 'UTC', e.timezone)) AS end_date,
         e.promotion_campaign, e.purchase_campaign_id
  FROM rctapi_minigame_editions e
  WHERE e.code = ${sqlStr(c.code)} AND e.deleted_at IS NULL
)`;
    }
    const tz = sqlStr(c.tz);
    return `campaign AS (
  SELECT ${c.editionId == null ? 'NULL' : Number(c.editionId)} AS edition_id, ${sqlStr(c.code)} AS code, ${tz} AS tz,
         CONVERT_TZ(TIMESTAMP(${sqlStr(c.startLocal)}), ${tz}, 'UTC') AS start_at,
         CONVERT_TZ(TIMESTAMP(${sqlStr(c.endLocal)}), ${tz}, 'UTC') AS end_at,
         CONVERT_TZ(TIMESTAMP(${sqlStr(c.redemptionEndLocal)}), ${tz}, 'UTC') AS redemption_end_at,
         DATE(${sqlStr(c.startLocal)}) AS start_date,
         DATE(${sqlStr(c.endLocal)}) AS end_date,
         ${sqlStr(c.promotionCampaign)} AS promotion_campaign,
         ${sqlStr(c.purchaseCampaignId)} AS purchase_campaign_id
)`;
  }
  const buildSql = (qid, c) => `-- report:${qid}\n` + DATA.queries[qid].sql.replace('{{CAMPAIGN}}', campaignCte(c));

  const EDITIONS_SQL = `SELECT id, code, name_fr, start_at, end_at, redemption_end_at, timezone, fiscal_year,
       promotion_campaign, purchase_campaign_id, comparison_edition_id, status
FROM rctapi_minigame_editions WHERE deleted_at IS NULL ORDER BY start_at DESC`;

  // ---------------------------------------------------------------------------
  // MCP result parsing. run_query answers with a text table:
  //   col_a | col_b
  //   ------+------
  //   1     | x
  //   (blank)
  //   N rows in 12ms
  // ---------------------------------------------------------------------------
  function resultText(res) {
    if (typeof res?.payload === 'string') return res.payload;
    const block = (res?.content || []).find((b) => b.type === 'text');
    if (block) return block.text;
    if (res?.payload != null) return JSON.stringify(res.payload);
    return '';
  }
  function cellValue(raw) {
    const v = raw.trim();
    if (v === 'NULL' || v === '') return null;
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    const m = v.match(/^(\d{4}-\d{2}-\d{2})T00:00:00(\.000)?Z$/);
    if (m) return m[1];
    return v;
  }
  function parseTable(text) {
    if (/Query returned 0 rows/i.test(text)) return [];
    const lines = text.split(/\r?\n/);
    const sep = lines.findIndex((l, i) => i > 0 && /^-+(\+-+)*\s*$/.test(l.trim()) && l.includes('-'));
    if (sep < 1) throw Object.assign(new Error('Réponse illisible du connecteur'), { code: 'parse_error' });
    const cols = lines[sep - 1].split('|').map((s) => s.trim());
    const rows = [];
    for (let i = sep + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) break;
      const parts = line.split('|');
      if (parts.length < cols.length) continue;
      if (parts.length > cols.length) {
        const extra = parts.splice(cols.length - 1);
        parts.push(extra.join('|'));
      }
      const row = {};
      cols.forEach((c, j) => { row[c] = cellValue(parts[j]); });
      rows.push(row);
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    campaigns: DATA.campaigns.map(campaignFromSeed),
    registrySource: 'seed',
    campaign: null,
    period: 'all',
    custom: null,       // { d0, d1 } for the custom range
    compare: 'prev',
    region: 'all',
    banner: 'all',
    tab: 'overview',
    activeSplit: false, // Audience chart: total vs per BU
    openTables: new Set(),
    results: {},
    errors: {},
    meta: {},
    busy: false,
    progress: null,
  };
  const caps = { mcp: null, db: null, user: null, downloads: null, canWrite: false };

  function currentCampaign() { return state.campaigns.find((c) => c.code === state.campaign) || null; }
  function comparisonCampaign(c) {
    if (!c || c.comparisonId == null) return null;
    return state.campaigns.find((x) => x.editionId === c.comparisonId) || null;
  }
  function pickDefaultCampaign() {
    const ready = state.campaigns.filter(isReady);
    const live = ready.find((c) => c.status === 'live');
    return (live || ready.sort((a, b) => (a.start < b.start ? 1 : -1))[0] || state.campaigns[0])?.code || null;
  }
  state.campaign = pickDefaultCampaign();

  function activeRegions() {
    const opt = REGION_OPTIONS.find((o) => o.id === state.region) || REGION_OPTIONS[0];
    return opt.regions.filter((r) => state.banner === 'all' || REGION_META[r]?.banner === state.banner);
  }
  const allRegionsSelected = () => activeRegions().length === REGION_ORDER.length;

  // ---------------------------------------------------------------------------
  // Periods: whole campaign, last 7 days, Monday-based weeks (same weeks as
  // sql/kpi/03), or any custom range inside the campaign.
  // ---------------------------------------------------------------------------
  function weeksOf(c) {
    const out = [];
    let w = mondayOf(c.start);
    let n = 1;
    while (w <= c.end) {
      out.push({ id: `w${n}`, week: w, n, d0: maxIso(w, c.start), d1: minIso(addDays(w, 6), c.end) });
      w = addDays(w, 7);
      n += 1;
    }
    return out;
  }
  // Give any range its most precise kind, so a custom range equal to a week or
  // to the whole campaign gets the exact unique-player figures.
  function classify(c, d0, d1) {
    if (d0 <= c.start && d1 >= c.end) return { kind: 'all', d0: c.start, d1: c.end };
    const w = weeksOf(c).find((x) => x.d0 === d0 && x.d1 === d1);
    if (w) return { kind: 'week', week: w.week, d0, d1 };
    return { kind: 'custom', d0, d1 };
  }
  function periodOptions(c) {
    if (!isReady(c)) return [];
    const last = minIso(todayIn(c.tz), c.end);
    const opts = [
      { id: 'all', label: 'Toute la campagne' },
      { id: 'last7', label: '7 derniers jours', d0: maxIso(addDays(last, -6), c.start), d1: last },
      ...weeksOf(c).map((w) => ({ id: w.id, label: `Semaine ${w.n} · ${fmtDay(w.d0)} – ${fmtDay(w.d1)}`, d0: w.d0, d1: w.d1 })),
      { id: 'custom', label: 'Personnalisée…' },
    ];
    return opts;
  }
  function currentRange() {
    const c = currentCampaign();
    if (!isReady(c)) return null;
    const opt = periodOptions(c).find((p) => p.id === state.period) || { id: 'all' };
    let d0 = c.start;
    let d1 = c.end;
    if (opt.id === 'custom' && state.custom) { d0 = maxIso(state.custom.d0, c.start); d1 = minIso(state.custom.d1, c.end); }
    else if (opt.d0) { d0 = opt.d0; d1 = opt.d1; }
    if (d1 < d0) d1 = d0;
    const rg = classify(c, d0, d1);
    // Coupons can be redeemed after play ends: the whole campaign counts them too.
    rg.redeemD1 = rg.kind === 'all' ? (c.redemptionEnd || c.end) : rg.d1;
    rg.label = rg.kind === 'all' ? 'Toute la campagne' : `${fmtDay(rg.d0)} – ${fmtDay(rg.d1)}`;
    return rg;
  }

  // ---------------------------------------------------------------------------
  // KPI engine. Each KPI computes from one campaign's results for a range of
  // days and a set of regions; comparisons reuse the same function.
  // ---------------------------------------------------------------------------
  const rowsOf = (res, qid) => res?.[qid]?.rows || null;
  const sum = (rows, f) => rows.reduce((a, r) => a + (Number(typeof f === 'function' ? f(r) : r[f]) || 0), 0);
  function regionFilter(rows, regions, allowUnassigned) {
    return rows.filter((r) => regions.includes(r.region_code) || (allowUnassigned && r.region_code === 'UNASSIGNED'));
  }
  function daily(res, qid, rg, regions, opts = {}) {
    const rows = rowsOf(res, qid);
    if (!rows) return null;
    const scoped = opts.noRegion ? rows : regionFilter(rows, regions, opts.allowUnassigned);
    const d1 = opts.redeem ? rg.redeemD1 || rg.d1 : rg.d1;
    return scoped.filter((r) => r.day >= rg.d0 && r.day <= d1);
  }
  const overlapsCampaign = (rg, c) => rg.d1 >= c.start && rg.d0 <= c.end;
  const ratio = (a, b) => (b ? a / b : null);
  const NEEDS_EXACT = 'Disponible pour toute la campagne ou une semaine';

  function appKeys() {
    if (state.banner === 'Couche-Tard') return ['couche_tard_ios', 'couche_tard_android'];
    if (state.banner === 'Circle K') return ['circle_k_ios', 'circle_k_android'];
    return ['couche_tard_ios', 'couche_tard_android', 'circle_k_ios', 'circle_k_android'];
  }
  const downloadsOf = (r) => appKeys().reduce((a, k) => a + (r[k] || 0), 0);

  // scope: 'period' follows the period filter; 'campaign' = whole-campaign total; 'stock' = as of today.
  const KPIS = [
    { id: 'paid_app_installs', section: 'audience', label: "Téléchargements d'app", fmt: 'int', scope: 'period', noRegion: true, allowBeforeStart: true,
      note: "Toutes provenances : l'attribution au média payant n'est pas encore disponible. Non ventilé par BU.",
      calc: (x) => { const rows = daily(x.res, 'q12', x.rg, x.regions, { noRegion: true }); return rows && sum(rows, downloadsOf); },
      spark: (x) => ({ qid: 'q12', f: downloadsOf, noRegion: true }) },
    { id: 'signups', section: 'audience', label: 'Inscriptions', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q01', x.rg, x.regions); return rows && sum(rows, 'signups'); } },
    { id: 'new_players', section: 'audience', label: 'Nouveaux joueurs aux jeux Circle K', fmt: 'int', scope: 'campaign',
      calc: (x) => { const rows = rowsOf(x.res, 'q02'); return rows && sum(regionFilter(rows, x.regions), 'new_to_ck_games'); } },
    { id: 'unique_players', section: 'audience', label: 'Joueurs uniques', fmt: 'int', scope: 'period', exact: true,
      calc: (x) => {
        if (x.rg.kind === 'week') { const rows = rowsOf(x.res, 'q03'); return rows && sum(regionFilter(rows, x.regions).filter((r) => r.week_start === x.rg.week), 'wau'); }
        if (x.rg.kind === 'all') { const rows = rowsOf(x.res, 'q02'); return rows && sum(regionFilter(rows, x.regions), 'unique_players'); }
        return null;
      },
      spark: () => ({ qid: 'q01', f: (r) => r.active_players }) },
    { id: 'dau', section: 'audience', label: 'Actifs par jour (moy.)', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q01', x.rg, x.regions); if (!rows) return null; const days = new Set(rows.filter((r) => r.active_players > 0).map((r) => r.day)).size; return days ? sum(rows, 'active_players') / days : null; } },
    { id: 'wau', section: 'audience', label: 'Actifs par semaine (moy.)', fmt: 'int', scope: 'period',
      calc: (x) => {
        const rows = rowsOf(x.res, 'q03'); if (!rows) return null;
        let scoped = regionFilter(rows, x.regions).filter((r) => r.week_start >= mondayOf(x.rg.d0) && r.week_start <= x.rg.d1);
        // Average over complete weeks only; partial first/last weeks would drag it down.
        const full = scoped.filter((r) => r.week_start >= x.rg.d0 && addDays(r.week_start, 6) <= x.rg.d1);
        if (full.length) scoped = full;
        const weeks = [...new Set(scoped.map((r) => r.week_start))];
        return weeks.length ? sum(scoped, 'wau') / weeks.length : null;
      } },
    { id: 'sessions_per_user', section: 'audience', label: 'Jours actifs par joueur', fmt: 'dec1', scope: 'period', exact: true,
      note: "Remplace « sessions par utilisateur » : le jeu n'enregistre pas de sessions d'app, on compte les jours où chaque joueur a joué.",
      calc: (x) => {
        if (x.rg.kind === 'week') {
          const d = daily(x.res, 'q01', x.rg, x.regions); const w = rowsOf(x.res, 'q03');
          return d && w ? ratio(sum(d, 'active_players'), sum(regionFilter(w, x.regions).filter((r) => r.week_start === x.rg.week), 'wau')) : null;
        }
        if (x.rg.kind !== 'all') return null;
        const rows = rowsOf(x.res, 'q02'); if (!rows) return null; const s = regionFilter(rows, x.regions);
        return ratio(sum(s, 'player_days'), sum(s, 'unique_players'));
      } },
    { id: 'repeat_visit_rate', section: 'audience', label: 'Taux de visites répétées', fmt: 'pct', scope: 'campaign', delta: 'pts',
      calc: (x) => { const rows = rowsOf(x.res, 'q02'); if (!rows) return null; const s = regionFilter(rows, x.regions); return ratio(sum(s, 'repeat_players'), sum(s, 'unique_players')); } },
    { id: 'games_played', section: 'audience', label: 'Parties jouées', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q01', x.rg, x.regions); return rows && sum(rows, 'games_played'); },
      spark: () => ({ qid: 'q01', f: (r) => r.games_played }) },

    { id: 'instant_prizes_won', section: 'prix', label: 'Prix gagnés', fmt: 'int', scope: 'period',
      // Whole campaign includes the few prizes granted after play ended (late game completions).
      calc: (x) => { const rows = daily(x.res, 'q05', x.rg, x.regions, { redeem: true }); return rows && sum(rows, 'won'); } },
    { id: 'instant_prizes_redeemed', section: 'prix', label: 'Prix échangés', fmt: 'int', scope: 'period',
      note: "Coupons activés en magasin, à la date d'activation. Toute la campagne inclut la période d'échange après la fin du jeu.",
      calc: (x) => { const rows = daily(x.res, 'q11', x.rg, x.regions, { allowUnassigned: x.allRegions, redeem: true }); return rows && sum(rows, 'coupon_activations'); },
      spark: () => ({ qid: 'q11', f: (r) => r.coupon_activations, redeem: true }) },
    { id: 'redemption_rate', section: 'prix', label: "Taux d'échange", fmt: 'pct', scope: 'campaign', delta: 'pts', extra: true,
      note: 'Prix échangés en magasin ÷ prix gagnés, sur toute la campagne.',
      // Same "échangés" source as the tile and daily chart (coupon activations), so the numbers always agree.
      calc: (x) => {
        const won = rowsOf(x.res, 'q04'); const act = rowsOf(x.res, 'q11'); if (!won || !act) return null;
        return ratio(sum(regionFilter(act, x.regions, x.allRegions), 'coupon_activations'), sum(regionFilter(won, x.regions), 'won'));
      } },
    { id: 'prizes_remaining', section: 'prix', label: 'Prix restants', fmt: 'int', scope: 'stock',
      note: "Inventaire moins les prix distribués. Les coupons non échangés à temps retournent dans l'inventaire.",
      calc: (x) => { const rows = rowsOf(x.res, 'q04'); return rows && sum(regionFilter(rows, x.regions), 'remaining'); } },
    { id: 'distribution_pacing', section: 'prix', label: 'Rythme de distribution', fmt: 'pct0', scope: 'stock', delta: 'pts',
      note: 'Prix distribués ÷ plan linéaire à date. Sous 90 % : sous-distribution. Au-dessus de 110 % : sur-distribution.',
      calc: (x) => { const rows = rowsOf(x.res, 'q04'); if (!rows) return null; const s = regionFilter(rows, x.regions); return ratio(sum(s, 'net_awarded'), sum(s, 'planned_to_date')); },
      state: (v) => paceStatus(v) },
    { id: 'grand_prize_entries', section: 'prix', label: 'Participations au grand prix', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q06', x.rg, x.regions); return rows && sum(rows, 'entries'); } },

    { id: 'bonus_challenge_completions', section: 'mecaniques', label: 'Actions bonus complétées', fmt: 'int', scope: 'campaign',
      calc: (x) => { const rows = rowsOf(x.res, 'q07'); return rows && sum(regionFilter(rows, x.regions).filter((r) => r.kind === 'bonus_action'), 'completions'); } },
    { id: 'badges_earned', section: 'mecaniques', label: 'Défis réussis', fmt: 'int', scope: 'campaign', kpiRef: 'bonus_challenge_completions', extra: true,
      calc: (x) => { const rows = rowsOf(x.res, 'q07'); return rows && sum(regionFilter(rows, x.regions).filter((r) => r.kind === 'badge'), 'completions'); } },
    { id: 'referrals', section: 'mecaniques', label: 'Parrainages réussis', fmt: 'int', scope: 'campaign',
      note: 'Seuls les parrainages convertis sont enregistrés ; les invitations envoyées ne le sont pas.',
      calc: (x) => { const rows = rowsOf(x.res, 'q08'); return rows && sum(regionFilter(rows, x.regions), 'successful_referrals'); } },
    { id: 'referrers', section: 'mecaniques', label: 'Parrains', fmt: 'int', scope: 'campaign', kpiRef: 'referrals', extra: true,
      calc: (x) => { const rows = rowsOf(x.res, 'q08'); return rows && sum(regionFilter(rows, x.regions), 'referrers'); } },
    { id: 'partner_ad_impressions', section: 'mecaniques', label: 'Impressions publicitaires', fmt: 'int', scope: 'campaign',
      calc: (x) => { const rows = rowsOf(x.res, 'q09'); return rows && sum(regionFilter(rows, x.regions), 'impressions'); } },
    { id: 'ad_completed_views', section: 'mecaniques', label: 'Vues complètes des pubs', fmt: 'int', scope: 'campaign', kpiRef: 'partner_ad_impressions', extra: true,
      calc: (x) => { const rows = rowsOf(x.res, 'q09'); return rows && sum(regionFilter(rows, x.regions), 'completed_views'); } },

    { id: 'store_traffic', section: 'commercial', label: 'Trafic en magasin', fmt: 'int', scope: 'period', missing: true,
      note: 'Nécessite les données des points de vente (POS), absentes du MCP.', calc: () => null },
    { id: 'coupon_traffic_contribution', section: 'commercial', label: 'Coupons activés en magasin', fmt: 'int', scope: 'period',
      note: 'Numérateur de la contribution des coupons au trafic. Le dénominateur (trafic total) attend les données POS.',
      calc: (x) => { const rows = daily(x.res, 'q11', x.rg, x.regions, { allowUnassigned: x.allRegions, redeem: true }); return rows && sum(rows, 'coupon_activations'); } },
    { id: 'lift_revenue', section: 'commercial', label: 'Revenus via LIFT', fmt: 'money', scope: 'period',
      note: 'Achats rattachés au jeu par le numéro de téléphone saisi à la caisse, pas le revenu LIFT total.',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && sum(rows, 'lift_revenue'); } },
    { id: 'lift_transactions', section: 'commercial', label: 'Transactions LIFT', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && sum(rows, 'lift_transactions'); } },
    { id: 'avg_spend_per_transaction', section: 'commercial', label: 'Dépense moyenne', fmt: 'money2', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && ratio(sum(rows, 'lift_revenue'), sum(rows, 'lift_transactions')); } },
    { id: 'items_per_basket', section: 'commercial', label: 'Articles par panier', fmt: 'dec1', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && ratio(sum(rows, 'items'), sum(rows, 'lift_transactions')); } },
  ];
  const KPI = Object.fromEntries(KPIS.map((k) => [k.id, k]));
  const OVERVIEW_HERO = ['unique_players', 'games_played', 'instant_prizes_redeemed', 'paid_app_installs'];
  const OVERVIEW_MORE = ['signups', 'repeat_visit_rate', 'distribution_pacing', 'lift_revenue'];

  function paceStatus(v) {
    if (v == null) return null;
    if (v < 0.9) return { cls: 'under', label: 'Sous le plan' };
    if (v > 1.1) return { cls: 'over', label: 'Au-dessus du plan' };
    return { cls: 'ok', label: 'Dans le plan' };
  }
  function sourceStatus(k) {
    if (k.missing) return 'missing';
    return KPI_DEF[k.kpiRef || k.id]?.status || 'available';
  }

  function computeKpi(k, res, camp, rg, regions) {
    if (!res || !camp || !rg) return null;
    if (k.scope === 'period' && !k.allowBeforeStart && !overlapsCampaign(rg, camp)) return null;
    try {
      const v = k.calc({ res, camp, rg, regions, allRegions: regions.length === REGION_ORDER.length });
      return Number.isFinite(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  // Comparison for the current selection: { camp, res, rg, label } or { na }.
  function comparisonFor(k, camp, rg) {
    if (state.compare === 'prev') {
      if (k.scope !== 'period') return { na: 'total' };
      const len = diffDays(rg.d0, rg.d1) + 1;
      const prev = classify(camp, addDays(rg.d0, -len), addDays(rg.d0, -1));
      if (rg.kind === 'week') { prev.kind = 'week'; prev.week = addDays(rg.week, -7); }
      if (rg.kind === 'all') prev.kind = 'before';
      prev.redeemD1 = prev.d1;
      // A previous window that starts before launch would compare against a partial period.
      if (!k.allowBeforeStart && prev.d0 < camp.start) return { na: 'none' };
      const label = rg.kind === 'week' ? 'vs semaine préc.' : rg.kind === 'all' ? `vs ${len} j avant le lancement` : `vs ${len} j précédents`;
      return { camp, res: state.results[camp.code], rg: prev, label };
    }
    const fy = comparisonCampaign(camp);
    if (!fy) return { na: 'nofy' };
    const res = state.results[fy.code];
    if (!res) return { na: 'fynodata', name: fy.name };
    if (k.scope !== 'period') return { camp: fy, res, rg: { kind: 'all', d0: fy.start, d1: fy.end, redeemD1: fy.redemptionEnd }, label: `vs ${fy.name}` };
    const o0 = diffDays(camp.start, rg.d0);
    const o1 = diffDays(camp.start, rg.d1);
    const frg = classify(fy, addDays(fy.start, o0), addDays(fy.start, Math.min(o1, diffDays(fy.start, fy.end))));
    frg.redeemD1 = rg.kind === 'all' ? fy.redemptionEnd : frg.d1;
    return { camp: fy, res, rg: frg, label: `vs ${fy.name}` };
  }

  function kpiValue(k) {
    const camp = currentCampaign();
    const rg = currentRange();
    const regions = activeRegions();
    const res = state.results[camp?.code];
    const value = computeKpi(k, res, camp, rg, regions);
    const cmpInfo = camp && rg ? comparisonFor(k, camp, rg) : { na: 'none' };
    const cmp = cmpInfo.na ? null : computeKpi(k, cmpInfo.res, cmpInfo.camp, cmpInfo.rg, regions);
    return { k, value, cmp, cmpInfo, loaded: !!res, rg };
  }

  // ---------------------------------------------------------------------------
  // DOM helpers
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Tooltip for [data-tip]
  const tip = $('tip');
  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = Math.min(300, window.innerWidth - 24);
    const left = Math.min(Math.max(12, r.left - 8), window.innerWidth - tw - 12);
    let top = r.bottom + 8;
    if (top + tip.offsetHeight + 8 > window.innerHeight) top = r.top - tip.offsetHeight - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('mouseover', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('[data-tip]')) hideTip(); });
  document.addEventListener('focusin', (e) => { const t = e.target.closest?.('[data-tip]'); if (t) showTip(t); });
  document.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, { passive: true });

  // ---------------------------------------------------------------------------
  // Filters and tabs
  // ---------------------------------------------------------------------------
  function renderFilters() {
    const camp = currentCampaign();
    $('f-campaign').replaceChildren(...state.campaigns.map((c) => el('option', { value: c.code, selected: c.code === state.campaign, disabled: !isReady(c) },
      isReady(c) ? `${c.name}${c.status === 'live' ? ' · en cours' : ''}` : `${c.name} (à configurer)`)));
    const periods = periodOptions(camp);
    if (!periods.find((p) => p.id === state.period)) state.period = 'all';
    $('f-period').replaceChildren(...periods.map((p) => el('option', { value: p.id, selected: p.id === state.period }, p.label)));
    $('f-region').replaceChildren(...REGION_OPTIONS.map((o) => el('option', { value: o.id, selected: o.id === state.region }, o.label)));
    $('f-banner').value = state.banner;
    $('f-compare').value = state.compare;
    const custom = state.period === 'custom';
    $('custom-range').hidden = !custom;
    if (isReady(camp)) {
      for (const id of ['f-from', 'f-to']) { $(id).min = camp.start; $(id).max = camp.end; }
      const rg = currentRange();
      $('f-from').value = rg.d0;
      $('f-to').value = rg.d1;
      const days = diffDays(rg.d0, rg.d1) + 1;
      $('range-note').textContent = rg.kind === 'all'
        ? `${fmtDay(camp.start)} – ${fmtDay(camp.end)} · ${days} jours${camp.redemptionEnd && camp.redemptionEnd > camp.end ? ` · échanges jusqu'au ${fmtDay(camp.redemptionEnd)}` : ''}`
        : `${fmtDay(rg.d0)} – ${fmtDay(rg.d1)} · ${days} jour${days > 1 ? 's' : ''}`;
    } else $('range-note').textContent = '';
  }
  $('f-campaign').addEventListener('change', (e) => { state.campaign = e.target.value; state.period = 'all'; state.custom = null; saveFilters(); onCampaignChange(); });
  $('f-period').addEventListener('change', (e) => {
    state.period = e.target.value;
    if (state.period === 'custom' && !state.custom) { const rg = currentRange(); state.custom = { d0: rg.d0, d1: rg.d1 }; }
    saveFilters(); renderFilters(); renderAll();
  });
  for (const id of ['f-from', 'f-to']) {
    $(id).addEventListener('change', () => {
      let d0 = $('f-from').value; let d1 = $('f-to').value;
      if (!d0 || !d1) return;
      if (d1 < d0) [d0, d1] = [d1, d0];
      state.custom = { d0, d1 };
      saveFilters(); renderFilters(); renderAll();
    });
  }
  for (const [id, key] of [['f-region', 'region'], ['f-banner', 'banner'], ['f-compare', 'compare']]) {
    $(id).addEventListener('change', (e) => { state[key] = e.target.value; saveFilters(); renderFilters(); renderAll(); });
  }
  $('filters').addEventListener('submit', (e) => e.preventDefault());

  function selectTab(tab, focus) {
    if (!TABS.includes(tab)) tab = 'overview';
    state.tab = tab;
    for (const t of TABS) {
      $(`tab-${t}`).setAttribute('aria-selected', String(t === tab));
      $(`tab-${t}`).tabIndex = t === tab ? 0 : -1;
      $(`panel-${t}`).hidden = t !== tab;
    }
    if (focus) $(`tab-${tab}`).focus();
    try { history.replaceState(null, '', `#${tab}`); } catch (e) { /* sandboxed */ }
    saveFilters();
    renderCharts();
  }
  $('tabs').addEventListener('click', (e) => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.id.slice(4)); });
  $('tabs').addEventListener('keydown', (e) => {
    const i = TABS.indexOf(state.tab);
    if (e.key === 'ArrowRight') selectTab(TABS[(i + 1) % TABS.length], true);
    else if (e.key === 'ArrowLeft') selectTab(TABS[(i - 1 + TABS.length) % TABS.length], true);
  });

  // Per-viewer convenience only.
  function saveFilters() {
    try { localStorage.setItem('report-filters-v2', JSON.stringify({ campaign: state.campaign, period: state.period, custom: state.custom, compare: state.compare, region: state.region, banner: state.banner, tab: state.tab })); } catch (e) { /* storage unavailable */ }
  }
  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem('report-filters-v2') || 'null');
      if (f) {
        if (state.campaigns.find((c) => c.code === f.campaign && isReady(c))) state.campaign = f.campaign;
        Object.assign(state, { period: f.period || 'all', custom: f.custom || null, compare: f.compare || 'prev', region: f.region || 'all', banner: f.banner || 'all', tab: f.tab || 'overview' });
      }
    } catch (e) { /* storage unavailable */ }
    const hash = (location.hash || '').slice(1);
    if (TABS.includes(hash)) state.tab = hash;
    if (hash === 'bilan') wrap.autoOpen = true;
  }

  // ---------------------------------------------------------------------------
  // KPI cards. One anatomy for every card: label (2 lines reserved) -> value ->
  // one context line. The context line shows the comparison when it exists,
  // otherwise a factual ratio computed from the loaded data (never typed in).
  // ---------------------------------------------------------------------------
  const KPI_GROUPS = {
    audience: [
      { title: 'Acquisition', ids: ['paid_app_installs', 'signups', 'new_players'], note: "Téléchargements : toutes provenances, pas encore attribués au média payant. Non ventilés par BU." },
      { title: 'Activité', ids: ['unique_players', 'dau', 'wau'] },
      { title: 'Fidélité', ids: ['sessions_per_user', 'repeat_visit_rate', 'games_played'], note: "Jours actifs par joueur remplace « sessions par utilisateur » : le jeu n'enregistre pas de sessions d'app." },
    ],
    prix: [
      { title: 'Distribution', ids: ['instant_prizes_won', 'instant_prizes_redeemed', 'redemption_rate'] },
      { title: 'Stock et grand prix', ids: ['prizes_remaining', 'distribution_pacing', 'grand_prize_entries'] },
    ],
    mecaniques: [
      { title: 'Actions et défis', ids: ['bonus_challenge_completions', 'badges_earned'] },
      { title: 'Parrainage', ids: ['referrals', 'referrers'], note: 'Seuls les parrainages réussis sont enregistrés ; les invitations envoyées ne le sont pas.' },
      { title: 'Publicité', ids: ['partner_ad_impressions', 'ad_completed_views'] },
    ],
    commercial: [
      { title: 'Magasin', ids: ['store_traffic', 'coupon_traffic_contribution'], note: 'Coupons activés : numérateur de la contribution au trafic. Le trafic total attend les données des points de vente (POS).' },
      { title: 'Ventes LIFT', ids: ['lift_revenue', 'lift_transactions', 'avg_spend_per_transaction', 'items_per_basket'], note: 'LIFT : achats rattachés au jeu par le numéro saisi à la caisse, pas le revenu LIFT total.' },
    ],
  };

  // Context lines: factual ratios from the snapshot. Return null when not meaningful for the range.
  const q = (x, id) => (x.res?.[id] ? regionFilter(x.res[id].rows, x.regions, false) : null);
  const daysIn = (rg, redeem) => diffDays(rg.d0, redeem ? rg.redeemD1 : rg.d1) + 1;
  function topOf(rows, key, val) {
    const by = new Map();
    for (const r of rows) by.set(r[key], (by.get(r[key]) || 0) + (r[val] || 0));
    return [...by.entries()].sort((a, b) => b[1] - a[1])[0] || null;
  }
  const CTX = {
    paid_app_installs: (x) => { const rows = daily(x.res, 'q12', x.rg, x.regions, { noRegion: true }); if (!rows) return null;
      const ios = sum(rows, (r) => (state.banner !== 'Circle K' ? r.couche_tard_ios : 0) + (state.banner !== 'Couche-Tard' ? r.circle_k_ios : 0));
      const web = sum(rows, (r) => (state.banner !== 'Circle K' ? r.couche_tard_ios_web_referrer : 0) + (state.banner !== 'Couche-Tard' ? r.circle_k_ios_web_referrer : 0));
      return ios ? [b(FMT.pct0(web / ios)), ' des installations iOS via un lien web'] : null; },
    signups: (x) => {
      const f = x.rg.kind === 'all' && q(x, 'q13');
      if (f) return [b(FMT.pct0(sum(f, 'played') / sum(f, 'signed_up'))), ' ont joué au moins une partie'];
      return x.value ? [b(FMT.int(x.value / daysIn(x.rg))), ' par jour en moyenne'] : null;
    },
    new_players: (x) => { const r = q(x, 'q02'); return r ? [b(FMT.pct0(sum(r, 'new_to_ck_games') / sum(r, 'unique_players'))), ' des joueurs uniques'] : null; },
    unique_players: (x) => { const d = daily(x.res, 'q01', x.rg, x.regions); return d && x.value ? [b(FMT.dec1(sum(d, 'games_played') / x.value)), ' parties par joueur'] : null; },
    dau: (x) => { const d = daily(x.res, 'q01', x.rg, x.regions); if (!d || !d.length) return null; const t = topOf(d, 'day', 'active_players'); return t ? ['pic : ', b(FMT.int(t[1])), ` le ${fmtDay(t[0])}`] : null; },
    wau: (x) => { if (x.rg.kind !== 'all') return null; const r = q(x, 'q02'); return r && x.value ? [b(FMT.pct0(x.value / sum(r, 'unique_players'))), ' des joueurs uniques chaque semaine'] : null; },
    sessions_per_user: (x) => ['sur ', b(FMT.int(daysIn(x.rg))), ' jours de jeu possibles'],
    repeat_visit_rate: (x) => { const r = q(x, 'q02'); return r ? [b(FMT.int(sum(r, 'repeat_players'))), ' joueurs revenus'] : null; },
    games_played: (x) => (x.value ? [b(FMT.int(x.value / daysIn(x.rg))), ' parties par jour en moyenne'] : null),
    instant_prizes_won: (x) => { const f = x.rg.kind === 'all' && q(x, 'q13'); return f ? [b(FMT.pct0(sum(f, 'won_prize') / sum(f, 'played'))), ' des joueurs ont gagné un prix'] : null; },
    instant_prizes_redeemed: (x) => { const w = daily(x.res, 'q05', x.rg, x.regions, { redeem: true }); const tw = w && sum(w, 'won'); return tw && x.value != null ? [b(FMT.pct0(x.value / tw)), ' des prix gagnés'] : null; },
    redemption_rate: (x) => { const f = q(x, 'q13'); return f ? [b(FMT.int(sum(f, 'redeemed_prize'))), ' joueurs ont échangé un prix'] : null; },
    prizes_remaining: (x) => { const r = q(x, 'q04'); return r && x.value != null ? [b(FMT.pct0(x.value / sum(r, 'inventory'))), " de l'inventaire, à ce jour"] : null; },
    distribution_pacing: (x) => { const r = q(x, 'q04'); if (!r) return null;
      const by = new Map(); for (const p of r) { const o = by.get(p.partner) || { n: 0, p: 0 }; o.n += p.net_awarded || 0; o.p += p.planned_to_date || 0; by.set(p.partner, o); }
      const under = [...by.values()].filter((o) => o.p && o.n / o.p < 0.9).length; return [b(`${under} sur ${by.size}`), ' partenaires sous le plan']; },
    grand_prize_entries: (x) => { const u = x.rg.kind === 'all' && q(x, 'q02'); return u && x.value ? [b(FMT.int(x.value / sum(u, 'unique_players'))), ' par joueur en moyenne'] : null; },
    bonus_challenge_completions: (x) => { const r = q(x, 'q07'); if (!r) return null; const t = topOf(r.filter((y) => y.kind === 'bonus_action'), 'title_fr', 'players'); return t ? ['la plus populaire : ', b(t[0])] : null; },
    badges_earned: (x) => { const r = q(x, 'q07'); if (!r) return null; const t = topOf(r.filter((y) => y.kind === 'badge'), 'title_fr', 'players'); return t ? ['le plus réussi : ', b(t[0])] : null; },
    referrals: (x) => { const r = q(x, 'q08'); return r ? ['par ', b(FMT.int(sum(r, 'referrers'))), ' parrains'] : null; },
    referrers: (x) => { const r = q(x, 'q08'); return r && x.value ? [b(FMT.dec1(sum(r, 'successful_referrals') / x.value)), ' parrainage(s) réussi(s) chacun'] : null; },
    partner_ad_impressions: (x) => { const r = q(x, 'q09'); return r ? [b(String(new Set(r.map((y) => y.partner)).size)), ' partenaires annonceurs'] : null; },
    ad_completed_views: (x) => { const r = q(x, 'q09'); return r && x.value != null ? [b(FMT.pct(x.value / sum(r, 'impressions'))), ' des impressions vues en entier'] : null; },
    coupon_traffic_contribution: (x) => (x.value ? [b(FMT.int(x.value / daysIn(x.rg, true))), ' par jour en moyenne'] : null),
    lift_revenue: (x) => { const d = daily(x.res, 'q10', x.rg, x.regions); return d ? ['sur ', b(FMT.int(sum(d, 'lift_transactions'))), ' transactions'] : null; },
    lift_transactions: (x) => (x.value ? [b(FMT.dec1(x.value / daysIn(x.rg))), ' par jour en moyenne'] : null),
    avg_spend_per_transaction: (x) => { const d = daily(x.res, 'q10', x.rg, x.regions); return d ? ['sur ', b(FMT.money(sum(d, 'lift_revenue'))), ' de ventes'] : null; },
    items_per_basket: (x) => { const d = daily(x.res, 'q10', x.rg, x.regions); const t = d && sum(d, 'lift_transactions'); return t ? ['dont ', b(FMT.dec1(sum(d, 'eligible_items') / t)), ' article(s) admissible(s)'] : null; },
  };
  function b(text) { return el('b', {}, text); }

  function deltaText(k, cur, cmp) {
    if (cur == null || cmp == null) return null;
    if (k.delta === 'pts') {
      const d = (cur - cmp) * 100;
      const cls = Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down';
      return el('span', { class: `delta ${cls}` }, `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf1.format(Math.abs(d))} pts`);
    }
    if (!cmp) return null;
    const d = (cur - cmp) / Math.abs(cmp);
    const cls = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down';
    const txt = d >= 1 ? `×${nf1.format(cur / cmp)}` : `${d > 0 ? '+' : d < 0 ? '−' : ''}${nf1.format(Math.abs(d) * 100)} %`;
    return el('span', { class: `delta ${cls}` }, txt);
  }
  function contextLine(v) {
    const { k, value, cmp, cmpInfo, rg } = v;
    if (k.missing) return [el('span', {}, 'Source : points de vente (POS)')];
    if (value == null && k.exact && rg && rg.kind === 'custom') return [el('span', {}, NEEDS_EXACT)];
    if (value == null) return [];
    const d = deltaText(k, value, cmp);
    const out = [];
    if (d) out.push(d, el('span', {}, ` ${cmpInfo.label}`));
    else {
      const camp = currentCampaign();
      let c = null;
      try { c = CTX[k.id]?.({ res: state.results[camp?.code], camp, rg, regions: activeRegions(), value }); } catch (e) { c = null; }
      if (c) out.push(el('span', {}, c));
    }
    if (k.scope === 'campaign' && rg && rg.kind !== 'all') out.push(el('span', { class: 'scope' }, ' · total de campagne'));
    if (k.noRegion && !allRegionsSelected()) out.push(el('span', { class: 'scope' }, ' · toutes BU'));
    return out;
  }
  function labelNode(k) {
    const status = sourceStatus(k);
    const def = KPI_DEF[k.kpiRef || k.id];
    const tipText = [k.note || def?.definition_fr, def?.source_fr ? `Source : ${def.source_fr}` : null].filter(Boolean).join(' ');
    // Icons sit inline right after the text, so they never drift to the far edge.
    // The last word stays glued to the icons so an icon never wraps onto a line by itself.
    const cut = k.label.lastIndexOf(' ');
    return el('div', { class: 'k-label' },
      cut > 0 ? k.label.slice(0, cut + 1) : '',
      el('span', { class: 'nobr' }, k.label.slice(cut + 1),
      status === 'partial' ? el('span', { class: 'qdot', tabindex: 0, 'data-tip': `Donnée partielle. ${k.note || def?.source_fr || ''}`.trim(), 'aria-label': 'Donnée partielle' }) : null,
      tipText ? el('span', { class: 'info', tabindex: 0, 'data-tip': tipText, 'aria-label': `À propos : ${k.label}` }, 'i') : null));
  }
  function valueText(v) {
    const { k, value, loaded } = v;
    if (value != null) return FMT[k.fmt](value);
    if (k.missing) return 'À brancher';
    if (!loaded) return state.busy ? '…' : '—';
    return '—';
  }
  function kpiCell(id, hero) {
    const v = kpiValue(KPI[id]);
    const st = v.k.state ? v.k.state(v.value) : null;
    const cell = el('div', { class: `k${v.k.missing ? ' missing' : ''}` },
      labelNode(v.k),
      el('div', { class: 'k-main' },
        el('span', { class: `k-value${v.value == null ? ' na' : ''}` }, valueText(v)),
        st ? el('span', { class: `state ${st.cls}` }, st.label) : null),
      el('div', { class: 'k-sub' }, contextLine(v)));
    if (hero && v.k.spark) cell.append(sparkline(v.k));
    return cell;
  }
  function groupBlock(g) {
    const partial = g.ids.some((id) => sourceStatus(KPI[id]) === 'partial');
    return el('div', { class: 'kgroup' },
      el('div', { class: 'kgroup-head' }, el('h3', {}, g.title)),
      el('div', { class: 'kgrid', style: `--n:${g.ids.length}` }, g.ids.map((id) => kpiCell(id))),
      g.note ? el('p', { class: 'kgroup-note' }, partial ? el('span', { class: 'qdot', 'aria-hidden': 'true' }) : null, g.note) : null);
  }
  function renderKpis() {
    $('hero').replaceChildren(...OVERVIEW_HERO.map((id) => kpiCell(id, true)));
    $('kpis-overview').replaceChildren(el('div', { class: 'kgrid', style: `--n:${OVERVIEW_MORE.length}` }, OVERVIEW_MORE.map((id) => kpiCell(id))));
    for (const sec of ['audience', 'prix', 'mecaniques', 'commercial']) {
      $(`kpis-${sec}`).replaceChildren(...KPI_GROUPS[sec].map(groupBlock));
    }
  }

  // Inline SVG sparkline of the KPI's daily series over the selected range, with the last value marked.
  function sparkline(k) {
    const camp = currentCampaign();
    const rg = currentRange();
    const res = state.results[camp?.code];
    const wrap = el('div', { class: 'spark-wrap' });
    const box = svgEl('svg', { class: 'spark', viewBox: '0 0 200 36', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    wrap.append(box);
    if (!res || !rg) return wrap;
    const s = k.spark();
    const rows = daily(res, s.qid, rg, activeRegions(), { noRegion: s.noRegion, allowUnassigned: allRegionsSelected(), redeem: s.redeem });
    if (!rows || !rows.length) return wrap;
    const days = eachDay(rg.d0, s.redeem ? rg.redeemD1 : rg.d1);
    const vals = days.map((d) => sum(rows.filter((r) => r.day === d), s.f));
    if (vals.length < 2) return wrap;
    const max = Math.max(...vals) || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * 196 + 2, 33 - (v / max) * 29]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    const color = cssVar('--data');
    box.append(svgEl('path', { d: `${line}L198,35L2,35Z`, fill: color, opacity: '0.10' }));
    box.append(svgEl('path', { d: line, fill: 'none', stroke: color, 'stroke-width': '1.5', 'vector-effect': 'non-scaling-stroke' }));
    // HTML dot (not SVG) so it stays round whatever the card width.
    const last = pts[pts.length - 1];
    wrap.append(el('span', { class: 'spark-dot', style: `left:${(last[0] / 200) * 100}%;top:${(last[1] / 36) * 100}%`, title: `${fmtDay(days[days.length - 1])} : ${FMT.int(vals[vals.length - 1])}` }));
    return wrap;
  }

  // ---------------------------------------------------------------------------
  // Cards, bar lists and charts
  // ---------------------------------------------------------------------------
  const charts = {};
  const hasEcharts = () => typeof window.echarts !== 'undefined';
  function theme() {
    return {
      ink: cssVar('--ink'), ink2: cssVar('--ink-2'), muted: cssVar('--muted'), line: cssVar('--line'),
      line2: cssVar('--line-2'), surface: cssVar('--surface'), data: cssVar('--data'), soft: cssVar('--data-soft'),
      ghost: cssVar('--data-ghost'), font: cssVar('--font') || 'system-ui',
      region: (r) => cssVar(REGION_VAR[r]),
    };
  }
  function baseOption(t) {
    return {
      animationDuration: 300,
      textStyle: { fontFamily: t.font, color: t.ink2 },
      grid: { left: 4, right: 24, top: 10, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true,
        backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, padding: [8, 10],
        textStyle: { color: t.ink, fontSize: 12, fontFamily: t.font },
        axisPointer: { type: 'line', lineStyle: { color: t.line2, width: 1 } },
        extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,.12); border-radius: 8px;',
      },
    };
  }
  const catAxis = (t, data, extra = {}) => ({
    type: 'category', data, boundaryGap: extra.boundaryGap ?? true,
    axisLine: { lineStyle: { color: t.line2 } }, axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true, margin: 10 },
  });
  const valAxis = (t, fmt = (v) => compact.format(v)) => ({
    type: 'value', splitNumber: 3, splitLine: { lineStyle: { color: t.line, type: [3, 3] } },
    axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: fmt },
  });
  function tooltipRows(params, fmt = FMT.int) {
    const list = (Array.isArray(params) ? params : [params]).filter((p) => p.value != null);
    const head = list[0]?.axisValueLabel || list[0]?.name || '';
    const rows = list.map((p) => `<div style="display:flex;justify-content:space-between;gap:18px"><span>${p.marker}${escapeHtml(p.seriesName)}</span><b style="font-variant-numeric:tabular-nums">${fmt(p.value)}</b></div>`).join('');
    return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${rows}`;
  }

  // A card: title, optional note, tools (segmented control, table toggle), body.
  function card(hostId, { title, note, legend, tools, body, table }) {
    const host = $(hostId);
    const tableOpen = state.openTables.has(hostId);
    const toolNodes = [...(tools || [])];
    if (table) {
      toolNodes.push(el('button', { type: 'button', class: 'link', 'aria-expanded': String(tableOpen), onclick: () => {
        if (state.openTables.has(hostId)) state.openTables.delete(hostId); else state.openTables.add(hostId);
        renderCharts();
      } }, tableOpen ? 'Masquer le tableau' : 'Tableau'));
    }
    host.replaceChildren(...[
      el('div', { class: 'c-head' },
        el('div', {}, el('h3', {}, title), note ? el('p', { class: 'c-note' }, note) : null),
        toolNodes.length ? el('div', { class: 'c-tools' }, toolNodes) : null),
      legend?.length ? el('div', { class: 'legend' }, legend.map((l) => el('span', {}, el('i', { class: l.dash ? 'dash' : null, style: `background:${l.color}` }), l.label))) : null,
      body,
      table && tableOpen ? el('div', { class: 'data-view table-wrap' }, dataTable(table.cols, table.rows)) : null,
    ].filter(Boolean));
  }
  function emptyBody(what) {
    const camp = currentCampaign();
    if (state.busy) return el('div', { class: 'empty' }, el('div', {}, el('strong', {}, 'Chargement…'), `${what} arrive avec l'actualisation en cours.`));
    if (!isReady(camp)) return el('div', { class: 'empty' }, el('div', {}, el('strong', {}, 'Campagne à configurer'), 'Ajoutez ses dates pour voir les données.'));
    return el('div', { class: 'empty' }, el('div', {}, el('strong', {}, 'Pas encore de données'), caps.mcp ? 'Cliquez sur Actualiser pour charger la campagne.' : "Les données s'afficheront dès qu'un éditeur aura actualisé le rapport."));
  }
  function dataTable(cols, rows) {
    return el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { class: c.num ? 'num' : null }, c.label)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => {
        const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        return el('td', { class: c.num ? 'num' : null }, v instanceof Node ? v : (v == null ? '—' : c.fmt ? c.fmt(v) : v));
      })))));
  }
  function chartBody(id, height) {
    return el('div', { class: 'chart', id, role: 'img', 'aria-label': 'Graphique', style: height ? `height:${height}px` : null });
  }
  function disposeChart(id) { if (charts[id]) { charts[id].dispose(); delete charts[id]; } }
  function drawChart(id, option) {
    const node = $(id);
    if (!node) return;
    if (!hasEcharts()) {
      node.replaceChildren(el('div', { class: 'empty' }, el('div', {}, el('strong', {}, 'Graphique indisponible'), "La librairie de graphiques n'a pas pu être chargée. Ouvrez le tableau pour voir les données.")));
      return;
    }
    disposeChart(id);
    const chart = window.echarts.init(node, null, { renderer: 'svg' });
    chart.setOption(option);
    charts[id] = chart;
    resizeObserver.observe(node);
  }
  const resizeObserver = new ResizeObserver((entries) => { for (const e of entries) charts[e.target.id]?.resize(); });

  // Ranked rows with an inline bar. items: { name, value, max, label, sub, color, tick }
  function barList(items, opts = {}) {
    const rows = items.map((it) => el('div', { class: 'brow' },
      el('div', { class: 'bname', title: it.name }, it.color ? el('i', { style: `background:${it.color}` }) : null, it.name),
      el('div', { class: 'btrack' },
        el('div', { class: 'bfill', style: `width:${Math.max(0, Math.min(100, (it.value / (it.max || 1)) * 100)).toFixed(1)}%;${it.fill ? `background:${it.fill}` : ''}` }),
        it.tick != null ? el('div', { class: 'btick', style: `left:calc(${(it.tick * 100).toFixed(1)}% - 1px)` }) : null),
      el('div', { class: 'bval' }, it.label, it.sub ? el('small', {}, it.sub) : null),
      ...(it.extra || [])));
    const head = opts.head ? el('div', { class: 'brow head' }, opts.head.map((h) => el('div', {}, h))) : null;
    return el('div', { class: `blist${opts.cls ? ` ${opts.cls}` : ''}` }, head, rows);
  }

  // Daily series for the selected range, summed over the selected BUs.
  function series(res, qid, rg, f, opts = {}) {
    const rows = daily(res, qid, rg, opts.regions || activeRegions(), opts);
    if (!rows) return null;
    const days = eachDay(rg.d0, opts.redeem ? rg.redeemD1 : rg.d1);
    const by = new Map();
    for (const r of rows) by.set(r.day, (by.get(r.day) || 0) + (Number(typeof f === 'function' ? f(r) : r[f]) || 0));
    return { days, values: days.map((d) => (by.has(d) ? by.get(d) : null)) };
  }
  // Comparison series aligned by position (day 1 vs day 1).
  function compareSeries(qid, f, opts = {}) {
    const camp = currentCampaign();
    const rg = currentRange();
    const info = comparisonFor({ scope: 'period', allowBeforeStart: opts.allowBeforeStart }, camp, rg);
    if (info.na || !info.res) return null;
    const s = series(info.res, qid, info.rg, f, opts);
    if (!s || s.values.every((v) => v == null)) return null;
    return { ...s, label: info.label.replace(/^vs /, '') };
  }
  const lineSeries = (name, data, color, extra = {}) => ({
    name, type: 'line', data, symbol: 'none', smooth: 0.15, connectNulls: false,
    lineStyle: { width: 2, color }, itemStyle: { color }, emphasis: { focus: 'series' }, ...extra,
  });

  function renderCharts() {
    const t = theme();
    const camp = currentCampaign();
    const res = state.results[camp?.code] || {};
    const regions = activeRegions();
    const rg = currentRange();
    const tab = state.tab;
    for (const id of Object.keys(charts)) if (!$(id) || $(id).closest('[hidden]')) disposeChart(id);

    if (tab === 'overview') {
      // Trend: active players per day, with the comparison period dashed.
      {
        const s = rg && res.q01 ? series(res, 'q01', rg, 'active_players') : null;
        const c = s ? compareSeries('q01', 'active_players') : null;
        const legend = s ? [{ label: 'Joueurs actifs', color: t.data }, ...(c ? [{ label: c.label, color: t.ghost, dash: true }] : [])] : null;
        card('card-trend', {
          title: 'Joueurs actifs par jour', note: rg ? rg.label : null, legend,
          body: s ? chartBody('ch-trend') : emptyBody('La tendance'),
          table: s && { cols: [{ label: 'Jour', key: 'day' }, { label: 'Joueurs actifs', key: 'v', num: true, fmt: FMT.int }], rows: s.days.map((d, i) => ({ day: d, v: s.values[i] })) },
        });
        if (s) {
          drawChart('ch-trend', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
            xAxis: catAxis(t, s.days.map(fmtDay), { boundaryGap: false }),
            yAxis: valAxis(t),
            series: [
              lineSeries('Joueurs actifs', s.values, t.data, { areaStyle: { color: t.data, opacity: 0.08 } }),
              ...(c ? [lineSeries(c.label, s.days.map((_, i) => c.values[i] ?? null), t.ghost, { lineStyle: { width: 1.5, color: t.ghost, type: [4, 4] } })] : []),
            ],
          });
        }
      }
      // BU split
      {
        const shown = REGION_ORDER.filter((r) => regions.includes(r));
        let items = null;
        let note = '';
        if (rg && (rg.kind === 'all' ? res.q02 : rg.kind === 'week' ? res.q03 : res.q01)) {
          const val = (r) => {
            if (rg.kind === 'all') return sum(res.q02.rows.filter((x) => x.region_code === r), 'unique_players');
            if (rg.kind === 'week') return sum(res.q03.rows.filter((x) => x.region_code === r && x.week_start === rg.week), 'wau');
            return sum(daily(res, 'q01', rg, [r]), 'active_players');
          };
          note = rg.kind === 'custom' ? 'Jours-joueurs sur la période' : 'Joueurs uniques';
          const vals = shown.map((r) => ({ r, v: val(r) }));
          const total = vals.reduce((a, x) => a + x.v, 0) || 1;
          const max = Math.max(...vals.map((x) => x.v), 1);
          items = vals.sort((a, b) => b.v - a.v).map((x) => ({ name: `${x.r} · ${REGION_LABEL[x.r]}`, value: x.v, max, color: t.region(x.r), fill: t.region(x.r), label: FMT.pct0(x.v / total), sub: FMT.short(x.v) }));
        }
        card('card-bu', { title: 'Répartition par BU', note, body: items ? barList(items, { cls: 'tight' }) : emptyBody('La répartition') });
      }
      renderFunnel(res, regions);
      renderAttention();
      return;
    }

    if (tab === 'audience') {
      {
        const shown = REGION_ORDER.filter((r) => regions.includes(r));
        const split = state.activeSplit && shown.length > 1;
        const s = rg && res.q01 ? series(res, 'q01', rg, 'active_players') : null;
        const c = s && !split ? compareSeries('q01', 'active_players') : null;
        const legend = !s ? null : split ? shown.map((r) => ({ label: `${r} · ${REGION_LABEL[r]}`, color: t.region(r) })) : [{ label: 'Joueurs actifs', color: t.data }, ...(c ? [{ label: c.label, color: t.ghost, dash: true }] : [])];
        const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Affichage' },
          el('button', { type: 'button', 'aria-pressed': String(!split), onclick: () => { state.activeSplit = false; renderCharts(); } }, 'Total'),
          el('button', { type: 'button', 'aria-pressed': String(split), onclick: () => { state.activeSplit = true; renderCharts(); } }, 'Par BU'));
        card('card-active', {
          title: 'Joueurs actifs par jour', note: rg?.label, legend, tools: s && shown.length > 1 ? [seg] : [],
          body: s ? chartBody('ch-active', 280) : emptyBody('La courbe'),
          table: s && { cols: [{ label: 'Jour', key: 'day' }, { label: 'BU', key: 'region_code' }, { label: 'Joueurs actifs', key: 'active_players', num: true, fmt: FMT.int }, { label: 'Parties', key: 'games_played', num: true, fmt: FMT.int }], rows: daily(res, 'q01', rg, regions) },
        });
        if (s) {
          const ser = split
            ? shown.map((r) => lineSeries(r, series(res, 'q01', rg, 'active_players', { regions: [r] }).values, t.region(r), { lineStyle: { width: 1.5, color: t.region(r) } }))
            : [lineSeries('Joueurs actifs', s.values, t.data, { areaStyle: { color: t.data, opacity: 0.08 } }),
              ...(c ? [lineSeries(c.label, s.days.map((_, i) => c.values[i] ?? null), t.ghost, { lineStyle: { width: 1.5, color: t.ghost, type: [4, 4] } })] : [])];
          drawChart('ch-active', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
            xAxis: catAxis(t, s.days.map(fmtDay), { boundaryGap: false }),
            yAxis: valAxis(t),
            series: ser,
          });
        }
      }
      {
        const s = rg && res.q01 ? series(res, 'q01', rg, 'signups') : null;
        card('card-signups', {
          title: 'Inscriptions par jour', note: rg?.label,
          body: s ? chartBody('ch-signups') : emptyBody('Le graphique'),
          table: s && { cols: [{ label: 'Jour', key: 'day' }, { label: 'Inscriptions', key: 'v', num: true, fmt: FMT.int }], rows: s.days.map((d, i) => ({ day: d, v: s.values[i] })) },
        });
        if (s) {
          drawChart('ch-signups', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.5 } }, formatter: (p) => tooltipRows(p) },
            xAxis: catAxis(t, s.days.map(fmtDay)),
            yAxis: valAxis(t),
            series: [{ name: 'Inscriptions', type: 'bar', data: s.values, barMaxWidth: 14, itemStyle: { color: t.data, borderRadius: [3, 3, 0, 0] } }],
          });
        }
      }
      {
        const rows = res.q12?.rows;
        const range = rg && rows ? (rg.kind === 'all' ? { d0: rows[0]?.day || rg.d0, d1: rg.d1 } : { d0: rg.d0, d1: rg.d1 }) : null;
        const scoped = range ? rows.filter((r) => r.day >= range.d0 && r.day <= range.d1) : null;
        const apps = [
          { name: 'App Couche-Tard', keys: ['couche_tard_ios', 'couche_tard_android'], color: t.data, show: state.banner !== 'Circle K' },
          { name: 'App Circle K', keys: ['circle_k_ios', 'circle_k_android'], color: t.region('CC'), show: state.banner !== 'Couche-Tard' },
        ].filter((a) => a.show);
        card('card-downloads', {
          title: "Téléchargements d'app par jour",
          note: rg?.kind === 'all' ? 'Zone grise : même durée avant le lancement · toutes BU' : 'Toutes BU',
          legend: scoped ? apps.map((a) => ({ label: a.name, color: a.color })) : null,
          body: scoped && scoped.length ? chartBody('ch-downloads') : emptyBody('Le graphique'),
          table: scoped && { cols: [{ label: 'Jour', key: 'day' }, ...apps.map((a) => ({ label: a.name, get: (r) => a.keys.reduce((s, k) => s + (r[k] || 0), 0), num: true, fmt: FMT.int })), { label: 'iOS via un lien web', get: (r) => (r.couche_tard_ios_web_referrer || 0) + (r.circle_k_ios_web_referrer || 0), num: true, fmt: FMT.int }], rows: scoped },
        });
        if (scoped && scoped.length) {
          const launch = scoped.find((r) => r.day >= camp.start)?.day;
          const pre = rg.kind === 'all' && launch && scoped[0].day < launch;
          drawChart('ch-downloads', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
            xAxis: catAxis(t, scoped.map((r) => fmtDay(r.day)), { boundaryGap: false }),
            yAxis: valAxis(t),
            series: apps.map((a, i) => lineSeries(a.name, scoped.map((r) => a.keys.reduce((s, k) => s + (r[k] || 0), 0)), a.color, {
              lineStyle: { width: 1.75, color: a.color },
              markArea: i === 0 && pre ? { silent: true, itemStyle: { color: t.ghost, opacity: 0.1 }, label: { show: true, position: 'insideTop', formatter: 'Avant le lancement', color: t.muted, fontSize: 11 }, data: [[{ xAxis: fmtDay(scoped[0].day) }, { xAxis: fmtDay(addDays(launch, -1)) }]] } : undefined,
            })),
          });
        }
      }
      renderRetention(res, regions, t);
      renderStreaks(res, regions);
      renderHeatmap(res, regions, t);
      return;
    }

    if (tab === 'prix') {
      {
        const won = rg && res.q05 ? series(res, 'q05', rg, 'won', { redeem: true }) : null;
        const red = rg && res.q11 ? series(res, 'q11', rg, 'coupon_activations', { redeem: true, allowUnassigned: allRegionsSelected() }) : null;
        const ok = won && red;
        card('card-prizes-daily', {
          title: 'Prix gagnés et échangés par jour', note: rg?.kind === 'all' ? "Inclut la période d'échange après la fin du jeu" : rg?.label,
          legend: ok ? [{ label: 'Gagnés', color: t.data }, { label: 'Échangés en magasin', color: t.region('QC') }] : null,
          body: ok ? chartBody('ch-prizes') : emptyBody('Le graphique'),
          table: ok && { cols: [{ label: 'Jour', key: 'day' }, { label: 'Gagnés', key: 'w', num: true, fmt: FMT.int }, { label: 'Échangés', key: 'r', num: true, fmt: FMT.int }], rows: won.days.map((d, i) => ({ day: d, w: won.values[i], r: red.values[i] })) },
        });
        if (ok) {
          drawChart('ch-prizes', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
            xAxis: catAxis(t, won.days.map(fmtDay), { boundaryGap: false }),
            yAxis: valAxis(t),
            series: [lineSeries('Gagnés', won.values, t.data), lineSeries('Échangés en magasin', red.values, t.region('QC'))],
          });
        }
      }
      {
        const rows = res.q04?.rows;
        let parts = [];
        if (rows) {
          const by = new Map();
          for (const r of regionFilter(rows, regions)) {
            const p = by.get(r.partner) || { partner: r.partner, inventory: 0, won: 0, released: 0, net: 0, remaining: 0, planned: 0, redeemed: 0 };
            p.inventory += r.inventory || 0; p.won += r.won || 0; p.released += r.released_to_stock || 0; p.net += r.net_awarded || 0;
            p.remaining += r.remaining || 0; p.planned += r.planned_to_date || 0; p.redeemed += r.redeemed || 0;
            by.set(r.partner, p);
          }
          parts = [...by.values()].map((p) => ({ ...p, pace: ratio(p.net, p.planned) })).sort((a, b) => (a.pace ?? 0) - (b.pace ?? 0));
        }
        const scaleMax = 1.25;
        const items = parts.map((p) => {
          const s = paceStatus(p.pace);
          return {
            name: p.partner, value: Math.min(p.pace ?? 0, scaleMax), max: scaleMax, tick: 1 / scaleMax,
            fill: s?.cls === 'over' ? cssVar('--critical') : s?.cls === 'under' ? cssVar('--warning') : cssVar('--good'),
            label: p.pace == null ? '—' : FMT.pct0(p.pace),
            extra: [el('div', {}, s ? el('span', { class: `state ${s.cls}` }, s.label) : '—')],
          };
        });
        card('card-pacing', {
          title: 'Rythme de distribution par partenaire',
          note: 'Prix distribués ÷ plan linéaire à date · trait = 100 % du plan',
          body: rows ? barList(items, { cls: 'pacing', head: ['Partenaire', 'Distribués vs plan', 'Rythme', 'Statut'] }) : emptyBody('Le rythme'),
          table: rows && {
            cols: [
              { label: 'Partenaire', key: 'partner' },
              { label: 'Inventaire', key: 'inventory', num: true, fmt: FMT.int },
              { label: 'Gagnés', key: 'won', num: true, fmt: FMT.int },
              { label: 'Remis en stock', key: 'released', num: true, fmt: FMT.int },
              { label: 'Distribués', key: 'net', num: true, fmt: FMT.int },
              { label: 'Échangés', key: 'redeemed', num: true, fmt: FMT.int },
              { label: 'Restants', key: 'remaining', num: true, fmt: FMT.int },
              { label: 'Rythme', key: 'pace', num: true, fmt: FMT.pct },
            ],
            rows: parts,
          },
        });
      }
      {
        const scoped = rg && res.q06 ? daily(res, 'q06', rg, regions) : null;
        const src = [['entries_gameplay', 'Parties jouées'], ['entries_badge', 'Défis'], ['entries_bonus', 'Actions bonus'], ['entries_referral', 'Parrainage'], ['entries_other', 'Autres']]
          .map(([k, label]) => ({ label, v: scoped ? sum(scoped, k) : 0 })).filter((s) => s.v > 0);
        const total = src.reduce((a, s) => a + s.v, 0) || 1;
        const max = Math.max(1, ...src.map((s) => s.v));
        card('card-entries', {
          title: 'Participations au grand prix par source', note: rg?.label,
          body: scoped ? barList(src.map((s) => ({ name: s.label, value: s.v, max, label: FMT.pct0(s.v / total), sub: FMT.short(s.v) }))) : emptyBody('La répartition'),
        });
      }
      renderGifts(res, regions);
      return;
    }

    if (tab === 'mecaniques') {
      for (const [hostId, kind, title] of [['card-bonus', 'bonus_action', 'Actions bonus'], ['card-badges', 'badge', 'Défis (badges)']]) {
        const rows = res.q07?.rows;
        let items = [];
        if (rows) {
          const by = new Map();
          for (const r of regionFilter(rows, regions).filter((x) => x.kind === kind)) {
            const p = by.get(r.key) || { key: r.key, title: r.title_fr || r.key, players: 0, eligible: 0, completions: 0 };
            p.players += r.players || 0; p.completions += r.completions || 0;
            p.eligible += r.eligible_players || (r.completion_rate ? r.players / r.completion_rate : 0);
            by.set(r.key, p);
          }
          items = [...by.values()].map((p) => ({ ...p, rate: ratio(p.players, p.eligible) })).sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
        }
        const max = Math.max(0.0001, ...items.map((i) => i.rate || 0));
        card(hostId, {
          title, note: 'Part des joueurs · toute la campagne',
          body: rows ? barList(items.map((i) => ({ name: i.title, value: i.rate || 0, max, label: FMT.pct(i.rate || 0), sub: FMT.short(i.players) }))) : emptyBody('La liste'),
          table: rows && { cols: [{ label: 'Action', key: 'title' }, { label: 'Joueurs', key: 'players', num: true, fmt: FMT.int }, { label: 'Complétions', key: 'completions', num: true, fmt: FMT.int }, { label: 'Taux', key: 'rate', num: true, fmt: FMT.pct }], rows: items },
        });
      }
      {
        const rows = res.q09?.rows;
        let parts = [];
        if (rows) {
          const by = new Map();
          for (const r of regionFilter(rows, regions)) {
            const p = by.get(r.partner) || { partner: r.partner, impressions: 0, completed: 0, unique: 0 };
            p.impressions += r.impressions || 0; p.completed += r.completed_views || 0; p.unique += r.unique_viewers || 0;
            by.set(r.partner, p);
          }
          parts = [...by.values()].map((p) => ({ ...p, rate: ratio(p.completed, p.impressions) })).sort((a, b) => b.unique - a.unique);
        }
        const max = Math.max(1, ...parts.map((p) => p.unique));
        card('card-ads', {
          title: 'Publicités par partenaire', note: 'Joueurs distincts exposés · toute la campagne',
          body: rows ? barList(parts.map((p) => ({ name: p.partner, value: p.unique, max, label: FMT.short(p.unique), sub: `${FMT.short(p.impressions)} impr.` })), { head: ['Partenaire', 'Vues uniques', 'Total'] }) : emptyBody('La liste'),
          table: rows && { cols: [{ label: 'Partenaire', key: 'partner' }, { label: 'Impressions', key: 'impressions', num: true, fmt: FMT.int }, { label: 'Vues uniques', key: 'unique', num: true, fmt: FMT.int }, { label: 'Vues complètes', key: 'completed', num: true, fmt: FMT.int }, { label: 'Taux de complétion', key: 'rate', num: true, fmt: FMT.pct }], rows: parts },
        });
      }
      renderConsents(res, regions);
      return;
    }

    if (tab === 'commercial') {
      {
        const s = rg && res.q11 ? series(res, 'q11', rg, 'coupon_activations', { redeem: true, allowUnassigned: allRegionsSelected() }) : null;
        card('card-coupons', {
          title: 'Coupons activés en magasin par jour', note: rg?.kind === 'all' ? "Inclut la période d'échange" : rg?.label,
          body: s ? chartBody('ch-coupons') : emptyBody('Le graphique'),
          table: s && { cols: [{ label: 'Jour', key: 'day' }, { label: 'Coupons activés', key: 'v', num: true, fmt: FMT.int }], rows: s.days.map((d, i) => ({ day: d, v: s.values[i] })) },
        });
        if (s) {
          drawChart('ch-coupons', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.5 } }, formatter: (p) => tooltipRows(p) },
            xAxis: catAxis(t, s.days.map(fmtDay)),
            yAxis: valAxis(t),
            series: [{ name: 'Coupons activés', type: 'bar', data: s.values, barMaxWidth: 12, itemStyle: { color: t.data, borderRadius: [3, 3, 0, 0] },
              markLine: rg.kind === 'all' && camp.redemptionEnd > camp.end ? { silent: true, symbol: 'none', lineStyle: { color: t.muted, type: [4, 4], width: 1 }, label: { formatter: 'Fin du jeu', color: t.muted, fontSize: 11 }, data: [{ xAxis: fmtDay(camp.end) }] } : undefined }],
          });
        }
      }
      {
        const scoped = rg && res.q10 ? daily(res, 'q10', rg, regions) : null;
        const weeks = scoped ? [...new Set(scoped.map((r) => mondayOf(r.day)))].sort() : [];
        const agg = weeks.map((w) => { const s = scoped.filter((r) => mondayOf(r.day) === w); return { week: w, rev: sum(s, 'lift_revenue'), tx: sum(s, 'lift_transactions') }; });
        card('card-lift', {
          title: 'Revenus LIFT attribués au jeu, par semaine', note: 'Achats liés au numéro de téléphone saisi à la caisse',
          body: scoped && agg.length ? chartBody('ch-lift') : emptyBody('Le graphique'),
          table: scoped && { cols: [{ label: 'Semaine du', get: (r) => fmtDay(r.week) }, { label: 'Revenus', key: 'rev', num: true, fmt: FMT.money2 }, { label: 'Transactions', key: 'tx', num: true, fmt: FMT.int }, { label: 'Panier moyen', get: (r) => ratio(r.rev, r.tx), num: true, fmt: FMT.money2 }], rows: agg },
        });
        if (scoped && agg.length) {
          drawChart('ch-lift', {
            ...baseOption(t),
            tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.5 } }, formatter: (p) => { const r = agg[p[0].dataIndex]; return `<b>Semaine du ${fmtDay(r.week)}</b><br>Revenus : ${FMT.money2(r.rev)}<br>Transactions : ${FMT.int(r.tx)}<br>Panier moyen : ${FMT.money2(ratio(r.rev, r.tx) || 0)}`; } },
            xAxis: catAxis(t, weeks.map(fmtDay)),
            yAxis: valAxis(t, (v) => `${compact.format(v)} $`),
            series: [{ name: 'Revenus', type: 'bar', barMaxWidth: 28, itemStyle: { color: t.data, borderRadius: [4, 4, 0, 0] }, data: agg.map((a) => a.rev) }],
          });
        }
      }
    }
  }


  // ---------------------------------------------------------------------------
  // Complementary views (funnel, retention, streaks, heatmap, gifts, consents).
  // All player-level and recomputed from sessions, grants and transfers.
  // ---------------------------------------------------------------------------
  const sumBy = (rows, keys) => Object.fromEntries(keys.map((k) => [k, sum(rows, k)]));

  function renderFunnel(res, regions) {
    const rows = res.q13 ? regionFilter(res.q13.rows, regions) : null;
    let body;
    if (rows) {
      const v = sumBy(rows, ['signed_up', 'played', 'won_prize', 'redeemed_prize']);
      const steps = [
        ['Inscrits pendant la campagne', v.signed_up, null],
        ['Ont joué au moins une partie', v.played, v.signed_up],
        ['Ont gagné au moins un prix', v.won_prize, v.played],
        ['Ont échangé au moins un prix', v.redeemed_prize, v.won_prize],
      ];
      body = el('div', {},
        el('div', { class: 'funnel' }, steps.map(([label, n, prev]) => el('div', { class: 'fstep' },
          el('div', { class: 'fl' }, label),
          el('div', { class: 'fv' }, FMT.int(n)),
          el('div', { class: 'fs' }, prev == null ? '100 % des inscrits' : el('span', {}, el('b', {}, FMT.pct0(n / prev)), ' de l\'étape précédente · ', FMT.pct0(n / v.signed_up), ' des inscrits')),
          el('div', { class: 'fbar', style: `width:${((n / (v.signed_up || 1)) * 100).toFixed(1)}%` })))));
      const dl = res.q12 ? sum(res.q12.rows.filter((r) => r.in_campaign === 1), downloadsOf) : null;
      if (dl) body.append(el('p', { class: 'side-note' }, `À titre indicatif : ${FMT.int(dl)} téléchargements de l'app pendant la campagne (toutes BU). Ils ne sont pas reliés aux joueurs et ne font donc pas partie de l'entonnoir.`));
    }
    card('card-funnel', {
      title: 'Entonnoir des joueurs', note: 'Joueurs distincts, toute la campagne',
      body: rows ? body : emptyBody("L'entonnoir"),
      table: rows && { cols: [{ label: 'BU', key: 'region_code' }, { label: 'Inscrits', key: 'signed_up', num: true, fmt: FMT.int }, { label: 'Ont joué', key: 'played', num: true, fmt: FMT.int }, { label: 'Ont gagné', key: 'won_prize', num: true, fmt: FMT.int }, { label: 'Ont échangé', key: 'redeemed_prize', num: true, fmt: FMT.int }], rows },
    });
  }

  function renderRetention(res, regions, t) {
    const rows = res.q14 ? regionFilter(res.q14.rows, regions) : null;
    let body;
    let cohorts = [];
    if (rows) {
      const by = new Map();
      for (const r of rows) {
        const c = by.get(r.cohort_week) || { week: r.cohort_week, players: 0, e1: 0, r1: 0, e7: 0, r7: 0, e30: 0, r30: 0 };
        c.players += r.players; c.e1 += r.eligible_d1; c.r1 += r.retained_d1; c.e7 += r.eligible_d7; c.r7 += r.retained_d7; c.e30 += r.eligible_d30; c.r30 += r.retained_d30;
        by.set(r.cohort_week, c);
      }
      cohorts = [...by.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
      const tot = cohorts.reduce((a, c) => ({ e1: a.e1 + c.e1, r1: a.r1 + c.r1, e7: a.e7 + c.e7, r7: a.r7 + c.r7, e30: a.e30 + c.e30, r30: a.r30 + c.r30 }), { e1: 0, r1: 0, e7: 0, r7: 0, e30: 0, r30: 0 });
      const shade = (rate) => `background: color-mix(in srgb, ${t.data} ${Math.round(6 + rate * 50)}%, transparent)`;
      const cell = (r, e) => (e ? el('td', { class: 'cell', style: shade(r / e), title: `${FMT.int(r)} sur ${FMT.int(e)} joueurs mesurables` }, FMT.pct0(r / e)) : el('td', { class: 'na' }, '—'));
      body = el('div', {},
        el('div', { class: 'summary-row' },
          [['J1', tot.r1, tot.e1], ['J7', tot.r7, tot.e7], ['J30', tot.r30, tot.e30]].map(([l, r, e]) => el('div', {}, el('b', {}, e ? FMT.pct0(r / e) : '—'), el('span', {}, `ont rejoué à ${l}`)))),
        el('div', { class: 'table-wrap' }, el('table', { class: 'data cohort' },
          el('thead', {}, el('tr', {}, ['1re partie, semaine du', 'Joueurs', 'J1', 'J7', 'J30'].map((h, i) => el('th', { class: i ? 'num' : null }, h)))),
          el('tbody', {}, cohorts.map((c) => el('tr', {},
            el('td', {}, fmtDay(c.week)), el('td', { class: 'num' }, FMT.int(c.players)),
            cell(c.r1, c.e1), cell(c.r7, c.e7), cell(c.r30, c.e30)))))));
    }
    card('card-retention', {
      title: 'Rétention par semaine de première partie',
      note: "Part des joueurs qui ont rejoué exactement 1, 7 ou 30 jours après leur première partie · « — » : trop tôt pour mesurer avant la fin du jeu",
      body: rows ? body : emptyBody('La rétention'),
    });
  }

  const STREAK_ORDER = ['1', '2-3', '4-6', '7-13', '14-29', '30+'];
  const STREAK_LABEL = { '1': '1 jour', '2-3': '2 à 3 jours', '4-6': '4 à 6 jours', '7-13': '7 à 13 jours', '14-29': '14 à 29 jours', '30+': '30 jours et plus' };
  function streakFacts(res, regions) {
    if (!res.q17) return null;
    const rows = regionFilter(res.q17.rows, regions);
    const by = Object.fromEntries(STREAK_ORDER.map((b) => [b, sum(rows.filter((r) => String(r.bucket) === b), 'players')]));
    const total = STREAK_ORDER.reduce((a, b) => a + by[b], 0);
    return { by, total, fourteen: by['14-29'] + by['30+'], max: Math.max(0, ...rows.map((r) => r.max_streak || 0)) };
  }
  function renderStreaks(res, regions) {
    const f = streakFacts(res, regions);
    const max = f ? Math.max(1, ...STREAK_ORDER.map((b) => f.by[b])) : 1;
    card('card-streaks', {
      title: 'Séries de jours consécutifs',
      note: f ? `${FMT.int(f.fourteen)} joueurs ont joué 14 jours ou plus d'affilée · plus longue série : ${f.max} jours` : 'Plus longue série de jours de jeu consécutifs par joueur',
      body: f ? barList(STREAK_ORDER.map((b) => ({ name: STREAK_LABEL[b], value: f.by[b], max, label: FMT.pct0(f.by[b] / (f.total || 1)), sub: FMT.short(f.by[b]) }))) : emptyBody('La répartition'),
    });
  }

  const DOW = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
  function renderHeatmap(res, regions, t) {
    const rows = res.q16 ? regionFilter(res.q16.rows, regions) : null;
    card('card-heatmap', {
      title: 'Quand ils jouent', note: "Parties commencées par jour et par heure (heure de l'Est)",
      body: rows ? chartBody('ch-heatmap', 250) : emptyBody('La carte de chaleur'),
    });
    if (!rows) return;
    const grid = new Map();
    for (const r of rows) { const k = `${r.dow}-${r.hour}`; grid.set(k, (grid.get(k) || 0) + r.games); }
    const data = [];
    let max = 1;
    for (let d = 1; d <= 7; d++) for (let h = 0; h < 24; h++) { const v = grid.get(`${d}-${h}`) || 0; max = Math.max(max, v); data.push([h, d - 1, v]); }
    drawChart('ch-heatmap', {
      ...baseOption(t),
      grid: { left: 4, right: 8, top: 4, bottom: 4, containLabel: true },
      tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: (p) => `<b>${DOW[p.value[1]]} ${p.value[0]} h</b><br>${FMT.int(p.value[2])} parties` },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h} h`), splitArea: { show: false }, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 10, interval: 2 } },
      yAxis: { type: 'category', data: DOW, inverse: true, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11 } },
      visualMap: { show: false, min: 0, max, inRange: { color: [t.surface, t.soft, t.data] } },
      series: [{ type: 'heatmap', data, itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } } }],
    });
  }

  function renderGifts(res, regions) {
    const rows = res.q15 ? regionFilter(res.q15.rows, regions) : null;
    let body;
    if (rows) {
      const v = sumBy(rows, ['gifts_sent', 'gifts_claimed', 'gifts_expired', 'gifts_pending', 'gifts_cancelled', 'senders', 'recipients']);
      body = el('div', {},
        el('div', { class: 'summary-row' },
          el('div', {}, el('b', {}, FMT.int(v.gifts_sent)), el('span', {}, 'prix offerts')),
          el('div', {}, el('b', {}, FMT.int(v.senders)), el('span', {}, 'joueurs ont offert')),
          el('div', {}, el('b', {}, FMT.int(v.recipients)), el('span', {}, 'amis ont reçu'))),
        barList([['Réclamés par l\'ami', v.gifts_claimed], ['Expirés sans être réclamés', v.gifts_expired], ['En attente', v.gifts_pending], ['Annulés', v.gifts_cancelled]]
          .filter(([, n]) => n > 0)
          .map(([name, n]) => ({ name, value: n, max: v.gifts_sent || 1, label: FMT.pct0(n / (v.gifts_sent || 1)), sub: FMT.short(n) }))));
    }
    card('card-gifts', {
      title: 'Prix offerts à un ami', note: "Prix gagnés qu'un joueur a transférés à quelqu'un d'autre · BU de l'expéditeur",
      body: rows ? body : emptyBody('Les transferts'),
    });
  }

  function renderConsents(res, regions) {
    const rows = res.q18 ? regionFilter(res.q18.rows, regions) : null;
    let body;
    if (rows) {
      const v = sumBy(rows, ['participations', 'sms_opt_in', 'email_opt_in', 'both_opt_in', 'any_opt_in']);
      const max = v.participations || 1;
      body = el('div', {},
        barList([['SMS', v.sms_opt_in], ['Courriel', v.email_opt_in], ['Les deux', v.both_opt_in], ['Au moins un des deux', v.any_opt_in]]
          .map(([name, n]) => ({ name, value: n, max, label: FMT.short(n), sub: FMT.pct0(n / max) }))),
        el('p', { class: 'side-note' }, `Sur ${FMT.int(v.participations)} participations. Ce que chaque consentement permet (messages du jeu ou marketing de la bannière) reste à confirmer avant de parler de base marketing.`));
    }
    card('card-consents', {
      title: 'Consentements recueillis', note: 'Joueurs ayant accepté de recevoir des messages',
      body: rows ? body : emptyBody('Les consentements'),
    });
  }

  // ---------------------------------------------------------------------------
  // Points of attention (overview)
  // ---------------------------------------------------------------------------
  function renderAttention() {
    const camp = currentCampaign();
    const res = state.results[camp?.code] || {};
    const regions = activeRegions();
    const items = [];
    const go = (tab, text) => el('button', { type: 'button', class: 'link go', onclick: () => selectTab(tab) }, text);
    if (isReady(camp)) {
      const today = todayIn(camp.tz);
      if (today < camp.start) items.push({ cls: '', text: `La campagne commence le ${fmtDayLong(camp.start)}.` });
      else if (today <= camp.end) items.push({ cls: 'good', text: `Campagne en cours jusqu'au ${fmtDayLong(camp.end)}.` });
      else items.push({ cls: '', text: `Jeu terminé le ${fmtDayLong(camp.end)}${camp.redemptionEnd > camp.end ? ` · coupons échangeables jusqu'au ${fmtDayLong(camp.redemptionEnd)}` : ''}.` });
    }
    if (res.q04) {
      const by = new Map();
      for (const r of regionFilter(res.q04.rows, regions)) {
        const p = by.get(r.partner) || { net: 0, planned: 0, inv: 0, rem: 0 };
        p.net += r.net_awarded || 0; p.planned += r.planned_to_date || 0; p.inv += r.inventory || 0; p.rem += r.remaining || 0;
        by.set(r.partner, p);
      }
      const list = [...by.entries()].map(([name, p]) => ({ name, pace: ratio(p.net, p.planned) }));
      const under = list.filter((p) => p.pace != null && p.pace < 0.9).sort((a, b) => a.pace - b.pace);
      const over = list.filter((p) => p.pace != null && p.pace > 1.1);
      if (over.length) items.push({ cls: 'bad', text: `${over.length} partenaire${over.length > 1 ? 's' : ''} au-dessus du plan de distribution : ${over.map((p) => p.name).join(', ')}.`, link: go('prix', 'Voir les prix') });
      if (under.length) items.push({ cls: 'warn', text: `${under.length} partenaire${under.length > 1 ? 's' : ''} sur ${list.length} sous le plan de distribution. Le plus bas : ${under[0].name} à ${FMT.pct0(under[0].pace)}.`, link: go('prix', 'Voir les prix') });
      const inv = [...by.values()].reduce((a, p) => a + p.inv, 0);
      const rem = [...by.values()].reduce((a, p) => a + p.rem, 0);
      if (inv) items.push({ cls: '', text: `${FMT.pct0(rem / inv)} de l'inventaire de prix n'a pas été distribué (${FMT.int(rem)} prix).` });
    }
    const rate = computeKpi(KPI.redemption_rate, res, camp, currentRange(), regions);
    if (rate != null) items.push({ cls: '', text: `${FMT.pct0(rate)} des prix gagnés ont été échangés en magasin.` });
    items.push({ cls: 'bad', text: 'Trafic en magasin et contribution des coupons au trafic : en attente des données des points de vente.', link: go('commercial', 'Voir') });
    items.push({ cls: 'warn', text: "Téléchargements : total toutes provenances. L'attribution au média payant n'est pas encore branchée." });
    if (state.compare === 'fy' && !comparisonCampaign(camp)) items.push({ cls: '', text: 'Comparaison FY26 : aucune édition comparable pour cette campagne.' });
    const errs = Object.keys(state.errors[camp?.code] || {});
    if (errs.length) items.push({ cls: 'bad', text: `${errs.length} requête${errs.length > 1 ? 's ont' : ' a'} échoué à la dernière actualisation : certaines sections peuvent être incomplètes.` });

    $('attention').replaceChildren(
      el('h3', {}, "Points d'attention"),
      el('ul', {}, items.map((i) => el('li', { class: i.cls || null }, el('span', {}, i.text), i.link || el('span')))));
  }

  // ---------------------------------------------------------------------------
  // Definitions, freshness, messages
  // ---------------------------------------------------------------------------
  function renderDefinitions() {
    const label = { available: 'Disponible', partial: 'Partiel', missing: 'Source manquante' };
    const cls = { available: 'ok', partial: 'under', missing: 'over' };
    $('def-table').replaceChildren(
      el('thead', {}, el('tr', {}, ['KPI', 'Définition', 'Source', 'État'].map((h) => el('th', {}, h)))),
      el('tbody', {}, [...DATA.kpis, ...(DATA.extras?.length ? [{ heading: 'Indicateurs complémentaires' }] : []), ...(DATA.extras || [])].map((k) => (k.heading
        ? el('tr', {}, el('th', { colspan: 4, style: 'padding-top:18px' }, k.heading))
        : el('tr', {},
          el('td', {}, k.label_fr),
          el('td', {}, k.definition_fr || '—'),
          el('td', {}, k.source_fr || '—'),
          el('td', {}, el('span', { class: `state ${cls[k.status] || ''}` }, label[k.status] || k.status)))))));
  }
  function renderFreshness() {
    const camp = currentCampaign();
    const meta = state.meta[camp?.code];
    const dot = $('freshness-dot');
    const text = $('freshness-text');
    dot.className = 'dot';
    if (state.busy) {
      dot.classList.add('busy');
      const p = state.progress;
      text.textContent = p ? `Actualisation · ${p.done} sur ${p.total}` : 'Actualisation…';
      return;
    }
    if (meta?.refreshedAt) {
      if (camp?.status === 'live') dot.classList.add('live');
      text.textContent = `Données au ${stampFmt.format(new Date(meta.refreshedAt))}${meta.partial ? ' · incomplètes' : ''}`;
    } else if (state.results[camp?.code]) text.textContent = 'Données chargées';
    else text.textContent = 'Aucune donnée publiée';
  }
  function setPageMsg(html) {
    const node = $('page-msg');
    if (!html) { node.hidden = true; node.replaceChildren(); return; }
    node.hidden = false;
    node.innerHTML = html;
  }

  const NO_REGION_MSG = '<strong>Aucune BU ne correspond à ces filtres.</strong> Le Québec est la seule BU Couche-Tard : choisissez une autre bannière ou une autre BU.';
  let regionMsgShown = false;
  function renderAll() {
    renderFreshness();
    renderKpis();
    renderCharts();
    const anyData = !!state.results[state.campaign];
    $('export-menu').hidden = !(caps.downloads && anyData);
    $('btn-wrap').hidden = !wrapAvailable();
    if (wrap.autoOpen && wrapAvailable()) { wrap.autoOpen = false; openWrap(); }
    if (!activeRegions().length) { setPageMsg(NO_REGION_MSG); regionMsgShown = true; }
    else if (regionMsgShown) { setPageMsg(null); regionMsgShown = false; }
  }

  // ---------------------------------------------------------------------------
  // Bilan: Wrapped-style recap of the whole campaign for the selected BU/banner.
  // One headline number per screen, computed from the same snapshot.
  // ---------------------------------------------------------------------------
  const WRAP_MS = 6500;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = { slides: [], i: 0, paused: false, t0: 0, elapsed: 0, raf: 0, lastFocus: null, autoOpen: false };
  const W = { blue: '#2648f0', tomato: '#ff5b3a', mint: '#17c48a', sun: '#ffc93c', pink: '#ff9ec4', night: '#10131a', ink: '#0f1115', paper: '#fbfaf7' };

  function wrapAvailable() {
    const camp = currentCampaign();
    const res = state.results[camp?.code];
    if (!isReady(camp) || !res?.q01 || !res?.q02) return false;
    return todayIn(camp.tz) > camp.end || camp.status === 'closed';
  }

  // Facts for the recap, over the whole campaign and the selected BUs.
  function wrapFacts() {
    const camp = currentCampaign();
    const res = state.results[camp.code];
    const regions = activeRegions();
    const scope = (q) => (res[q] ? regionFilter(res[q].rows, regions) : null);
    const f = { camp, regions, days: diffDays(camp.start, camp.end) + 1 };
    const q02 = scope('q02');
    f.unique = sum(q02, 'unique_players');
    f.newPlayers = sum(q02, 'new_to_ck_games');
    f.repeat = ratio(sum(q02, 'repeat_players'), f.unique);
    f.daysPerPlayer = ratio(sum(q02, 'player_days'), f.unique);
    const q01 = scope('q01');
    f.games = sum(q01, 'games_played');
    f.signups = sum(q01, 'signups');
    const byDay = new Map();
    for (const r of q01) byDay.set(r.day, (byDay.get(r.day) || 0) + (r.active_players || 0));
    const peak = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
    if (peak) { f.peakDay = peak[0]; f.peakPlayers = peak[1]; f.avgDau = [...byDay.values()].reduce((a, v) => a + v, 0) / byDay.size; }
    f.regionShares = REGION_ORDER.filter((r) => regions.includes(r)).map((r) => ({ r, v: sum(res.q02.rows.filter((x) => x.region_code === r), 'unique_players') }));
    const q04 = scope('q04');
    if (q04) {
      f.won = sum(q04, 'won');
      f.redeemed = res.q11 ? sum(regionFilter(res.q11.rows, regions, regions.length === REGION_ORDER.length), 'coupon_activations') : sum(q04, 'redeemed');
      const byP = new Map();
      for (const r of q04) byP.set(r.partner, (byP.get(r.partner) || 0) + (r.redeemed || 0));
      const top = [...byP.entries()].filter(([p]) => !/^Bannière/.test(p)).sort((a, b) => b[1] - a[1])[0];
      if (top) { f.topPrizePartner = top[0]; f.topPrizeRedeemed = top[1]; }
    }
    const q06 = scope('q06');
    if (q06) f.entries = sum(q06, 'entries');
    const q07 = scope('q07');
    if (q07) {
      const byA = new Map();
      for (const r of q07.filter((x) => x.kind === 'bonus_action')) {
        const a = byA.get(r.key) || { title: r.title_fr || r.key, players: 0 };
        a.players += r.players || 0;
        byA.set(r.key, a);
      }
      const top = [...byA.values()].sort((a, b) => b.players - a.players)[0];
      if (top) { f.topAction = top.title; f.topActionPlayers = top.players; }
      f.badges = sum(q07.filter((x) => x.kind === 'badge'), 'completions');
    }
    const q08 = scope('q08');
    if (q08) { f.referrals = sum(q08, 'successful_referrals'); f.referrers = sum(q08, 'referrers'); }
    const q09 = scope('q09');
    if (q09) {
      f.impressions = sum(q09, 'impressions');
      const byP = new Map();
      for (const r of q09) byP.set(r.partner, (byP.get(r.partner) || 0) + (r.unique_viewers || 0));
      f.adPartners = byP.size;
      const top = [...byP.entries()].sort((a, b) => b[1] - a[1])[0];
      if (top) { f.topAdPartner = top[0]; f.topAdViewers = top[1]; }
    }
    if (res.q12) {
      const rows = res.q12.rows;
      f.downloads = sum(rows.filter((r) => r.in_campaign === 1), downloadsOf);
      f.downloadsBefore = sum(rows.filter((r) => r.in_campaign === 0), downloadsOf);
    }
    const sf = streakFacts(res, regions);
    if (sf) { f.streak14 = sf.fourteen; f.streakMax = sf.max; }
    const q15 = scope('q15');
    if (q15) { f.giftsSent = sum(q15, 'gifts_sent'); f.giftsClaimed = sum(q15, 'gifts_claimed'); f.giftSenders = sum(q15, 'senders'); }
    const q10 = scope('q10');
    if (q10) { f.liftRevenue = sum(q10, 'lift_revenue'); f.liftTx = sum(q10, 'lift_transactions'); }
    return f;
  }

  const scopeName = (regions) => {
    if (regions.length === REGION_ORDER.length) return 'toutes les BU';
    if (regions.length === 2 && regions.includes('ATL') && regions.includes('QC')) return 'Eastern';
    return regions.map((r) => REGION_LABEL[r]).join(', ');
  };
  const big = (n) => (n >= 1e6 ? { v: n / 1e6, fmt: (x) => nf1.format(x), unit: 'millions' } : { v: n, fmt: (x) => nf.format(x), unit: '' });

  function buildSlides() {
    const f = wrapFacts();
    const S = [];
    const add = (s) => S.push(s);
    const days = f.days;
    add({ bg: W.night, ink: W.paper, acc: W.tomato, motif: 'disc', kicker: `${f.camp.name} · ${scopeName(f.regions)}`, title: 'Le bilan', line: `${days} jours de jeu, du ${fmtDayLong(f.camp.start)} au ${fmtDayLong(f.camp.end)}. Voici ce que la campagne a donné.` });
    if (f.unique) add({ bg: W.blue, ink: W.paper, acc: '#3d5ff5', motif: 'ring', kicker: 'Ils ont joué', num: f.unique, unit: 'joueurs uniques',
      line: f.newPlayers ? `<b>${FMT.pct0(f.newPlayers / f.unique)}</b> n'avaient jamais joué à un jeu de l'app avant. Ça fait <b>${FMT.int(f.newPlayers)}</b> nouveaux joueurs.` : null });
    if (f.games) {
      const secs = (days * 86400) / f.games;
      const b = big(f.games);
      add({ bg: W.tomato, ink: W.ink, acc: '#ff7a5e', motif: 'stripes', light: true, kicker: 'Et ils ont joué beaucoup', num: b.v, fmt: b.fmt, unit: b.unit ? `${b.unit} de parties` : 'parties',
        line: `C'est <b>une partie toutes les ${nf1.format(secs)} secondes</b>, jour et nuit, pendant ${days} jours.` });
    }
    if (f.repeat != null) add({ bg: W.mint, ink: W.ink, acc: '#3fd9a3', motif: 'blocks', light: true, kicker: 'Ils sont revenus', num: f.repeat * 100, fmt: (x) => nf.format(x), unit: '% des joueurs',
      line: `sont revenus jouer au moins un deuxième jour. En moyenne, chaque joueur a joué <b>${nf1.format(f.daysPerPlayer || 0)} jours</b>.` });
    if (f.peakDay) add({ bg: W.sun, ink: W.ink, acc: '#ffd970', motif: 'arc', light: true, kicker: 'Le jour le plus fort', title: fmtDayLong(f.peakDay).replace(/ \d{4}$/, ''),
      line: `<b>${FMT.int(f.peakPlayers)}</b> joueurs actifs ce jour-là, contre ${FMT.int(f.avgDau || 0)} en moyenne.` });
    if (f.regionShares.length > 1) {
      const total = f.regionShares.reduce((a, x) => a + x.v, 0) || 1;
      const sorted = [...f.regionShares].sort((a, b) => b.v - a.v);
      const max = sorted[0].v || 1;
      add({ bg: W.night, ink: W.paper, acc: '#1b2030', motif: 'disc', kicker: 'La BU en tête', title: REGION_LABEL[sorted[0].r],
        line: `${FMT.pct0(sorted[0].v / total)} des joueurs uniques.`,
        bars: sorted.map((x) => ({ label: REGION_LABEL[x.r], pct: x.v / total, w: x.v / max, color: cssVar(REGION_VAR[x.r]) })) });
    }
    if (f.won) {
      const b = big(f.won);
      add({ bg: W.pink, ink: W.ink, acc: '#ffb8d4', motif: 'ring', light: true, kicker: 'Des prix, beaucoup de prix', num: b.v, fmt: b.fmt, unit: b.unit ? `${b.unit} de prix gagnés` : 'prix gagnés',
        line: `<b>${FMT.int(f.redeemed)}</b> ont été échangés en magasin, soit <b>${FMT.pct0(f.redeemed / f.won)}</b>.` + (f.topPrizePartner ? ` Le partenaire le plus échangé : <b>${escapeHtml(f.topPrizePartner)}</b>.` : '') });
    }
    if (f.entries) {
      const b = big(f.entries);
      add({ bg: W.blue, ink: W.paper, acc: '#3d5ff5', motif: 'stripes', kicker: 'En route vers le grand prix', num: b.v, fmt: b.fmt, unit: b.unit ? `${b.unit} de participations` : 'participations',
        line: f.unique ? `Environ <b>${nf.format(f.entries / f.unique)}</b> participations par joueur.` : null });
    }
    if (f.streak14) add({ bg: W.night, ink: W.paper, acc: '#1b2030', motif: 'stripes', kicker: 'Les plus fidèles', num: f.streak14, unit: 'joueurs',
      line: `ont joué <b>14 jours ou plus d'affilée</b>. La plus longue série : <b>${f.streakMax} jours</b>.` });
    if (f.giftsClaimed) add({ bg: W.pink, ink: W.ink, acc: '#ffb8d4', motif: 'disc', light: true, kicker: 'Et ils ont partagé', num: f.giftsClaimed, unit: 'prix offerts à un ami',
      line: `ont été réclamés, sur ${FMT.int(f.giftsSent)} prix offerts par ${FMT.int(f.giftSenders)} joueurs.` });
    if (f.topAction) add({ bg: W.mint, ink: W.ink, acc: '#3fd9a3', motif: 'arc', light: true, kicker: 'Les mécaniques qui ont marché', num: f.topActionPlayers, unit: 'joueurs',
      line: `ont choisi « ${escapeHtml(f.topAction)} », l'action bonus la plus populaire.` + (f.referrals ? ` Et <b>${FMT.int(f.referrals)}</b> parrainages ont abouti.` : '') });
    if (f.impressions) {
      const b = big(f.impressions);
      add({ bg: W.tomato, ink: W.ink, acc: '#ff7a5e', motif: 'blocks', light: true, kicker: 'Les partenaires ont été vus', num: b.v, fmt: b.fmt, unit: b.unit ? `${b.unit} d'impressions` : 'impressions',
        line: `pour ${f.adPartners} partenaires.` + (f.topAdPartner ? ` <b>${escapeHtml(f.topAdPartner)}</b> a rejoint le plus de joueurs : ${FMT.int(f.topAdViewers)}.` : '') });
    }
    if (f.downloads && f.downloadsBefore) add({ bg: W.sun, ink: W.ink, acc: '#ffd970', motif: 'disc', light: true, kicker: "L'app a décollé", num: f.downloads / f.downloadsBefore, fmt: (x) => `×${nf1.format(x)}`, unit: 'téléchargements',
      line: `<b>${FMT.int(f.downloads)}</b> téléchargements pendant la campagne, contre ${FMT.int(f.downloadsBefore)} sur la même durée avant le lancement.`, note: 'Toutes BU, toutes provenances.' });
    if (f.liftRevenue) add({ bg: W.night, ink: W.paper, acc: '#1b2030', motif: 'ring', kicker: 'Jusque dans le panier', num: f.liftRevenue, fmt: (x) => money.format(x), unit: 'de ventes rattachées au jeu',
      line: `${FMT.int(f.liftTx)} transactions, ${FMT.money2(f.liftRevenue / f.liftTx)} en moyenne.`, note: 'Achats liés au numéro de téléphone saisi à la caisse. Pas le revenu total.' });
    add({ bg: W.blue, ink: W.paper, acc: '#3d5ff5', motif: 'disc', kicker: `${f.camp.name} en bref`, title: 'Merci !', summary: f });
    return S;
  }

  function slideNode(s, idx) {
    const node = el('section', { class: `slide${s.light ? ' light' : ''}`, style: `--bg-s:${s.bg};--ink-s:${s.ink};--acc-s:${s.acc}`, 'aria-label': `Écran ${idx + 1} sur ${wrap.slides.length}` },
      el('div', { class: `motif ${s.motif}` }),
      el('div', { class: 'kicker rise' }, s.kicker));
    if (s.title) node.append(el('div', { class: `big mid rise d1` }, s.title));
    if (s.num != null) {
      const n = el('div', { class: 'big rise d1', 'data-to': String(s.num) }, (s.fmt || ((x) => nf.format(x)))(reducedMotion() ? s.num : 0));
      node.append(n);
      if (s.unit) node.append(el('div', { class: 'unit rise d2' }, s.unit));
    }
    if (s.line) { const p = el('p', { class: 'line rise d3' }); p.innerHTML = s.line; node.append(p); }
    if (s.bars) {
      node.append(el('div', { class: 'bars rise d3' }, s.bars.map((b) => el('div', {}, el('span', {}, b.label), el('s', { style: `width:${Math.max(4, b.w * 100)}%;color:${b.color}` }), el('span', {}, FMT.pct0(b.pct))))));
    }
    if (s.summary) {
      const f = s.summary;
      const tiles = [
        [FMT.short(f.unique), 'joueurs uniques'],
        [FMT.short(f.games), 'parties jouées'],
        [f.repeat != null ? FMT.pct0(f.repeat) : '—', 'sont revenus'],
        [f.won ? FMT.short(f.won) : '—', 'prix gagnés'],
        [f.redeemed ? FMT.short(f.redeemed) : '—', 'prix échangés'],
        [f.downloads && f.downloadsBefore ? `×${nf1.format(f.downloads / f.downloadsBefore)}` : '—', 'téléchargements vs avant'],
      ];
      node.append(el('div', { class: 'tiles-s rise d2' }, tiles.map(([v, l]) => el('div', {}, el('b', {}, v), el('span', {}, l)))));
      const cta = el('div', { class: 'cta rise d3' },
        caps.downloads ? el('button', { type: 'button', onclick: (e) => { e.stopPropagation(); saveWrapCard(f); } }, 'Télécharger la carte') : null,
        el('button', { type: 'button', class: 'ghost', onclick: (e) => { e.stopPropagation(); showSlide(0); } }, 'Revoir'));
      node.append(cta);
    }
    if (s.note) node.append(el('p', { class: 'note rise d3' }, s.note));
    return node;
  }

  function countUp(node, s) {
    const target = Number(node.dataset.to);
    const fmt = s.fmt || ((x) => nf.format(x));
    if (reducedMotion()) { node.textContent = fmt(target); return; }
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      const e = 1 - Math.pow(1 - k, 3);
      node.textContent = fmt(target * e);
      if (k < 1 && wrap.slides[wrap.i] === s) requestAnimationFrame(step);
      else node.textContent = fmt(target);
    };
    requestAnimationFrame(step);
  }

  function renderProgress() {
    $('wrap-progress').replaceChildren(...wrap.slides.map((_, j) => el('span', {}, el('i', { style: `width:${j < wrap.i ? 100 : 0}%` }))));
  }
  function showSlide(i) {
    wrap.i = Math.max(0, Math.min(wrap.slides.length - 1, i));
    const s = wrap.slides[wrap.i];
    const node = slideNode(s, wrap.i);
    $('wrap-stage').replaceChildren(node);
    $('wrap-frame').classList.toggle('light', !!s.light);
    $('wrap-frame').style.color = s.ink;
    const n = node.querySelector('[data-to]');
    if (n) countUp(n, s);
    renderProgress();
    wrap.elapsed = 0;
    wrap.t0 = performance.now();
  }
  function tick(t) {
    if ($('wrap').hidden) return;
    const bar = $('wrap-progress').children[wrap.i]?.firstChild;
    const last = wrap.i === wrap.slides.length - 1;
    if (!wrap.paused && !reducedMotion() && !last) {
      const p = Math.min(1, (wrap.elapsed + (t - wrap.t0)) / WRAP_MS);
      if (bar) bar.style.width = `${p * 100}%`;
      if (p >= 1) showSlide(wrap.i + 1);
    } else if (bar && last) bar.style.width = '100%';
    wrap.raf = requestAnimationFrame(tick);
  }
  function setPaused(p) {
    if (p && !wrap.paused) wrap.elapsed += performance.now() - wrap.t0;
    if (!p && wrap.paused) wrap.t0 = performance.now();
    wrap.paused = p;
    $('wrap-pause').textContent = p ? 'Lecture' : 'Pause';
    $('wrap-pause').setAttribute('aria-label', p ? 'Reprendre la lecture' : 'Mettre en pause');
  }
  function openWrap() {
    if (!wrapAvailable()) return;
    wrap.slides = buildSlides();
    wrap.lastFocus = document.activeElement;
    $('wrap-brand').textContent = `Bilan · ${currentCampaign().name}`;
    $('wrap').hidden = false;
    document.body.style.overflow = 'hidden';
    setPaused(reducedMotion());
    showSlide(0);
    cancelAnimationFrame(wrap.raf);
    wrap.raf = requestAnimationFrame(tick);
    $('wrap-close').focus();
    try { history.replaceState(null, '', '#bilan'); } catch (e) { /* sandboxed */ }
  }
  function closeWrap() {
    $('wrap').hidden = true;
    document.body.style.overflow = '';
    cancelAnimationFrame(wrap.raf);
    try { history.replaceState(null, '', `#${state.tab}`); } catch (e) { /* sandboxed */ }
    wrap.lastFocus?.focus?.();
  }
  $('btn-wrap').addEventListener('click', openWrap);
  window.addEventListener('hashchange', () => { if (location.hash === '#bilan' && $('wrap').hidden) { if (wrapAvailable()) openWrap(); else wrap.autoOpen = true; } });
  $('wrap-close').addEventListener('click', closeWrap);
  $('wrap-pause').addEventListener('click', () => setPaused(!wrap.paused));
  $('wrap-prev').addEventListener('click', () => showSlide(wrap.i - 1));
  $('wrap-next').addEventListener('click', () => showSlide(wrap.i + 1));
  document.addEventListener('keydown', (e) => {
    if ($('wrap').hidden) return;
    if (e.key === 'Escape') closeWrap();
    else if (e.key === 'ArrowRight') showSlide(wrap.i + 1);
    else if (e.key === 'ArrowLeft') showSlide(wrap.i - 1);
    else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); setPaused(!wrap.paused); }
  });
  // Swipe on touch screens
  let touchX = null;
  $('wrap-frame').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  $('wrap-frame').addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) showSlide(wrap.i + (dx < 0 ? 1 : -1));
  });

  // Shareable PNG card (1080 x 1350) drawn on a canvas.
  async function saveWrapCard(f) {
    try { await document.fonts.load('800 80px "Bricolage Grotesque"'); await document.fonts.load('600 30px "Public Sans"'); } catch (e) { /* fallback fonts */ }
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1350;
    const g = c.getContext('2d');
    const disp = '"Bricolage Grotesque", "Public Sans", system-ui, sans-serif';
    const body = '"Public Sans", system-ui, sans-serif';
    g.fillStyle = W.blue; g.fillRect(0, 0, 1080, 1350);
    g.strokeStyle = '#3d5ff5'; g.lineWidth = 60; g.beginPath(); g.arc(900, 120, 330, 0, Math.PI * 2); g.stroke();
    g.fillStyle = W.paper;
    g.font = `600 34px ${body}`; g.fillText(`${f.camp.name} · ${scopeName(f.regions)}`, 80, 150);
    g.font = `800 120px ${disp}`; g.fillText('Le bilan', 74, 290);
    g.font = `500 30px ${body}`; g.fillText(`${fmtDayLong(f.camp.start)} – ${fmtDayLong(f.camp.end)}`, 80, 350);
    const tiles = [
      [FMT.short(f.unique), 'joueurs uniques'],
      [FMT.short(f.games), 'parties jouées'],
      [f.repeat != null ? FMT.pct0(f.repeat) : '—', 'sont revenus jouer'],
      [f.won ? FMT.short(f.won) : '—', 'prix gagnés'],
      [f.redeemed ? FMT.short(f.redeemed) : '—', 'prix échangés'],
      [f.downloads && f.downloadsBefore ? `×${nf1.format(f.downloads / f.downloadsBefore)}` : '—', 'téléchargements vs avant'],
    ];
    tiles.forEach(([v, l], i) => {
      const x = 80 + (i % 2) * 470;
      const y = 440 + Math.floor(i / 2) * 270;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      if (g.roundRect) { g.beginPath(); g.roundRect(x, y, 440, 240, 28); g.fill(); } else g.fillRect(x, y, 440, 240);
      g.fillStyle = W.paper;
      // Shrink to fit the tile, whatever font actually loaded.
      let size = 96;
      do { g.font = `800 ${size}px ${disp}`; size -= 4; } while (g.measureText(v).width > 372 && size > 48);
      g.fillText(v, x + 32, y + 130);
      size = 30;
      do { g.font = `500 ${size}px ${body}`; size -= 1; } while (g.measureText(l).width > 380 && size > 20);
      g.fillText(l, x + 34, y + 192);
    });
    const meta = state.meta[f.camp.code];
    g.font = `500 24px ${body}`; g.globalAlpha = 0.8;
    g.fillText(meta?.refreshedAt ? `Données au ${stampFmt.format(new Date(meta.refreshedAt))}` : '', 80, 1290);
    g.globalAlpha = 1;
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    try { await caps.downloads.save({ filename: `bilan-${f.camp.code}.png`, data: blob }); }
    catch (e) { if (e?.code !== 'declined') setPageMsg(`La carte n'a pas pu être préparée (${escapeHtml(e?.code || 'erreur')}).`); }
  }

  // ---------------------------------------------------------------------------
  // Shared snapshot (db): campaigns/<code> meta + campaigns/<code>/results/<qid>
  // ---------------------------------------------------------------------------
  const subs = [];
  function subscribeCampaign(code) {
    while (subs.length) subs.pop()();
    if (!caps.db || !code) return;
    const camp = state.campaigns.find((c) => c.code === code);
    const codes = [code, comparisonCampaign(camp)?.code].filter(Boolean);
    for (const c of codes) {
      subs.push(caps.db.collection(`campaigns/${c}/results`).onSnapshot((snap) => {
        if (state.busy && c === state.campaign) return; // the running refresh owns this campaign's state
        const out = {};
        for (const d of snap.docs) {
          const body = d.data();
          try { out[d.id] = { rows: parseTable(body.text), storedAt: body.storedAt, ms: body.ms }; } catch (e) { /* skip unreadable doc */ }
        }
        if (Object.keys(out).length) state.results[c] = out;
        renderAll();
        if (c === state.campaign && !snap.metadata?.fromCache) maybeAutoRefresh();
      }, () => renderAll()));
      subs.push(caps.db.doc(`campaigns/${c}`).onSnapshot((snap) => {
        if (snap.exists) state.meta[c] = snap.data();
        renderFreshness();
      }, () => {}));
    }
  }
  async function persist(code, qid, text, ms) {
    if (!caps.db || !caps.canWrite) return;
    try { await caps.db.doc(`campaigns/${code}/results/${qid}`).set({ text, ms, storedAt: Date.now() }); }
    catch (e) { if (e?.code === 'invalid_argument') caps.canWrite = false; }
  }

  // ---------------------------------------------------------------------------
  // Live refresh through the viewer's Couche-Tard MCP connector
  // ---------------------------------------------------------------------------
  const ERR_COPY = {
    server_not_connected: "Le connecteur <strong>Couche-Tard MCP</strong> n'est pas ajouté à votre compte. Ajoutez-le dans claude.ai → Paramètres → Connecteurs pour actualiser les données.",
    selection_required: "Plusieurs connecteurs <strong>Couche-Tard MCP</strong> sont configurés. Choisissez celui à utiliser dans la fenêtre de claude.ai, puis relancez l'actualisation.",
    needs_reauth: 'La connexion à <strong>Couche-Tard MCP</strong> a expiré. Reconnectez-la dans claude.ai → Paramètres → Connecteurs, puis relancez l\'actualisation.',
    not_in_manifest: "L'accès à <strong>Couche-Tard MCP</strong> a été refusé pour cette page. Vous pouvez l'autoriser dans le menu Permissions de l'artefact.",
    blocked_by_policy: "La politique de votre organisation bloque l'outil de requête de <strong>Couche-Tard MCP</strong> pour votre compte.",
    approval_required: "Votre organisation exige une approbation pour chaque requête vers <strong>Couche-Tard MCP</strong> ; ce n'est pas encore possible depuis un artefact.",
    server_not_found: "Le connecteur <strong>Couche-Tard MCP</strong> n'existe plus. Ajoutez-le de nouveau dans claude.ai → Paramètres → Connecteurs.",
    consent_required: "L'accès à <strong>Couche-Tard MCP</strong> n'a pas été autorisé pour cette page. Cliquez sur Actualiser pour le redemander.",
  };
  const PAGE_LEVEL = new Set(Object.keys(ERR_COPY).concat(['not_granted', 'capability_disabled', 'capability_removed']));

  async function runSql(sql) {
    const call = () => caps.mcp.callTool(SERVER, TOOL, { sql }, { cache: false });
    let res;
    try {
      res = await call();
    } catch (e) {
      if (!e?.retryable) throw e;
      await new Promise((r) => setTimeout(r, Math.min(e.retryAfterMs || 0, 60000) + 800 + Math.random() * 1500));
      res = await call();
    }
    return resultText(res);
  }

  async function loadRegistry() {
    try {
      const text = await runSql(EDITIONS_SQL);
      const rows = parseTable(text);
      if (rows.length) {
        state.campaigns = rows.map(campaignFromTable);
        state.registrySource = 'table';
        if (caps.db && caps.canWrite) caps.db.doc('config/campaigns').set({ source: 'table', text, storedAt: Date.now() }).catch(() => {});
        if (!state.campaigns.find((c) => c.code === state.campaign && isReady(c))) state.campaign = pickDefaultCampaign();
        renderFilters();
      }
    } catch (e) {
      if (e?.code !== 'tool_error') throw e; // table not deployed yet -> keep seeds/campaigns.csv
    }
  }

  async function refresh() {
    if (state.busy || !caps.mcp) return;
    state.busy = true;
    setPageMsg(null);
    $('btn-refresh').disabled = true;
    const startedAt = Date.now();
    state.progress = { done: 0, total: QUERY_ORDER.length };
    renderFreshness();
    try {
      await loadRegistry();
    } catch (e) {
      return finishRefresh(e);
    }
    const camp = currentCampaign();
    if (!isReady(camp)) return finishRefresh(null, 'Cette campagne n\'a pas encore de dates.');
    const code = camp.code;
    const fresh = {};
    const errors = {};
    let fatal = null;
    const queue = [...QUERY_ORDER];
    async function worker() {
      while (queue.length && !fatal) {
        const qid = queue.shift();
        const t0 = performance.now();
        try {
          const text = await runSql(buildSql(qid, camp));
          const rows = parseTable(text);
          const ms = Math.round(performance.now() - t0);
          fresh[qid] = { rows, storedAt: Date.now(), ms };
          state.results[code] = { ...(state.results[code] || {}), [qid]: fresh[qid] };
          await persist(code, qid, text, ms);
        } catch (e) {
          if (PAGE_LEVEL.has(e?.code)) { fatal = e; break; }
          errors[qid] = e?.message || 'Erreur inconnue';
        }
        state.progress.done += 1;
        renderAll();
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    state.errors[code] = errors;
    if (!fatal) {
      const meta = { refreshedAt: startedAt, partial: Object.keys(errors).length > 0, source: camp.source, durationMs: Date.now() - startedAt };
      state.meta[code] = meta;
      if (caps.db && caps.canWrite) caps.db.doc(`campaigns/${code}`).set(meta).catch(() => {});
    }
    finishRefresh(fatal, Object.keys(errors).length ? `Certaines requêtes ont échoué : ${Object.entries(errors).map(([q, m]) => `${DATA.queries[q].file} (${m})`).join(' ; ')}. Les autres sections sont à jour.` : null);
  }
  function finishRefresh(err, message) {
    state.busy = false;
    state.progress = null;
    $('btn-refresh').disabled = false;
    if (err) {
      const copy = ERR_COPY[err.code];
      if (['not_granted', 'capability_disabled', 'capability_removed'].includes(err.code)) {
        caps.mcp = null; $('btn-refresh').hidden = true;
        setPageMsg('Cette vue ne peut pas interroger Couche-Tard MCP. Les données affichées sont le dernier instantané publié.');
      } else if (copy) setPageMsg(copy);
      else setPageMsg(`L'actualisation a échoué : ${escapeHtml(err.message || err.code || 'erreur inconnue')}. Les données précédentes restent affichées.`);
    } else if (message) setPageMsg(escapeHtml(message));
    renderAll();
  }

  let autoTried = false;
  function maybeAutoRefresh() {
    const camp = currentCampaign();
    // Auto-fill only for someone who can publish the snapshot, or for an in-memory view without db.
    if (autoTried || !caps.mcp || !(caps.canWrite || !caps.db) || !isReady(camp)) return;
    const res = state.results[camp.code];
    const complete = res && QUERY_ORDER.every((q) => res[q]);
    if (complete) return;
    autoTried = true;
    refresh();
  }
  $('btn-refresh').addEventListener('click', () => refresh());

  function onCampaignChange() {
    autoTried = false;
    renderFilters();
    subscribeCampaign(state.campaign);
    renderAll();
    if (!caps.db) maybeAutoRefresh();
  }

  // ---------------------------------------------------------------------------
  // Export (CSV, semicolon-separated, French decimals, UTF-8 BOM for Excel)
  // ---------------------------------------------------------------------------
  const csvCell = (v) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  function filterLabel() {
    const rg = currentRange();
    const opt = REGION_OPTIONS.find((o) => o.id === state.region);
    return { period: rg ? `${rg.label} (${rg.d0} au ${rg.d1})` : '', bu: opt?.label || '', banner: state.banner === 'all' ? 'Toutes' : state.banner };
  }
  async function save(filename, data) {
    $('export-menu').open = false;
    try { await caps.downloads.save({ filename, data }); }
    catch (e) {
      if (e?.code === 'declined') return;
      if (e?.code === 'rate_limited') setPageMsg('Un téléchargement est déjà en attente de confirmation.');
      else setPageMsg(`Le téléchargement n'a pas pu être préparé (${escapeHtml(e?.code || 'erreur')}).`);
    }
  }
  $('btn-export-kpi').addEventListener('click', () => {
    const camp = currentCampaign();
    const f = filterLabel();
    const meta = state.meta[camp.code];
    const asOf = meta?.refreshedAt ? new Date(meta.refreshedAt).toISOString() : '';
    const sections = { audience: 'Audience et engagement', prix: 'Prix et distribution', mecaniques: 'Mécaniques de jeu', commercial: 'Impact commercial' };
    const rows = [['Campagne', 'Période', 'BU', 'Bannière', 'Section', 'KPI', 'Valeur', 'Comparaison', 'Valeur de comparaison', 'Variation', 'Portée', 'État de la source', 'Note', 'Données au']];
    for (const { k, value, cmp, cmpInfo, rg } of KPIS.map(kpiValue)) {
      const variation = value != null && cmp != null ? (k.delta === 'pts' ? `${((value - cmp) * 100).toFixed(1)} pts` : cmp ? `${(((value - cmp) / Math.abs(cmp)) * 100).toFixed(1)} %` : '') : '';
      const scope = k.scope === 'stock' ? 'À ce jour' : k.scope === 'campaign' ? 'Total de campagne' : (k.exact && rg?.kind === 'custom' && value == null ? NEEDS_EXACT : 'Période sélectionnée');
      rows.push([camp.name, f.period, f.bu, f.banner, sections[k.section], k.label, value, cmpInfo.na ? 'n/d' : cmpInfo.label, cmp, variation.replace('.', ','), scope, { available: 'Disponible', partial: 'Partiel', missing: 'Source manquante' }[sourceStatus(k)], k.note || '', asOf]);
    }
    save(`kpi-${camp.code}-${state.period}-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
  });
  $('btn-export-data').addEventListener('click', () => {
    const camp = currentCampaign();
    const res = state.results[camp.code] || {};
    const dims = ['campaign', 'day', 'week_start', 'cohort_week', 'region_code', 'partner', 'prize_fr', 'promotion_id', 'kind', 'key', 'title_fr', 'in_campaign', 'bucket', 'dow', 'hour'];
    const rows = [['jeu_de_donnees', 'jour_ou_semaine', 'bu', 'partenaire', 'element', 'mesure', 'valeur']];
    for (const qid of Object.keys(DATA.queries)) {
      for (const r of res[qid]?.rows || []) {
        for (const [m, v] of Object.entries(r)) {
          if (dims.includes(m) || v == null || typeof v !== 'number') continue;
          rows.push([DATA.queries[qid].file.replace('.sql', ''), r.day || r.week_start || r.cohort_week || '', r.region_code || '', r.partner || '', r.prize_fr || r.title_fr || r.key || r.bucket || (r.dow ? `${DOW[r.dow - 1]} ${r.hour} h` : ''), m, v]);
        }
      }
    }
    save(`donnees-${camp.code}-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
  });

  // ---------------------------------------------------------------------------
  // Theme changes redraw charts with the new tokens
  // ---------------------------------------------------------------------------
  let themeTimer = null;
  const redraw = () => { clearTimeout(themeTimer); themeTimer = setTimeout(renderAll, 60); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------------------
  // Boot: render at rest, then light up capabilities as they resolve
  // ---------------------------------------------------------------------------
  loadFilters();
  renderFilters();
  renderDefinitions();
  selectTab(state.tab);
  renderAll();

  async function boot() {
    const use = (name) => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
    const [db, mcp, user, downloads] = await Promise.all([use('db'), use('mcp'), use('user'), use('downloads')]);
    Object.assign(caps, { db, mcp, user, downloads });
    let canWrite = false;
    if (user) {
      try {
        const w = await user.can('data.write');
        canWrite = w == null ? true : !!w;
      } catch (e) { canWrite = false; }
    }
    caps.canWrite = !!db && canWrite;
    $('btn-refresh').hidden = !mcp;
    if (db) {
      try {
        const reg = await db.doc('config/campaigns').get();
        if (reg.exists && reg.data().source === 'table') {
          const rows = parseTable(reg.data().text);
          if (rows.length) { state.campaigns = rows.map(campaignFromTable); state.registrySource = 'table'; }
          if (!state.campaigns.find((c) => c.code === state.campaign && isReady(c))) state.campaign = pickDefaultCampaign();
        }
      } catch (e) { /* keep seeds */ }
    }
    onCampaignChange();
    if (!db && !mcp) setPageMsg('Ouvrez ce rapport dans claude.ai pour voir les données publiées. Les définitions des KPI restent consultables dans l\'onglet Définitions.');
    if (mcp && caps.canWrite) {
      setInterval(() => { if (currentCampaign()?.status === 'live' && !document.hidden) refresh(); }, LIVE_REFRESH_MS);
    }
  }
  boot();
})();
