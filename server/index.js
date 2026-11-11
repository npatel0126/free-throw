// A zero-dependency HTTP server for running Free Throw on your own machine or any Node host.

import { createServer } from 'node:http';
import { handle, warm } from './app.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';

createServer((req, res) => handle(req, res)).listen(PORT, HOST, () => {
  console.log(`Free Throw is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  warm();
});
