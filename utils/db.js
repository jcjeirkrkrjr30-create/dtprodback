const mysql = require('mysql2/promise');
const { config } = require('../config');

const pool = mysql.createPool(config.db);

module.exports = {
  query: async (sql, params) => {
    try {
      const [results] = await pool.execute(sql, params);
      console.log(`Database query executed successfully: ${sql}`, { params, resultCount: results?.length || 0 });
      return results;
    } catch (error) {
      console.error('Database query error:', {
        sql,
        params,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  },
  pool, // Export pool for raw queries
};

// Test database connection on startup
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('Database connected successfully:', {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
    });
    connection.release();
  } catch (error) {
    console.error('Database connection failed:', {
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      error: error.message,
      stack: error.stack,
    });
    throw error; // Throw to crash startup if DB fails (Render will show in logs)
  }
}
testConnection(); // Run on server start
