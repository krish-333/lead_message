const { authed, send, readTab, ensureTracking } = require('./_lib');

// Reads one tab, adds the tracking columns if they are missing, returns all rows.
module.exports = async (req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'login' });
  try {
    const { sheetId, tab } = req.query || {};
    if (!sheetId || !tab) return send(res, 400, { error: 'sheetId and tab are required' });
    const values = await readTab(sheetId, tab);
    if (!values.length) return send(res, 200, { headers: [], rows: [], track: {}, syncedAt: Date.now() });
    const track = await ensureTracking(sheetId, tab, values[0]);
    const headers = values[0].slice();
    Object.entries(track).forEach(([name, i]) => { if (!headers[i]) headers[i] = name; });
    const rows = [];
    values.slice(1).forEach((v, i) => { if (v.some((c) => String(c).trim())) rows.push({ r: i + 2, v }); });
    return send(res, 200, { headers, rows, track, syncedAt: Date.now() });
  } catch (e) {
    const status = e.status || 500;
    return send(res, status, { error: status === 500 ? (e.message || 'Server error').slice(0, 200) : e.message });
  }
};
