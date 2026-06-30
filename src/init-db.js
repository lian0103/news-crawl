const { initDatabase } = require('./db');

async function run() {
  try {
    console.log('Initializing database...');
    await initDatabase();
    console.log('Database initialized successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  }
}

run();
