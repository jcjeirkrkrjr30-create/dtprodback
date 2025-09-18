const mysql = require('mysql2/promise');
const { config } = require('../config');

const pool = mysql.createPool(config.db);

module.exports = {
  query: async (sql, params) => {
    try {
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    }
  },
  pool, // Export pool for raw queries
};