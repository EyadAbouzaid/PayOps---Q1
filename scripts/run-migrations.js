require('dotenv').config();
const db = require('../shared/db');

db.runMigrationsAndSeed()
  .then(() => {
    console.log('Migrations & seed completed successfully.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Migration error:', err);
    process.exit(1);
  });
