const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'sa\\SQLEXPRESS',        // your MySQL username
  password: '123456',
  database: 'CryptoManagementSystem',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

async function testConnection() {
  try {
    const [rows] = await pool.query('SELECT 1');
    console.log('✅ Connected to MySQL');
  } catch (err) {
    console.error('❌ Connection failed:', err);
  }
}

testConnection();

module.exports = pool;
