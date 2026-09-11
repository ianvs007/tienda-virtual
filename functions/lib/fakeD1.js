// D1 simulada mínima para los tests de node (NO es una ruta: no exporta
// onRequest*). Reconoce las sentencias SQL reales de lib/syncV2.js,
// lib/etiquetas.js y api/productos.js por su prefijo normalizado y las aplica
// sobre arrays en memoria, así el cableado SQL se prueba sin base de datos.
//
// Tablas: products, variants (product_variants), eventos (stock_eventos),
// dispositivos (sync_dispositivos), etiquetas (product_etiquetas),
// settings (clave → valor; ahí vive la presencia de sesión de lib/sesionSync.js),
// log (stock_log).

const AHORA = '2026-09-11 12:00:00';

/** Cuenta los `?` de una lista IN para saber cuántos argumentos consume. */
const enLista = (a) => new Set(a.map((x) => (typeof x === 'number' ? x : String(x))));
const coincideIn = (conjunto, v) => conjunto.has(typeof v === 'number' ? v : String(v)) || conjunto.has(Number(v)) || conjunto.has(String(v));
const like = (patron, valor) => new RegExp('^' + String(patron).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$').test(String(valor));

export class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql.replace(/\s+/g, ' ').trim();
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    const s = this.sql;
    const a = this.args;
    if (s.startsWith("SELECT datetime('now')")) return { ahora: AHORA };
    if (s.startsWith('SELECT id, nombre, ultimo_evento_ack')) {
      return this.db.dispositivos.find((d) => d.id === a[0]) || null;
    }
    if (s.startsWith("SELECT valor FROM settings WHERE clave = 'sync_token'")) return { valor: 'tok' };
    if (s.startsWith('SELECT valor FROM settings WHERE clave = ?')) {
      this.db.lecturas.settings++;
      return a[0] in this.db.settings ? { valor: this.db.settings[a[0]] } : null;
    }
    if (s.startsWith('SELECT * FROM products WHERE id = ?')) {
      return this.db.products.find((p) => p.id === a[0]) || null;
    }
    throw new Error(`first() sin soporte: ${s}`);
  }

  async all() {
    const s = this.sql;
    const a = this.args;
    if (s.startsWith('SELECT id, nombre, codigo, global_id, precio, activo FROM products WHERE global_id IN (')) {
      const set = enLista(a);
      const results = this.db.products.filter((p) => p.global_id && coincideIn(set, p.global_id)).map((p) => ({ ...p }));
      this.db.lecturas.products += results.length;
      return { results };
    }
    if (s.startsWith('SELECT id, nombre, codigo, global_id, precio, activo FROM products WHERE codigo IN (')) {
      const set = enLista(a);
      const results = this.db.products.filter((p) => p.codigo && coincideIn(set, p.codigo)).map((p) => ({ ...p }));
      this.db.lecturas.products += results.length;
      return { results };
    }
    if (s.startsWith('SELECT id, global_id, activo FROM products')) {
      this.db.lecturas.products += this.db.products.length;
      return { results: this.db.products.map((p) => ({ id: p.id, global_id: p.global_id, activo: p.activo })) };
    }
    if (s.startsWith('SELECT id, product_id, talla, color, stock FROM product_variants WHERE product_id IN (')) {
      const set = enLista(a);
      const results = this.db.variants.filter((v) => coincideIn(set, v.product_id)).map((v) => ({ ...v }));
      this.db.lecturas.variants += results.length;
      return { results };
    }
    if (s.startsWith('SELECT etiqueta, product_id, global_id, disponible FROM product_etiquetas')) {
      this.db.lecturas.etiquetas += this.db.etiquetas.length;
      return { results: this.db.etiquetas.map((e) => ({ etiqueta: e.etiqueta, product_id: e.product_id, global_id: e.global_id, disponible: e.disponible })) };
    }
    if (s.startsWith('SELECT variant_id, SUM(delta) AS delta FROM stock_eventos')) {
      const [ack] = a;
      const m = new Map();
      for (const e of this.db.eventos) {
        if (e.id > ack && e.variant_id != null) m.set(e.variant_id, (m.get(e.variant_id) || 0) + e.delta);
      }
      return { results: [...m.entries()].map(([variant_id, delta]) => ({ variant_id, delta })) };
    }
    if (s.startsWith('SELECT id, tipo, global_id, codigo, nombre, talla, color, delta')) {
      const [desde, limite] = a;
      const lista = this.db.eventos.filter((e) => e.id > desde).sort((x, y) => x.id - y.id).slice(0, limite);
      return { results: lista.map((e) => ({ ...e, precio_unit: e.precio_unit ?? 0, pedido_ref: e.pedido_ref ?? '' })) };
    }
    if (s.startsWith('SELECT e.product_id, e.global_id, e.disponible, p.nombre, p.codigo, p.activo FROM product_etiquetas e')) {
      const soloActivos = s.includes('AND p.activo = 1');
      const results = [];
      for (const e of this.db.etiquetas) {
        if (e.etiqueta !== a[0]) continue;
        const p = this.db.products.find((x) => x.id === e.product_id);
        if (!p) continue;
        if (soloActivos && Number(p.activo) !== 1) continue;
        results.push({ product_id: e.product_id, global_id: e.global_id, disponible: e.disponible, nombre: p.nombre, codigo: p.codigo, activo: p.activo });
      }
      return { results };
    }
    if (s.startsWith('SELECT etiqueta, disponible FROM product_etiquetas WHERE product_id = ?')) {
      return {
        results: this.db.etiquetas
          .filter((e) => e.product_id === a[0])
          .sort((x, y) => x.etiqueta.localeCompare(y.etiqueta))
          .map((e) => ({ etiqueta: e.etiqueta, disponible: e.disponible })),
      };
    }
    if (s.startsWith('SELECT p.id, p.nombre, p.descripcion, p.precio, p.categoria_id, p.codigo,')) {
      // Catálogo público: activos, con stock_total sumado de sus variantes.
      const categoria = s.includes('AND p.categoria_id = ?') ? a[0] : null;
      const results = this.db.products
        .filter((p) => Number(p.activo) === 1 && (categoria === null || String(p.categoria_id) === String(categoria)))
        .map((p) => ({
          id: p.id,
          nombre: p.nombre,
          descripcion: p.descripcion || '',
          precio: p.precio,
          categoria_id: p.categoria_id ?? null,
          codigo: p.codigo ?? null,
          imagen: null,
          stock_total: this.db.variants.filter((v) => v.product_id === p.id).reduce((acc, v) => acc + Number(v.stock), 0),
        }));
      return { results };
    }
    throw new Error(`all() sin soporte: ${s}`);
  }

  async run() {
    const s = this.sql;
    const a = this.args;
    const db = this.db;
    if (s.startsWith('INSERT INTO sync_dispositivos')) {
      const [id, nombre] = a;
      const d = db.dispositivos.find((x) => x.id === id);
      if (d) {
        if (nombre) d.nombre = nombre;
      } else {
        db.dispositivos.push({ id, nombre, ultimo_evento_ack: 0, sesion_snapshot: null, ultimo_snapshot_en: null });
      }
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE products SET codigo = NULL WHERE id = ?')) {
      const p = db.products.find((x) => x.id === a[0]);
      if (p) p.codigo = null;
      return { meta: { changes: p ? 1 : 0 } };
    }
    if (s.startsWith('UPDATE products SET global_id = ? WHERE id = ?')) {
      const p = db.products.find((x) => x.id === a[1]);
      if (p) p.global_id = a[0];
      return { meta: { changes: p ? 1 : 0 } };
    }
    if (s.startsWith('UPDATE products SET nombre = ?, precio = ?, codigo = ?, activo = 1, sesion_snapshot = ? WHERE id = ?')) {
      const [nombre, precio, codigo, sesion, id] = a;
      if (codigo && db.products.some((x) => x.id !== id && x.codigo === codigo)) {
        throw new Error(`UNIQUE constraint failed: products.codigo (${codigo})`);
      }
      const p = db.products.find((x) => x.id === id);
      Object.assign(p, { nombre, precio, codigo, activo: 1, sesion_snapshot: sesion });
      db.escrituras.products++;
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE product_variants SET stock = ? WHERE id = ?')) {
      const v = db.variants.find((x) => x.id === a[1]);
      v.stock = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO stock_log')) {
      db.log.push(a);
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('INSERT INTO products')) {
      const [nombre, precio, codigo, global_id, sesion] = a;
      if (codigo && db.products.some((x) => x.codigo === codigo)) {
        throw new Error(`UNIQUE constraint failed: products.codigo (${codigo})`);
      }
      const id = Math.max(0, ...db.products.map((p) => p.id)) + 1;
      db.products.push({ id, nombre, precio, codigo, global_id, activo: 1, sesion_snapshot: sesion });
      return { meta: { changes: 1, last_row_id: id } };
    }
    if (s.startsWith('INSERT INTO product_variants')) {
      const [product_id, talla, color, stock] = a;
      const id = Math.max(0, ...db.variants.map((v) => v.id)) + 1;
      db.variants.push({ id, product_id, talla, color, stock });
      return { meta: { changes: 1, last_row_id: id } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET sesion_snapshot = ?')) {
      const d = db.dispositivos.find((x) => x.id === a[1]);
      d.sesion_snapshot = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET ultimo_evento_ack = ?')) {
      const d = db.dispositivos.find((x) => x.id === a[1]);
      d.ultimo_evento_ack = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE stock_eventos SET aplicado_pos_en')) {
      let n = 0;
      for (const e of db.eventos) if (e.id <= a[0] && !e.aplicado_pos_en) { e.aplicado_pos_en = 'now'; n++; }
      return { meta: { changes: n } };
    }
    if (s.startsWith('UPDATE products SET activo = 0 WHERE id IN (')) {
      const set = enLista(a);
      let n = 0;
      for (const p of db.products) if (coincideIn(set, p.id) && p.activo !== 0) { p.activo = 0; n++; }
      db.escrituras.products += n;
      return { meta: { changes: n } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET ultimo_snapshot_en')) {
      const d = db.dispositivos.find((x) => x.id === a[2]);
      d.ultimo_snapshot_en = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE settings SET valor = ?')) return { meta: { changes: 1 } };

    // ── presencia de sesión en settings (lib/sesionSync.js) ──
    if (s.startsWith('INSERT INTO settings (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE')) {
      db.settings[a[0]] = a[1];
      db.escrituras.settings++;
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('DELETE FROM settings WHERE clave IN (')) {
      let n = 0;
      for (const k of a) if (k in db.settings) { delete db.settings[k]; n++; }
      return { meta: { changes: n } };
    }
    if (s.startsWith('DELETE FROM settings WHERE clave LIKE ? AND clave NOT LIKE ?')) {
      let n = 0;
      for (const k of Object.keys(db.settings)) if (like(a[0], k) && !like(a[1], k)) { delete db.settings[k]; n++; }
      return { meta: { changes: n } };
    }

    // ── etiquetas físicas (migración 007): solo diferencias ──
    if (s.startsWith('DELETE FROM product_etiquetas WHERE (etiqueta = ? AND product_id = ?)')) {
      const pares = new Set();
      for (let i = 0; i < a.length; i += 2) pares.add(`${a[i]}|${Number(a[i + 1])}`);
      const antes = db.etiquetas.length;
      db.etiquetas = db.etiquetas.filter((e) => !pares.has(`${e.etiqueta}|${Number(e.product_id)}`));
      db.escrituras.etiquetas += antes - db.etiquetas.length;
      return { meta: { changes: antes - db.etiquetas.length } };
    }
    if (s.startsWith('INSERT INTO product_etiquetas (etiqueta, product_id, global_id, disponible, actualizado_en) VALUES')) {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const [etiqueta, product_id, global_id, disponible] = a.slice(i, i + 4);
        const previa = db.etiquetas.find((x) => x.etiqueta === etiqueta && Number(x.product_id) === Number(product_id));
        if (previa) Object.assign(previa, { disponible, global_id, actualizado_en: AHORA });
        else db.etiquetas.push({ etiqueta, product_id, global_id, disponible, actualizado_en: AHORA });
        n++;
      }
      db.escrituras.etiquetas += n;
      return { meta: { changes: n } };
    }
    throw new Error(`run() sin soporte: ${s}`);
  }
}

export class FakeDB {
  constructor(data = {}) {
    this.products = data.products || [];
    this.variants = data.variants || [];
    this.eventos = data.eventos || [];
    this.dispositivos = data.dispositivos || [];
    this.etiquetas = data.etiquetas || [];
    this.settings = { ultima_sincronizacion: '1970-01-01 00:00:00', ...(data.settings || {}) };
    this.log = [];
    this.batches = 0;
    // Contadores para medir el costo en cuota de D1 (filas leídas / escritas).
    this.lecturas = { products: 0, variants: 0, etiquetas: 0, settings: 0 };
    this.escrituras = { products: 0, etiquetas: 0, settings: 0 };
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
  /** Claves de presencia de sesión (lib/sesionSync.js) presentes en settings. */
  clavesSesion() {
    return Object.keys(this.settings).filter((k) => k.startsWith('sync_sesion:')).sort();
  }
  // D1 ejecuta el batch como una transacción: si una sentencia falla, nada se
  // aplica. Aquí se simula guardando y restaurando el estado. Un batch puede
  // traer SELECTs (lecturas por lote): devuelven { results }.
  async batch(sts) {
    this.batches++;
    const respaldo = JSON.stringify({
      products: this.products, variants: this.variants, eventos: this.eventos, dispositivos: this.dispositivos,
      etiquetas: this.etiquetas, settings: this.settings, log: this.log,
    });
    const out = [];
    try {
      for (const st of sts) out.push(st.sql.startsWith('SELECT') ? await st.all() : await st.run());
    } catch (err) {
      Object.assign(this, JSON.parse(respaldo));
      throw err;
    }
    return out;
  }
}

/** Fabrica un `env` con la D1 simulada. */
export function envConDB(data) {
  return { DB: new FakeDB(data) };
}
