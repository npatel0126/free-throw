// Vercel Function for every /api/ request. vercel.json rewrites /api/<route> here as
// ?route=<route>; Vercel serves public/ itself.

import { handle } from '../server/app.js';

export default function handler(req, res) {
  const route = new URL(req.url, 'http://localhost').searchParams.get('route') ?? '';
  return handle(req, res, `/api/${route}`);
}
