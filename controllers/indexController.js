const fetchData = require('../utils/fetchData');

async function index(req, res) {
  const q = "SELECT * FROM concept WHERE id=35";
  const rows = await fetchData(q);
  res.send("Hello, world. You're at the polls index.");
}

module.exports = { index };
