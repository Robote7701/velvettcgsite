const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const portraits = require('../portrait-info.js');
const files = {
  '/': ['index.html', 'text/html'],
  '/index.html': ['index.html', 'text/html'],
  '/save-storage.js': ['save-storage.js', 'text/javascript'],
  '/profile-info.js': ['profile-info.js', 'text/javascript'],
  '/profile-info.css': ['profile-info.css', 'text/css'],
  '/booster-effects.css': ['booster-effects.css', 'text/css'],
  '/booster-audio.js': ['booster-audio.js', 'text/javascript'],
  '/portrait-info.js': ['portrait-info.js', 'text/javascript'],
  '/data/portraits.json': ['data/portraits.json', 'application/json'],
  '/data/personalities.json': ['data/personalities.json', 'application/json']
};
http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  let file = Object.hasOwn(files,route) ? files[route] : null;
  if (/^\/assets\/portraits\/(?:[1-9]|[1-9][0-9]|100)\.(?:jpg|png|webp)$/.test(route)) {
    try {
      const manifest=portraits.validate(JSON.parse(await fs.readFile(path.join(__dirname,'../data/portraits.json'),'utf8')));
      if(Object.values(manifest.portraits).some(entry=>'/'+entry.src===route))file=[route.slice(1),route.endsWith('.jpg')?'image/jpeg':route.endsWith('.png')?'image/png':'image/webp'];
    }catch{}
  }
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  try {
    const content = await fs.readFile(path.join(__dirname, '..', file[0]));
    res.writeHead(200, { 'Content-Type': file[1] + (file[1].startsWith('image/') ? '' : '; charset=utf-8'), 'Cache-Control': 'no-store', 'X-Content-Type-Options':'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(500); res.end('Lecture impossible'); }
}).listen(8080, '127.0.0.1', () => console.log('Velvet Collection : http://127.0.0.1:8080 (Ctrl+C pour arrêter)'));
