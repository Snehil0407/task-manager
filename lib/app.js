'use strict';

const path = require('path');
const express = require('express');
const api = require('./api');

const app = express();

app.use('/api', api);

// Serve the static frontend.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// SPA fallback: any non-API GET returns index.html.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

module.exports = app;
