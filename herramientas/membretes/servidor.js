// Servidor local mínimo para el generador de membretes: sirve membretes.html y el logo, y
// guarda los PNG generados en public/. Uso: node herramientas/membretes/servidor.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLICO = path.join(__dirname, '..', '..', 'public');
const PERMITIDOS = new Set(['membrete-cotizacion.png', 'membrete-orden-servicio.png']);
const PUERTO = process.env.PORT || 3301;

http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/membretes.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'membretes.html')).pipe(res);
  }
  if (req.method === 'GET' && req.url === '/logo-saneadren.png') {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    return fs.createReadStream(path.join(PUBLICO, 'logo-saneadren.png')).pipe(res);
  }
  const m = req.method === 'POST' && req.url.match(/^\/guardar\/([\w.-]+)$/);
  if (m && PERMITIDOS.has(m[1])) {
    const partes = [];
    req.on('data', p => partes.push(p));
    req.on('end', () => {
      fs.writeFileSync(path.join(PUBLICO, m[1]), Buffer.concat(partes));
      res.end('ok');
    });
    return;
  }
  res.writeHead(404); res.end('No encontrado');
}).listen(PUERTO, '127.0.0.1', () => console.log(`Generador de membretes en http://localhost:${PUERTO}`));
