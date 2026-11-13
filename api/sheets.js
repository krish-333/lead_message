const { authed, send, listConnected } = require('./_lib');

// Lists the spreadsheets connected through the SHEET_IDS setting, with their tabs.
module.exports = async (req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'login' });
  try {
    return send(res, 200, { sheets: await listConnected() });
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
};
