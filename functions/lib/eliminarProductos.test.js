import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../api/admin/productos/eliminar-lote.js';
import { eliminarLotes, cargarCatalogo } from '../../src/lib/eliminarProductos.js';

function entorno() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const nombre of ['001_init.sql', '007_etiquetas.sql']) {
    db.exec(readFileSync(new URL('../../migrations/' + nombre, import.meta.url), 'utf8'));
  }
  for (let id = 1; id <= 57; id++) {
    db.prepare("INSERT INTO products(id,nombre,precio) VALUES (?, 'Prenda', 10)").run(id);
    db.prepare('INSERT INTO product_variants(id,product_id,stock) VALUES (?,?,2)').run(id,id);
    db.prepare("INSERT INTO product_images(product_id,r2_key) VALUES (?, 'foto')").run(id);
    db.prepare("INSERT INTO product_etiquetas(etiqueta,product_id,global_id) VALUES ('02797',?,?)").run(id,'g'+id);
  }
  db.exec(`INSERT INTO orders(id,codigo,cliente_nombre,cliente_whatsapp,tipo_entrega,total)
    VALUES(1,'pedido','Cliente','123','recojo',10);
    INSERT INTO order_items(order_id,product_id,variant_id,cantidad,precio_unit) VALUES(1,1,2,1,10);`);
  let llamadas = 0;
  const env = { DB: {
    prepare(sql) { return { bind(...args) { return {sql,args}; } }; },
    async batch(sentencias) {
      llamadas++;
      db.exec('BEGIN');
      try {
        const salida = sentencias.map(({sql,args}) => {
          const st = db.prepare(sql);
          return sql.startsWith('SELECT') ? { results: st.all(...args) } : { meta: st.run(...args) };
        });
        db.exec('COMMIT');
        return salida;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  }};
  return { db, env, llamadas: () => llamadas };
}
const solicitud = ids => new Request('https://local.invalid', {
  method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ids}),
});

test('57 productos en tres lotes: protege pedidos y variantes, limpia relaciones y reintenta sin inflar contadores', async () => {
  const { db, env, llamadas } = entorno();
  try {
    const ids = Array.from({length:57},(_,i)=>i+1);
    const ejecutar = () => eliminarLotes(ids, {fetchImpl:(_,op)=>onRequestPost({env,request:new Request('https://local.invalid',op)})});
    const r = await ejecutar();
    assert.equal(llamadas(),3);
    assert.deepEqual(r,{borradas:55,ocultadas:2,yaOcultadas:0,inexistentes:0,fallidas:0});
    assert.equal(db.prepare('SELECT COUNT(*) n FROM order_items').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM product_etiquetas').get().n,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM product_images').get().n,2);
    assert.deepEqual(await ejecutar(),{borradas:0,ocultadas:0,yaOcultadas:2,inexistentes:55,fallidas:0});
  } finally { db.close(); }
});

test('un error SQL revierte todo el lote y devuelve JSON con diagnóstico, sin ocultar por error', async () => {
  const {db,env} = entorno();
  try {
    db.exec("CREATE TRIGGER fallo BEFORE DELETE ON products WHEN OLD.id = 3 BEGIN SELECT RAISE(ABORT,'fallo simulado'); END");
    const r = await onRequestPost({env,request:solicitud([1,3,4])});
    assert.equal(r.status,500);
    assert.ok((await r.json()).referencia);
    assert.equal(db.prepare('SELECT activo FROM products WHERE id=1').get().activo,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM products').get().n,57);
  } finally { db.close(); }
});

test('rechaza cuerpos inválidos y lotes excesivos antes de consultar la base', async () => {
  for (const ids of [[],[0],[-1],[1.5],['1'],Array(21).fill(1)]) {
    assert.equal((await onRequestPost({env:{},request:solicitud(ids)})).status,400);
  }
  const r = await onRequestPost({env:{},request:new Request('https://local.invalid',{method:'POST',body:'null'})});
  assert.equal(r.status,400);
});

test('deduplica ids e informa inexistentes reales', async () => {
  const {db,env} = entorno();
  try {
    const r = await onRequestPost({env,request:solicitud([3,3,999])});
    assert.deepEqual(await r.json(),{ok:true,borradas:1,ocultadas:0,yaOcultadas:0,inexistentes:1,fallidas:0});
  } finally {db.close();}
});

test('respuesta perdida después de aplicar: conserva solo pendientes y reintenta idempotentemente', async () => {
  const {db,env} = entorno();
  try {
    let llamadas=0;
    let fallo;
    const progreso=[];
    const ids=Array.from({length:57},(_,i)=>i+1);
    try {
      await eliminarLotes(ids,{onProgreso:p=>progreso.push(p.hechas),fetchImpl:async(_,op)=>{
        const r=await onRequestPost({env,request:new Request('https://local.invalid',op)});
        return ++llamadas===2 ? new Response('<html>Error</html>',{status:502,headers:{'cf-ray':'prueba-ray'}}) : r;
      }});
    } catch(e) {fallo=e;}
    assert.match(fallo.message,/HTTP 502.*prueba-ray/);
    assert.match(fallo.message,/Confirmados: 20 de 57/);
    assert.deepEqual(fallo.pendientes,ids.slice(20));
    assert.deepEqual(progreso,[0,20]);
    const r=await eliminarLotes(fallo.pendientes,{fetchImpl:(_,op)=>onRequestPost({env,request:new Request('https://local.invalid',op)})});
    assert.equal(r.borradas,17);
    assert.equal(r.inexistentes,20);
  } finally {db.close();}
});

test('fallo al cargar catálogo nunca se convierte en catálogo vacío', async()=>{
  await assert.rejects(cargarCatalogo(async()=>Response.json({error:'No autorizado'},{status:401})),/401/);
  await assert.rejects(cargarCatalogo(async()=>Response.json({})),/lista válida/);
  assert.deepEqual(await cargarCatalogo(async()=>Response.json([])),[]);
});

test('respuesta JSON incompleta y fallo de red conservan el lote para reintentar',async()=>{
  for (const fetchImpl of [async()=>Response.json({ok:true}),async()=>{throw Error('red caída');}]) {
    await assert.rejects(eliminarLotes([1,2],{fetchImpl}),e=>{
      assert.deepEqual(e.pendientes,[1,2]);
      assert.match(e.message,/Confirmados: 0 de 2/);
      return true;
    });
  }
});
