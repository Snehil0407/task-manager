'use strict';

// Vercel Serverless Function entry point.
// Vercel routes every request here (see vercel.json) and the Express app
// handles both the static frontend and the /api routes.
module.exports = require('../lib/app');
