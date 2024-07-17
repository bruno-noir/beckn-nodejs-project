const express = require('express');
const indexController = require('../controllers/indexController');
const schemeRoutes = require('./schemeRoutes');

const router = express.Router();

// Define a basic route for testing
router.get('/', (req, res) => {
  res.send('Hello, World!'); // Replace with your desired response
});

// Example of using indexController.index
// router.get('/', indexController.index);

// Include schemeRoutes under /schemes
router.use('/schemes', schemeRoutes);

module.exports = router;
