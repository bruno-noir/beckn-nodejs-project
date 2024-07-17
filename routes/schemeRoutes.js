const express = require('express');
const schemeController = require('../controllers/schemeController');

const router = express.Router();

// Define your routes here
router.get('/fulfillments/:schemeId', async (req, res) => {
  const schemeId = req.params.schemeId;
  const data = await schemeController.getFulfillmentsData(schemeId);
  res.json(data);
});

module.exports = router;
