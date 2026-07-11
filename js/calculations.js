/**
 * calculations.js — All Business Formula Computations
 * Pure functions. No side effects. No localStorage access.
 */

const calc = (() => {

  // ── Trade Metrics (SSOT) ───────────────────────────────────────────────────
  function getTradeMetrics(trade) {
    if (!trade || !trade.entries || trade.entries.length === 0) return _emptyMetrics();

    const entries = trade.entries || [];
    const pyramids = trade.pyramids || [];
    const partialExits = trade.partialExits || [];
    const finalExit = trade.finalExit || null;

    // Quantities
    const entryQty = entries.reduce((s, e) => s + Number(e.qty || 0), 0);
    const pyramidQty = pyramids.reduce((s, p) => s + Number(p.qty || 0), 0);
    const totalBuyQty = entryQty + pyramidQty;

    const partialExitQty = partialExits.reduce((s, p) => s + Number(p.qty || 0), 0);
    const finalExitQty = finalExit ? Number(finalExit.qty || 0) : 0;
    const totalSellQty = partialExitQty + finalExitQty;
    const openQty = totalBuyQty - totalSellQty;
    const remainingQty = openQty; // alias

    // Average Entry Price (weighted)
    const totalBuyCost = entries.reduce((s, e) => s + (Number(e.qty || 0) * Number(e.price || 0)), 0)
      + pyramids.reduce((s, p) => s + (Number(p.qty || 0) * Number(p.price || 0)), 0);
    const avgEntryPrice = totalBuyQty > 0 ? totalBuyCost / totalBuyQty : 0;

    // Average Exit Price (weighted)
    const totalSellRevenue = partialExits.reduce((s, p) => s + (Number(p.qty || 0) * Number(p.price || 0)), 0)
      + (finalExit ? Number(finalExit.qty || 0) * Number(finalExit.price || 0) : 0);
    const avgExitPrice = totalSellQty > 0 ? totalSellRevenue / totalSellQty : 0;

    // Charges
    const totalBuyCharges = entries.reduce((s, e) => s + Number(e.charges || 0), 0)
      + pyramids.reduce((s, p) => s + Number(p.charges || 0), 0);
    const totalSellCharges = partialExits.reduce((s, p) => s + Number(p.charges || 0), 0)
      + (finalExit ? Number(finalExit.charges || 0) : 0);
    const totalCharges = totalBuyCharges + totalSellCharges;

    // Current Stop
    const currentStop = trade.currentStop !== undefined ? Number(trade.currentStop)
      : (trade.stopRevisions && trade.stopRevisions.length > 0
        ? Number(trade.stopRevisions[trade.stopRevisions.length - 1].newStop)
        : Number(trade.initialStop || 0));

    // RPT (never decreases once set; grows if current risk exceeds it)
    const initialRPT = Number(trade.rpt || trade.initialRPT || db.getSettings().tradingDefaults?.defaultRPT || 10000);

    // Current Exposure
    const exposure = avgEntryPrice * openQty;

    // Position Size (max capital ever deployed — doesn't decrease)
    const maxExposureEver = Number(trade.positionSizeMax || exposure);
    const positionSize = Math.max(maxExposureEver, exposure);

    // Current Position Risk
    let currentRisk = 0;
    if (openQty > 0 && currentStop > 0) {
      if (trade.direction === 'Long') {
        currentRisk = (currentStop - avgEntryPrice) * openQty;
      } else {
        currentRisk = (avgEntryPrice - currentStop) * openQty;
      }
    }

    // Current Position Risk in R
    const rptToUse = Math.max(initialRPT, trade.rptCurrent || initialRPT);
    const currentRiskR = rptToUse !== 0 ? currentRisk / rptToUse : 0;

    // Net Realized P&L
    let realizedPnl = 0;
    if (totalSellQty > 0) {
      if (trade.direction === 'Long') {
        realizedPnl = (avgExitPrice - avgEntryPrice) * totalSellQty;
      } else {
        realizedPnl = (avgEntryPrice - avgExitPrice) * totalSellQty;
      }
      realizedPnl -= totalCharges;
    }

    // Unrealized P&L (needs CMP — passed separately)
    // We compute it outside when CMP is known

    // Profit R (realized)
    const profitR = rptToUse !== 0 ? realizedPnl / rptToUse : 0;

    // Return %
    const profitPct = positionSize > 0 ? (realizedPnl / positionSize) * 100 : 0;

    // Holding Days
    const entryDate = entries.length > 0 ? new Date(entries[0].date) : new Date();
    const exitDate = finalExit ? new Date(finalExit.date) : new Date();
    const holdingDays = Math.ceil((exitDate - entryDate) / (1000 * 60 * 60 * 24));

    return {
      entryQty, pyramidQty, totalBuyQty,
      partialExitQty, finalExitQty, totalSellQty,
      openQty, remainingQty,
      avgEntryPrice, avgExitPrice,
      totalCharges,
      currentStop, initialRPT, rptCurrent: rptToUse,
      exposure, positionSize,
      currentRisk, currentRiskR,
      realizedPnl, profitR, profitPct,
      holdingDays,
      isOpen: openQty > 0
    };
  }

  function _emptyMetrics() {
    return {
      entryQty: 0, pyramidQty: 0, totalBuyQty: 0,
      partialExitQty: 0, finalExitQty: 0, totalSellQty: 0,
      openQty: 0, remainingQty: 0,
      avgEntryPrice: 0, avgExitPrice: 0,
      totalCharges: 0,
      currentStop: 0, initialRPT: 0, rptCurrent: 0,
      exposure: 0, positionSize: 0,
      currentRisk: 0, currentRiskR: 0,
      realizedPnl: 0, profitR: 0, profitPct: 0,
      holdingDays: 0, isOpen: false
    };
  }

  // ── Unrealized P&L ─────────────────────────────────────────────────────────
  function getUnrealizedPnl(trade, cmp) {
    const m = getTradeMetrics(trade);
    if (m.openQty <= 0 || !cmp) return 0;
    if (trade.direction === 'Long') {
      return (cmp - m.avgEntryPrice) * m.openQty;
    } else {
      return (m.avgEntryPrice - cmp) * m.openQty;
    }
  }

  // ── Portfolio Heat ─────────────────────────────────────────────────────
  // Portfolio heat = sum of OPEN risk R for all positions (always positive)
  function getPortfolioHeat(openTrades, currentR) {
    if (!openTrades || openTrades.length === 0) return 0;
    return openTrades.reduce((sum, trade) => {
      const m = getTradeMetrics(trade);
      // Only count positions that are still at risk (below stop for Long, above stop for Short)
      // currentRisk is already signed (negative = at loss); take absolute value
      const riskR = m.initialRPT > 0 ? Math.abs(m.currentRisk) / m.initialRPT : 0;
      return sum + riskR;
    }, 0);
  }

  // ── Capital ────────────────────────────────────────────────────────────────
  function getCurrentEquity(capitalTxns, realizedPnl = 0) {
    const netDeposits = capitalTxns.reduce((sum, txn) => {
      if (txn.type === 'Deposit' || txn.type === 'Adjustment') return sum + Number(txn.amount || 0);
      if (txn.type === 'Withdrawal') return sum - Number(txn.amount || 0);
      return sum;
    }, 0);
    return netDeposits + realizedPnl;
  }

  function getNetDeposits(capitalTxns) {
    return capitalTxns.reduce((sum, txn) => {
      if (txn.type === 'Deposit' || txn.type === 'Adjustment') return sum + Number(txn.amount || 0);
      if (txn.type === 'Withdrawal') return sum - Number(txn.amount || 0);
      return sum;
    }, 0);
  }

  function getCurrentR(equity, settings) {
    const rm = settings?.riskManagement || {};
    const riskMode = rm.riskMode || 'Dynamic';
    if (riskMode === 'Fixed') {
      // Fixed mode: use fixedRiskAmount from Risk Management settings
      return Number(rm.fixedRiskAmount || 10000);
    }
    // Dynamic mode: % of current equity
    const riskPercent = Number(rm.riskPercent || 1) / 100;
    return equity * riskPercent;
  }

  function getAvailableCash(equity, openTrades) {
    const totalExposure = openTrades.reduce((sum, t) => {
      const m = getTradeMetrics(t);
      return sum + m.exposure;
    }, 0);
    return equity - totalExposure;
  }

  // ── Performance Metrics ────────────────────────────────────────────────────
  function getWinRate(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return 0;
    const winners = closedTrades.filter(t => {
      const m = getTradeMetrics(t);
      return m.realizedPnl > 0;
    });
    return (winners.length / closedTrades.length) * 100;
  }

  function getAvgWinLoss(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return { avgWin: 0, avgLoss: 0, avgWinR: 0, avgLossR: 0 };
    const metrics = closedTrades.map(t => getTradeMetrics(t));
    const winners = metrics.filter(m => m.realizedPnl > 0);
    const losers = metrics.filter(m => m.realizedPnl < 0);
    const avgWin = winners.length > 0 ? winners.reduce((s, m) => s + m.realizedPnl, 0) / winners.length : 0;
    const avgLoss = losers.length > 0 ? losers.reduce((s, m) => s + m.realizedPnl, 0) / losers.length : 0;
    const avgWinR = winners.length > 0 ? winners.reduce((s, m) => s + m.profitR, 0) / winners.length : 0;
    const avgLossR = losers.length > 0 ? losers.reduce((s, m) => s + m.profitR, 0) / losers.length : 0;
    return { avgWin, avgLoss, avgWinR, avgLossR, winCount: winners.length, lossCount: losers.length };
  }

  function getExpectancy(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return 0;
    const wr = getWinRate(closedTrades) / 100;
    const lr = 1 - wr;
    const { avgWinR, avgLossR } = getAvgWinLoss(closedTrades);
    return (wr * avgWinR) + (lr * avgLossR);
  }

  function getMaxDrawdown(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return 0;
    const sorted = [...closedTrades].sort((a, b) => {
      const da = a.entries?.[0]?.date || '';
      const db2 = b.entries?.[0]?.date || '';
      return da.localeCompare(db2);
    });
    let peak = 0, maxDD = 0, cumR = 0;
    sorted.forEach(t => {
      const m = getTradeMetrics(t);
      cumR += m.profitR;
      if (cumR > peak) peak = cumR;
      const dd = cumR - peak;
      if (dd < maxDD) maxDD = dd;
    });
    return maxDD;
  }

  function getTotalPnl(trades) {
    return trades.reduce((s, t) => s + getTradeMetrics(t).realizedPnl, 0);
  }

  function getTotalR(trades) {
    return trades.reduce((s, t) => s + getTradeMetrics(t).profitR, 0);
  }

  // ── Daily P&L Data (for charts) ────────────────────────────────────────────
  function getDailyPnl(closedTrades) {
    if (!closedTrades || closedTrades.length === 0) return [];

    // Group by exit date
    const byDate = {};
    closedTrades.forEach(t => {
      const m = getTradeMetrics(t);
      const date = t.finalExit?.date || t.entries?.[0]?.date || '';
      if (!date) return;
      const d = date.split('T')[0];
      if (!byDate[d]) byDate[d] = 0;
      byDate[d] += m.realizedPnl;
    });

    const dates = Object.keys(byDate).sort();
    let cumPnl = 0;
    return dates.map(date => {
      cumPnl += byDate[date];
      return { date, pnl: byDate[date], cumPnl };
    });
  }

  function getMonthlyPnl(closedTrades) {
    const byMonth = {};
    closedTrades.forEach(t => {
      const m = getTradeMetrics(t);
      const date = t.finalExit?.date || t.entries?.[0]?.date || '';
      if (!date) return;
      const key = date.substring(0, 7); // YYYY-MM
      if (!byMonth[key]) byMonth[key] = { pnl: 0, trades: 0 };
      byMonth[key].pnl += m.realizedPnl;
      byMonth[key].trades++;
    });
    return byMonth;
  }

  // ── Date Filtering ─────────────────────────────────────────────────────────
  function filterByDateRange(trades, range, customStart, customEnd) {
    const now = new Date();
    let startDate;
    let endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (range) {
      case 'Weekly':
        startDate = new Date(now); startDate.setDate(now.getDate() - 7); break;
      case 'Monthly':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'Quarterly':
        const qMonth = Math.floor(now.getMonth() / 3) * 3;
        startDate = new Date(now.getFullYear(), qMonth, 1); break;
      case 'Yearly':
        startDate = new Date(now.getFullYear(), 0, 1); break;
      case 'YTD':
        startDate = new Date(now.getFullYear(), 3, 1); // April (Indian FY)
        if (now < startDate) startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      case 'Custom':
        startDate = customStart ? new Date(customStart) : new Date(0);
        endDate = customEnd ? new Date(customEnd) : endDate;
        break;
      default: // 'All'
        return trades;
    }

    return trades.filter(t => {
      const exitDate = t.finalExit?.date || t.entries?.[0]?.date;
      if (!exitDate) return false;
      const d = new Date(exitDate);
      return d >= startDate && d <= endDate;
    });
  }

  // ── Zerodha Charge Calculator ──────────────────────────────────────────────
  function getZerodhaCharges(tradeType, buyTurnover, sellTurnover, settings, exchange = 'NSE') {
    const cfg = settings?.charges || {};
    let brokerage = 0, stt = 0, exchangeCharge = 0, sebiCharge = 0, gst = 0, stampDuty = 0;
    const totalTurnover = buyTurnover + sellTurnover;

    // BSE standard transaction charge for equity segments
    const bseRate = 0.0000375;

    if (tradeType === 'Equity') {
      const c = cfg.equity || {};
      brokerage = Number(c.brokerage ?? 0);
      stt = totalTurnover * Number(c.stt ?? 0.001);
      const exRate = exchange === 'BSE' ? bseRate : Number(c.exchangeCharge ?? 0.0000335);
      exchangeCharge = totalTurnover * exRate;
      sebiCharge = totalTurnover * Number(c.sebiCharge ?? 0.000001);
      gst = (brokerage + exchangeCharge + sebiCharge) * Number(c.gst ?? 0.18);
      stampDuty = buyTurnover * Number(c.stampDuty ?? 0.00015);
    } else if (tradeType === 'Intraday') {
      const c = cfg.intraday || {};
      const brokerageFlat = Number(c.brokerage ?? 20);
      const brokeragePct = totalTurnover * Number(c.brokeragePercent ?? 0.0003);
      brokerage = Math.min(brokerageFlat, brokeragePct);
      stt = sellTurnover * Number(c.stt ?? 0.00025);
      const exRate = exchange === 'BSE' ? bseRate : Number(c.exchangeCharge ?? 0.0000335);
      exchangeCharge = totalTurnover * exRate;
      sebiCharge = totalTurnover * Number(c.sebiCharge ?? 0.000001);
      gst = (brokerage + exchangeCharge + sebiCharge) * Number(c.gst ?? 0.18);
      stampDuty = buyTurnover * Number(c.stampDuty ?? 0.00003);
    } else if (tradeType === 'Futures') {
      const c = cfg.futures || {};
      const brokerageFlat = Number(c.brokerage ?? 20);
      const brokeragePct = totalTurnover * Number(c.brokeragePercent ?? 0.0003);
      brokerage = Math.min(brokerageFlat, brokeragePct);
      stt = sellTurnover * Number(c.stt ?? 0.0002);
      const exRate = exchange === 'BSE' ? 0 : Number(c.exchangeCharge ?? 0.00002);
      exchangeCharge = totalTurnover * exRate;
      sebiCharge = totalTurnover * Number(c.sebiCharge ?? 0.000001);
      gst = (brokerage + exchangeCharge + sebiCharge) * Number(c.gst ?? 0.18);
      stampDuty = buyTurnover * Number(c.stampDuty ?? 0.00002);
    }

    const total = brokerage + stt + exchangeCharge + sebiCharge + gst + stampDuty;
    return { brokerage, stt, exchangeCharge, sebi: sebiCharge, gst, stampDuty, total };
  }

  // ── Utility ────────────────────────────────────────────────────────────────
  function isBreakEven(profitR) {
    return Math.abs(profitR) <= 0.3;
  }

  function getTradeResult(trade) {
    const m = getTradeMetrics(trade);
    if (m.realizedPnl > 0 && !isBreakEven(m.profitR)) return 'Win';
    if (m.realizedPnl < 0 && !isBreakEven(m.profitR)) return 'Loss';
    return 'Break-even';
  }

  function formatCurrency(amount, decimals = 0) {
    if (isNaN(amount)) return '₹0';
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';
    if (abs >= 10000000) return `${sign}₹${(abs / 10000000).toFixed(2)}Cr`;
    if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(2)}L`;
    if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
    return `${sign}₹${abs.toFixed(decimals)}`;
  }

  function formatR(r, decimals = 2) {
    if (isNaN(r)) return '0R';
    const sign = r >= 0 ? '+' : '';
    return `${sign}${r.toFixed(decimals)}R`;
  }

  function formatDate(dateStr, format = 'DD-MM-YYYY') {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    if (format === 'DD-MM-YYYY') return `${day}-${month}-${year}`;
    if (format === 'MM-DD-YYYY') return `${month}-${day}-${year}`;
    return `${year}-${month}-${day}`;
  }

  function formatNumber(n, dec = 2) {
    if (isNaN(n)) return '0';
    return Number(n).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  function getHoldingDays(trade) {
    const m = getTradeMetrics(trade);
    return m.holdingDays;
  }

  function getCAGR(startEquity, endEquity, years) {
    if (startEquity <= 0 || years <= 0) return 0;
    return (Math.pow(endEquity / startEquity, 1 / years) - 1) * 100;
  }

  function getDrawdownCurve(closedTrades) {
    const dailyData = getDailyPnl(closedTrades);
    let peak = 0, cumR = 0;
    return dailyData.map(d => {
      if (d.cumPnl > peak) peak = d.cumPnl;
      const dd = peak > 0 ? ((d.cumPnl - peak) / peak) * 100 : 0;
      return { date: d.date, drawdown: dd };
    });
  }

  return {
    getTradeMetrics, getUnrealizedPnl,
    getPortfolioHeat,
    getCurrentEquity, getNetDeposits, getCurrentR, getAvailableCash,
    getWinRate, getAvgWinLoss, getExpectancy, getMaxDrawdown,
    getTotalPnl, getTotalR,
    getDailyPnl, getMonthlyPnl, getDrawdownCurve,
    filterByDateRange,
    getZerodhaCharges,
    isBreakEven, getTradeResult,
    formatCurrency, formatR, formatDate, formatNumber,
    getHoldingDays, getCAGR
  };
})();
