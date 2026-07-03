/**
 * alerts.js — Alert Engine
 * Evaluates alert conditions for all open trades.
 */
const alertEngine = (() => {

  const ALERT_TYPES = {
    DAY5_EXIT: 'Day-5 Exit Due',
    ATR_EXTENSION: 'ATR Extension Reached',
    EMA20_DISTANCE: 'EMA20 Distance Reached',
    EMA20_BREAKDOWN: 'EMA20 Breakdown Alert',
    STOP_BREACH: 'Stop Loss Breach',
    CUSTOM_RULE: 'Custom Rule Alert'
  };

  const ALERT_STATUS = { PENDING: 'Pending', TRIGGERED: 'Triggered', COMPLETED: 'Completed', DISMISSED: 'Dismissed' };

  function checkAllAlerts(openTrades) {
    const settings = db.getSettings();
    const alertConfig = settings.alerts || {};
    const updated = [];

    openTrades.forEach(trade => {
      const alerts = [...(trade.alerts || [])];
      const m = calc.getTradeMetrics(trade);
      const holdingDays = m.holdingDays;
      const dirty = { changed: false };

      // Day-5 Exit Due
      if (alertConfig.day5Exit?.enabled !== false) {
        _upsertAlert(alerts, ALERT_TYPES.DAY5_EXIT, holdingDays >= 5, dirty);
      }

      // Stop Loss Breach
      if (alertConfig.stopLossBreach?.enabled !== false && trade.cmp) {
        const breached = trade.direction === 'Long'
          ? trade.cmp <= m.currentStop
          : trade.cmp >= m.currentStop;
        _upsertAlert(alerts, ALERT_TYPES.STOP_BREACH, breached, dirty);
      }

      if (dirty.changed) {
        updated.push({ ...trade, alerts });
        db.saveTrade({ ...trade, alerts });
      }
    });

    return updated;
  }

  function _upsertAlert(alerts, type, condition, dirty) {
    const existing = alerts.find(a => a.type === type);
    if (condition) {
      if (!existing) {
        alerts.push({ type, status: ALERT_STATUS.TRIGGERED, triggeredAt: new Date().toISOString() });
        dirty.changed = true;
      } else if (existing.status === ALERT_STATUS.PENDING) {
        existing.status = ALERT_STATUS.TRIGGERED;
        existing.triggeredAt = new Date().toISOString();
        dirty.changed = true;
      }
    }
  }

  function getActiveAlerts(trades) {
    const all = [];
    trades.forEach(trade => {
      (trade.alerts || []).forEach(alert => {
        if (alert.status === ALERT_STATUS.TRIGGERED) {
          all.push({ ...alert, tradeId: trade.id, symbol: trade.symbol, entryDate: trade.entries?.[0]?.date });
        }
      });
    });
    return all;
  }

  function dismissAlert(tradeId, alertType) {
    const trade = db.getTradeById(tradeId);
    if (!trade) return;
    const alerts = (trade.alerts || []).map(a =>
      a.type === alertType ? { ...a, status: ALERT_STATUS.DISMISSED } : a
    );
    db.saveTrade({ ...trade, alerts });
  }

  function completeAlert(tradeId, alertType) {
    const trade = db.getTradeById(tradeId);
    if (!trade) return;
    const alerts = (trade.alerts || []).map(a =>
      a.type === alertType ? { ...a, status: ALERT_STATUS.COMPLETED } : a
    );
    db.saveTrade({ ...trade, alerts });
  }

  return { ALERT_TYPES, ALERT_STATUS, checkAllAlerts, getActiveAlerts, dismissAlert, completeAlert };
})();
