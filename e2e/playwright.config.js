const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  use: {
    baseURL: process.env.FRONTEND_URL || 'http://localhost:5173',
    headless: true,
  },
});
