// Simulación del criterio de vida (mismo cálculo que el kiosco) con secuencias ruidosas.
const mediana = l => { const o = [...l].sort((a, b) => a - b); return o.length ? o[Math.floor(o.length / 2)] : 0; };
function vida(cuadros) {
  const abiertos = [], giros = []; let cerro = false, giro = false, vivo = false;
  for (const { ojo, g } of cuadros) {
    const base = mediana(abiertos), cerrados = abiertos.length >= 3 && ojo < base * 0.8;
    if (!cerrados) { abiertos.push(ojo); if (abiertos.length > 9) abiertos.shift(); }
    if (giros.length < 4) giros.push(g);
    if (!vivo && abiertos.length >= 3) {
      if (!cerro && cerrados) cerro = true; else if (cerro && ojo > base * 0.9) vivo = true;
      const dg = Math.abs(g - mediana(giros)); if (giros.length >= 4) { if (dg > 0.12) giro = true; else if (giro && dg < 0.05) vivo = true; }
    }
    if (vivo) return true;
  }
  return false;
}
const r = (m, d) => m + (Math.random() - 0.5) * 2 * d;
let res = { persona: 0, foto: 0, fotoMovida: 0, giro: 0, personaConPico: 0 }; const N = 2000;
for (let i = 0; i < N; i++) {
  // Persona, 3 cuadros por segundo: 2 s abiertos, ~1 s cerrados (3 cuadros), 1 s abiertos.
  res.persona += vida([...Array(6)].map(() => ({ ojo: r(0.28, 0.03), g: r(0, 0.02) })).concat([...Array(3)].map(() => ({ ojo: r(0.15, 0.03), g: r(0, 0.02) })), [...Array(3)].map(() => ({ ojo: r(0.28, 0.03), g: r(0, 0.02) }))));
  // Persona con un cuadro mal medido muy alto al inicio (el caso que antes se atoraba).
  res.personaConPico += vida([{ ojo: 0.48, g: 0 }].concat([...Array(5)].map(() => ({ ojo: r(0.28, 0.03), g: r(0, 0.02) })), [...Array(3)].map(() => ({ ojo: r(0.15, 0.03), g: r(0, 0.02) })), [...Array(3)].map(() => ({ ojo: r(0.28, 0.03), g: r(0, 0.02) }))));
  // Persona que voltea la cabeza.
  res.giro += vida([...Array(5)].map(() => ({ ojo: r(0.28, 0.03), g: r(0, 0.02) })).concat([...Array(3)].map(() => ({ ojo: r(0.26, 0.03), g: r(0.18, 0.03) })), [...Array(3)].map(() => ({ ojo: r(0.28, 0.03), g: r(0, 0.02) }))));
  // Foto quieta (solo ruido de medición), 36 cuadros = 12 s.
  res.foto += vida([...Array(36)].map(() => ({ ojo: r(0.28, 0.025), g: r(0, 0.02) })));
  // Foto que se mueve o inclina (el giro medido sobre la línea casi no cambia; ruido mayor).
  res.fotoMovida += vida([...Array(36)].map(() => ({ ojo: r(0.28, 0.035), g: r(0, 0.035) })));
}
for (const k in res) console.log(k.padEnd(16), (100 * res[k] / N).toFixed(1) + '% pasa la prueba de vida');
