// Revisa la configuración de facturación del .env SIN mostrar las llaves: solo dice si están puestas.
// Uso:  npm run facturacion-estado
const { estadoConfig } = require('../server/facturacion-config');
const e = estadoConfig();
const marca = ok => (ok ? '✔' : '✘');
console.log('\nFacturación con factura.com · configuración');
console.log(`  Entorno ........ ${e.entorno === 'prod' ? 'PRODUCCIÓN (timbres con validez fiscal)' : 'sandbox (pruebas, sin validez fiscal)'}`);
console.log(`  Dirección ...... ${e.host}`);
console.log(`  ${marca(e.apiKey === 'puesta')} FACTURA_API_KEY ...... ${e.apiKey}`);
console.log(`  ${marca(e.secretKey === 'puesta')} FACTURA_SECRET_KEY ... ${e.secretKey}`);
console.log(`  ${marca(!!e.emisor.regimen)} EMISOR_REGIMEN ....... ${e.emisor.regimen || 'falta'}`);
console.log(`  ${marca(!!e.emisor.cp)} EMISOR_CP ............ ${e.emisor.cp || 'falta'}`);
for (const a of e.avisos) console.log('  ⚠ ' + a);
console.log(e.listo ? '\n✔ Todo lo necesario está puesto.\n' : `\n✘ Falta en el .env: ${e.faltantes.join(', ') || '(revisa los avisos)'}\n`);
process.exit(e.listo ? 0 : 1);
