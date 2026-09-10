module.exports=function registrarProspeccion(app,db,h){
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
    if(!db.prepare('PRAGMA table_info(leads)').all().some(c=>c.name==='establecimiento_id'))db.exec('ALTER TABLE leads ADD COLUMN establecimiento_id INTEGER REFERENCES establecimientos(id)');
    const ins=db.prepare('INSERT OR IGNORE INTO sectores_prospeccion(id,nombre) VALUES (?,?)');[[1,'Restaurantes'],[2,'Hoteles'],[3,'Hospitales']].forEach(x=>ins.run(...x));
  })();
  const estados=['investigar','pendiente','contactado','interesado','no_contactar'];
  const detalle=id=>db.prepare(`SELECT e.*,s.nombre sector,u.nombre responsable,c.nombre cliente_nombre FROM establecimientos e JOIN sectores_prospeccion s ON s.id=e.sector_id JOIN usuarios u ON u.id=e.responsable_id LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id=?`).get(id);
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
    if(x.proximo_contacto){const d=new Date(x.proximo_contacto+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(x.proximo_contacto)||isNaN(d)||d.toISOString().slice(0,10)!==x.proximo_contacto)throw Error('Fecha de seguimiento inválida');}
    if(x.estado==='no_contactar')x.proximo_contacto=null;
    return x;
  }
  app.get('/api/prospeccion/sectores',h((req,res)=>res.json(db.prepare('SELECT * FROM sectores_prospeccion ORDER BY nombre').all())));
  function guardarSector(req,res){
    if(req.usuarioSesion.rol!=='admin')return res.status(403).json({error:'Solo el administrador puede administrar sectores'});
    const nombre=typeof req.body.nombre==='string'?req.body.nombre.trim():'';
    if(!nombre||nombre.length>80)return res.status(400).json({error:'Escribe un nombre de hasta 80 caracteres'});
    if(db.prepare('SELECT id FROM sectores_prospeccion WHERE nombre=? AND id<>?').get(nombre,Number(req.params.id)||0))return res.status(409).json({error:'Ese sector ya existe'});
    if(req.params.id){if(!db.prepare('UPDATE sectores_prospeccion SET nombre=? WHERE id=?').run(nombre,req.params.id).changes)return res.status(404).json({error:'Sector no encontrado'});res.json({id:Number(req.params.id),nombre});}
    else{const info=db.prepare('INSERT INTO sectores_prospeccion(nombre) VALUES (?)').run(nombre);res.status(201).json({id:info.lastInsertRowid,nombre});}
  }
  app.post('/api/prospeccion/sectores',h(guardarSector));app.put('/api/prospeccion/sectores/:id',h(guardarSector));
  app.get('/api/prospeccion',h((req,res)=>{
    let sql=`SELECT e.*,s.nombre sector,u.nombre responsable,c.nombre cliente_nombre FROM establecimientos e JOIN sectores_prospeccion s ON s.id=e.sector_id JOIN usuarios u ON u.id=e.responsable_id LEFT JOIN clientes c ON c.id=e.cliente_id WHERE 1=1`;const args=[];
    if(req.query.q){sql+=' AND (e.nombre LIKE ? OR e.zona LIKE ? OR e.persona LIKE ? OR e.telefono LIKE ?)';for(let i=0;i<4;i++)args.push('%'+req.query.q+'%');}
    for(const k of ['sector_id','estado','responsable_id'])if(req.query[k]){sql+=' AND e.'+k+'=?';args.push(req.query[k]);}
    if(req.query.pendientes==='1')sql+=" AND e.estado<>'no_contactar' AND e.proximo_contacto<=date('now','localtime')";
    sql+=' ORDER BY CASE WHEN e.proximo_contacto IS NULL THEN 1 ELSE 0 END,e.proximo_contacto,e.updated_at DESC LIMIT 2000';res.json(db.prepare(sql).all(...args));
  }));
  app.get('/api/prospeccion/:id',h((req,res)=>{const e=detalle(req.params.id);if(!e)return res.status(404).json({error:'Establecimiento no encontrado'});res.json(e);}));
  app.post('/api/prospeccion',h((req,res)=>{
    let x;try{x=validar(req.body);}catch(e){return res.status(400).json({error:e.message});}
    const existe=db.prepare('SELECT id FROM establecimientos WHERE lower(trim(nombre))=lower(?) AND lower(trim(zona))=lower(?) AND lower(trim(direccion))=lower(?)').get(x.nombre,x.zona,x.direccion);
    if(existe)return res.status(409).json({error:'Ya existe ese establecimiento en esta zona y domicilio',id:existe.id});
    const ks=Object.keys(x);const info=db.prepare('INSERT INTO establecimientos('+ks.join(',')+') VALUES ('+ks.map(()=>'?').join(',')+')').run(...Object.values(x));res.status(201).json(detalle(info.lastInsertRowid));
  }));
  app.put('/api/prospeccion/:id',h((req,res)=>{
    const actual=detalle(req.params.id);if(!actual)return res.status(404).json({error:'Establecimiento no encontrado'});
    if(req.body.version!==actual.version)return res.status(409).json({error:'Otra persona actualizó esta ficha. Vuelve a abrirla antes de guardar.'});
    let x;try{x=validar(req.body);}catch(e){return res.status(400).json({error:e.message});}
    const repetido=db.prepare('SELECT id FROM establecimientos WHERE lower(trim(nombre))=lower(?) AND lower(trim(zona))=lower(?) AND lower(trim(direccion))=lower(?) AND id<>?').get(x.nombre,x.zona,x.direccion,actual.id);
    if(repetido)return res.status(409).json({error:'Ya existe otro establecimiento con estos datos'});
    db.prepare('UPDATE establecimientos SET '+Object.keys(x).map(k=>k+'=?').join(',')+",version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(...Object.values(x),actual.id);res.json(detalle(actual.id));
  }));
  app.post('/api/prospeccion/:id/vincular',h((req,res)=>{
    const e=detalle(req.params.id);if(!e)return res.status(404).json({error:'Establecimiento no encontrado'});
    if(e.estado==='no_contactar')return res.status(400).json({error:'Este establecimiento está marcado como no contactar'});
    if(e.cliente_id)return res.json({cliente_id:e.cliente_id});
    if(e.version!==req.body.version)return res.status(409).json({error:'La ficha cambió. Vuelve a abrirla.'});
    if(e.estado==='no_contactar')return res.status(400).json({error:'Este establecimiento está marcado como no contactar'});
    const tel=e.telefono.replace(/\D/g,'').slice(-10);if(tel.length!==10)return res.status(400).json({error:'Completa el teléfono antes de preparar la cotización'});
    const existente=db.prepare('SELECT id,nombre,telefono FROM clientes WHERE telefono_normalizado=?').get(tel);
    if(existente&&req.body.cliente_id!==existente.id)return res.status(409).json({error:'El teléfono ya pertenece a un contacto. Confirma si es el mismo contacto comercial.',existente});
    if(req.body.cliente_id&&!existente)return res.status(400).json({error:'El contacto indicado no coincide con el teléfono'});
    const id=db.transaction(()=>{
      let clienteId=existente?.id;
      if(!clienteId){db.prepare("INSERT OR IGNORE INTO canales(nombre,orden) VALUES ('Prospección comercial',99)").run();const canal=db.prepare("SELECT id FROM canales WHERE nombre='Prospección comercial'").get();
        clienteId=db.prepare('INSERT INTO clientes(nombre,empresa_contacto,telefono,telefono_normalizado,direccion,correo,canal_origen_id) VALUES (?,?,?,?,?,?,?)').run(e.persona||e.nombre,e.nombre,e.telefono,tel,e.direccion,e.correo||null,canal.id).lastInsertRowid;
      }
      db.prepare("UPDATE establecimientos SET cliente_id=?,version=version+1,updated_at=datetime('now','localtime') WHERE id=?").run(clienteId,e.id);return clienteId;
    })();res.json({cliente_id:id});
  }));
};
