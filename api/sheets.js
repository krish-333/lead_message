const { authed, send, listConnected } = require('./_lib');

// Lists every spreadsheet the service account can see in Google Drive (plus any in SHEET_IDS), with their tabs.
module.exports = async (req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'login' });
  try {
    return send(res, 200, { sheets: await listConnected() });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
};
