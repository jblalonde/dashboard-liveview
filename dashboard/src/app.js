(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Constants and embedded report definition (built by dashboard/build.py)
  // ---------------------------------------------------------------------------
  const DATA = JSON.parse(document.getElementById('report-data').textContent);
  const SERVER = 'Couche-Tard MCP';
  const TOOL = 'run_query';
  // Fast queries first so the page fills progressively; at most 2 in flight.
  const QUERY_ORDER = ['q12', 'q10', 'q08', 'q04', 'q05', 'q11', 'q07', 'q03', 'q02', 'q01', 'q09', 'q06'];
  const CONCURRENCY = 2;
  const LIVE_REFRESH_MS = 30 * 60 * 1000;

  const REGION_ORDER = ['ATL', 'QC', 'CC', 'WC'];
  const REGION_LABEL = { ATL: 'Atlantique', QC: 'Québec', CC: 'Centre', WC: 'Ouest', UNASSIGNED: 'Non attribué' };
  const REGION_SLOT = { ATL: 1, QC: 2, CC: 3, WC: 4 };
  const REGION_META = {};
  for (const r of DATA.regions) {
    REGION_META[r.region_code] = { banner: r.banner_default, rollup: r.client_rollup, name: r.region_name };
  }
  const REGION_CHIPS = [
    { id: 'all', label: 'Toutes', regions: REGION_ORDER },
    { id: 'Eastern', label: 'Eastern (ATL + QC)', regions: ['ATL', 'QC'] },
    ...REGION_ORDER.map((c) => ({ id: c, label: `${c} · ${REGION_LABEL[c]}`, regions: [c], slot: REGION_SLOT[c] })),
  ];
  const KPI_DEF = Object.fromEntries(DATA.kpis.map((k) => [k.id, k]));

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
  const stampFmt = new Intl.DateTimeFormat('fr-CA', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Toronto' });
  const FMT = {
    int: (v) => nf.format(v),
    dec1: (v) => nf1.format(v),
    dec2: (v) => nf2.format(v),
    pct: (v) => `${nf1.format(v * 100)} %`,
    money: (v) => money.format(v),
    money2: (v) => money2.format(v),
  };
  const fmtDay = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));

  // ---------------------------------------------------------------------------
  // Date helpers (ISO yyyy-mm-dd, calendar days, no timezone drift)
  // ---------------------------------------------------------------------------
  const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
  const toIso = (d) => d.toISOString().slice(0, 10);
  const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
  const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);
  const mondayOf = (iso) => { const d = toDate(iso); const wd = (d.getUTCDay() + 6) % 7; return addDays(iso, -wd); };
  const localDate = (utcIso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(utcIso));

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
    return {
      code: r.code,
      name: r.name_fr || r.code,
      editionId: r.id,
      start: r.start_at ? localDate(r.start_at, tz) : null,
      end: r.end_at ? localDate(r.end_at, tz) : null,
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

  const EDITIONS_SQL = `SELECT id, code, name_fr, start_at, end_at, timezone, fiscal_year, promotion_campaign,
       purchase_campaign_id, comparison_edition_id, status
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
        // A '|' inside a text value: fold the surplus back into the widest text column.
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
    compare: 'prev',
    regionChip: 'all',
    banner: 'all',
    results: {},       // code -> qid -> { rows, storedAt, ms }
    errors: {},        // code -> qid -> message
    meta: {},          // code -> { refreshedAt }
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
    const chip = REGION_CHIPS.find((c) => c.id === state.regionChip) || REGION_CHIPS[0];
    return chip.regions.filter((r) => state.banner === 'all' || REGION_META[r]?.banner === state.banner);
  }
  const allRegionsSelected = () => activeRegions().length === REGION_ORDER.length;

  // Period = whole campaign or one Monday-based week (same weeks as sql/kpi/03).
  function periodOptions(c) {
    if (!isReady(c)) return [];
    const opts = [{ id: 'all', kind: 'all', d0: c.start, d1: c.end, label: `Campagne complète · ${fmtDay(c.start)} – ${fmtDay(c.end)}` }];
    let w = mondayOf(c.start);
    let n = 1;
    while (w <= c.end) {
      const d0 = w < c.start ? c.start : w;
      const d1 = addDays(w, 6) > c.end ? c.end : addDays(w, 6);
      opts.push({ id: `w${n}`, kind: 'week', week: w, n, d0, d1, label: `Semaine ${n} · ${fmtDay(d0)} – ${fmtDay(d1)}` });
      w = addDays(w, 7);
      n += 1;
    }
    return opts;
  }
  function currentRange() {
    const c = currentCampaign();
    return periodOptions(c).find((p) => p.id === state.period) || periodOptions(c)[0] || null;
  }

  // ---------------------------------------------------------------------------
  // KPI engine. Each KPI computes from one campaign's results for a range of
  // campaign days and a set of regions; comparisons reuse the same function.
  // ---------------------------------------------------------------------------
  const rowsOf = (res, qid) => res?.[qid]?.rows || null;
  const sum = (rows, f) => rows.reduce((a, r) => a + (Number(typeof f === 'function' ? f(r) : r[f]) || 0), 0);
  const inRange = (day, rg) => day >= rg.d0 && day <= rg.d1;
  function regionFilter(rows, regions, allowUnassigned) {
    return rows.filter((r) => regions.includes(r.region_code) || (allowUnassigned && r.region_code === 'UNASSIGNED'));
  }
  function daily(res, qid, rg, regions, opts = {}) {
    const rows = rowsOf(res, qid);
    if (!rows) return null;
    const scoped = opts.noRegion ? rows : regionFilter(rows, regions, opts.allowUnassigned);
    return scoped.filter((r) => inRange(r.day, rg));
  }
  function overlapsCampaign(rg, c) { return rg.d1 >= c.start && rg.d0 <= c.end; }
  const ratio = (a, b) => (b ? a / b : null);

  function appKeys() {
    if (state.banner === 'Couche-Tard') return ['couche_tard_ios', 'couche_tard_android'];
    if (state.banner === 'Circle K') return ['circle_k_ios', 'circle_k_android'];
    return ['couche_tard_ios', 'couche_tard_android', 'circle_k_ios', 'circle_k_android'];
  }

  // scope: 'period' follows the period filter; 'campaign' = whole campaign only; 'stock' = as of today.
  const KPIS = [
    // Audience et engagement
    { id: 'paid_app_installs', section: 'audience', label: "Téléchargements d'app", fmt: 'int', scope: 'period', noRegion: true,
      note: 'Toutes provenances. Les téléchargements ne sont pas encore attribués au média payant.',
      calc: (x) => { const rows = daily(x.res, 'q12', x.rg, x.regions, { noRegion: true }); return rows && sum(rows, (r) => appKeys().reduce((a, k) => a + (r[k] || 0), 0)); },
      allowBeforeStart: true },
    { id: 'signups', section: 'audience', label: 'Inscriptions', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q01', x.rg, x.regions); return rows && sum(rows, 'signups'); } },
    { id: 'new_players', section: 'audience', label: 'Nouveaux joueurs aux jeux Circle K', fmt: 'int', scope: 'campaign',
      calc: (x) => { const rows = rowsOf(x.res, 'q02'); return rows && sum(regionFilter(rows, x.regions), 'new_to_ck_games'); } },
    { id: 'unique_players', section: 'audience', label: 'Joueurs uniques', fmt: 'int', scope: 'period',
      calc: (x) => {
        if (x.rg.kind === 'week') { const rows = rowsOf(x.res, 'q03'); return rows && sum(regionFilter(rows, x.regions).filter((r) => r.week_start === x.rg.week), 'wau'); }
        const rows = rowsOf(x.res, 'q02'); return rows && sum(regionFilter(rows, x.regions), 'unique_players');
      } },
    { id: 'dau', section: 'audience', label: 'Utilisateurs actifs quotidiens (moy.)', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q01', x.rg, x.regions); if (!rows) return null; const days = new Set(rows.filter((r) => r.active_players > 0).map((r) => r.day)).size; return days ? sum(rows, 'active_players') / days : null; } },
    { id: 'wau', section: 'audience', label: 'Utilisateurs actifs hebdomadaires (moy.)', fmt: 'int', scope: 'period',
      calc: (x) => {
        const rows = rowsOf(x.res, 'q03'); if (!rows) return null;
        const scoped = regionFilter(rows, x.regions).filter((r) => r.week_start >= mondayOf(x.rg.d0) && r.week_start <= x.rg.d1);
        const weeks = [...new Set(scoped.map((r) => r.week_start))];
        return weeks.length ? sum(scoped, 'wau') / weeks.length : null;
      } },
    { id: 'sessions_per_user', section: 'audience', label: 'Jours actifs par joueur', fmt: 'dec1', scope: 'period',
      note: "Indicateur de remplacement : le jeu n'enregistre pas de sessions d'app, on compte les jours où le joueur a joué.",
      calc: (x) => {
        if (x.rg.kind === 'week') {
          const d = daily(x.res, 'q01', x.rg, x.regions); const w = rowsOf(x.res, 'q03');
          return d && w ? ratio(sum(d, 'active_players'), sum(regionFilter(w, x.regions).filter((r) => r.week_start === x.rg.week), 'wau')) : null;
        }
        const rows = rowsOf(x.res, 'q02'); if (!rows) return null; const s = regionFilter(rows, x.regions);
        return ratio(sum(s, 'player_days'), sum(s, 'unique_players'));
      } },
    { id: 'repeat_visit_rate', section: 'audience', label: 'Taux de visites répétées', fmt: 'pct', scope: 'campaign', delta: 'pts',
      calc: (x) => { const rows = rowsOf(x.res, 'q02'); if (!rows) return null; const s = regionFilter(rows, x.regions); return ratio(sum(s, 'repeat_players'), sum(s, 'unique_players')); } },
    { id: 'games_played', section: 'audience', label: 'Parties jouées', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q01', x.rg, x.regions); return rows && sum(rows, 'games_played'); } },

    // Prix et distribution
    { id: 'instant_prizes_won', section: 'prix', label: 'Prix instantanés gagnés', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q05', x.rg, x.regions); return rows && sum(rows, 'won'); } },
    { id: 'instant_prizes_redeemed', section: 'prix', label: 'Prix instantanés échangés', fmt: 'int', scope: 'period',
      note: "Coupons activés en magasin, comptés à la date d'activation.",
      calc: (x) => { const rows = daily(x.res, 'q11', x.rg, x.regions, { allowUnassigned: x.allRegions }); return rows && sum(rows, 'coupon_activations'); } },
    { id: 'redemption_rate', section: 'prix', label: "Taux d'échange", fmt: 'pct', scope: 'campaign', delta: 'pts', extra: true,
      note: 'Prix échangés ÷ prix gagnés, sur toute la campagne.',
      calc: (x) => { const rows = rowsOf(x.res, 'q04'); if (!rows) return null; const s = regionFilter(rows, x.regions); return ratio(sum(s, 'redeemed'), sum(s, 'won')); } },
    { id: 'prizes_remaining', section: 'prix', label: 'Prix restants', fmt: 'int', scope: 'stock',
      note: 'Inventaire − (gagnés − coupons non échangés remis en stock).',
      calc: (x) => { const rows = rowsOf(x.res, 'q04'); return rows && sum(regionFilter(rows, x.regions), 'remaining'); } },
    { id: 'distribution_pacing', section: 'prix', label: 'Rythme de distribution', fmt: 'pct', scope: 'stock', delta: 'pts',
      note: 'Prix réellement distribués ÷ plan linéaire à date. Sous 90 % : sous-distribution ; au-dessus de 110 % : sur-distribution.',
      calc: (x) => { const rows = rowsOf(x.res, 'q04'); if (!rows) return null; const s = regionFilter(rows, x.regions); return ratio(sum(s, 'net_awarded'), sum(s, 'planned_to_date')); },
      status: (v) => paceStatus(v) },
    { id: 'grand_prize_entries', section: 'prix', label: 'Participations au grand prix', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q06', x.rg, x.regions); return rows && sum(rows, 'entries'); } },

    // Mécaniques de jeu
    { id: 'bonus_challenge_completions', section: 'mecaniques', label: 'Actions bonus complétées', fmt: 'int', scope: 'campaign',
      calc: (x) => { const rows = rowsOf(x.res, 'q07'); return rows && sum(regionFilter(rows, x.regions).filter((r) => r.kind === 'bonus_action'), 'completions'); } },
    { id: 'badges_earned', section: 'mecaniques', label: 'Défis réussis (badges)', fmt: 'int', scope: 'campaign', kpiRef: 'bonus_challenge_completions', extra: true,
      calc: (x) => { const rows = rowsOf(x.res, 'q07'); return rows && sum(regionFilter(rows, x.regions).filter((r) => r.kind === 'badge'), 'completions'); } },
    { id: 'referrals', section: 'mecaniques', label: 'Parrainages réussis', fmt: 'int', scope: 'campaign',
      note: 'Seuls les parrainages convertis sont enregistrés ; les invitations envoyées ne le sont pas.',
      calc: (x) => { const rows = rowsOf(x.res, 'q08'); return rows && sum(regionFilter(rows, x.regions), 'successful_referrals'); } },
    { id: 'referrers', section: 'mecaniques', label: 'Parrains actifs', fmt: 'int', scope: 'campaign', kpiRef: 'referrals', extra: true,
      calc: (x) => { const rows = rowsOf(x.res, 'q08'); return rows && sum(regionFilter(rows, x.regions), 'referrers'); } },
    { id: 'partner_ad_impressions', section: 'mecaniques', label: 'Impressions publicitaires', fmt: 'int', scope: 'campaign',
      calc: (x) => { const rows = rowsOf(x.res, 'q09'); return rows && sum(regionFilter(rows, x.regions), 'impressions'); } },
    { id: 'ad_completed_views', section: 'mecaniques', label: 'Vues complètes des pubs', fmt: 'int', scope: 'campaign', kpiRef: 'partner_ad_impressions', extra: true,
      calc: (x) => { const rows = rowsOf(x.res, 'q09'); return rows && sum(regionFilter(rows, x.regions), 'completed_views'); } },

    // Impact commercial
    { id: 'store_traffic', section: 'commercial', label: 'Trafic en magasin', fmt: 'int', scope: 'period', missing: true,
      note: 'Nécessite les données des points de vente (POS), absentes du MCP.',
      calc: () => null },
    { id: 'coupon_traffic_contribution', section: 'commercial', label: 'Coupons activés en magasin', fmt: 'int', scope: 'period',
      note: 'Numérateur de la contribution des coupons au trafic. Le dénominateur (trafic total) attend les données POS.',
      calc: (x) => { const rows = daily(x.res, 'q11', x.rg, x.regions, { allowUnassigned: x.allRegions }); return rows && sum(rows, 'coupon_activations'); } },
    { id: 'lift_revenue', section: 'commercial', label: 'Revenus via LIFT', fmt: 'money', scope: 'period',
      note: 'Achats rattachés au jeu par le numéro de téléphone à la caisse, pas le revenu LIFT total.',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && sum(rows, 'lift_revenue'); } },
    { id: 'lift_transactions', section: 'commercial', label: 'Transactions LIFT', fmt: 'int', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && sum(rows, 'lift_transactions'); } },
    { id: 'avg_spend_per_transaction', section: 'commercial', label: 'Dépense moyenne par transaction', fmt: 'money2', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && ratio(sum(rows, 'lift_revenue'), sum(rows, 'lift_transactions')); } },
    { id: 'items_per_basket', section: 'commercial', label: 'Articles dans le panier', fmt: 'dec1', scope: 'period',
      calc: (x) => { const rows = daily(x.res, 'q10', x.rg, x.regions); return rows && ratio(sum(rows, 'items'), sum(rows, 'lift_transactions')); } },
  ];

  function paceStatus(v) {
    if (v == null) return null;
    if (v < 0.9) return { cls: 'st-under', label: 'Sous-distribution' };
    if (v > 1.1) return { cls: 'st-over', label: 'Sur-distribution' };
    return { cls: 'st-ok', label: 'Dans le plan' };
  }
  function sourceStatus(k) {
    if (k.missing) return 'missing';
    const def = KPI_DEF[k.kpiRef || k.id];
    return def?.status || 'available';
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

  // Comparison range for the current selection, or a reason it is unavailable.
  function comparisonFor(k, camp, rg) {
    if (state.compare === 'prev') {
      if (k.scope === 'campaign') return { na: 'Total de campagne : comparable à FY26 seulement' };
      if (k.scope === 'stock') return { na: 'Stock à ce jour : comparable à FY26 seulement' };
      const len = diffDays(rg.d0, rg.d1) + 1;
      const prev = { kind: rg.kind, d0: addDays(rg.d0, -len), d1: addDays(rg.d0, -1) };
      if (rg.kind === 'week') prev.week = addDays(rg.week, -7);
      if (!k.allowBeforeStart && prev.d1 < camp.start) return { na: 'Pas de période précédente' };
      return { camp, res: state.results[camp.code], rg: prev, label: rg.kind === 'week' ? 'vs semaine précédente' : `vs ${len} jours avant le lancement` };
    }
    const fy = comparisonCampaign(camp);
    if (!fy) return { na: 'Aucune édition FY26 comparable' };
    const res = state.results[fy.code];
    if (!res) return { na: `${fy.name} : données non chargées` };
    if (k.scope === 'stock') return { camp: fy, res, rg: { kind: 'all', d0: fy.start, d1: fy.end }, label: `vs ${fy.name}` };
    // Align on campaign day: same offsets from each campaign's launch.
    const o0 = diffDays(camp.start, rg.d0);
    const o1 = diffDays(camp.start, rg.d1);
    const frg = { kind: rg.kind, d0: addDays(fy.start, o0), d1: addDays(fy.start, Math.min(o1, diffDays(fy.start, fy.end))) };
    if (rg.kind === 'week') frg.week = mondayOf(frg.d0);
    return { camp: fy, res, rg: frg, label: `vs ${fy.name} (mêmes jours de campagne)` };
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
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return node;
  }
  function pillFor(status, tip) {
    if (status === 'partial') return el('span', { class: 'pill partial', tabindex: 0, 'data-tip': tip || 'Donnée partielle' }, 'Partiel');
    if (status === 'missing') return el('span', { class: 'pill missing', tabindex: 0, 'data-tip': tip || 'Source de données manquante' }, 'Source manquante');
    return null;
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Tooltip for [data-tip] (pills, notes)
  const tip = $('tip');
  function showTip(target) {
    const text = target.getAttribute('data-tip');
    if (!text) return;
    tip.textContent = text;
    tip.hidden = false;
    const r = target.getBoundingClientRect();
    const tw = Math.min(300, window.innerWidth - 24);
    let left = Math.min(Math.max(12, r.left), window.innerWidth - tw - 12);
    let top = r.bottom + 8;
    if (top + 80 > window.innerHeight) top = r.top - tip.offsetHeight - 8;
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
  // Filters UI
  // ---------------------------------------------------------------------------
  function renderFilters() {
    const sel = $('f-campaign');
    sel.replaceChildren(...state.campaigns.map((c) => el('option', { value: c.code, selected: c.code === state.campaign, disabled: !isReady(c) },
      isReady(c) ? `${c.name}${c.status === 'live' ? ' · en cours' : ''}` : `${c.name} · à configurer`)));
    const periods = periodOptions(currentCampaign());
    if (!periods.find((p) => p.id === state.period)) state.period = 'all';
    $('f-period').replaceChildren(...periods.map((p) => el('option', { value: p.id, selected: p.id === state.period }, p.label)));
    $('f-region').replaceChildren(...REGION_CHIPS.map((c) => el('button', {
      type: 'button', 'aria-pressed': String(c.id === state.regionChip), 'data-v': c.id,
      onclick: () => { state.regionChip = c.id; saveFilters(); renderFilters(); renderAll(); },
    }, c.slot ? el('i', { class: 'sw', style: `background: var(--series-${c.slot})` }) : null, c.label)));
    for (const [id, key] of [['f-compare', 'compare'], ['f-banner', 'banner']]) {
      for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === state[key]));
    }
  }
  $('f-campaign').addEventListener('change', (e) => { state.campaign = e.target.value; state.period = 'all'; saveFilters(); onCampaignChange(); });
  $('f-period').addEventListener('change', (e) => { state.period = e.target.value; saveFilters(); renderAll(); });
  for (const [id, key] of [['f-compare', 'compare'], ['f-banner', 'banner']]) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state[key] = b.dataset.v; saveFilters(); renderFilters(); renderAll();
    });
  }
  $('filters').addEventListener('submit', (e) => e.preventDefault());

  // Per-viewer convenience only.
  function saveFilters() {
    try { localStorage.setItem('report-filters', JSON.stringify({ campaign: state.campaign, period: state.period, compare: state.compare, regionChip: state.regionChip, banner: state.banner })); } catch (e) { /* storage unavailable */ }
  }
  function loadFilters() {
    try {
      const f = JSON.parse(localStorage.getItem('report-filters') || 'null');
      if (!f) return;
      if (state.campaigns.find((c) => c.code === f.campaign && isReady(c))) state.campaign = f.campaign;
      Object.assign(state, { period: f.period || 'all', compare: f.compare || 'prev', regionChip: f.regionChip || 'all', banner: f.banner || 'all' });
    } catch (e) { /* storage unavailable */ }
  }

  // ---------------------------------------------------------------------------
  // KPI tiles
  // ---------------------------------------------------------------------------
  function deltaNode(k, cur, cmp) {
    if (cur == null || cmp == null) return null;
    if (k.delta === 'pts') {
      const d = (cur - cmp) * 100;
      const cls = Math.abs(d) < 0.05 ? 'flat' : d > 0 ? 'up' : 'down';
      return el('span', { class: `delta ${cls}` }, `${d > 0 ? '▲' : d < 0 ? '▼' : '■'} ${nf1.format(Math.abs(d))} pts`);
    }
    if (!cmp) return el('span', { class: 'delta flat' }, 'Nouveau');
    const d = (cur - cmp) / Math.abs(cmp);
    const cls = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down';
    const txt = d >= 1 ? `×${nf1.format(cur / cmp)}` : `${nf1.format(Math.abs(d) * 100)} %`;
    return el('span', { class: `delta ${cls}` }, `${d > 0 ? '▲' : d < 0 ? '▼' : '■'} ${txt}`);
  }

  function kpiValues() {
    const camp = currentCampaign();
    const rg = currentRange();
    const regions = activeRegions();
    const res = state.results[camp?.code];
    return KPIS.map((k) => {
      const value = computeKpi(k, res, camp, rg, regions);
      const cmpInfo = camp && rg ? comparisonFor(k, camp, rg) : { na: '' };
      let cmp = null;
      if (!cmpInfo.na) cmp = computeKpi(k, cmpInfo.res, cmpInfo.camp, cmpInfo.rg, regions);
      return { k, value, cmp, cmpInfo, loaded: !!res };
    });
  }

  function scopeText(k, rg) {
    if (k.scope === 'campaign' && rg?.kind !== 'all') return 'Campagne complète';
    if (k.scope === 'stock') return 'À ce jour';
    if (k.noRegion && !allRegionsSelected()) return 'Toutes BU (non ventilé)';
    return null;
  }

  function renderTiles(values) {
    const rg = currentRange();
    const loadingQ = state.busy;
    for (const sec of ['audience', 'prix', 'mecaniques', 'commercial']) {
      const host = $(`tiles-${sec === 'mecaniques' ? 'meca' : sec === 'commercial' ? 'com' : sec}`);
      host.replaceChildren(...values.filter((v) => v.k.section === sec).map(({ k, value, cmp, cmpInfo, loaded }) => {
        const status = sourceStatus(k);
        const st = k.status ? k.status(value) : null;
        const valueText = value == null
          ? (k.missing ? 'Non disponible' : loaded || !loadingQ ? '—' : '…')
          : FMT[k.fmt](value);
        const scope = cmpInfo.na && k.scope !== 'period' ? null : scopeText(k, rg);
        let foot;
        if (k.missing) foot = [el('span', {}, 'En attente des données POS')];
        else if (cmpInfo.na) foot = [el('span', { class: 'scope' }, cmpInfo.na)];
        else if (value != null && cmp != null) foot = [deltaNode(k, value, cmp), el('span', {}, `${cmpInfo.label} (${FMT[k.fmt](cmp)})`)];
        else foot = [el('span', { class: 'scope' }, `${cmpInfo.label} : n/d`)];
        return el('article', { class: 'tile' },
          el('div', { class: 'tile-top' },
            el('span', { class: 'tile-label', 'data-tip': k.note || KPI_DEF[k.kpiRef || k.id]?.definition_fr || null, tabindex: 0 }, k.label),
            pillFor(status, k.note || KPI_DEF[k.kpiRef || k.id]?.source_fr)),
          el('div', { class: `tile-value${value == null ? ' na' : ''}` }, valueText),
          st ? el('span', { class: `pill ${st.cls}` }, st.label) : null,
          el('div', { class: 'tile-foot' }, ...foot, scope ? el('span', { class: 'scope' }, `· ${scope}`) : null));
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Charts (Apache ECharts 6)
  // ---------------------------------------------------------------------------
  const charts = {};
  const hasEcharts = () => typeof window.echarts !== 'undefined';
  function theme() {
    return {
      ink: cssVar('--ink'), ink2: cssVar('--ink-2'), muted: cssVar('--muted'), line: cssVar('--line'),
      lineStrong: cssVar('--line-strong'), surface: cssVar('--surface'), accent: cssVar('--accent'),
      seq: cssVar('--seq'), seqSoft: cssVar('--seq-soft'),
      s: [1, 2, 3, 4].map((i) => cssVar(`--series-${i}`)),
      warning: cssVar('--warning'), critical: cssVar('--critical'), good: cssVar('--good'),
      font: cssVar('--font-body') || 'system-ui',
    };
  }
  function baseOption(t, extra = {}) {
    return {
      animationDuration: 400,
      textStyle: { fontFamily: t.font, color: t.ink2 },
      grid: { left: 4, right: 12, top: 14, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis', confine: true,
        backgroundColor: t.surface, borderColor: t.line, borderWidth: 1,
        textStyle: { color: t.ink, fontSize: 12, fontFamily: t.font },
        axisPointer: { type: 'line', lineStyle: { color: t.lineStrong, width: 1 } },
        extraCssText: 'box-shadow: 0 6px 24px rgba(0,0,0,.14); border-radius: 8px;',
      },
      ...extra,
    };
  }
  const catAxis = (t, data, extra = {}) => ({
    type: 'category', data, axisLine: { lineStyle: { color: t.lineStrong } }, axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, hideOverlap: true }, ...extra,
  });
  const valAxis = (t, extra = {}) => ({
    type: 'value', splitLine: { lineStyle: { color: t.line } }, axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => compact.format(v) }, ...extra,
  });
  function tooltipRows(params, fmt = FMT.int) {
    const list = Array.isArray(params) ? params : [params];
    const head = list[0]?.axisValueLabel || list[0]?.name || '';
    const total = list.reduce((a, p) => a + (Number(p.value) || 0), 0);
    const rows = list.map((p) => `<div style="display:flex;justify-content:space-between;gap:16px"><span>${p.marker}${p.seriesName}</span><b style="font-variant-numeric:tabular-nums">${p.value == null ? '—' : fmt(p.value)}</b></div>`).join('');
    const tot = list.length > 1 ? `<div style="display:flex;justify-content:space-between;gap:16px;border-top:1px solid rgba(127,127,127,.3);margin-top:4px;padding-top:4px"><span>Total</span><b>${fmt(total)}</b></div>` : '';
    return `<div style="font-weight:600;margin-bottom:4px">${head}</div>${rows}${tot}`;
  }

  // A chart card: header, legend, plot, data table view.
  function chartCard(hostId, { title, note, legend, empty, table, height }) {
    const host = $(hostId);
    const plotId = `${hostId}-plot`;
    const children = [
      el('div', { class: 'chart-head' }, el('h3', {}, title), note ? el('p', { class: 'chart-note' }, note) : null),
    ];
    if (legend?.length) children.push(el('div', { class: 'legend' }, legend.map((l) => el('span', {}, el('i', { style: `background:${l.color}` }), l.label))));
    if (empty) {
      children.push(el('div', { class: 'empty' }, el('div', {}, el('strong', {}, empty.title), empty.body)));
      disposeChart(plotId);
    } else {
      children.push(el('div', { class: `chart${height === 'tall' ? ' tall' : ''}`, id: plotId, role: 'img', 'aria-label': title }));
      if (table) {
        children.push(el('details', { class: 'data-view' }, el('summary', {}, 'Voir les données'),
          el('div', { class: 'table-wrap mini-table' }, dataTable(table.cols, table.rows))));
      }
    }
    host.replaceChildren(...children);
    return empty ? null : plotId;
  }
  function dataTable(cols, rows) {
    return el('table', { class: 'data' },
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { class: c.num ? 'num' : null }, c.label)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => {
        const v = typeof c.get === 'function' ? c.get(r) : r[c.key];
        return el('td', { class: c.num ? 'num' : null }, v instanceof Node ? v : (v == null ? '—' : c.fmt ? c.fmt(v) : v));
      })))));
  }
  function disposeChart(id) { if (charts[id]) { charts[id].dispose(); delete charts[id]; } }
  function drawChart(id, option) {
    if (!id) return;
    const node = $(id);
    if (!node) return;
    if (!hasEcharts()) {
      node.replaceChildren(el('div', { class: 'empty' }, el('div', {}, el('strong', {}, 'Graphique indisponible'), 'La librairie de graphiques n\'a pas pu être chargée. Les données restent consultables dans le tableau ci-dessous.')));
      return;
    }
    disposeChart(id);
    const chart = window.echarts.init(node, null, { renderer: 'svg' });
    chart.setOption(option);
    charts[id] = chart;
    resizeObserver.observe(node);
  }
  const resizeObserver = new ResizeObserver((entries) => {
    for (const e of entries) charts[e.target.id]?.resize();
  });

  // Horizontal bars: reserve room for category labels so long names never clip.
  function hbar(t, labels, right = 56) {
    const longest = Math.max(0, ...labels.map((l) => String(l).length));
    const left = Math.round(Math.min(230, longest * 7.4 + 14));
    return { grid: { left, right, top: 6, bottom: 22, containLabel: false }, label: { color: t.ink2, fontSize: 12, width: left - 12, overflow: 'truncate' } };
  }
  const noData = (what) => ({ title: 'Pas encore de données', body: `${what} s'affichera après la première actualisation.` });

  function daysOfCampaign(c) {
    const out = [];
    for (let d = c.start; d <= c.end; d = addDays(d, 1)) out.push(d);
    return out;
  }
  function periodMarkArea(t, days, rg) {
    if (!rg || rg.kind === 'all') return undefined;
    return { silent: true, itemStyle: { color: t.accent, opacity: 0.08 }, data: [[{ xAxis: fmtDay(rg.d0) }, { xAxis: fmtDay(rg.d1) }]] };
  }

  function renderCharts() {
    const t = theme();
    const camp = currentCampaign();
    const res = state.results[camp?.code] || {};
    const regions = activeRegions();
    const rg = currentRange();
    const ready = isReady(camp);
    const days = ready ? daysOfCampaign(camp) : [];
    const labels = days.map(fmtDay);
    const regionsShown = REGION_ORDER.filter((r) => regions.includes(r));
    const regionLegend = regionsShown.map((r) => ({ label: `${r} · ${REGION_LABEL[r]}`, color: t.s[REGION_SLOT[r] - 1] }));

    // Active players per day, stacked by region
    {
      const rows = res.q01?.rows;
      const id = chartCard('card-active', {
        title: 'Joueurs actifs par jour', note: 'Par BU · empilé', legend: regionLegend,
        empty: rows ? null : noData('La courbe des joueurs actifs'),
        table: rows && { cols: [{ label: 'Jour', key: 'day' }, { label: 'BU', key: 'region_code' }, { label: 'Joueurs actifs', key: 'active_players', num: true, fmt: FMT.int }, { label: 'Parties', key: 'games_played', num: true, fmt: FMT.int }], rows: regionFilter(rows, regions) },
      });
      if (id) {
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
          xAxis: catAxis(t, labels, { boundaryGap: false }),
          yAxis: valAxis(t),
          series: regionsShown.map((r, i) => ({
            name: r, type: 'line', stack: 'all', symbol: 'none', smooth: 0.2,
            lineStyle: { width: 1.5, color: t.s[REGION_SLOT[r] - 1] },
            areaStyle: { color: t.s[REGION_SLOT[r] - 1], opacity: 0.82 },
            itemStyle: { color: t.s[REGION_SLOT[r] - 1] },
            data: days.map((d) => rows.find((x) => x.day === d && x.region_code === r)?.active_players ?? 0),
            markArea: i === 0 ? periodMarkArea(t, days, rg) : undefined,
          })),
        });
      }
    }

    // Signups per day, stacked bars by region
    {
      const rows = res.q01?.rows;
      const id = chartCard('card-signups', {
        title: 'Inscriptions par jour', note: 'Par BU', legend: regionLegend,
        empty: rows ? null : noData('Le graphique des inscriptions'),
        table: rows && { cols: [{ label: 'Jour', key: 'day' }, { label: 'BU', key: 'region_code' }, { label: 'Inscriptions', key: 'signups', num: true, fmt: FMT.int }], rows: regionFilter(rows, regions) },
      });
      if (id) {
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.4 } }, formatter: (p) => tooltipRows(p) },
          xAxis: catAxis(t, labels),
          yAxis: valAxis(t),
          series: regionsShown.map((r, i) => ({
            name: r, type: 'bar', stack: 'all', barMaxWidth: 14,
            itemStyle: { color: t.s[REGION_SLOT[r] - 1], borderColor: t.surface, borderWidth: 0.5, borderRadius: i === regionsShown.length - 1 ? [3, 3, 0, 0] : 0 },
            data: days.map((d) => rows.find((x) => x.day === d && x.region_code === r)?.signups ?? 0),
            markArea: i === 0 ? periodMarkArea(t, days, rg) : undefined,
          })),
        });
      }
    }

    // App downloads, campaign vs the same number of days before launch
    {
      const rows = res.q12?.rows;
      const legend = [{ label: 'App Couche-Tard', color: t.s[1] }, { label: 'App Circle K', color: t.s[0] }]
        .filter((l) => state.banner === 'all' || l.label.endsWith(state.banner));
      const id = chartCard('card-downloads', {
        title: "Téléchargements d'app par jour",
        note: 'iOS + Android · zone grise = même durée avant le lancement · non ventilé par BU',
        legend,
        empty: rows ? null : noData('Le graphique des téléchargements'),
        table: rows && { cols: [{ label: 'Jour', key: 'day' }, { label: 'Campagne', get: (r) => (r.in_campaign ? 'oui' : 'avant') }, { label: 'Couche-Tard iOS', key: 'couche_tard_ios', num: true, fmt: FMT.int }, { label: 'Couche-Tard Android', key: 'couche_tard_android', num: true, fmt: FMT.int }, { label: 'Circle K iOS', key: 'circle_k_ios', num: true, fmt: FMT.int }, { label: 'Circle K Android', key: 'circle_k_android', num: true, fmt: FMT.int }, { label: 'iOS via web (CT + CK)', get: (r) => (r.couche_tard_ios_web_referrer || 0) + (r.circle_k_ios_web_referrer || 0), num: true, fmt: FMT.int }], rows },
      });
      if (id) {
        const all = rows.map((r) => r.day);
        const ser = [];
        if (state.banner !== 'Circle K') ser.push({ name: 'App Couche-Tard', color: t.s[1], f: (r) => r.couche_tard_ios + r.couche_tard_android });
        if (state.banner !== 'Couche-Tard') ser.push({ name: 'App Circle K', color: t.s[0], f: (r) => r.circle_k_ios + r.circle_k_android });
        const launch = all.find((d) => d >= camp.start);
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
          xAxis: catAxis(t, all.map(fmtDay), { boundaryGap: false }),
          yAxis: valAxis(t),
          series: ser.map((s, i) => ({
            name: s.name, type: 'line', symbol: 'none', lineStyle: { width: 2, color: s.color }, itemStyle: { color: s.color },
            areaStyle: { color: s.color, opacity: 0.08 },
            data: rows.map(s.f),
            markArea: i === 0 && launch ? { silent: true, itemStyle: { color: t.muted, opacity: 0.08 }, data: [[{ xAxis: fmtDay(all[0]) }, { xAxis: fmtDay(addDays(launch, -1)) }]] } : undefined,
            markLine: i === 0 && launch ? { silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'dashed', width: 1 }, label: { formatter: 'Lancement', color: t.ink2, fontSize: 11 }, data: [{ xAxis: fmtDay(launch) }] } : undefined,
          })),
        });
      }
    }

    // Prizes won vs redeemed per day
    {
      const won = res.q05?.rows; const red = res.q11?.rows;
      const legend = [{ label: 'Prix gagnés', color: t.s[0] }, { label: 'Prix échangés (coupons activés)', color: t.s[1] }];
      const id = chartCard('card-prizes-daily', {
        title: 'Prix gagnés et échangés par jour', legend,
        empty: won && red ? null : noData('Le graphique des prix'),
        table: won && red && { cols: [{ label: 'Jour', key: 'day' }, { label: 'Gagnés', key: 'won', num: true, fmt: FMT.int }, { label: 'Échangés', key: 'red', num: true, fmt: FMT.int }], rows: days.map((d) => ({ day: d, won: sum(regionFilter(won, regions).filter((r) => r.day === d), 'won'), red: sum(regionFilter(red, regions, allRegionsSelected()).filter((r) => r.day === d), 'coupon_activations') })) },
      });
      if (id) {
        const redDays = [...days];
        for (let d = addDays(camp.end, 1); red.some((r) => r.day === d); d = addDays(d, 1)) redDays.push(d);
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, formatter: (p) => tooltipRows(p) },
          xAxis: catAxis(t, redDays.map(fmtDay), { boundaryGap: false }),
          yAxis: valAxis(t),
          series: [
            { name: 'Prix gagnés', type: 'line', symbol: 'none', lineStyle: { width: 2, color: t.s[0] }, itemStyle: { color: t.s[0] }, data: redDays.map((d) => (d <= camp.end ? sum(regionFilter(won, regions).filter((r) => r.day === d), 'won') : null)), markArea: periodMarkArea(t, days, rg) },
            { name: 'Prix échangés', type: 'line', symbol: 'none', lineStyle: { width: 2, color: t.s[1] }, itemStyle: { color: t.s[1] }, data: redDays.map((d) => sum(regionFilter(red, regions, allRegionsSelected()).filter((r) => r.day === d), 'coupon_activations')) },
          ],
        });
      }
    }

    // Grand prize entries by source
    {
      const rows = res.q06?.rows;
      const scoped = rows && rg ? daily(res, 'q06', rg, regions) : null;
      const src = [['entries_gameplay', 'Parties jouées'], ['entries_badge', 'Défis (badges)'], ['entries_bonus', 'Actions bonus'], ['entries_referral', 'Parrainage'], ['entries_other', 'Autres']]
        .map(([k, label]) => ({ label, v: scoped ? sum(scoped, k) : 0 })).filter((s) => s.v > 0);
      const id = chartCard('card-entries', {
        title: 'Participations au grand prix par source', note: rg?.kind === 'week' ? rg.label : 'Période sélectionnée',
        empty: rows ? null : noData('La répartition des participations'),
        table: rows && { cols: [{ label: 'Source', key: 'label' }, { label: 'Participations', key: 'v', num: true, fmt: FMT.int }], rows: src },
      });
      if (id) {
        const total = src.reduce((a, s) => a + s.v, 0);
        const hb = hbar(t, src.map((s) => s.label), 64);
        drawChart(id, {
          ...baseOption(t, { grid: hb.grid }),
          tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${FMT.int(p.value)} · ${FMT.pct(p.value / total)}` },
          xAxis: valAxis(t),
          yAxis: catAxis(t, src.map((s) => s.label), { inverse: true, axisLabel: hb.label }),
          series: [{ type: 'bar', barMaxWidth: 22, itemStyle: { color: t.seq, borderRadius: [0, 4, 4, 0] }, data: src.map((s) => s.v),
            label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p) => FMT.pct(p.value / total) } }],
        });
      }
    }

    // Pacing by partner
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
      const id = chartCard('card-pacing', {
        title: 'Rythme de distribution par partenaire',
        note: 'Prix distribués ÷ plan linéaire à date · bande = 90 à 110 % du plan',
        height: 'tall',
        empty: rows ? null : noData('Le rythme par partenaire'),
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
            { label: 'Statut', get: (r) => { const s = paceStatus(r.pace); return s ? el('span', { class: `pill ${s.cls}` }, s.label) : '—'; } },
          ],
          rows: parts,
        },
      });
      if (id) {
        const node = $(id).closest('.chart-card').querySelector('details');
        if (node) node.open = true;
        const hb = hbar(t, parts.map((p) => p.partner));
        drawChart(id, {
          ...baseOption(t, { grid: hb.grid }),
          tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: (p) => { const r = parts[p.dataIndex]; const s = paceStatus(r.pace); return `<b>${r.partner}</b><br>Rythme : ${FMT.pct(r.pace)} · ${s?.label || ''}<br>Distribués : ${FMT.int(r.net)} / plan ${FMT.int(r.planned)}<br>Restants : ${FMT.int(r.remaining)}`; } },
          xAxis: valAxis(t, { max: (v) => Math.max(1.2, Math.ceil(v.max * 10) / 10), axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => `${Math.round(v * 100)} %` } }),
          yAxis: catAxis(t, parts.map((p) => p.partner), { axisLabel: hb.label }),
          series: [{
            type: 'bar', barMaxWidth: 16, data: parts.map((p) => p.pace ?? 0),
            itemStyle: { color: t.seq, borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p) => `${Math.round(p.value * 100)} %` },
            markArea: { silent: true, itemStyle: { color: t.good, opacity: 0.1 }, data: [[{ xAxis: 0.9 }, { xAxis: 1.1 }]] },
            markLine: { silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'dashed', width: 1 }, label: { formatter: 'Plan', color: t.ink2, fontSize: 11 }, data: [{ xAxis: 1 }] },
          }],
        });
      }
    }

    // Bonus actions and badges: completion rate
    for (const [hostId, kind, title] of [['card-bonus', 'bonus_action', 'Actions bonus · taux de complétion'], ['card-badges', 'badge', 'Défis (badges) · taux de réussite']]) {
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
      const id = chartCard(hostId, {
        title, note: 'Joueurs ayant complété ÷ joueurs inscrits · campagne complète',
        empty: rows ? null : noData('Ce graphique'),
        table: rows && { cols: [{ label: 'Action', key: 'title' }, { label: 'Joueurs', key: 'players', num: true, fmt: FMT.int }, { label: 'Complétions', key: 'completions', num: true, fmt: FMT.int }, { label: 'Taux', key: 'rate', num: true, fmt: FMT.pct }], rows: items },
      });
      if (id) {
        const hb = hbar(t, items.map((i) => i.title));
        drawChart(id, {
          ...baseOption(t, { grid: hb.grid }),
          tooltip: { ...baseOption(t).tooltip, trigger: 'item', formatter: (p) => { const r = items[p.dataIndex]; return `<b>${r.title}</b><br>${FMT.pct(r.rate)} des joueurs<br>${FMT.int(r.players)} joueurs · ${FMT.int(r.completions)} complétions`; } },
          xAxis: valAxis(t, { axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => `${Math.round(v * 100)} %` } }),
          yAxis: catAxis(t, items.map((i) => i.title), { inverse: true, axisLabel: hb.label }),
          series: [{ type: 'bar', barMaxWidth: 16, itemStyle: { color: t.seq, borderRadius: [0, 4, 4, 0] }, data: items.map((i) => i.rate ?? 0),
            label: { show: true, position: 'right', color: t.ink2, fontSize: 11, formatter: (p) => FMT.pct(p.value) } }],
        });
      }
    }

    // Ads by partner
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
        parts = [...by.values()].map((p) => ({ ...p, rate: ratio(p.completed, p.impressions) })).sort((a, b) => b.impressions - a.impressions);
      }
      const legend = [{ label: 'Impressions', color: t.seqSoft }, { label: 'Vues uniques', color: t.seq }];
      const id = chartCard('card-ads', {
        title: 'Publicités par partenaire', note: 'Campagne complète · vues uniques = joueurs distincts par partenaire', legend,
        empty: rows ? null : noData('Le graphique des publicités'),
        table: rows && { cols: [{ label: 'Partenaire', key: 'partner' }, { label: 'Impressions', key: 'impressions', num: true, fmt: FMT.int }, { label: 'Vues uniques', key: 'unique', num: true, fmt: FMT.int }, { label: 'Vues complètes', key: 'completed', num: true, fmt: FMT.int }, { label: 'Taux de complétion', key: 'rate', num: true, fmt: FMT.pct }], rows: parts },
      });
      if (id) {
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.4 } }, formatter: (p) => { const r = parts[p[0].dataIndex]; return `<b>${r.partner}</b><br>Impressions : ${FMT.int(r.impressions)}<br>Vues uniques : ${FMT.int(r.unique)}<br>Vues complètes : ${FMT.int(r.completed)} (${FMT.pct(r.rate)})`; } },
          xAxis: catAxis(t, parts.map((p) => p.partner), { axisLabel: { color: t.ink2, fontSize: 12, interval: 0, hideOverlap: true } }),
          yAxis: valAxis(t),
          series: [
            { name: 'Impressions', type: 'bar', barGap: '8%', barMaxWidth: 26, itemStyle: { color: t.seqSoft, borderRadius: [4, 4, 0, 0] }, data: parts.map((p) => p.impressions) },
            { name: 'Vues uniques', type: 'bar', barMaxWidth: 26, itemStyle: { color: t.seq, borderRadius: [4, 4, 0, 0] }, data: parts.map((p) => p.unique) },
          ],
        });
      }
    }

    // Coupon activations per day
    {
      const rows = res.q11?.rows;
      const scoped = rows ? regionFilter(rows, regions, allRegionsSelected()) : null;
      const allDays = scoped ? [...new Set(scoped.map((r) => r.day))].sort() : [];
      const id = chartCard('card-coupons', {
        title: 'Coupons activés en magasin par jour', note: "Incluant la période d'échange après la fin du jeu",
        empty: rows ? null : noData('Le graphique des coupons'),
        table: rows && { cols: [{ label: 'Jour', key: 'day' }, { label: 'BU', key: 'region_code' }, { label: 'Coupons activés', key: 'coupon_activations', num: true, fmt: FMT.int }, { label: 'Clients', key: 'redeeming_users', num: true, fmt: FMT.int }], rows: scoped },
      });
      if (id) {
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.4 } }, formatter: (p) => tooltipRows(p) },
          xAxis: catAxis(t, allDays.map(fmtDay)),
          yAxis: valAxis(t),
          series: [{ name: 'Coupons activés', type: 'bar', barMaxWidth: 12, itemStyle: { color: t.seq, borderRadius: [3, 3, 0, 0] }, data: allDays.map((d) => sum(scoped.filter((r) => r.day === d), 'coupon_activations')),
            markLine: camp?.end ? { silent: true, symbol: 'none', lineStyle: { color: t.ink2, type: 'dashed', width: 1 }, label: { formatter: 'Fin du jeu', color: t.ink2, fontSize: 11 }, data: [{ xAxis: fmtDay(camp.end) }] } : undefined }],
        });
      }
    }

    // LIFT revenue per week
    {
      const rows = res.q10?.rows;
      const scoped = rows ? regionFilter(rows, regions) : null;
      const weeks = scoped ? [...new Set(scoped.map((r) => mondayOf(r.day)))].sort() : [];
      const agg = weeks.map((w) => { const s = scoped.filter((r) => mondayOf(r.day) === w); return { week: w, rev: sum(s, 'lift_revenue'), tx: sum(s, 'lift_transactions'), items: sum(s, 'items') }; });
      const id = chartCard('card-lift', {
        title: 'Revenus LIFT attribués au jeu, par semaine', note: 'Achats liés au numéro de téléphone saisi à la caisse',
        empty: rows ? null : noData('Le graphique LIFT'),
        table: rows && { cols: [{ label: 'Semaine du', get: (r) => fmtDay(r.week) }, { label: 'Revenus', key: 'rev', num: true, fmt: FMT.money2 }, { label: 'Transactions', key: 'tx', num: true, fmt: FMT.int }, { label: 'Panier moyen', get: (r) => ratio(r.rev, r.tx), num: true, fmt: FMT.money2 }], rows: agg },
      });
      if (id) {
        drawChart(id, {
          ...baseOption(t),
          tooltip: { ...baseOption(t).tooltip, axisPointer: { type: 'shadow', shadowStyle: { color: t.line, opacity: 0.4 } }, formatter: (p) => { const r = agg[p[0].dataIndex]; return `<b>Semaine du ${fmtDay(r.week)}</b><br>Revenus : ${FMT.money2(r.rev)}<br>Transactions : ${FMT.int(r.tx)}<br>Panier moyen : ${FMT.money2(ratio(r.rev, r.tx) || 0)}`; } },
          xAxis: catAxis(t, weeks.map(fmtDay)),
          yAxis: valAxis(t, { axisLabel: { color: t.muted, fontSize: 11, formatter: (v) => `${compact.format(v)} $` } }),
          series: [{ name: 'Revenus', type: 'bar', barMaxWidth: 34, itemStyle: { color: t.seq, borderRadius: [4, 4, 0, 0] }, data: agg.map((a) => a.rev) }],
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Section subtitles, definitions, freshness
  // ---------------------------------------------------------------------------
  function renderSubtitles() {
    const rg = currentRange();
    const regions = activeRegions();
    const scope = regions.length === REGION_ORDER.length ? 'toutes les BU' : regions.map((r) => `${r} · ${REGION_LABEL[r]}`).join(', ');
    const txt = rg ? `${rg.kind === 'all' ? 'Campagne complète' : rg.label} · ${scope}` : '';
    for (const id of ['sub-audience', 'sub-prix', 'sub-meca', 'sub-com']) $(id).textContent = txt;
  }
  function renderDefinitions() {
    const label = { available: 'Disponible', partial: 'Partiel', missing: 'Source manquante' };
    $('def-table').replaceChildren(
      el('thead', {}, el('tr', {}, ['KPI', 'Définition', 'Source', 'État'].map((h) => el('th', {}, h)))),
      el('tbody', {}, DATA.kpis.map((k) => el('tr', {},
        el('td', {}, k.label_fr),
        el('td', {}, k.definition_fr || '—'),
        el('td', {}, k.source_fr || '—'),
        el('td', {}, k.status === 'available' ? label.available : pillFor(k.status, k.source_fr))))));
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
      text.textContent = p ? `Actualisation en cours · ${p.done} / ${p.total} requêtes` : 'Actualisation en cours…';
      return;
    }
    if (meta?.refreshedAt) {
      dot.classList.add(camp?.status === 'live' ? 'live' : 'stale');
      text.textContent = `Données au ${stampFmt.format(new Date(meta.refreshedAt))}${meta.partial ? ' · partielles' : ''}`;
    } else if (state.results[camp?.code]) {
      text.textContent = 'Données chargées';
    } else {
      text.textContent = caps.mcp ? 'Aucune donnée publiée · lancez une actualisation' : 'Aucune donnée publiée pour cette campagne';
    }
    $('campaign-title').textContent = camp ? camp.name : 'Minijeux';
  }
  function setPageMsg(html) {
    const node = $('page-msg');
    if (!html) { node.hidden = true; node.replaceChildren(); return; }
    node.hidden = false;
    node.innerHTML = html;
  }

  const NO_REGION_MSG = '<strong>Aucune BU ne correspond à ces filtres.</strong> Le Québec est la seule BU Couche-Tard ; choisissez une autre bannière ou une autre BU.';
  let regionMsgShown = false;
  function renderAll() {
    renderSubtitles();
    renderFreshness();
    renderTiles(kpiValues());
    renderCharts();
    const anyData = !!state.results[state.campaign];
    $('btn-export-kpi').hidden = !(caps.downloads && anyData);
    $('btn-export-data').hidden = !(caps.downloads && anyData);
    if (!activeRegions().length) { setPageMsg(NO_REGION_MSG); regionMsgShown = true; }
    else if (regionMsgShown) { setPageMsg(null); regionMsgShown = false; }
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
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    const chip = REGION_CHIPS.find((c) => c.id === state.regionChip);
    return { period: rg?.label || '', bu: chip?.label || '', banner: state.banner === 'all' ? 'Toutes' : state.banner };
  }
  async function save(filename, data) {
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
    for (const { k, value, cmp, cmpInfo } of kpiValues()) {
      const variation = value != null && cmp != null ? (k.delta === 'pts' ? `${((value - cmp) * 100).toFixed(1)} pts` : cmp ? `${(((value - cmp) / Math.abs(cmp)) * 100).toFixed(1)} %` : '') : '';
      rows.push([camp.name, f.period, f.bu, f.banner, sections[k.section], k.label, value, cmpInfo.na ? 'n/d' : cmpInfo.label, cmp, variation.replace('.', ','), scopeText(k, currentRange()) || 'Période sélectionnée', { available: 'Disponible', partial: 'Partiel', missing: 'Source manquante' }[sourceStatus(k)], k.note || '', asOf]);
    }
    save(`kpi-${camp.code}-${state.period}-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
  });
  $('btn-export-data').addEventListener('click', () => {
    const camp = currentCampaign();
    const res = state.results[camp.code] || {};
    const dims = ['campaign', 'day', 'week_start', 'region_code', 'partner', 'prize_fr', 'promotion_id', 'kind', 'key', 'title_fr', 'in_campaign'];
    const rows = [['jeu_de_donnees', 'jour_ou_semaine', 'bu', 'partenaire', 'element', 'mesure', 'valeur']];
    for (const qid of Object.keys(DATA.queries)) {
      for (const r of res[qid]?.rows || []) {
        for (const [m, v] of Object.entries(r)) {
          if (dims.includes(m) || v == null || typeof v !== 'number') continue;
          rows.push([DATA.queries[qid].file.replace('.sql', ''), r.day || r.week_start || '', r.region_code || '', r.partner || '', r.prize_fr || r.title_fr || r.key || '', m, v]);
        }
      }
    }
    save(`donnees-${camp.code}-${new Date().toISOString().slice(0, 10)}.csv`, csv(rows));
  });

  // ---------------------------------------------------------------------------
  // Theme changes redraw charts with the new tokens
  // ---------------------------------------------------------------------------
  let themeTimer = null;
  const redraw = () => { clearTimeout(themeTimer); themeTimer = setTimeout(renderCharts, 60); };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', redraw);
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // ---------------------------------------------------------------------------
  // Boot: render at rest, then light up capabilities as they resolve
  // ---------------------------------------------------------------------------
  loadFilters();
  renderFilters();
  renderDefinitions();
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
    if (!db && !mcp) setPageMsg("Ouvrez ce rapport dans claude.ai pour voir les données publiées. Les définitions des KPI restent consultables plus bas.");
    if (mcp && caps.canWrite) {
      setInterval(() => { if (currentCampaign()?.status === 'live' && !document.hidden) refresh(); }, LIVE_REFRESH_MS);
    }
  }
  boot();
})();
