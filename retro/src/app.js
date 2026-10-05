(() => {
  'use strict';
  const DATA = JSON.parse(document.getElementById('retro-data').textContent);
  const H = DATA['harvest-ctrpp'];
  const J = DATA['jira-rppprev'];
  const C = DATA['campagne-rpp-2026'];

  // ---------------------------------------------------------------------------
  // Formatting and DOM helpers
  // ---------------------------------------------------------------------------
  const nf = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('fr-CA', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const pct0 = (v) => `${nf.format(v * 100)} %`;
  const pct1 = (v) => `${nf1.format(v * 100)} %`;
  const dayFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const dayShort = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const fd = (iso) => dayFmt.format(new Date(`${iso}T00:00:00Z`));
  const fds = (iso) => dayShort.format(new Date(`${iso}T00:00:00Z`));
  const $ = (id) => document.getElementById(id);
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs = {}, ...kids) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    for (const c of kids.flat(Infinity)) if (c != null) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return n;
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 2600); }

  // ---------------------------------------------------------------------------
  // Derived facts (all from the data files, nothing typed by hand)
  // ---------------------------------------------------------------------------
  const weeks = Object.entries(H.by_week).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const after = (iso) => weeks.filter(([w]) => w > iso).reduce((a, [, h]) => a + h, 0);
  const hoursAfterEnd = after(H.planned_end);
  const peakWeek = weeks.reduce((m, w) => (w[1] > m[1] ? w : m), weeks[0]);
  const juneWeeks = weeks.filter(([w]) => w >= '2026-06-01' && w < '2026-07-01');
  const juneAvg = juneWeeks.reduce((a, [, h]) => a + h, 0) / juneWeeks.length;
  const taskTotal = Object.values(H.by_task).reduce((a, v) => a + v, 0);
  const share = (k) => (H.by_task[k] || 0) / taskTotal;
  const designShare = share('Design UIUX Frontend') + share('Design UIUX CMS');
  const bugs = J.types.Bug || 0;
  const julyBugs = J.bugs_by_month['2026-07'] || 0;
  const done = J.status.Done || 0;
  const s5 = J.sprints.find((s) => /5/.test(s.name));
  const s8 = J.sprints.find((s) => /8/.test(s.name));
  const perStore = Object.fromEntries(Object.keys(C.stores_by_region).map((r) => [r, C.unique_players_by_region[r] / C.stores_by_region[r]]));
  const REG = { ATL: 'Atlantique', QC: 'Québec', CC: 'Centre', WC: 'Ouest' };
  const hourPeak = C.games_by_hour.indexOf(Math.max(...C.games_by_hour));
  // First week whose cumulative hours exceed the budget.
  let cum = 0;
  const overWeek = (weeks.find(([, h]) => (cum += h) > H.budget_hours) || [null])[0];

  // ---------------------------------------------------------------------------
  // Small inline charts (SVG, theme colors through CSS variables)
  // ---------------------------------------------------------------------------
  function hoursChart(story) {
    const W = 420; const Hh = 120; const max = Math.max(...weeks.map((w) => w[1]));
    const bw = W / weeks.length;
    const fill = story ? 'currentColor' : 'var(--chart)';
    const xOf = (iso) => { const i = weeks.findIndex(([w]) => w > iso) - 1; return Math.max(0, i) * bw + bw / 2; };
    const g = svg('svg', { viewBox: `0 -14 ${W} ${Hh + 30}`, role: 'img', 'aria-label': 'Heures saisies par semaine' },
      weeks.map(([w, h], i) => svg('rect', { x: i * bw + 1, y: Hh - (h / max) * Hh, width: bw - 2, height: Math.max(1, (h / max) * Hh), rx: 2, style: `fill:${fill};opacity:${w > H.planned_end ? 0.45 : 0.95}` })),
      [[H.planned_end, 'Fin prévue'], [C.play_start, 'Lancement']].map(([d, l], k) => [
        svg('line', { x1: xOf(d), x2: xOf(d), y1: -6 + k * 12, y2: Hh, style: `stroke:${story ? 'currentColor' : 'var(--mark)'};stroke-width:1;stroke-dasharray:3 3` }),
        svg('text', { x: xOf(d) + (k ? 4 : -4), y: -8 + k * 12, 'text-anchor': k ? 'start' : 'end', class: 'lab' }, l),
      ]),
      svg('text', { x: 0, y: Hh + 16 }, fds(weeks[0][0])),
      svg('text', { x: W, y: Hh + 16, 'text-anchor': 'end' }, fds(weeks[weeks.length - 1][0])));
    return el('div', { class: 'viz' }, g);
  }
  function hbars(rows, { story, fmt, highlight } = {}) {
    const W = 420; const rowH = 22; const labW = 96; const max = Math.max(...rows.map((r) => r.v));
    const g = svg('svg', { viewBox: `0 0 ${W} ${rows.length * rowH}`, role: 'img' },
      rows.map((r, i) => [
        svg('text', { x: 0, y: i * rowH + 14, class: 'lab' }, r.label),
        svg('rect', { x: labW, y: i * rowH + 4, width: Math.max(2, ((W - labW - 64) * r.v) / max), height: 12, rx: 6, style: `fill:${story ? 'currentColor' : 'var(--chart)'};opacity:${highlight && highlight !== r.key ? 0.4 : 1}` }),
        svg('text', { x: W, y: i * rowH + 14, 'text-anchor': 'end', class: 'val' }, fmt(r.v)),
      ]));
    return el('div', { class: 'viz' }, g);
  }
  function stackBar(story) {
    const parts = [['Développement', share('Developpement')], ['Gestion', share('Gestion de projet')], ['Design', designShare], ['QA', share('QA')], ['Autres', share('Conception') + share('Onboarding')]];
    const W = 420; let x = 0;
    const op = [1, 0.7, 0.5, 0.95, 0.3];
    const g = svg('svg', { viewBox: `0 0 ${W} 54`, role: 'img', 'aria-label': 'Répartition des heures' },
      parts.map(([l, v], i) => { const w = W * v; const r = svg('rect', { x, y: 0, width: Math.max(1, w - 2), height: 18, rx: 3, style: `fill:${i === 3 ? (story ? 'currentColor' : 'var(--projet)') : (story ? 'currentColor' : 'var(--chart)')};opacity:${op[i]}` }); x += w; return r; }),
      (() => { let xx = 0; return parts.map(([l, v], i) => { const t = svg('text', { x: Math.min(xx, W - 60), y: 34 + (i % 2) * 14, class: 'lab' }, `${l} ${pct0(v)}`); xx += W * v; return t; }); })());
    return el('div', { class: 'viz' }, g);
  }

  // ---------------------------------------------------------------------------
  // Findings: number -> what it means -> proposal (proposals are suggestions)
  // ---------------------------------------------------------------------------
  const F = [
    { id: 'budget', sec: 'projet', k: 'Budget', big: `+${pct0(H.total_hours / H.budget_hours - 1)}`, unit: "d'heures au-delà du budget",
      mean: `<b>${nf.format(H.total_hours)} h</b> saisies pour <b>${nf.format(H.budget_hours)} h</b> prévues au forfait, soit ${nf.format(H.total_hours - H.budget_hours)} h de plus. Le budget a été dépassé <b>la semaine du ${fd(overWeek)}</b>. L'alerte Harvest est réglée à ${H.over_budget_alert_pct} % (dernière notification : ${fd(H.over_budget_alert_date)}).`,
      prop: 'Régler les alertes Harvest à 70 % et 90 %, et revoir le budget chaque semaine pendant le développement.', src: 'Harvest · projet CTRPP' },
    { id: 'calendar', sec: 'projet', k: 'Calendrier', big: `${nf.format(hoursAfterEnd)} h`, unit: 'après la date de fin prévue',
      mean: `La fin était prévue le <b>${fd(H.planned_end)}</b>. Le lancement a eu lieu le ${fd(C.play_start)}, et <b>${pct0(hoursAfterEnd / H.total_hours)} des heures</b> ont été faites après la date de fin prévue.`,
      prop: 'Budgéter explicitement la période de campagne en cours (support, correctifs, suivi) au lieu de la traiter comme un dépassement.', src: 'Harvest · heures par semaine', viz: hoursChart },
    { id: 'rush', sec: 'projet', k: 'Rush de lancement', big: `${nf.format(peakWeek[1])} h`, unit: `la semaine du ${fd(peakWeek[0])}`,
      mean: `C'est <b>${nf1.format(peakWeek[1] / juneAvg)} fois</b> la moyenne de juin (${nf.format(juneAvg)} h par semaine). Le ${s5.name.toLowerCase()} a duré <b>${s5.days} jours</b> au lieu de 14 et s'est fermé le jour du lancement.`,
      prop: 'Geler les fonctionnalités 2 semaines avant le lancement, et garder des sprints de durée fixe.', src: 'Harvest · Jira RPPREV' },
    { id: 'quality', sec: 'projet', k: 'Qualité', big: pct1(share('QA')), unit: 'des heures en QA',
      mean: `${nf.format(H.by_task.QA)} h de QA sur ${nf.format(taskTotal)} h, pour <b>${bugs} bogues</b>, dont <b>${julyBugs} (${pct0(julyBugs / bugs)})</b> ouverts en juillet, le mois du lancement.`,
      prop: 'Prévoir la QA dès juin (10 à 15 % des heures de développement) et un sprint de stabilisation avant le lancement.', src: 'Harvest · Jira RPPREV' },
    { id: 'split', sec: 'projet', k: 'Où sont allées les heures', big: pct0(share('Developpement')), unit: 'en développement',
      mean: `Gestion de projet <b>${pct0(share('Gestion de projet'))}</b>, design <b>${pct0(designShare)}</b>, QA <b>${pct1(share('QA'))}</b>. ${H.people} personnes ont saisi du temps sur le projet.`,
      prop: 'Utiliser cette répartition réelle comme base d’estimation pour la prochaine édition (31DOCK).', src: 'Harvest · heures par tâche', viz: stackBar },
    { id: 'velocity', sec: 'projet', k: "Vélocité de l'équipe", big: `${nf1.format(H.total_hours / done)} h`, unit: 'par ticket terminé, en moyenne',
      mean: `${done} tickets terminés en ${J.sprints.length} sprints. Mais <b>${J.bulk_close.tickets} tickets ont été fermés en ${J.bulk_close.window_minutes} minutes le ${fd(J.bulk_close.date)}</b>, et seuls <b>${pct0(J.with_points / J.issues)} des tickets</b> ont des points : la vélocité réelle par sprint n'est pas mesurable de façon fiable.`,
      prop: `Estimer tous les tickets, les fermer au fil de l'eau, et tenir des sprints de 2 semaines (le ${s5.name.toLowerCase()} a duré ${s5.days} jours, le ${s8.name.toLowerCase()} ${s8.days}).`, src: 'Jira RPPREV · Harvest',
      viz: (story) => hbars(J.sprints.map((s) => ({ key: s.name, label: s.name.replace(/^sprint/i, 'Sprint'), v: s.done / (s.days / 7) })), { story, fmt: (v) => `${nf1.format(v)} / sem.` }) },
    { id: 'trace', sec: 'projet', k: 'Traçabilité', big: '0', unit: 'heure reliée à un ticket Jira',
      mean: `Aucune des ${nf.format(H.entries)} saisies Harvest ne pointe vers un ticket, et <b>${pct0(J.unassigned / J.issues)} des tickets</b> n'ont pas de responsable. Impossible de savoir combien a coûté chaque fonctionnalité.`,
      prop: "Activer l'intégration Harvest–Jira et rendre le responsable obligatoire sur chaque ticket.", src: 'Harvest · Jira RPPREV' },

    { id: 'atlantic', sec: 'campagne', k: 'Pénétration régionale', big: nf.format(perStore.ATL), unit: 'joueurs par magasin en Atlantique',
      mean: `Contre <b>${nf.format(perStore.QC)}</b> au Québec, ${nf.format(perStore.WC)} dans l'Ouest et ${nf.format(perStore.CC)} au Centre. L'Atlantique a ${pct0(C.stores_by_region.ATL / Object.values(C.stores_by_region).reduce((a, v) => a + v, 0))} des magasins, mais ${pct0(C.unique_players_by_region.ATL / Object.values(C.unique_players_by_region).reduce((a, v) => a + v, 0))} des joueurs.`,
      prop: 'Activation ciblée en Atlantique (média local, promotion en magasin) : c’est le plus gros potentiel de croissance.', src: `MCP Couche-Tard · ${C.stores_note}`,
      viz: (story) => hbars(Object.keys(REG).map((r) => ({ key: r, label: REG[r], v: perStore[r] })).sort((a, b) => b.v - a.v), { story, fmt: (v) => nf.format(v), highlight: 'ATL' }) },
    { id: 'inventory', sec: 'campagne', k: 'Inventaire de prix', big: pct0(C.prize_remaining / C.prize_inventory), unit: 'des prix jamais distribués',
      mean: `<b>${nf.format(C.prize_remaining)}</b> prix sur ${nf.format(C.prize_inventory)}. <b>${C.partners_under_plan} partenaires sur ${C.partners_total}</b> sont restés sous le plan de distribution.`,
      prop: "Réduire l'inventaire initial et le réallouer entre partenaires en cours de campagne.", src: 'MCP Couche-Tard · sql/kpi/04' },
    { id: 'redeem', sec: 'campagne', k: 'Échange en magasin', big: pct0(C.funnel.redeemed_prize / C.funnel.won_prize), unit: 'des gagnants échangent leur prix',
      mean: `<b>${nf.format(C.funnel.redeemed_prize)}</b> joueurs ont échangé au moins un prix, sur ${nf.format(C.funnel.won_prize)} gagnants. Chaque prix non échangé est une visite en magasin qui n'a pas eu lieu.`,
      prop: "Rappel avant l'expiration du prix et délai d'échange plus long.", src: 'MCP Couche-Tard · sql/kpi/13' },
    { id: 'gifts', sec: 'campagne', k: 'Prix offerts à un ami', big: pct0(C.gifts.expired / C.gifts.sent), unit: 'expirent sans être réclamés',
      mean: `<b>${nf.format(C.gifts.expired)}</b> des ${nf.format(C.gifts.sent)} prix offerts à un ami n'ont jamais été réclamés.`,
      prop: "Rappel automatique à l'ami, ou réclamation possible sans créer de compte.", src: 'MCP Couche-Tard · sql/kpi/15' },
    { id: 'retention', sec: 'campagne', k: 'Rétention', big: pct0(C.retention_d30.launch_week), unit: 'des joueurs du lancement rejouent 30 jours après',
      mean: `Contre <b>${pct0(C.retention_d30.late_week)}</b> pour ceux arrivés la semaine du ${C.retention_d30.late_week_label}. Les joueurs du lancement sont deux fois plus fidèles.`,
      prop: 'Concentrer l’acquisition sur le lancement et relancer plus tôt les joueurs arrivés en cours de route.', src: 'MCP Couche-Tard · sql/kpi/14' },
    { id: 'checkout', sec: 'campagne', k: 'Lien avec les ventes', big: pct1(C.checkout_action.share), unit: 'des joueurs ont donné leur numéro à la caisse',
      mean: `${nf.format(C.checkout_action.players)} joueurs. C'est l'action qui relie le jeu aux ventes LIFT : tant qu'elle reste marginale, l'impact sur les ventes reste invisible.`,
      prop: 'Rendre l’action caisse plus visible et mieux récompensée.', src: 'MCP Couche-Tard · sql/kpi/07' },
    { id: 'hours', sec: 'campagne', k: 'Quand ils jouent', big: hourPeak === 0 ? 'Minuit' : `${hourPeak} h`, unit: "l'heure la plus jouée",
      mean: `<b>${nf.format(C.games_by_hour[hourPeak])}</b> parties entre minuit et 1 h (heure de l'Est), puis un plateau de 7 h à 10 h.`,
      prop: 'Envoyer les notifications vers 7 h, et prévoir la charge serveur pour minuit.', src: 'MCP Couche-Tard · sql/kpi/16',
      viz: (story) => { const W = 420; const Hh = 60; const m = Math.max(...C.games_by_hour); const bw = W / 24;
        return el('div', { class: 'viz' }, svg('svg', { viewBox: `0 0 ${W} ${Hh + 16}`, role: 'img', 'aria-label': 'Parties par heure' },
          C.games_by_hour.map((v, h) => svg('rect', { x: h * bw + 1, y: Hh - (v / m) * Hh, width: bw - 2, height: (v / m) * Hh, rx: 2, style: `fill:${story ? 'currentColor' : 'var(--chart)'};opacity:${h === hourPeak ? 1 : 0.55}` })),
          [0, 6, 12, 18, 23].map((h) => svg('text', { x: h * bw + bw / 2, y: Hh + 13, 'text-anchor': 'middle' }, `${h} h`)))); } },
    { id: 'spike', sec: 'campagne', k: 'Anomalie à expliquer', big: `×${nf1.format(C.spike.prizes_won / C.spike.median_day)}`, unit: `prix gagnés le ${fd(C.spike.day)}`,
      mean: `<b>${nf.format(C.spike.prizes_won)}</b> prix gagnés ce jour-là, contre ${nf.format(C.spike.median_day)} un jour normal.`,
      prop: 'Identifier la cause (événement, configuration ou bogue) avant la prochaine édition.', src: 'MCP Couche-Tard · sql/kpi/05' },
  ];
  const SEC = { projet: 'Le projet', campagne: 'La campagne' };

  // ---------------------------------------------------------------------------
  // Document view
  // ---------------------------------------------------------------------------
  $('lede').textContent = `${F.length} constats tirés de Jira, Harvest et des données du jeu. Pour chacun : le chiffre, ce qu'il veut dire, et notre proposition pour la prochaine édition.`;
  $('sources').append(
    el('span', {}, el('b', {}, 'Jira '), `${J.project} · ${J.issues} tickets`),
    el('span', {}, el('b', {}, 'Harvest '), `${H.code} · ${nf.format(H.total_hours)} h, ${H.entries} saisies`),
    el('span', {}, el('b', {}, 'Jeu '), `${C.campaign} · MCP Couche-Tard`),
    el('span', {}, `Données au ${fd(C.source_as_of)} 2026`));
  for (const sec of ['projet', 'campagne']) {
    $(`cards-${sec}`).replaceChildren(...F.filter((f) => f.sec === sec).map((f) => el('article', { class: 'card', id: `f-${f.id}` },
      el('div', { class: 'c-num' }, el('span', { class: 'k' }, f.k), el('span', { class: 'big' }, f.big), el('span', { class: 'unit' }, f.unit)),
      el('div', { class: 'c-mean' }, el('p', { html: f.mean }), f.viz ? f.viz(false) : null, el('p', { class: 'src' }, `Source : ${f.src}`)),
      el('div', { class: 'c-prop' }, el('span', { class: 'lbl' }, 'Proposition'), el('p', {}, f.prop)))));
  }
  $('foot').textContent = "Document interne. Chiffres d'équipe uniquement (aucune donnée par personne). Les propositions sont des recommandations à valider en rétro.";

  // ---------------------------------------------------------------------------
  // Shared action plan (db): plan/rpp-2026 = { items: { <id>: { status } } }
  // ---------------------------------------------------------------------------
  const STATUS = [['discuter', 'À discuter'], ['retenue', 'Retenue'], ['ecartee', 'Écartée']];
  const plan = { items: {}, db: null, canWrite: false, saving: false };
  const statusOf = (id) => plan.items[id]?.status || 'discuter';
  function renderPlan() {
    const counts = Object.fromEntries(STATUS.map(([v]) => [v, F.filter((f) => statusOf(f.id) === v).length]));
    $('plan-count').replaceChildren(...STATUS.map(([v, l]) => el('span', {}, el('b', {}, counts[v]), l.toLowerCase())));
    $('plan-list').replaceChildren(...F.map((f, i) => el('li', { class: statusOf(f.id) },
      el('span', { class: 'n' }, String(i + 1).padStart(2, '0')),
      el('div', { class: 't' }, f.prop, el('small', {}, `${SEC[f.sec]} · ${f.k} · `, el('a', { href: `#f-${f.id}` }, 'voir le constat'))),
      el('div', { class: 'status', role: 'group', 'aria-label': `Statut : ${f.k}`, 'aria-disabled': plan.canWrite ? null : 'true' },
        STATUS.map(([v, l]) => el('button', { type: 'button', 'data-v': v, 'aria-pressed': String(statusOf(f.id) === v), disabled: !plan.canWrite, onclick: () => setStatus(f.id, v) }, l))))));
    $('plan-sub').textContent = plan.db
      ? (plan.canWrite ? "Statut partagé avec l'équipe : changez-le pendant la rétro." : 'Statut partagé avec l’équipe (lecture seule pour vous).')
      : 'Ouvrez cette page dans claude.ai pour partager les statuts avec l’équipe.';
  }
  async function setStatus(id, v) {
    if (!plan.canWrite || statusOf(id) === v) return;
    plan.items = { ...plan.items, [id]: { status: v } };
    renderPlan();
    if (!plan.db) return;
    try { await plan.db.doc('plan/rpp-2026').set({ items: plan.items }); }
    catch (e) { if (e?.code === 'invalid_argument') { plan.canWrite = false; renderPlan(); } toast("Le statut n'a pas pu être enregistré."); }
  }
  function planMarkdown() {
    const lines = ['# Plan d’action — prochaine édition (tiré de RPP 2026)', ''];
    for (const [v, l] of STATUS) {
      const items = F.filter((f) => statusOf(f.id) === v);
      if (!items.length) continue;
      lines.push(`## ${l} (${items.length})`, '');
      for (const f of items) lines.push(`- [ ] ${f.prop}`, `  - Constat : ${f.big} ${f.unit} (${f.src})`);
      lines.push('');
    }
    return lines.join('\n');
  }
  $('btn-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(planMarkdown()); toast('Plan copié en Markdown.'); }
    catch (e) { toast('Copie impossible ici : utilisez Télécharger.'); }
  });
  let downloads = null;
  $('btn-md').addEventListener('click', async () => {
    try { await downloads.save({ filename: 'plan-action-rpp-2026.md', data: planMarkdown() }); }
    catch (e) { if (e?.code !== 'declined') toast("Le fichier n'a pas pu être préparé."); }
  });

  // ---------------------------------------------------------------------------
  // Story mode
  // ---------------------------------------------------------------------------
  const PAL = {
    projet: [{ bg: '#14161c', ink: '#fbfaf7', acc: '#2a2116' }, { bg: '#ff6a2b', ink: '#14161c', acc: '#ff8a55', light: true }],
    campagne: [{ bg: '#2648f0', ink: '#fbfaf7', acc: '#3d5ff5' }, { bg: '#ffc93c', ink: '#14161c', acc: '#ffd970', light: true }],
  };
  const MOTIFS = ['disc', 'ring', 'stripes'];
  const screens = [
    { intro: true, bg: '#14161c', ink: '#fbfaf7', acc: '#ff6a2b' },
    ...F.map((f, i) => ({ f, ...PAL[f.sec][i % 2], motif: MOTIFS[i % 3] })),
    { outro: true, bg: '#0f8a5f', ink: '#fbfaf7', acc: '#139e6d' },
  ];
  const STORY_MS = 9000;
  const st = { i: 0, paused: false, t0: 0, elapsed: 0, raf: 0, last: null };
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function screenNode(s, i) {
    const n = el('section', { class: `scr${s.light ? ' light' : ''}`, style: `--s-bg:${s.bg};--s-ink:${s.ink};--s-acc:${s.acc}`, 'aria-label': `Écran ${i + 1} sur ${screens.length}` },
      el('div', { class: `motif ${s.motif || 'disc'}` }));
    if (s.intro) {
      n.append(el('div', { class: 'sect rise' }, 'Bilan interne'), el('div', { class: 'big rise d1', style: 'font-size:clamp(46px,13vw,64px)' }, 'Ce que RPP 2026 nous apprend'),
        el('p', { class: 'mean rise d2' }, `${F.length} constats : ${F.filter((f) => f.sec === 'projet').length} sur le projet, ${F.filter((f) => f.sec === 'campagne').length} sur la campagne. Pour chacun, une proposition pour la prochaine édition.`));
    } else if (s.outro) {
      const ret = F.filter((f) => statusOf(f.id) === 'retenue').length;
      n.append(el('div', { class: 'sect rise' }, "Plan d'action"), el('div', { class: 'big rise d1' }, String(F.length)), el('div', { class: 'unit rise d1' }, 'propositions à trancher en rétro'),
        el('p', { class: 'mean rise d2' }, ret ? `${ret} déjà retenue${ret > 1 ? 's' : ''}.` : 'Aucune n’est encore retenue.'),
        el('div', { class: 'cta rise d3' }, el('button', { type: 'button', onclick: (e) => { e.stopPropagation(); closeStory(); location.hash = 'plan'; } }, 'Ouvrir le plan')));
    } else {
      const f = s.f;
      n.append(el('div', { class: 'sect rise' }, `${SEC[f.sec]} · ${f.k}`), el('div', { class: 'big rise d1' }, f.big), el('div', { class: 'unit rise d1' }, f.unit),
        f.viz ? el('div', { class: 'rise d2' }, f.viz(true)) : null,
        el('p', { class: 'mean rise d2', html: f.mean }),
        el('p', { class: 'prop rise d3' }, el('b', {}, 'Proposition'), f.prop));
    }
    return n;
  }
  function show(i) {
    st.i = Math.max(0, Math.min(screens.length - 1, i));
    const s = screens[st.i];
    $('stage').replaceChildren(screenNode(s, st.i));
    $('frame').classList.toggle('light', !!s.light);
    $('frame').style.color = s.ink;
    $('progress').replaceChildren(...screens.map((_, j) => el('span', {}, el('i', { style: `width:${j < st.i ? 100 : 0}%` }))));
    st.elapsed = 0; st.t0 = performance.now();
  }
  function tick(t) {
    if ($('story').hidden) return;
    const bar = $('progress').children[st.i]?.firstChild;
    const last = st.i === screens.length - 1;
    if (!st.paused && !reduced() && !last) {
      const p = Math.min(1, (st.elapsed + t - st.t0) / STORY_MS);
      if (bar) bar.style.width = `${p * 100}%`;
      if (p >= 1) show(st.i + 1);
    } else if (bar && last) bar.style.width = '100%';
    st.raf = requestAnimationFrame(tick);
  }
  function pause(p) {
    if (p && !st.paused) st.elapsed += performance.now() - st.t0;
    if (!p && st.paused) st.t0 = performance.now();
    st.paused = p; $('story-pause').textContent = p ? 'Lecture' : 'Pause';
  }
  function openStory() {
    st.last = document.activeElement;
    $('story').hidden = false; document.body.style.overflow = 'hidden';
    pause(reduced()); show(0);
    cancelAnimationFrame(st.raf); st.raf = requestAnimationFrame(tick);
    $('story-close').focus();
  }
  function closeStory() { $('story').hidden = true; document.body.style.overflow = ''; cancelAnimationFrame(st.raf); st.last?.focus?.(); }
  $('btn-story').addEventListener('click', openStory);
  $('story-close').addEventListener('click', closeStory);
  $('story-pause').addEventListener('click', () => pause(!st.paused));
  $('story-prev').addEventListener('click', () => show(st.i - 1));
  $('story-next').addEventListener('click', () => show(st.i + 1));
  document.addEventListener('keydown', (e) => {
    if ($('story').hidden) return;
    if (e.key === 'Escape') closeStory();
    else if (e.key === 'ArrowRight') show(st.i + 1);
    else if (e.key === 'ArrowLeft') show(st.i - 1);
  });
  let tx = null;
  $('frame').addEventListener('touchstart', (e) => { tx = e.touches[0].clientX; }, { passive: true });
  $('frame').addEventListener('touchend', (e) => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 50) show(st.i + (dx < 0 ? 1 : -1)); });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  renderPlan();
  (async () => {
    const use = (n) => (window.claude?.use ? window.claude.use(n).catch(() => null) : Promise.resolve(null));
    const [db, user, dl] = await Promise.all([use('db'), use('user'), use('downloads')]);
    downloads = dl;
    $('btn-md').hidden = !dl;
    plan.db = db;
    if (user) { try { const w = await user.can('data.write'); plan.canWrite = !!db && (w == null ? true : !!w); } catch (e) { plan.canWrite = false; } }
    if (!db) { plan.canWrite = true; renderPlan(); return; } // local-only fallback: statuses stay in this view
    db.doc('plan/rpp-2026').onSnapshot((snap) => {
      if (snap.exists) plan.items = snap.data().items || {};
      renderPlan();
    }, () => renderPlan());
    renderPlan();
  })();
})();
