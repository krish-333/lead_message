const { TRACK, authed, send, digits, q, istNow, readTab, readCell, writeCells, ensureTracking, assertConnected } = require('./_lib');

// Writes tracking values (status, timestamps, outcome, notes) into one row of the sheet.
module.exports = async (req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'login' });
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
  try {
    const { sheetId, tab, row, phone, phoneCol, set } = req.body || {};
    if (!sheetId || !tab || !Number.isInteger(row) || row < 2 || !set || typeof set !== 'object') {
      return send(res, 400, { error: 'Bad request' });
    }
    assertConnected(sheetId);
    // Safety: make sure the row still holds the same phone number (in case the sheet was re-sorted).
    if (phone && Number.isInteger(phoneCol) && phoneCol >= 0) {
      const cell = await readCell(sheetId, tab, row, phoneCol);
      if (digits(cell).slice(-10) !== digits(phone).slice(-10)) {
        return send(res, 409, { error: 'This row changed in the sheet. Refresh and try again.' });
      }
    }
    const header = (await readTab(sheetId, tab, `${q(tab)}!1:1`))[0] || [];
    const map = await ensureTracking(sheetId, tab, header);
    // Guard: if another device already logged this step for this contact, do not log it twice.
    for (const key of ['First Sent', 'Follow-up 1 Sent', 'Follow-up 2 Sent']) {
      if (set[key] === '$now') {
        const existing = await readCell(sheetId, tab, row, map[key]);
        if (existing && String(existing).trim()) {
          return send(res, 409, { error: `Already messaged (${key.replace(' Sent', '')} on ${existing}). Updating your list.` });
        }
      }
    }
    const now = istNow();
    const cells = [], applied = {};
    for (const key of Object.keys(set)) {
      if (!TRACK.includes(key)) continue;
      const v = set[key] === '$now' ? now : String(set[key] == null ? '' : set[key]).slice(0, 500);
      cells.push({ r: row, c: map[key], v });
      applied[key] = v;
    }
    await writeCells(sheetId, tab, cells);
    return send(res, 200, { ok: true, applied });
  } catch (e) {
    const status = e.status || 500;
    return send(res, status, { error: status === 500 ? (e.message || 'Server error').slice(0, 200) : e.message });
  }
};
