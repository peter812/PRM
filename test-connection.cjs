// Test MySQL connection
const mysql = require('mysql2/promise');

async function testConnection() {
  try {
    console.log('Testing MySQL connection to pbe.im:3306...');
    const connection = await mysql.createConnection({
      host: 'pbe.im',
      port: 3306,
      user: 'people',
      password: 'people812',
      database: 'people'
    });
    
    console.log('✓ MySQL connection successful!');
    
    // Test query
    const [rows] = await connection.execute('SELECT DATABASE() as db, VERSION() as version');
    console.log('Database:', rows[0].db);
    console.log('Version:', rows[0].version);
    
    // Show tables
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('Tables:', tables);
    
    await connection.end();
  } catch (error) {
    console.error('MySQL connection failed:', error.message);
    
    // Try PostgreSQL
    console.log('\nTesting PostgreSQL connection...');
    const { Pool } = require('pg');
    const pool = new Pool({
      host: 'pbe.im',
      port: 3306,
      user: 'people',
      password: 'people812',
      database: 'people',
      ssl: false
    });
    
    try {
      const result = await pool.query('SELECT version()');
      console.log('✓ PostgreSQL connection successful!');
      console.log('Version:', result.rows[0].version);
      await pool.end();
    } catch (pgError) {
      console.error('PostgreSQL connection failed:', pgError.message);
    }
  }
}

testConnection();
