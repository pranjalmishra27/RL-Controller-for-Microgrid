/* ═══════════════════════════════════════════════════════════════════
   Microgrid RL Dashboard — app.js
   ═══════════════════════════════════════════════════════════════════ */

"use strict";

// ── Constants / palette ──────────────────────────────────────────────────
const PALETTE = {
  solar:    '#f39c12',
  solarFill:'rgba(243,156,18,0.25)',
  load:     '#9b59b6',
  loadFill: 'rgba(155,89,182,0.20)',
  battery:  '#2ecc71',
  batFill:  'rgba(46,204,113,0.20)',
  grid:     '#e74c3c',
  gridFill: 'rgba(231,76,60,0.20)',
  rl:       '#3498db',
  rlFill:   'rgba(52,152,219,0.20)',
  rule:     '#f39c12',
  ruleFill: 'rgba(243,156,18,0.20)',
  reward:   '#2ecc71',
  cost:     '#e74c3c',
};

const ACTION_COLORS = ['#3498db','#e74c3c','#2ecc71','#9b59b6'];
const ACTION_LABELS = ['CHARGE','DISCHARGE','IDLE','GRID_CHARGE'];

// Chart.js global defaults
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size = 12;

// ── API helper ───────────────────────────────────────────────────────────
async function api(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${endpoint}?${qs}` : endpoint;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── Loading overlay ──────────────────────────────────────────────────────
function showLoading(msg = 'Simulating…') {
  document.getElementById('loadingText').textContent = msg;
  document.getElementById('loadingOverlay').classList.add('show');
}
function hideLoading() {
  document.getElementById('loadingOverlay').classList.remove('show');
}

// ── Tab navigation ───────────────────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Chart factory ────────────────────────────────────────────────────────
function mkChart(id, type, labels, datasets, options = {}) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  if (canvas._chart) canvas._chart.destroy();
  const chart = new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { labels: { color: '#8b949e', boxWidth: 12, font: { size: 11 } } },
        tooltip: { mode: 'index', intersect: false },
        ...options.plugins,
      },
      scales: options.scales || {
        x: { grid: { color: '#21262d' }, ticks: { maxTicksLimit: 24 } },
        y: { grid: { color: '#21262d' } },
      },
      ...options.extra,
    },
  });
  canvas._chart = chart;
  return chart;
}

function destroyChart(id) {
  const canvas = document.getElementById(id);
  if (canvas && canvas._chart) { canvas._chart.destroy(); canvas._chart = null; }
}

// ── Format helpers ───────────────────────────────────────────────────────
const fmt = {
  w:   v => v != null ? `${v.toFixed(0)} W`  : '—',
  wh:  v => v != null ? `${v.toFixed(0)} Wh` : '—',
  pct: v => v != null ? `${v.toFixed(1)}%`   : '—',
  usd: v => v != null ? `$${v.toFixed(4)}`   : '—',
  imp: (v, neg) => {
    if (v == null) return '—';
    const sign = neg ? (v > 0 ? '↓ ' : '↑ ') : (v > 0 ? '↑ ' : '↓ ');
    const cls  = neg ? (v > 0 ? 'green' : 'red') : (v > 0 ? 'green' : 'red');
    return `<span class="${cls}">${sign}${Math.abs(v).toFixed(1)}%</span>`;
  },
};

// ══════════════════════════════════════════════════════════════════════════
//  SECTION 1 — Overview tab
// ══════════════════════════════════════════════════════════════════════════

let overviewChart = null;

async function initOverview() {
  try {
    const info = await api('/api/info');
    document.getElementById('kpi-pv').textContent    = `${info.pv_max_w} W`;
    document.getElementById('kpi-bat').textContent   = `${info.battery_capacity_wh} Wh`;
    document.getElementById('kpi-price').textContent = `${(info.grid_peak_price*100).toFixed(0)}¢/kWh peak`;
    document.getElementById('kpi-load').textContent  = `${info.load_min_w}–${info.load_max_w} W`;

    const dot  = document.getElementById('statusDot');
    const stxt = document.getElementById('statusText');
    dot.className  = 'status-dot online';
    stxt.textContent = info.has_rl_model ? 'RL Model Online' : 'Rule-Based Mode';

    // Run 24-hour preview
    await runOverviewPreview(42);

  } catch(e) {
    console.error(e);
    const dot = document.getElementById('statusDot');
    dot.className = 'status-dot error';
    document.getElementById('statusText').textContent = 'Backend offline';
  }
}

async function runOverviewPreview(seed) {
  const data = await api('/api/simulate', { controller: 'rule', seed, length: 24 });
  const h = data.history;

  // Take first 24 entries
  const slice = h.slice(0, 24);
  const labels = slice.map(r => `${r.hour}:00`);

  overviewChart = mkChart('overviewChart', 'line', labels, [
    { label: 'PV Output (W)',   data: slice.map(r => r.pv_w),   borderColor: PALETTE.solar,   backgroundColor: PALETTE.solarFill, fill: true, tension: 0.4, pointRadius: 0 },
    { label: 'Load (W)',        data: slice.map(r => r.load_w),  borderColor: PALETTE.load,    backgroundColor: PALETTE.loadFill,  fill: true, tension: 0.4, pointRadius: 0 },
    { label: 'Grid Import (W)', data: slice.map(r => r.grid_w),  borderColor: PALETTE.grid,    fill: false,                        tension: 0.3, pointRadius: 0 },
    { label: 'Battery SOC (%)', data: slice.map(r => r.soc),     borderColor: PALETTE.battery, fill: false, borderDash: [4,3],   tension: 0.3, pointRadius: 0, yAxisID: 'ySoc' },
  ], {
    scales: {
      x: { grid: { color: '#21262d' }, ticks: { maxTicksLimit: 12 } },
      y: { grid: { color: '#21262d' }, title: { display: true, text: 'Power (W)' } },
      ySoc: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: 'SOC (%)' } },
    },
  });

  // Update diagram with last step's data
  const last = slice[slice.length - 1];
  updateDiagram(last);
  updateStateVector(last);
}

function updateDiagram(r) {
  document.getElementById('diag-pv').textContent   = fmt.w(r.pv_w);
  document.getElementById('diag-load').textContent = fmt.w(r.load_w);
  document.getElementById('diag-grid').textContent = fmt.w(r.grid_w);
  document.getElementById('diag-soc').textContent  = fmt.pct(r.soc);
  const bar = document.getElementById('diag-soc-bar');
  if (bar) bar.style.width = `${Math.min(100, Math.max(0, r.soc))}%`;

  // Action badge
  const badge = document.getElementById('overviewAction');
  badge.textContent  = r.action;
  badge.className    = `action-badge ${r.action}`;
}

function updateStateVector(r) {
  const hour = r.hour;
  const hSin = ((Math.sin(2 * Math.PI * hour / 24) + 1) / 2 * 100).toFixed(0);
  const hCos = ((Math.cos(2 * Math.PI * hour / 24) + 1) / 2 * 100).toFixed(0);
  const pvNorm   = (r.pv_w  / 700  * 100).toFixed(0);
  const loadNorm = (r.load_w / 900 * 100).toFixed(0);
  const priceNorm= r.price > 0.1 ? '100' : '0';

  const set = (id, val, barId) => {
    document.getElementById(id).textContent = (val/100).toFixed(2);
    document.getElementById(barId).style.width = `${Math.min(100, Math.max(0, +val))}%`;
  };
  set('sv-pv',   pvNorm,  'sf-pv');
  set('sv-load', loadNorm,'sf-load');
  set('sv-soc',  r.soc,   'sf-soc');
  set('sv-hsin', hSin,    'sf-hsin');
  set('sv-hcos', hCos,    'sf-hcos');
  set('sv-price',priceNorm,'sf-price');
}

document.getElementById('overviewRefresh').addEventListener('click', async () => {
  const seed = parseInt(document.getElementById('overviewSeed').value) || 42;
  showLoading('Running preview…');
  try { await runOverviewPreview(seed); } finally { hideLoading(); }
});


// ══════════════════════════════════════════════════════════════════════════
//  SECTION 2 — Simulate tab
// ══════════════════════════════════════════════════════════════════════════

document.getElementById('sim-run').addEventListener('click', async () => {
  const controller = document.getElementById('sim-controller').value;
  const length     = parseInt(document.getElementById('sim-length').value)  || 168;
  const seed       = parseInt(document.getElementById('sim-seed').value)     || 42;

  showLoading(`Running ${controller === 'rl' ? 'RL Agent' : 'Rule-Based'} simulation…`);
  try {
    const data = await api('/api/simulate', { controller, length, seed });
    renderSimulation(data);
  } catch(e) {
    alert('Simulation error: ' + e.message);
  } finally {
    hideLoading();
  }
});

function renderSimulation(data) {
  const h      = data.history;
  const s      = data.summary;
  const labels = h.map(r => `H${r.step}`);

  // Summary cards
  document.getElementById('sim-summary').style.display = 'flex';
  document.getElementById('sum-cost').textContent       = fmt.usd(s['total_grid_cost_$']);
  document.getElementById('sum-ssc').textContent        = fmt.pct(s['solar_self_consumption_%']);
  document.getElementById('sum-solar-gen').textContent  = fmt.wh(s['total_solar_generated_wh']);
  document.getElementById('sum-solar-used').textContent = fmt.wh(s['total_solar_used_wh']);

  // Power flows
  mkChart('simPowerChart', 'line', labels, [
    { label:'PV Output (W)',   data: h.map(r=>r.pv_w),   borderColor: PALETTE.solar,   backgroundColor: PALETTE.solarFill, fill:true,  tension:0.4, pointRadius:0 },
    { label:'Load (W)',        data: h.map(r=>r.load_w),  borderColor: PALETTE.load,    backgroundColor: PALETTE.loadFill,  fill:true,  tension:0.4, pointRadius:0 },
    { label:'Grid Import (W)', data: h.map(r=>r.grid_w),  borderColor: PALETTE.grid,    fill:false, tension:0.3, pointRadius:0 },
    { label:'Solar Used (W)',  data: h.map(r=>r.solar_used_w), borderColor: PALETTE.battery, fill:false, borderDash:[4,2], tension:0.3, pointRadius:0 },
  ], { scales: { x:{ grid:{color:'#21262d'}, ticks:{maxTicksLimit:24} }, y:{ grid:{color:'#21262d'} } } });

  // SOC
  mkChart('simSocChart', 'line', labels, [
    { label:'Battery SOC (%)', data: h.map(r=>r.soc), borderColor: PALETTE.battery, backgroundColor: PALETTE.batFill, fill:true, tension:0.3, pointRadius:0 },
  ], {
    plugins: { annotation: { annotations: {
      minLine: { type:'line', yMin:20, yMax:20, borderColor:'#e74c3c', borderDash:[6,3], label:{content:'Min 20%', enabled:true, position:'end'} },
      maxLine: { type:'line', yMin:95, yMax:95, borderColor:'#f39c12', borderDash:[6,3], label:{content:'Max 95%', enabled:true, position:'end'} },
    }}},
    scales: { x:{ grid:{color:'#21262d'}, ticks:{maxTicksLimit:24} }, y:{ grid:{color:'#21262d'}, min:0, max:100, title:{display:true,text:'SOC (%)'} } },
  });

  // Action distribution (bar)
  const actionCounts = [0,0,0,0];
  h.forEach(r => actionCounts[r.action_id]++);
  mkChart('simActionChart', 'bar', ACTION_LABELS, [
    { label:'Steps', data: actionCounts, backgroundColor: ACTION_COLORS, borderRadius: 4 },
  ], {
    extra: { indexAxis: 'x' },
    scales: { x:{ grid:{color:'#21262d'} }, y:{ grid:{color:'#21262d'}, title:{display:true,text:'# Steps'} } },
    plugins: { legend:{ display:false } },
  });

  // Cumulative reward
  let cumReward = 0;
  const cumRewards = h.map(r => { cumReward += r.reward; return +cumReward.toFixed(4); });
  mkChart('simRewardChart', 'line', labels, [
    { label:'Cumulative Reward', data: cumRewards, borderColor: PALETTE.reward, backgroundColor:'rgba(46,204,113,0.15)', fill:true, tension:0.3, pointRadius:0 },
  ], { scales: { x:{grid:{color:'#21262d'}, ticks:{maxTicksLimit:24}}, y:{grid:{color:'#21262d'}} } });

  // Grid cost timeline
  mkChart('simCostChart', 'bar', labels, [
    { label:'Grid Cost ($)', data: h.map(r=>r.grid_cost), backgroundColor: h.map(r => r.price > 0.1 ? 'rgba(231,76,60,0.6)' : 'rgba(52,152,219,0.5)'), borderRadius: 2 },
  ], {
    extra: { barThickness: 2 },
    plugins: { legend:{display:false} },
    scales: { x:{grid:{color:'#21262d'}, ticks:{maxTicksLimit:24}}, y:{grid:{color:'#21262d'}, title:{display:true,text:'$/step'}} },
  });
}


// ══════════════════════════════════════════════════════════════════════════
//  SECTION 3 — Compare tab
// ══════════════════════════════════════════════════════════════════════════

document.getElementById('cmp-run').addEventListener('click', async () => {
  const length = parseInt(document.getElementById('cmp-length').value) || 168;
  const seed   = parseInt(document.getElementById('cmp-seed').value)   || 42;

  showLoading('Running comparison…');
  try {
    const data = await api('/api/compare', { length, seed });
    renderComparison(data);
  } catch(e) {
    alert('Comparison error: ' + e.message);
  } finally {
    hideLoading();
  }
});

function renderComparison(data) {
  const rb = data.rule_based;
  const rl = data.rl_agent;

  // KPI row
  document.getElementById('cmpKpiRow').style.display = 'flex';
  document.getElementById('ck-rb-cost').textContent  = fmt.usd(rb.summary['total_grid_cost_$']);
  document.getElementById('ck-rb-ssc').textContent   = fmt.pct(rb.summary['solar_self_consumption_%']);
  document.getElementById('ck-rl-cost').textContent  = fmt.usd(rl.summary['total_grid_cost_$']);
  document.getElementById('ck-rl-ssc').textContent   = fmt.pct(rl.summary['solar_self_consumption_%']);

  const costDiff = ((rb.summary['total_grid_cost_$'] - rl.summary['total_grid_cost_$']) /
                     rb.summary['total_grid_cost_$'] * 100).toFixed(1);
  document.getElementById('cmpBadge').innerHTML =
    `RL saves <span class="green">${costDiff}%</span><br/>grid cost`;

  function renderPairCharts(prefix, h, color) {
    const labels = h.map(r => `H${r.step}`);
    mkChart(`cmp${prefix}PowerChart`, 'line', labels, [
      { label:'PV (W)',   data:h.map(r=>r.pv_w),   borderColor:PALETTE.solar,  backgroundColor:PALETTE.solarFill, fill:true, tension:0.4, pointRadius:0 },
      { label:'Load (W)', data:h.map(r=>r.load_w),  borderColor:PALETTE.load,   fill:false, tension:0.4, pointRadius:0 },
      { label:'Grid (W)', data:h.map(r=>r.grid_w),  borderColor:PALETTE.grid,   fill:false, tension:0.3, pointRadius:0 },
    ], { scales:{x:{grid:{color:'#21262d'}, ticks:{maxTicksLimit:24}}, y:{grid:{color:'#21262d'}}} });

    mkChart(`cmp${prefix}SocChart`, 'line', labels, [
      { label:'SOC (%)', data:h.map(r=>r.soc), borderColor:color, backgroundColor:`${color}33`, fill:true, tension:0.3, pointRadius:0 },
    ], {
      plugins:{annotation:{annotations:{
        minLine:{type:'line',yMin:20,yMax:20,borderColor:'#e74c3c',borderDash:[5,3]},
        maxLine:{type:'line',yMin:95,yMax:95,borderColor:'#f39c12',borderDash:[5,3]},
      }}},
      scales:{x:{grid:{color:'#21262d'}, ticks:{maxTicksLimit:24}},y:{grid:{color:'#21262d'},min:0,max:100}},
    });

    const actionCounts = [0,0,0,0];
    h.forEach(r => actionCounts[r.action_id]++);
    mkChart(`cmp${prefix}ActionChart`, 'bar', ACTION_LABELS, [
      { label:'Steps', data:actionCounts, backgroundColor:ACTION_COLORS, borderRadius:4 },
    ], {
      plugins:{legend:{display:false}},
      scales:{x:{grid:{color:'#21262d'}},y:{grid:{color:'#21262d'},title:{display:true,text:'# Steps'}}},
    });
  }

  renderPairCharts('Rb', rb.history, PALETTE.rule);
  renderPairCharts('Rl', rl.history, PALETTE.rl);

  // Summary bar chart
  mkChart('cmpBarChart', 'bar',
    ['Grid Cost ($)', 'Solar SSC (%)', 'Avg Grid Import (W)'],
    [
      { label:'Rule-Based', data:[
          rb.summary['total_grid_cost_$'],
          rb.summary['solar_self_consumption_%'],
          rb.history.reduce((s,r)=>s+r.grid_w,0)/rb.history.length,
        ], backgroundColor:'rgba(243,156,18,0.7)', borderRadius:4 },
      { label:'RL Agent', data:[
          rl.summary['total_grid_cost_$'],
          rl.summary['solar_self_consumption_%'],
          rl.history.reduce((s,r)=>s+r.grid_w,0)/rl.history.length,
        ], backgroundColor:'rgba(52,152,219,0.7)', borderRadius:4 },
    ],
    { scales:{x:{grid:{color:'#21262d'}},y:{grid:{color:'#21262d'}}} }
  );
}


// ══════════════════════════════════════════════════════════════════════════
//  SECTION 4 — Live Monitor
// ══════════════════════════════════════════════════════════════════════════

let liveInterval   = null;
let liveHour       = 8;
let liveSoc        = 50;
let liveTotalCost  = 0;
let livePowerData  = { pv:[], load:[], grid:[], labels:[] };
let liveSocData    = { soc:[], labels:[] };
let liveCostData   = { cost:[], labels:[] };
const MAX_LIVE_PTS = 48;

let livePowerChart = null;
let liveSocChart   = null;
let liveCostChart  = null;

function initLiveCharts() {
  livePowerChart = mkChart('livePowerChart','line',[],[
    { label:'PV (W)',  data:[], borderColor:PALETTE.solar,   backgroundColor:PALETTE.solarFill, fill:true,  tension:0.4, pointRadius:0 },
    { label:'Load (W)',data:[], borderColor:PALETTE.load,    fill:false, tension:0.4, pointRadius:0 },
    { label:'Grid (W)',data:[], borderColor:PALETTE.grid,    fill:false, tension:0.3, pointRadius:2, pointBackgroundColor:PALETTE.grid },
  ],{ scales:{x:{grid:{color:'#21262d'}, ticks:{maxTicksLimit:12}},y:{grid:{color:'#21262d'}}} });

  liveSocChart = mkChart('liveSocChart','line',[],[
    { label:'SOC (%)', data:[], borderColor:PALETTE.battery, backgroundColor:PALETTE.batFill, fill:true, tension:0.3, pointRadius:0 },
  ],{
    plugins:{annotation:{annotations:{
      minLine:{type:'line',yMin:20,yMax:20,borderColor:'#e74c3c',borderDash:[5,3]},
      maxLine:{type:'line',yMin:95,yMax:95,borderColor:'#f39c12',borderDash:[5,3]},
    }}},
    scales:{x:{grid:{color:'#21262d'},ticks:{maxTicksLimit:12}},y:{min:0,max:100,grid:{color:'#21262d'}}},
  });

  liveCostChart = mkChart('liveCostChart','bar',[],[
    { label:'Grid Cost ($)', data:[], backgroundColor:'rgba(231,76,60,0.6)', borderRadius:2 },
  ],{
    plugins:{legend:{display:false}},
    scales:{x:{grid:{color:'#21262d'},ticks:{maxTicksLimit:12}},y:{grid:{color:'#21262d'},title:{display:true,text:'$/step'}}},
  });
}

function pushLivePoint(r) {
  const label = `${String(r.hour).padStart(2,'0')}:00`;

  // Keep rolling window
  const push = (arr, val) => { arr.push(val); if(arr.length > MAX_LIVE_PTS) arr.shift(); };

  push(livePowerData.labels, label);
  push(livePowerData.pv,   r.pv_w);
  push(livePowerData.load, r.load_w);
  push(livePowerData.grid, r.grid_w);

  push(liveSocData.labels, label);
  push(liveSocData.soc,    r.soc);

  push(liveCostData.labels, label);
  push(liveCostData.cost,   r.grid_cost);

  // Update charts
  if (livePowerChart) {
    livePowerChart.data.labels = [...livePowerData.labels];
    livePowerChart.data.datasets[0].data = [...livePowerData.pv];
    livePowerChart.data.datasets[1].data = [...livePowerData.load];
    livePowerChart.data.datasets[2].data = [...livePowerData.grid];
    livePowerChart.update('none');
  }
  if (liveSocChart) {
    liveSocChart.data.labels = [...liveSocData.labels];
    liveSocChart.data.datasets[0].data = [...liveSocData.soc];
    liveSocChart.update('none');
  }
  if (liveCostChart) {
    liveCostChart.data.labels = [...liveCostData.labels];
    liveCostChart.data.datasets[0].data = [...liveCostData.cost];
    liveCostChart.update('none');
  }
}

function updateLiveKPIs(r) {
  liveTotalCost += r.grid_cost;
  document.getElementById('lkc-pv').textContent     = fmt.w(r.pv_w);
  document.getElementById('lkc-load').textContent   = fmt.w(r.load_w);
  document.getElementById('lkc-soc').textContent    = fmt.pct(r.soc);
  document.getElementById('lkc-grid').textContent   = fmt.w(r.grid_w);
  document.getElementById('lkc-action').textContent = r.action;
  document.getElementById('lkc-cost').textContent   = `$${liveTotalCost.toFixed(4)}`;
}

function appendLog(r) {
  const log = document.getElementById('eventLog');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="le-time">[${String(r.hour).padStart(2,'0')}:00]</span> ` +
    `<span class="le-action ${r.action}">${r.action}</span> — ` +
    `PV: ${fmt.w(r.pv_w)} | Load: ${fmt.w(r.load_w)} | SOC: ${fmt.pct(r.soc)} | Grid: ${fmt.w(r.grid_w)} | Cost: $${r.grid_cost.toFixed(5)}`;
  log.prepend(entry);
  if (log.children.length > 50) log.removeChild(log.lastChild);
}

async function liveTick() {
  try {
    const r = await api('/api/live', { hour: liveHour, soc: liveSoc / 100 });
    liveHour = (liveHour + 1) % 24;
    liveSoc  = r.soc;
    pushLivePoint(r);
    updateLiveKPIs(r);
    appendLog(r);
  } catch(e) {
    console.error('Live tick error:', e);
  }
}

document.getElementById('live-start').addEventListener('click', () => {
  if (liveInterval) return;
  liveHour = parseInt(document.getElementById('live-hour').value) || 8;
  liveSoc  = parseFloat(document.getElementById('live-soc').value) || 50;
  const speed = parseInt(document.getElementById('live-speed').value) || 1000;

  document.getElementById('live-start').disabled = true;
  document.getElementById('live-stop').disabled  = false;

  initLiveCharts();
  liveInterval = setInterval(liveTick, speed);
  liveTick(); // immediate first tick
});

document.getElementById('live-stop').addEventListener('click', () => {
  clearInterval(liveInterval);
  liveInterval = null;
  document.getElementById('live-start').disabled = false;
  document.getElementById('live-stop').disabled  = true;
});

document.getElementById('live-reset').addEventListener('click', () => {
  clearInterval(liveInterval);
  liveInterval = null;
  liveTotalCost = 0;
  livePowerData = { pv:[], load:[], grid:[], labels:[] };
  liveSocData   = { soc:[], labels:[] };
  liveCostData  = { cost:[], labels:[] };
  document.getElementById('eventLog').innerHTML = '';
  document.getElementById('live-start').disabled = false;
  document.getElementById('live-stop').disabled  = true;
  ['lkc-pv','lkc-load','lkc-soc','lkc-grid','lkc-action'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  document.getElementById('lkc-cost').textContent = '$0.00';
  initLiveCharts();
});


// ══════════════════════════════════════════════════════════════════════════
//  SECTION 5 — Metrics tab
// ══════════════════════════════════════════════════════════════════════════

document.getElementById('met-run').addEventListener('click', async () => {
  const n      = parseInt(document.getElementById('met-n').value)      || 5;
  const length = parseInt(document.getElementById('met-length').value)  || 168;

  document.getElementById('met-hint').textContent = `Running ${n} episodes…`;
  showLoading(`Running ${n}-episode analysis…`);
  try {
    const data = await api('/api/metrics', { n, length });
    renderMetrics(data);
  } catch(e) {
    alert('Metrics error: ' + e.message);
  } finally {
    hideLoading();
    document.getElementById('met-hint').textContent = '';
  }
});

function renderMetrics(data) {
  const rb = data.rule_based;
  const rl = data.rl_agent;

  // Summary table
  document.getElementById('metStatsPanel').style.display = 'block';
  document.getElementById('metChartsRow').style.display  = 'flex';
  document.getElementById('metRewardPanel').style.display= 'block';

  const costImp = ((rb.grid_cost.mean - rl.grid_cost.mean) / rb.grid_cost.mean * 100);
  const sscImp  = rl.solar_ssc.mean  - rb.solar_ssc.mean;
  const rewImp  = rl.reward.mean     - rb.reward.mean;

  document.getElementById('metTableBody').innerHTML = `
    <tr>
      <td>Avg Grid Cost ($)</td>
      <td>$${rb.grid_cost.mean.toFixed(4)} ± ${rb.grid_cost.std.toFixed(4)}</td>
      <td>$${rl.grid_cost.mean.toFixed(4)} ± ${rl.grid_cost.std.toFixed(4)}</td>
      <td>${fmt.imp(costImp, true)}</td>
    </tr>
    <tr>
      <td>Solar SSC (%)</td>
      <td>${rb.solar_ssc.mean.toFixed(1)}% ± ${rb.solar_ssc.std.toFixed(1)}%</td>
      <td>${rl.solar_ssc.mean.toFixed(1)}% ± ${rl.solar_ssc.std.toFixed(1)}%</td>
      <td>${fmt.imp(sscImp, false)}</td>
    </tr>
    <tr>
      <td>Mean Episode Reward</td>
      <td>${rb.reward.mean.toFixed(3)}</td>
      <td>${rl.reward.mean.toFixed(3)}</td>
      <td>${fmt.imp(rewImp / Math.abs(rb.reward.mean) * 100, false)}</td>
    </tr>
  `;

  // Cost distribution
  const epLabels = rb.grid_cost.all.map((_,i) => `Ep ${i+1}`);
  mkChart('metCostChart','bar', epLabels, [
    { label:'Rule-Based', data: rb.grid_cost.all, backgroundColor:'rgba(243,156,18,0.7)', borderRadius:4 },
    { label:'RL Agent',   data: rl.grid_cost.all, backgroundColor:'rgba(52,152,219,0.7)', borderRadius:4 },
  ], { scales:{x:{grid:{color:'#21262d'}},y:{grid:{color:'#21262d'},title:{display:true,text:'Grid Cost ($)'}}} });

  // SSC distribution
  mkChart('metSscChart','bar', epLabels, [
    { label:'Rule-Based', data: rb.solar_ssc.all, backgroundColor:'rgba(243,156,18,0.7)', borderRadius:4 },
    { label:'RL Agent',   data: rl.solar_ssc.all, backgroundColor:'rgba(52,152,219,0.7)', borderRadius:4 },
  ], { scales:{x:{grid:{color:'#21262d'}},y:{min:0,max:100,grid:{color:'#21262d'},title:{display:true,text:'Solar SSC (%)'}}} });

  // Reward comparison
  mkChart('metRewardChart','line', epLabels, [
    { label:'Rule-Based', data: rb.reward.all, borderColor:PALETTE.rule,  backgroundColor:PALETTE.ruleFill, fill:true, tension:0.3 },
    { label:'RL Agent',   data: rl.reward.all, borderColor:PALETTE.rl,    backgroundColor:PALETTE.rlFill,  fill:true, tension:0.3 },
  ], { scales:{x:{grid:{color:'#21262d'}},y:{grid:{color:'#21262d'},title:{display:true,text:'Episode Reward'}}} });
}


// ══════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════

(async () => {
  await initOverview();
  initLiveCharts();
})();
