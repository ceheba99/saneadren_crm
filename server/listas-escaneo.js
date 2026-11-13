// Encuentra TODAS las listas desplegables (<select>) de las pantallas (public/*.html y public/*.js) y les da una clave
// estable: el id («gasto-categoria»; si el id lleva una parte variable, «gc-servicio-*»), o el atributo data-…
// con su valor fijo («data-fx-o=uso_cfdi»), o la primera clase («rg-metodo»). Lo usan la prueba que exige que cada lista
// esté en el inventario (server/listas-inventario.js) y la pantalla «Listas desplegables» para decir cuántas hay.
// Se saltan los <select> que aparecen dentro de un comentario (renglones que empiezan con //, /* o *).
const fs = require('fs'), path = require('path');
const PUBLICO = path.join(__dirname, '..', 'public');

function claveDe(attrs) {
  const id = /\bid="([^"]*)"/.exec(attrs);
  if (id && !id[1].startsWith('$')) return id[1].replace(/\$\{[^}]*\}.*$/, '*');
  const data = /\b(data-[a-z-]+)(?:="([^"$'+]*)")?/.exec(attrs);
  if (data) return data[1] + (data[2] ? '=' + data[2] : '');
  const clase = /\bclass="([^"\s$']+)/.exec(attrs);
  if (clase) return clase[1];
  return null;
}

function escanear(dir = PUBLICO) {
  const salida = [];
  for (const archivo of fs.readdirSync(dir).filter(f => /\.(html|js)$/.test(f)).sort()) {
    const texto = fs.readFileSync(path.join(dir, archivo), 'utf8');
    // Comentarios de bloque que empiezan al inicio de un renglón (así no confunde «image/*» con un comentario).
    const bloques = [...texto.matchAll(/^[ \t]*\/\*[\s\S]*?\*\//gm)].map(b => [b.index, b.index + b[0].length]);
    for (const m of texto.matchAll(/<select\b([^>]*)>/g)) {
      const inicio = texto.lastIndexOf('\n', m.index) + 1, antes = texto.slice(inicio, m.index).trim();
      if (/^(\/\/|\*)/.test(antes) || bloques.some(([a, b]) => m.index > a && m.index < b)) continue;
      salida.push({ archivo, linea: texto.slice(0, m.index).split('\n').length, clave: claveDe(m[1]) || 'sin-nombre@' + archivo });
    }
  }
  return salida;
}

module.exports = { escanear, claveDe };
if (require.main === module) for (const x of escanear()) console.log(`${x.archivo}:${x.linea}\t${x.clave}`);
