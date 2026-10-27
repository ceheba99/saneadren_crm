module.exports=function registrarProspeccion(app,db,h,unicos){
  const P=()=>app.locals.permisos,yo=req=>req.usuarioSesion.id;
  // ¿Ve toda su sucursal o solo lo suyo? (como en cotizaciones: el vendedor, lo suyo).
  const veSucursal=req=>P().puede(req,'prospeccion.sucursal');
  // A nombre de quién: quien ve solo lo suyo, a su nombre; el responsable debe poder usar Prospección.
  function responsableValido(req,x){
    if(!veSucursal(req)&&x.responsable_id!==yo(req))return 'Solo puedes registrar establecimientos a tu nombre';
    const u=db.prepare('SELECT rol FROM usuarios WHERE id=? AND activo=1').get(x.responsable_id);
    if(u&&!P().tieneRol(u.rol,'prospeccion.ver'))return 'Esa persona no tiene acceso a Prospección: elige a otra';
    return null;
  }
  // Repetido: se busca en TODOS (aunque sea de otro vendedor); si no lo puede ver, solo se dice quién lo trabaja.
  function repetido(req,x,excepto=0){
    const r=db.prepare('SELECT e.id,u.nombre responsable FROM main.establecimientos e JOIN usuarios u ON u.id=e.responsable_id WHERE lower(trim(e.nombre))=lower(?) AND lower(trim(e.zona))=lower(?) AND lower(trim(e.direccion))=lower(?) AND e.id<>?').get(x.nombre,x.zona,x.direccion,excepto);
    if(!r)return null;
    return db.prepare('SELECT id FROM establecimientos WHERE id=?').get(r.id)?{error:'Ya existe ese establecimiento en esta zona y domicilio',id:r.id}:{error:'Ese establecimiento ya lo trabaja '+r.responsable};
  }
  db.transaction(()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS sectores_prospeccion(id INTEGER PRIMARY KEY,nombre TEXT NOT NULL COLLATE NOCASE UNIQUE);
    CREATE TABLE IF NOT EXISTS establecimientos(
      id INTEGER PRIMARY KEY,nombre TEXT NOT NULL CHECK(length(trim(nombre))>0),sector_id INTEGER NOT NULL REFERENCES sectores_prospeccion(id),
      zona TEXT NOT NULL CHECK(length(trim(zona))>0),direccion TEXT NOT NULL DEFAULT '',telefono TEXT NOT NULL DEFAULT '',correo TEXT NOT NULL DEFAULT '',
      persona TEXT NOT NULL DEFAULT '',cargo TEXT NOT NULL DEFAULT '',fuente TEXT NOT NULL DEFAULT '',necesidades TEXT NOT NULL DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'investigar' CHECK(estado IN ('investigar','pendiente','contactado','interesado','no_contactar')),
      responsable_id INTEGER NOT NULL REFERENCES usuarios(id),proximo_contacto TEXT,cliente_id INTEGER REFERENCES clientes(id),version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')),updated_at TEXT NOT NULL DEFAULT(datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS idx_establecimientos_segmento ON establecimientos(sector_id,estado,zona);
    CREATE INDEX IF NOT EXISTS idx_establecimientos_agenda ON establecimientos(responsable_id,proximo_contacto);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_establecimiento_unico ON establecimientos(lower(trim(nombre)),lower(trim(zona)),lower(trim(direccion)));
    `);
    // Historial de seguimiento (2026-10-26): cada llamada, mensaje o visita con su resultado; lo ve quien ve el establecimiento.
    db.exec(`CREATE TABLE IF NOT EXISTS seguimientos_prospeccion(
      id INTEGER PRIMARY KEY,establecimiento_id INTEGER NOT NULL REFERENCES establecimientos(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id),medio TEXT NOT NULL CHECK(medio IN ('llamada','whatsapp','correo','visita','nota')),
      texto TEXT NOT NULL DEFAULT '',estado_antes TEXT,estado_nuevo TEXT,proximo_contacto TEXT,
      created_at TEXT NOT NULL DEFAULT(datetime('now','localtime')));
    CREATE INDEX IF NOT EXISTS idx_seguimientos_prospeccion ON seguimientos_prospeccion(establecimiento_id,id);`);
    if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='establecimiento_id'))db.exec('ALTER TABLE leads ADD COLUMN establecimiento_id INTEGER REFERENCES establecimientos(id)');
    const ins=db.prepare('INSERT OR IGNORE INTO sectores_prospeccion(id,nombre) VALUES (?,?)');[[1,'Restaurantes'],[2,'Hoteles'],[3,'Hospitales']].forEach(x=>ins.run(...x));
  })();
  const estados=['investigar','pendiente','contactado','interesado','no_contactar'];
  const detalle=id=>db.prepare(`SELECT e.*,s.nombre sector,u.nombre responsable,c.nombre cliente_nombre FROM establecimientos e JOIN sectores_prospeccion s ON s.id=e.sector_id JOIN usuarios u ON u.id=e.responsable_id LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id=?`).get(id);
  const MEDIOS=['llamada','whatsapp','correo','visita','nota'];
  const seguimientos=id=>db.prepare(`SELECT g.id,g.medio,g.texto,g.estado_antes,g.estado_nuevo,g.proximo_contacto,g.created_at,u.nombre usuario FROM seguimientos_prospeccion g LEFT JOIN usuarios u ON u.id=g.usuario_id WHERE g.establecimiento_id=? ORDER BY g.id DESC`).all(id);
  const fechaValida=f=>{const d=new Date(f+'T00:00:00Z');return /^\d{4}-\d{2}-\d{2}$/.test(f)&&!isNaN(d)&&d.toISOString().slice(0,10)===f;};
  function validar(body){
    const x={};for(const k of ['nombre','zona','direccion','telefono','correo','persona','cargo','fuente','necesidades']){
      if(body[k]!==undefined&&typeof body[k]!=='string')throw Error('Revisa el campo '+k);
      x[k]=(body[k]||'').trim();if(x[k].length>(k==='necesidades'?5000:500))throw Error('El campo '+k+' es demasiado largo');
    }
    if(!x.nombre||!x.zona)throw Error('Indica nombre del establecimiento y ciudad o zona');
    x.sector_id=Number(body.sector_id);x.responsable_id=Number(body.responsable_id);
    if(!db.prepare('SELECT id FROM sectores_prospeccion WHERE id=?').get(x.sector_id))throw Error('Selecciona un sector');
    if(!db.prepare('SELECT id FROM usuarios WHERE id=? AND activo=1').get(x.responsable_id))throw Error('Selecciona un responsable activo');
    if(x.telefono && x.telefono.replace(/\D/g,'').length<10)throw Error('El teléfono debe tener al menos 10 dígitos, o quedar vacío');
    if(x.correo&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.correo))throw Error('Revisa el correo electrónico');
    x.estado=body.estado||'investigar';if(!estados.includes(x.estado))throw Error('Estado inválido');
    x.proximo_contacto=body.proximo_contacto||null;
    if(x.proximo_contacto&&!fechaValida(x.proximo_contacto))throw Error('Fecha de seguimiento inválida');
    if(x.estado==='no_contactar')x.proximo_contacto=null;
    return x;
  }
  app.get('/api/prospeccion/sectores',h((req,res)=>res.json(db.prepare('SELECT * FROM sectores_prospeccion ORDER BY nombre').all())));
  function guardarSector(req,res){
    if(!app.locals.permisos.direccion(req))return res.status(403).json({error:'No tienes permiso para administrar sectores'});
    const nombre=typeof req.body.nombre==='string'?req.body.nombre.trim():'';
    if(!nombre||nombre.length>80)return res.status(400).json({error:'Escribe un nombre de hasta 80 caracteres'});
    if(db.prepare('SELECT id FROM sectores_prospeccion WHERE nombre=? AND id<>?').get(nombre,Number(req.params.id)||0))return res.status(409).json({error:'Ese sector ya existe'});
    if(req.params.id){if(!db.prepare('UPDATE sectores_prospeccion SET nombre=? WHERE id=?').run(nombre,req.params.id).changes)return res.status(404).json({error:'Sector no encontrado'});res.json({id:Number(req.params.id),nombre});}
    else{const info=db.prepare('INSERT INTO sectores_prospeccion(nombre) VALUES (?)').run(nombre);res.status(201).json({id:info.lastInsertRowid,nombre});}
  }
  app.post('/api/prospeccion/sectores',h(guardarSector));app.put('/api/prospeccion/sectores/:id',h(guardarSector));
  app.get('/api/prospeccion',h((req,res)=>{
    // Con su último seguimiento y cuántos lleva, para ver de un vistazo cómo va cada uno (2026-10-26).
    let sql=`SELECT e.*,s.nombre sector,u.nombre responsable,c.nombre cliente_nombre,
      (SELECT COUNT(*) FROM seguimientos_prospeccion g WHERE g.establecimiento_id=e.id) seguimientos,
      (SELECT g.created_at FROM seguimientos_prospeccion g WHERE g.establecimiento_id=e.id ORDER BY g.id DESC LIMIT 1) ultimo_seguimiento,
      (SELECT g.medio FROM seguimientos_prospeccion g WHERE g.establecimiento_id=e.id ORDER BY g.id DESC LIMIT 1) ultimo_medio,
      (SELECT g.texto FROM seguimientos_prospeccion g WHERE g.establecimiento_id=e.id ORDER BY g.id DESC LIMIT 1) ultimo_texto
      FROM establecimientos e JOIN sectores_prospeccion s ON s.id=e.sector_id JOIN usuarios u ON u.id=e.responsable_id LEFT JOIN clientes c ON c.id=e.cliente_id WHERE 1=1`;const args=[];
    // Busca también por correo, domicilio, cargo y notas, sin importar acentos; el teléfono, por sus dígitos.
    if(req.query.q){const q=String(req.query.q),dig=q.replace(/\D/g,'');
      sql+=' AND ('+['e.nombre','e.zona','e.persona','e.cargo','e.direccion','e.correo','e.necesidades'].map(k=>'sin_acentos('+k+') LIKE sin_acentos(?)').join(' OR ')+(dig.length>=4?' OR solo_digitos(e.telefono) LIKE ?':'')+')';
      for(let i=0;i<7;i++)args.push('%'+q+'%');if(dig.length>=4)args.push('%'+dig+'%');}
    for(const k of ['sector_id','estado','responsable_id'])if(req.query[k]){sql+=' AND e.'+k+'=?';args.push(req.query[k]);}
    if(req.query.zona){sql+=' AND lower(trim(e.zona))=lower(trim(?))';args.push(String(req.query.zona));}
    if(req.query.telefono==='sin')sql+=" AND trim(e.telefono)=''";
    if(req.query.vinculado==='si')sql+=' AND e.cliente_id IS NOT NULL';else if(req.query.vinculado==='no')sql+=' AND e.cliente_id IS NULL';
    if(req.query.agenda==='sin_fecha')sql+=" AND e.estado<>'no_contactar' AND e.proximo_contacto IS NULL";
    else if(req.query.agenda==='atrasados')sql+=" AND e.estado<>'no_contactar' AND e.proximo_contacto<date('now','localtime')";
    else if(req.query.agenda==='hoy')sql+=" AND e.estado<>'no_contactar' AND e.proximo_contacto=date('now','localtime')";
    if(req.query.pendientes==='1')sql+=" AND e.estado<>'no_contactar' AND e.proximo_contacto<=date('now','localtime')";
    sql+=' ORDER BY CASE WHEN e.proximo_contacto IS NULL THEN 1 ELSE 0 END,e.proximo_contacto,e.updated_at DESC LIMIT 2000';res.json(db.prepare(sql).all(...args));
  }));
  // Tarjetas de arriba: la agenda y cuántos hay en cada estado (solo de lo que ve quien pregunta).
  app.get('/api/prospeccion/resumen',h((req,res)=>{
    const r=db.prepare(`SELECT COUNT(*) total,
      SUM(estado<>'no_contactar' AND proximo_contacto=date('now','localtime')) hoy,
      SUM(estado<>'no_contactar' AND proximo_contacto<date('now','localtime')) atrasados,
      SUM(estado<>'no_contactar' AND proximo_contacto IS NULL) sin_fecha,
      SUM(trim(telefono)='') sin_telefono,SUM(cliente_id IS NOT NULL) vinculados,
      ${estados.map(k=>`SUM(estado='${k}') ${k}`).join(',')} FROM establecimientos`).get();
    const zonas=db.prepare("SELECT trim(zona) zona,COUNT(*) n FROM establecimientos GROUP BY lower(trim(zona)) ORDER BY zona").all();
    res.json({...Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v||0])),zonas});
  }));
  app.get('/api/prospeccion/:id',h((req,res)=>{const e=detalle(req.params.id);if(!e)return res.status(404).json({error:'Establecimiento no encontrado'});res.json({...e,seguimientos:seguimientos(e.id)});}));
  // Anotar un seguimiento: qué pasó, por qué medio y, si cambia, el nuevo estado y la próxima fecha (actualizan la ficha).
  app.post('/api/prospeccion/:id/seguimientos',h((req,res)=>{
    const e=detalle(req.params.id);if(!e)return res.status(404).json({error:'Establecimiento no encontrado'});
    if(req.body.version!==e.version)return res.status(409).json({error:'Otra persona actualizó esta ficha. Vuelve a abrirla antes de anotar.'});
    const medio=String(req.body.medio||'');if(!MEDIOS.includes(medio))return res.status(400).json({error:'Elige cómo fue el contacto'});
    const texto=typeof req.body.texto==='string'?req.body.texto.trim():'';
    if(!texto)return res.status(400).json({error:'Escribe qué pasó (p. ej. «No contestó» o «Pidió cotización»)'});if(texto.length>2000)return res.status(400).json({error:'El texto es demasiado largo (máximo 2000 caracteres)'});
    const estado=req.body.estado?String(req.body.estado):e.estado;if(!estados.includes(estado))return res.status(400).json({error:'Estado inválido'});
    let prox=req.body.proximo_contacto===undefined?e.proximo_contacto:(req.body.proximo_contacto||null);
    if(prox&&!fechaValida(prox))return res.status(400).json({error:'Fecha de seguimiento inválida'});
    if(estado==='no_contactar')prox=null;
    db.transaction(()=>{
      db.prepare('INSERT INTO seguimientos_prospeccion(establecimiento_id,usuario_id,medio,texto,estado_antes,estado_nuevo,proximo_contacto) VALUES (?,?,?,?,?,?,?)').run(e.id,yo(req),medio,texto,e.estado,estado!==e.estado?estado:null,prox);
      db.prepare("UPDATE main.establecimientos SET estado=?,proximo_contacto=?,version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(estado,prox,e.id);
    })();
    res.status(201).json({...detalle(e.id),seguimientos:seguimientos(e.id)});
  }));
  app.post('/api/prospeccion',h((req,res)=>{
    let x;try{x=validar(req.body);}catch(e){return res.status(400).json({error:e.message});}
    const mal=responsableValido(req,x);if(mal)return res.status(403).json({error:mal});
    const existe=repetido(req,x);if(existe)return res.status(409).json(existe);
    const ks=Object.keys(x);const info=db.prepare('INSERT INTO main.establecimientos('+ks.join(',')+') VALUES ('+ks.map(()=>'?').join(',')+')').run(...Object.values(x));app.locals.sucursales.asignar('establecimientos',Number(info.lastInsertRowid));res.status(201).json(detalle(info.lastInsertRowid));
  }));
  app.put('/api/prospeccion/:id',h((req,res)=>{
    const actual=detalle(req.params.id);if(!actual)return res.status(404).json({error:'Establecimiento no encontrado'});
    if(req.body.version!==actual.version)return res.status(409).json({error:'Otra persona actualizó esta ficha. Vuelve a abrirla antes de guardar.'});
    let x;try{x=validar(req.body);}catch(e){return res.status(400).json({error:e.message});}
    if(x.responsable_id!==actual.responsable_id){const mal=responsableValido(req,x);if(mal)return res.status(403).json({error:mal});}
    const otro=repetido(req,x,actual.id);if(otro)return res.status(409).json({error:otro.id?'Ya existe otro establecimiento con estos datos':otro.error});
    db.prepare('UPDATE main.establecimientos SET '+Object.keys(x).map(k=>k+'=?').join(',')+",version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(...Object.values(x),actual.id);res.json(detalle(actual.id));
  }));
  app.post('/api/prospeccion/:id/vincular',h((req,res)=>{
    const e=detalle(req.params.id);if(!e)return res.status(404).json({error:'Establecimiento no encontrado'});
    if(e.estado==='no_contactar')return res.status(400).json({error:'Este establecimiento está marcado como no contactar'});
    if(e.cliente_id)return res.json({cliente_id:e.cliente_id});
    if(e.version!==req.body.version)return res.status(409).json({error:'La ficha cambió. Vuelve a abrirla.'});
    if(e.estado==='no_contactar')return res.status(400).json({error:'Este establecimiento está marcado como no contactar'});
    const tel=e.telefono.replace(/\D/g,'').slice(-10);if(tel.length!==10)return res.status(400).json({error:'Completa el teléfono antes de preparar la cotización'});
    // «Es el mismo cliente» (parecido por nombre): se le agrega este teléfono y se vincula el establecimiento.
    if(req.body.agregar_telefono_a){const destino=db.prepare('SELECT id FROM clientes WHERE id=?').get(Number(req.body.agregar_telefono_a));if(!destino)return res.status(404).json({error:'Cliente no encontrado'});
      if(!app.locals.sucursales.puedeEditarCliente(req,destino.id)){db.prepare("UPDATE main.establecimientos SET cliente_id=?,version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(destino.id,e.id);return res.json({cliente_id:destino.id,otra_sucursal:true});}
      const r=unicos.agregarTelefono(destino.id,e.telefono,'Prospección: '+String(e.nombre).slice(0,45));if(r.error)return res.status(409).json(r);
      db.prepare("UPDATE main.establecimientos SET cliente_id=?,version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(destino.id,e.id);return res.json({cliente_id:destino.id});}
    const existente=unicos.porTelefono(tel);
    if(existente&&req.body.cliente_id!==existente.id)return res.status(409).json({error:'El teléfono ya pertenece a un contacto. Confirma si es el mismo contacto comercial.',existente:unicos.resumen(existente)});
    if(req.body.cliente_id&&!existente)return res.status(400).json({error:'El contacto indicado no coincide con el teléfono'});
    // Contacto nuevo: no debe existir ya un cliente con nombre o empresa parecidos (salvo que se confirme que es otro).
    const distintoDe=Array.isArray(req.body.distinto_de)?req.body.distinto_de.map(Number).filter(Boolean):[];
    if(!existente){const pendiente=unicos.exigirConfirmacion({nombre:e.persona||e.nombre,empresa:e.nombre},distintoDe);if(pendiente)return res.status(409).json(pendiente);}
    const id=db.transaction(()=>{
      let clienteId=existente?.id;
      if(!clienteId){db.prepare("INSERT OR IGNORE INTO canales(nombre,orden) VALUES ('Prospección comercial',99)").run();const canal=db.prepare("SELECT id FROM canales WHERE nombre='Prospección comercial'").get();
        clienteId=db.prepare('INSERT INTO clientes(nombre,empresa_contacto,telefono,telefono_normalizado,direccion,correo,canal_origen_id) VALUES (?,?,?,?,?,?,?)').run(e.persona||e.nombre,e.nombre,e.telefono,tel,e.direccion,e.correo||null,canal.id).lastInsertRowid;app.locals.sucursales.asignar('clientes',Number(clienteId),e.sucursal_id);
        unicos.recordarDistintos(Number(clienteId),distintoDe,req.usuarioSesion.id);
      }
      db.prepare("UPDATE main.establecimientos SET cliente_id=?,version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(clienteId,e.id);return clienteId;
    })();res.json({cliente_id:id,otra_sucursal:!app.locals.sucursales.verCliente(Number(id))});
  }));
};
