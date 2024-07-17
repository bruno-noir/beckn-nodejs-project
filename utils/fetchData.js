const { QueryTypes } = require('sequelize');
const sequelize = require('../config/db');

async function fetchData(query) {
  try {
    const result = await sequelize.query(query, { type: QueryTypes.SELECT });
    return result;
  } catch (error) {
    console.error('Error fetching data:', error);
    return [];
  }
}

module.exports = fetchData;
