/**
 * analytics.js — Module 05: Analytics
 * 6-tab performance intelligence dashboard.
 */
const analyticsModule = (() => {
  let _range = 'YTD';
  let _activeTab = 'performance';
  let _charts = [];

  function init() {
    _setupDateFilter();
    _setupTabBar();
    _renderTab(_activeTab);
  }

  function _setupDateFilter() {
    document.querySelectorAll('#anl-date-filter .filter-btn').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', () => {
        document.querySelectorAll('#anl-date-filter .filter-btn').forEach(b => b.classList.remove('active'));
        fresh.classList.add('active');
        _range = fresh.dataset.range;
        _renderTab(_activeTab);
      });
    });
  }

  function _setupTabBar() {
    document.querySelectorAll('#anl-tab-bar .tab-btn').forEach(btn => {
      const fresh = btn.cloneNode(true);
      btn.parentNode.replaceChild(fresh, btn);
      fresh.addEventListener('click', () => {
        document.querySelectorAll('#anl-tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
        fresh.classList.add('active');
        _activeTab = fresh.dataset.tab;
        _renderTab(_activeTab);
      });
    });
  }

  function _renderTab(tab) {
    _charts.forEach(c => { try { c.destroy(); } catch(e) {} });
    _charts = [];
    const el = document.getElementById('anl-content');
    if (!el) return;
    const trades = calc.filterByDateRange(db.getClosedTrades(), _range);
    if (tab === 'performance') _tabPerformance(el, trades);
    else if (tab === 'trade-analytics') _tabTradeAnalytics(el, trades);
    else if (tab === 'playbook-analytics') _tabPlaybookAnalytics(el, trades);
    else if (tab === 'risk') _tabRisk(el, trades);
    else if (tab === 'discipline') _tabDiscipline(el, trades);
    else if (tab === 'simulator') _tabSimulator(el, trades);
  }

  // ── TAB 1: Performance ─────────────────────────────────────────────────────
  function _tabPerformance(el, trades) {
    const wr = calc.getWinRate(trades);
    const netPnl = calc.getTotalPnl(trades);
    const netR = calc.getTotalR(trades);
    const exp = calc.getExpectancy(trades);
    const mdd = calc.getMaxDrawdown(trades);
    const ruleBreaks = trades.filter(t => !t.ruleFollowed).length;
    const score = Math.max(0, 100 - (trades.length > 0 ? (ruleBreaks/trades.length)*40 : 0) - (Math.max(0, -mdd) * 5));
    el.innerHTML = `<div class="anl-tab-content">
      <div class="anl-cards-row">
        ${_sCard('Total Trades', trades.length, '')}
        ${_sCard('Win Rate', `${wr.toFixed(1)}%`, '', wr >= 40 ? 'text-success' : 'text-danger')}
        ${_sCard('Net P&L', calc.formatCurrency(netPnl), '', netPnl >= 0 ? 'text-success' : 'text-danger')}
        ${_sCard('Net R', calc.formatR(netR), '', netR >= 0 ? 'text-success' : 'text-danger')}
        ${_sCard('Expectancy', calc.formatR(exp), 'per trade', exp >= 0 ? 'text-success' : 'text-danger')}
        ${_sCard('Max Drawdown', calc.formatR(mdd), '', 'text-danger')}
        ${_sCard('Trading Score', score.toFixed(0), '/100', score >= 70 ? 'text-success' : score >= 40 ? 'text-warning' : 'text-danger')}
      </div>
      <div class="anl-charts-row">
        <div class="card">
          <div class="card-header">
            <span class="card-title" id="anl-pnl-chart-title">Cumulative P&L</span>
            <div style="display:flex;gap:6px;">
              <button class="toggle-btn active" id="btn-cum-pnl" onclick="analyticsModule._switchCumChart('pnl')" style="font-size:11px;padding:3px 8px;">Cum. P&L</button>
              <button class="toggle-btn" id="btn-cum-eq" onclick="analyticsModule._switchCumChart('equity')" style="font-size:11px;padding:3px 8px;">Cum. Equity</button>
            </div>
          </div>
          <div style="padding:12px;height:220px"><canvas id="anl-equity-chart"></canvas></div>
        </div>
        <div class="card"><div class="card-header"><span class="card-title">Drawdown Curve</span></div><div style="padding:12px;height:220px"><canvas id="anl-dd-chart"></canvas></div></div>
      </div>
      <div class="anl-charts-row">
        <div class="card"><div class="card-header"><span class="card-title">Monthly P&L Heatmap</span></div><div style="padding:12px;overflow-x:auto" id="anl-heatmap"></div></div>
        <div class="card"><div class="card-header"><span class="card-title">Rolling 10-Trade Win Rate</span></div><div style="padding:12px;height:220px"><canvas id="anl-rolling-chart"></canvas></div></div>
      </div>
    </div>`;

    // Cumulative P&L chart (default)
    const dailyArr = calc.getDailyPnl(trades);
    const labels = dailyArr.map(d => d.date.slice(5));
    const cumData = dailyArr.map(d => d.cumPnl);
    _charts.push(_makeLineChart('anl-equity-chart', labels, cumData, 'Cumulative P&L', '#5b6af0'));

    // Drawdown curve
    let peak = 0;
    const ddData = dailyArr.map(d => { if (d.cumPnl > peak) peak = d.cumPnl; return peak > 0 ? ((d.cumPnl - peak) / peak) * 100 : 0; });
    _charts.push(_makeLineChart('anl-dd-chart', labels, ddData, 'Drawdown %', '#ef4444'));

    // Heatmap
    document.getElementById('anl-heatmap').innerHTML = _buildHeatmap(trades);

    // Rolling WR
    const sorted = trades.slice().sort((a,b) => (a.finalExit?.date||'').localeCompare(b.finalExit?.date||''));
    const rolling = sorted.map((_, i) => { if (i < 9) return null; const slice = sorted.slice(i-9, i+1); return calc.getWinRate(slice); }).filter(v => v !== null);
    const rLabels = sorted.slice(9).map((t,i) => `T${i+10}`);
    _charts.push(_makeLineChart('anl-rolling-chart', rLabels, rolling, 'Rolling 10-Trade WR%', '#22c55e'));
  }

  // Chart toggle: Cumulative P&L ↔ Cumulative Equity
  function _switchCumChart(mode) {
    const btnPnl = document.getElementById('btn-cum-pnl');
    const btnEq  = document.getElementById('btn-cum-eq');
    const titleEl= document.getElementById('anl-pnl-chart-title');
    if (!btnPnl || !btnEq) return;
    btnPnl.classList.toggle('active', mode === 'pnl');
    btnEq.classList.toggle('active', mode === 'equity');

    // Destroy existing chart on that canvas
    const existingIdx = _charts.findIndex(c => c?.canvas?.id === 'anl-equity-chart');
    if (existingIdx >= 0) { try { _charts[existingIdx].destroy(); } catch(e) {} _charts.splice(existingIdx, 1); }

    const closedTrades = db.getClosedTrades();
    const dailyArr  = calc.getDailyPnl(closedTrades);
    const labels    = dailyArr.map(d => d.date.slice(5));

    if (mode === 'pnl') {
      if (titleEl) titleEl.textContent = 'Cumulative P&L';
      const cumData = dailyArr.map(d => d.cumPnl);
      _charts.push(_makeLineChart('anl-equity-chart', labels, cumData, 'Cumulative P&L', '#5b6af0'));
    } else {
      if (titleEl) titleEl.textContent = 'Cumulative Equity';
      const capital     = db.getCapital();
      const netDeposits = calc.getNetDeposits(capital);
      const eqData = dailyArr.map(d => Math.round(netDeposits + d.cumPnl));
      _labels_start = ['Start', ...labels];
      const fullData = [netDeposits, ...eqData];
      _charts.push(_makeLineChart('anl-equity-chart', ['Start', ...labels], fullData, 'Cumulative Equity', '#22c55e'));
    }
  }

  function _buildHeatmap(trades) {
    const monthly = {};
    trades.forEach(t => {
      const m = calc.getTradeMetrics(t);
      const date = t.finalExit?.date || '';
      if (!date) return;
      const ym = date.slice(0, 7);
      if (!monthly[ym]) monthly[ym] = 0;
      monthly[ym] += m.realizedPnl;
    });
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const years = [...new Set(Object.keys(monthly).map(k => k.slice(0,4)))].sort();
    if (!years.length) return '<div class="no-data">No data for heatmap</div>';
    const maxAbs = Math.max(...Object.values(monthly).map(Math.abs), 1);
    let html = `<table class="heatmap-table"><thead><tr><th></th>${MONTHS.map(m => `<th>${m}</th>`).join('')}</tr></thead><tbody>`;
    years.forEach(yr => {
      html += `<tr><td class="heatmap-year">${yr}</td>`;
      MONTHS.forEach((_, mi) => {
        const key = `${yr}-${String(mi+1).padStart(2,'0')}`;
        const val = monthly[key];
        if (val === undefined) { html += `<td class="heatmap-cell empty">—</td>`; return; }
        const intensity = Math.min(255, Math.round((Math.abs(val) / maxAbs) * 255));
        const cls = val >= 0 ? 'pos' : 'neg';
        html += `<td class="heatmap-cell ${cls}" style="--intensity:${intensity}" title="${key}: ${calc.formatCurrency(val)}">${val >= 0 ? '+' : ''}${(val/1000).toFixed(1)}K</td>`;
      });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    return html;
  }

  // ── TAB 2: Trade Analytics ─────────────────────────────────────────────────
  function _tabTradeAnalytics(el, trades) {
    const sectors = {};
    trades.forEach(t => {
      const s = t.sector || 'Other';
      if (!sectors[s]) sectors[s] = [];
      sectors[s].push(t);
    });
    const sectorRows = Object.entries(sectors).map(([sec, ts]) => {
      const m = calc.getTradeMetrics; const wr = calc.getWinRate(ts); const netR = calc.getTotalR(ts); const exp = calc.getExpectancy(ts);
      const avgDays = ts.reduce((s,t) => s + m(t).holdingDays, 0) / ts.length;
      return { sec, cnt: ts.length, wr: wr.toFixed(1), netR: netR.toFixed(2), exp: exp.toFixed(2), avgDays: avgDays.toFixed(0), netPnl: calc.getTotalPnl(ts) };
    }).sort((a,b) => parseFloat(b.netR) - parseFloat(a.netR));

    const days = ['Mon','Tue','Wed','Thu','Fri'];
    const dayR = [0,0,0,0,0]; const dayCnt = [0,0,0,0,0];
    trades.forEach(t => {
      const date = t.entries?.[0]?.date;
      if (!date) return;
      const day = new Date(date).getDay();
      if (day >= 1 && day <= 5) { dayR[day-1] += calc.getTradeMetrics(t).profitR; dayCnt[day-1]++; }
    });

    const rBuckets = {'<-2R':0,'-2 to -1':0,'-1 to 0':0,'0 to 1':0,'1 to 2':0,'2 to 3':0,'>3R':0};
    trades.forEach(t => {
      const r = calc.getTradeMetrics(t).profitR;
      if (r < -2) rBuckets['<-2R']++;
      else if (r < -1) rBuckets['-2 to -1']++;
      else if (r < 0) rBuckets['-1 to 0']++;
      else if (r < 1) rBuckets['0 to 1']++;
      else if (r < 2) rBuckets['1 to 2']++;
      else if (r < 3) rBuckets['2 to 3']++;
      else rBuckets['>3R']++;
    });

    // Holding period scatter data
    const scatterData = trades.map(t => {
      const m = calc.getTradeMetrics(t);
      const result = calc.getTradeResult(t);
      return { x: m.holdingDays, y: m.profitR, result };
    });

    el.innerHTML = `<div class="anl-tab-content">
      <div class="anl-section">
        <div class="anl-section-title">Sector Performance</div>
        <table class="sector-table"><thead><tr><th>Sector</th><th>Trades</th><th>Win Rate</th><th>Net R</th><th>Expectancy</th><th>Avg Days</th></tr></thead>
        <tbody>${sectorRows.map(r => `<tr><td><strong>${r.sec}</strong></td><td>${r.cnt}</td>
          <td>${r.wr}%</td>
          <td class="${parseFloat(r.netR) >= 0 ? 'text-success' : 'text-danger'} font-mono">${r.netR}R</td>
          <td class="${parseFloat(r.exp) >= 0 ? 'text-success' : 'text-danger'}">${r.exp}R</td>
          <td>${r.avgDays}d</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="anl-charts-row">
        <div class="card"><div class="card-header"><span class="card-title">Net R by Weekday</span></div><div style="padding:12px;height:200px"><canvas id="anl-weekday-chart"></canvas></div></div>
        <div class="card"><div class="card-header"><span class="card-title">Return Distribution (R)</span></div><div style="padding:12px;height:200px"><canvas id="anl-dist-chart"></canvas></div></div>
      </div>
      <div class="anl-charts-row">
        <div class="card" style="flex:2">
          <div class="card-header"><span class="card-title">Holding Period vs Profit R</span><span class="card-subtitle">Each dot = one trade (Green=Win, Red=Loss)</span></div>
          <div style="padding:12px;height:220px"><canvas id="anl-scatter-chart"></canvas></div>
        </div>
      </div>
    </div>`;

    // Weekday chart
    _charts.push(_makeBarChart('anl-weekday-chart', days, dayR, 'Net R by Day'));
    // Distribution chart
    _charts.push(_makeBarChart('anl-dist-chart', Object.keys(rBuckets), Object.values(rBuckets), 'Frequency'));
    // Holding period scatter
    _charts.push(_makeScatterChart('anl-scatter-chart', scatterData));
  }

  // ── TAB 3: Playbook Analytics ──────────────────────────────────────────────
  function _tabPlaybookAnalytics(el, trades) {
    const pbs = db.getPlaybooks();
    const rows = pbs.map(pb => {
      const ts = trades.filter(t => t.playbookId === pb.id);
      if (!ts.length) return null;
      const wr = calc.getWinRate(ts);
      const { avgWinR, avgLossR } = calc.getAvgWinLoss(ts);
      const exp = calc.getExpectancy(ts);
      const netR = calc.getTotalR(ts);
      const avgDays = ts.reduce((s,t) => s + calc.getTradeMetrics(t).holdingDays,0)/ts.length;
      return { pb, ts, wr, avgWinR, avgLossR, exp, netR, avgDays };
    }).filter(Boolean).sort((a,b) => b.exp - a.exp);

    el.innerHTML = `<div class="anl-tab-content">
      <div class="anl-section">
        <div class="anl-section-title">Playbook Performance</div>
        <table class="data-table"><thead><tr><th>Name</th><th>Ver</th><th>Trades</th><th>Win Rate</th><th>Avg Win</th><th>Avg Loss</th><th>Expectancy</th><th>Net R</th><th>Avg Days</th></tr></thead>
        <tbody>${rows.map(r => `<tr onclick="app.navigate('playbook')">
          <td><strong>${r.pb.name}</strong></td><td>v${r.pb.currentVersion}</td><td>${r.ts.length}</td>
          <td>${r.wr.toFixed(1)}%</td>
          <td class="text-success">${r.avgWinR.toFixed(2)}R</td>
          <td class="text-danger">${r.avgLossR.toFixed(2)}R</td>
          <td class="${r.exp >= 0 ? 'text-success' : 'text-danger'} fw-600">${calc.formatR(r.exp)}</td>
          <td class="${r.netR >= 0 ? 'text-success' : 'text-danger'}">${calc.formatR(r.netR)}</td>
          <td>${r.avgDays.toFixed(0)}d</td>
        </tr>`).join('')}</tbody></table>
      </div>
      <div class="anl-charts-row">
        <div class="card"><div class="card-header"><span class="card-title">Expectancy by Playbook</span></div><div style="padding:12px;height:220px"><canvas id="anl-pb-exp-chart"></canvas></div></div>
        <div class="card"><div class="card-header"><span class="card-title">Win Rate by Playbook</span></div><div style="padding:12px;height:220px"><canvas id="anl-pb-wr-chart"></canvas></div></div>
      </div>
      <div class="anl-charts-row">
        <div class="card" style="flex:2">
          <div class="card-header"><span class="card-title">Playbook vs Avg Holding Days</span><span class="card-subtitle">Average holding duration per setup</span></div>
          <div style="padding:12px;height:220px"><canvas id="anl-pb-days-chart"></canvas></div>
        </div>
      </div>
    </div>`;

    if (rows.length) {
      const names = rows.map(r => r.pb.name.length > 12 ? r.pb.name.slice(0,12)+'…' : r.pb.name);
      _charts.push(_makeBarChart('anl-pb-exp-chart', names, rows.map(r => r.exp), 'Expectancy (R)'));
      _charts.push(_makeBarChart('anl-pb-wr-chart', names, rows.map(r => r.wr), 'Win Rate %'));
      // Playbook vs Avg Holding Days
      const daysData = rows.map(r => parseFloat(r.avgDays.toFixed(0)));
      const daysCtx  = document.getElementById('anl-pb-days-chart')?.getContext('2d');
      if (daysCtx) {
        _charts.push(new Chart(daysCtx, {
          type: 'bar',
          data: { labels: names, datasets: [{ label: 'Avg Days', data: daysData, backgroundColor: 'rgba(91,106,240,0.7)', borderColor: '#5b6af0', borderWidth: 1.5 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 }, callback: v => v + 'd' } } } }
        }));
      }
    }
  }

  // ── TAB 4: Risk Analytics ──────────────────────────────────────────────────
  function _tabRisk(el, trades) {
    const openTrades = db.getOpenTrades();
    const heat = calc.getPortfolioHeat(openTrades);
    const violations = trades.filter(t => !t.ruleFollowed);
    const settings = db.getSettings();
    const maxHeat = settings?.riskManagement?.maxPortfolioHeat || 4;

    el.innerHTML = `<div class="anl-tab-content">
      <div class="anl-cards-row">
        ${_sCard('Current Heat', `${heat.toFixed(2)}R`, `Max: ${maxHeat}R`, heat >= maxHeat ? 'text-danger' : '')}
        ${_sCard('Rule Violations', violations.length, `${trades.length > 0 ? ((violations.length/trades.length)*100).toFixed(0) : 0}% of trades`, violations.length > 0 ? 'text-warning' : 'text-success')}
        ${_sCard('Open Positions', openTrades.length, 'Currently active', '')}
      </div>
      <div class="anl-section">
        <div class="anl-section-title">Rule Violations</div>
        ${violations.length ? `<table class="data-table"><thead><tr><th>Symbol</th><th>Entry</th><th>Exit</th><th>P&L</th><th>R</th></tr></thead>
        <tbody>${violations.map(t => { const m = calc.getTradeMetrics(t); return `<tr>
          <td><strong>${t.symbol}</strong></td>
          <td>${calc.formatDate(t.entries?.[0]?.date)}</td>
          <td>${calc.formatDate(t.finalExit?.date)}</td>
          <td class="${m.realizedPnl >= 0 ? 'text-success' : 'text-danger'} font-mono">${calc.formatCurrency(m.realizedPnl)}</td>
          <td class="${m.profitR >= 0 ? 'text-success' : 'text-danger'}">${calc.formatR(m.profitR)}</td>
        </tr>`; }).join('')}</tbody></table>` : `<div class="no-data" style="padding:20px 0">No rule violations in this period. 🎯</div>`}
      </div>
    </div>`;
  }

  // ── TAB 5: Discipline ──────────────────────────────────────────────────────
  function _tabDiscipline(el, trades) {
    const ruleBreaks = trades.filter(t => !t.ruleFollowed).length;
    const ruleBreakPct = trades.length > 0 ? (ruleBreaks / trades.length) * 100 : 0;
    const score = Math.max(0, Math.round(100 - ruleBreakPct * 0.5));
    const violations = trades.filter(t => !t.ruleFollowed);
    const sorted = trades.slice().sort((a,b) => (a.finalExit?.date||'').localeCompare(b.finalExit?.date||''));
    let revengeTrade = false;
    for (let i = 3; i < sorted.length; i++) {
      const recent3 = sorted.slice(i-3, i);
      const allLoss = recent3.every(t => calc.getTradeMetrics(t).profitR < 0);
      if (allLoss) {
        const nextRPT = calc.getTradeMetrics(sorted[i]).initialRPT;
        const avgRPT = recent3.reduce((s,t) => s + calc.getTradeMetrics(t).initialRPT, 0) / 3;
        if (nextRPT > avgRPT * 1.5) { revengeTrade = true; break; }
      }
    }
    el.innerHTML = `<div class="anl-tab-content">
      <div style="display:flex;align-items:center;gap:24px;margin-bottom:18px">
        <div class="score-circle" style="--pct:${score}%">
          <span class="score-value">${score}</span>
        </div>
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--navy)">Discipline Score</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${score >= 80 ? '🟢 Excellent discipline' : score >= 60 ? '🟡 Needs improvement' : '🔴 Significant issues detected'}</div>
          ${revengeTrade ? `<div class="alert-banner danger" style="margin-top:8px">⚠ Possible revenge trading detected — position size increased after 3 consecutive losses.</div>` : ''}
        </div>
      </div>
      <div class="anl-cards-row">
        ${_sCard('Rule Breaks', ruleBreaks, `${ruleBreakPct.toFixed(1)}%`, ruleBreaks > 0 ? 'text-danger' : 'text-success')}
        ${_sCard('Clean Trades', trades.length - ruleBreaks, `${(100-ruleBreakPct).toFixed(1)}%`, 'text-success')}
        ${_sCard('Revenge Trade', revengeTrade ? 'Detected' : 'Clear', '', revengeTrade ? 'text-danger' : 'text-success')}
      </div>
      ${violations.length ? `<div class="anl-section-title">Trades with Rule Breaks</div>
      <table class="data-table"><thead><tr><th>Symbol</th><th>Entry</th><th>Exit</th><th>P&L</th><th>R</th></tr></thead>
      <tbody>${violations.map(t => { const m = calc.getTradeMetrics(t); return `<tr>
        <td><strong>${t.symbol}</strong></td><td>${calc.formatDate(t.entries?.[0]?.date)}</td>
        <td>${calc.formatDate(t.finalExit?.date)}</td>
        <td class="${m.realizedPnl >= 0 ? 'text-success' : 'text-danger'} font-mono">${calc.formatCurrency(m.realizedPnl)}</td>
        <td class="${m.profitR >= 0 ? 'text-success' : 'text-danger'}">${calc.formatR(m.profitR)}</td>
      </tr>`; }).join('')}</tbody></table>` : `<div class="no-data">No rule violations! 🎉</div>`}
    </div>`;
  }

  // ── TAB 6: Growth Simulator ────────────────────────────────────────────────
  function _tabSimulator(el, trades) {
    const capital = db.getCapital();
    const closedTrades = db.getClosedTrades();
    const realizedPnl = calc.getTotalPnl(closedTrades);
    const equity = calc.getCurrentEquity(capital, realizedPnl);
    const settings = db.getSettings();
    const currentRPT = calc.getCurrentR(equity, settings);
    const wr = calc.getWinRate(trades);
    const { avgWinR, avgLossR } = calc.getAvgWinLoss(trades);
    const exp = calc.getExpectancy(trades);
    const tradesPerYear = trades.length > 0 ? Math.round(trades.length * (365 / Math.max(1, _daysDiff(trades)))) : 50;
    const annualReturn = exp * currentRPT * tradesPerYear;

    el.innerHTML = `<div class="anl-tab-content">
      <div class="sim-grid">
        <div>
          <div class="sim-section-title">📊 Current Performance (Actual)</div>
          ${_simRow('Account Value', calc.formatCurrency(equity))}
          ${_simRow('RPT (₹)', calc.formatCurrency(currentRPT))}
          ${_simRow('Trades Analysed', trades.length)}
          ${_simRow('Win Rate', `${wr.toFixed(1)}%`)}
          ${_simRow('Avg Win (R)', avgWinR.toFixed(2))}
          ${_simRow('Avg Loss (R)', avgLossR.toFixed(2))}
          ${_simRow('Expectancy', calc.formatR(exp))}
          ${_simRow('Est. Trades/Year', tradesPerYear)}
          ${_simRow('Est. Annual Return', calc.formatCurrency(annualReturn))}
        </div>
        <div>
          <div class="sim-section-title">🎯 Target Performance</div>
          <div class="form-group"><label class="form-label">Target Win Rate (%)</label><input class="form-input" id="sim-wr" type="number" step="1" value="${Math.round(wr)}" oninput="analyticsModule._simRecalc()"></div>
          <div class="form-group"><label class="form-label">Target Avg Win (R)</label><input class="form-input" id="sim-win" type="number" step="0.1" value="${avgWinR.toFixed(1)}" oninput="analyticsModule._simRecalc()"></div>
          <div class="form-group"><label class="form-label">Target Avg Loss (R)</label><input class="form-input" id="sim-loss" type="number" step="0.1" value="${avgLossR.toFixed(1)}" oninput="analyticsModule._simRecalc()"></div>
          <div class="form-group"><label class="form-label">Trades Per Year</label><input class="form-input" id="sim-tpy" type="number" value="${tradesPerYear}" oninput="analyticsModule._simRecalc()"></div>
          <div class="form-group"><label class="form-label">Starting Capital (₹)</label><input class="form-input" id="sim-capital" type="number" value="${equity.toFixed(0)}" oninput="analyticsModule._simRecalc()"></div>
          <div class="form-group"><label class="form-label">Risk per trade (%)</label><input class="form-input" id="sim-risk" type="number" step="0.1" value="1" oninput="analyticsModule._simRecalc()"></div>
        </div>
      </div>
      <div style="margin-top:18px" id="sim-results"></div>
    </div>`;
    _simRecalc();
  }

  function _simRecalc() {
    const wr = parseFloat(document.getElementById('sim-wr')?.value) / 100 || 0.4;
    const avgWin = parseFloat(document.getElementById('sim-win')?.value) || 1.5;
    const avgLoss = parseFloat(document.getElementById('sim-loss')?.value) || 1.0;
    const tpy = parseInt(document.getElementById('sim-tpy')?.value) || 50;
    const startCap = parseFloat(document.getElementById('sim-capital')?.value) || 1000000;
    const riskPct = parseFloat(document.getElementById('sim-risk')?.value) / 100 || 0.01;
    const exp = wr * avgWin - (1-wr) * avgLoss;
    const years = [1,3,5,10,20];
    const results = years.map(y => {
      let cap = startCap;
      for (let t = 0; t < tpy * y; t++) { const rpt = cap * riskPct; const r = Math.random() < wr ? avgWin : -avgLoss; cap += r * rpt; }
      return { year: y, capital: cap };
    });
    const el = document.getElementById('sim-results');
    if (!el) return;
    el.innerHTML = `
      <div class="form-section-title">Projection Engine — ${(exp*tpy*riskPct*100).toFixed(1)}% Est. Annual Return</div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:12px">Expectancy: ${exp.toFixed(3)}R/trade · ${tpy} trades/year · ${(riskPct*100).toFixed(1)}% risk per trade</p>
      <table class="sim-table"><thead><tr><th>Period</th><th>Projected Capital</th><th>CAGR</th></tr></thead>
      <tbody>${results.map(r => { const cagr = (Math.pow(r.capital/startCap, 1/r.year)-1)*100; return `<tr>
        <td>${r.year} Year${r.year > 1 ? 's' : ''}</td>
        <td class="${r.capital > startCap ? 'sim-gap-pos' : 'sim-gap-neg'} font-mono fw-600">${calc.formatCurrency(r.capital)}</td>
        <td class="${cagr >= 0 ? 'sim-gap-pos' : 'sim-gap-neg'}">${cagr.toFixed(1)}%/yr</td>
      </tr>`; }).join('')}</tbody></table>
      <div class="alert-banner info" style="margin-top:12px;font-size:11px">⚠ Projections are Monte Carlo simulations based on your target parameters. Past performance does not guarantee future results. Phase 2 will include AI-powered analysis.</div>`;
  }

  function _daysDiff(trades) {
    const dates = trades.map(t => t.finalExit?.date || t.entries?.[0]?.date).filter(Boolean).sort();
    if (dates.length < 2) return 365;
    return Math.max(1, (new Date(dates.at(-1)) - new Date(dates[0])) / (1000*60*60*24));
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _sCard(label, value, sub='', cls='') {
    return `<div class="stat-card"><div class="stat-card-label">${label}</div><div class="stat-card-value ${cls}">${value}</div>${sub ? `<div class="stat-card-sub">${sub}</div>` : ''}</div>`;
  }
  function _simRow(label, value) {
    return `<div class="settings-row"><div class="settings-row-label">${label}</div><div class="fw-600">${value}</div></div>`;
  }
  function _makeLineChart(id, labels, data, label, color='#5b6af0') {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return null;
    return new Chart(ctx, { type: 'line', data: { labels, datasets: [{ label, data, borderColor: color, backgroundColor: color + '15', fill: true, tension: 0.3, pointRadius: 2, borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 10 }, maxTicksLimit: 8 } }, y: { ticks: { font: { size: 10 } } } } } });
  }
  function _makeBarChart(id, labels, data, label) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return null;
    const colors  = data.map(v => v >= 0 ? '#22c55e80' : '#ef444480');
    const borders = data.map(v => v >= 0 ? '#22c55e'   : '#ef4444');
    return new Chart(ctx, { type: 'bar', data: { labels, datasets: [{ label, data, backgroundColor: colors, borderColor: borders, borderWidth: 1.5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { font: { size: 10 } } }, y: { ticks: { font: { size: 10 } } } } } });
  }

  // Scatter chart for Holding Period vs Profit R
  function _makeScatterChart(id, points) {
    const ctx = document.getElementById(id)?.getContext('2d');
    if (!ctx) return null;
    const datasets = [
      { label: 'Win',        data: points.filter(p => p.result === 'Win').map(p => ({ x: p.x, y: p.y })),        backgroundColor: 'rgba(34,197,94,0.65)',  pointRadius: 6 },
      { label: 'Loss',       data: points.filter(p => p.result === 'Loss').map(p => ({ x: p.x, y: p.y })),       backgroundColor: 'rgba(239,68,68,0.65)',  pointRadius: 6 },
      { label: 'Break-even', data: points.filter(p => p.result === 'Break-even').map(p => ({ x: p.x, y: p.y })), backgroundColor: 'rgba(148,163,184,0.65)', pointRadius: 6 },
    ];
    return new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'top', labels: { font: { size: 10 } } } },
        scales: {
          x: { title: { display: true, text: 'Holding Days', font: { size: 10 } }, ticks: { font: { size: 10 } } },
          y: { title: { display: true, text: 'Profit (R)',    font: { size: 10 } }, ticks: { font: { size: 10 } } }
        }
      }
    });
  }

  return { init, _simRecalc, _switchCumChart };
})();
