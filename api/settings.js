const { authed, send, readSettings, writeSettings } = require('./_lib');

// Settings shared by every device: your name, offer line, message templates, hooks, campaign and column choices.
// GET  /api/settings?sheetId=...            -> { settings: { key: valueString } }
// POST /api/settings { sheetId, set:{...} } -> saves only the keys you send
const ALLOWED = /^(wa_me|wa_offer|wa_hooks|wa_tpl_[a-z]+_[a-z0-9]+|camp_.{1,300}|map_.{1,300})$/;

module.exports = async (req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'login' });
  try {
    if (req.method === 'POST') {
      const { sheetId, set } = req.body || {};
      if (!sheetId || !set || typeof set !== 'object') return send(res, 400, { error: 'Bad request' });
      const clean = {};
      for (const [k, v] of Object.entries(set)) {
        if (ALLOWED.test(k) && typeof v === 'string') clean[k] = v;
      }
      if (Object.keys(clean).length > 80) return send(res, 400, { error: 'Too many settings at once' });
      await writeSettings(sheetId, clean);
      return send(res, 200, { ok: true, saved: Object.keys(clean).length });
    }
    const { sheetId } = req.query || {};
    if (!sheetId) return send(res, 400, { error: 'sheetId is required' });
    return send(res, 200, { settings: await readSettings(sheetId), syncedAt: Date.now() });
  } catch (e) {
    const status = e.status || 500;
    return send(res, status, { error: status === 500 ? (e.message || 'Server error').slice(0, 200) : e.message });
  }
};
