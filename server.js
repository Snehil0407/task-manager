'use strict';

// Local runner. On Vercel, api/index.js is used instead.
const app = require('./lib/app');
const { ensure } = require('./lib/db');

const BASE_PORT = parseInt(process.env.PORT, 10) || 3000;
const MAX_TRIES = 10;

function listen(port, triesLeft) {
  const server = app.listen(port, () => {
    console.log(`\n  SA Kumar Task Manager running:  http://localhost:${port}\n`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      console.warn(`  Port ${port} is busy, trying ${port + 1}…`);
      listen(port + 1, triesLeft - 1);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`\n  Could not find a free port (tried ${BASE_PORT}–${port}).`);
      console.error('  Close the other app using these ports, or run with a custom one:');
      console.error('    PowerShell:  $env:PORT=4000; npm start\n');
      process.exit(1);
    } else {
      throw err;
    }
  });
}

ensure().then(() => listen(BASE_PORT, MAX_TRIES));

module.exports = app;
