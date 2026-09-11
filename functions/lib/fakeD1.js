// D1 simulada mínima para los tests de node (NO es una ruta: no exporta
// onRequest*). Reconoce las sentencias SQL reales de lib/syncV2.js,
// lib/etiquetas.js y api/productos.js por su prefijo normalizado y las aplica
// sobre arrays en memoria, así el cableado SQL se prueba sin base de datos.
//
// Tablas: products, variants (product_variants), eventos (stock_eventos),
// dispositivos (sync_dispositivos), etiquetas (product_etiquetas),
// etiquetasPendientes (sync_etiquetas_pendientes), log (stock_log).

const AHORA = '2026-09-11 12:00:00';

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
    if (s.startsWith('SELECT COUNT(*) AS n FROM products WHERE sesion_snapshot')) {
      return { n: this.db.products.filter((p) => p.sesion_snapshot === a[0]).length };
    }
    if (s.startsWith("SELECT valor FROM settings WHERE clave = 'sync_token'")) return { valor: 'tok' };
    if (s.startsWith('SELECT COUNT(*) AS n FROM sync_etiquetas_pendientes WHERE sesion = ?')) {
      return { n: this.db.etiquetasPendientes.filter((e) => e.sesion === a[0]).length };
    }
    if (s.startsWith('SELECT COUNT(*) AS n FROM sync_etiquetas_pendientes s WHERE s.sesion = ? AND NOT EXISTS')) {
      const conProducto = new Set(this.db.products.map((p) => p.global_id).filter(Boolean));
      return { n: this.db.etiquetasPendientes.filter((e) => e.sesion === a[0] && !conProducto.has(e.global_id)).length };
    }
    if (s.startsWith('SELECT * FROM products WHERE id = ?')) {
      return this.db.products.find((p) => p.id === a[0]) || null;
    }
    throw new Error(`first() sin soporte: ${s}`);
  }

  async all() {
    const s = this.sql;
    const a = this.args;
    if (s.startsWith('SELECT id, nombre, codigo, global_id, precio, activo FROM products')) {
      return { results: this.db.products.map((p) => ({ ...p })) };
    }
    if (s.startsWith('SELECT id, product_id, talla, color, stock FROM product_variants')) {
      return { results: this.db.variants.map((v) => ({ ...v })) };
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
    if (s.startsWith('UPDATE products SET activo = 0 WHERE activo = 1 AND (sesion_snapshot IS NULL OR sesion_snapshot != ?)')) {
      let n = 0;
      for (const p of db.products) if (p.activo === 1 && p.sesion_snapshot !== a[0]) { p.activo = 0; n++; }
      return { meta: { changes: n } };
    }
    if (s.startsWith('UPDATE sync_dispositivos SET ultimo_snapshot_en')) {
      const d = db.dispositivos.find((x) => x.id === a[2]);
      d.ultimo_snapshot_en = a[0];
      return { meta: { changes: 1 } };
    }
    if (s.startsWith('UPDATE settings SET valor = ?')) return { meta: { changes: 1 } };

    // ── etiquetas físicas (migración 007) ──
    if (s.startsWith('INSERT INTO sync_etiquetas_pendientes (sesion, etiqueta, global_id, disponible) VALUES')) {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) {
        const [sesion, etiqueta, global_id, disponible] = a.slice(i, i + 4);
        const previa = db.etiquetasPendientes.find((e) => e.sesion === sesion && e.etiqueta === etiqueta && e.global_id === global_id);
        if (previa) previa.disponible = disponible;
        else db.etiquetasPendientes.push({ sesion, etiqueta, global_id, disponible, creado_en: AHORA });
        n++;
      }
      return { meta: { changes: n } };
    }
    if (s.startsWith('DELETE FROM product_etiquetas WHERE NOT EXISTS')) {
      const sesion = a[0];
      const presentes = new Set(db.etiquetasPendientes.filter((e) => e.sesion === sesion).map((e) => `${e.etiqueta}|${e.global_id}`));
      const antes = db.etiquetas.length;
      db.etiquetas = db.etiquetas.filter((e) => presentes.has(`${e.etiqueta}|${e.global_id}`));
      return { meta: { changes: antes - db.etiquetas.length } };
    }
    if (s.startsWith('INSERT INTO product_etiquetas (etiqueta, product_id, global_id, disponible, actualizado_en) SELECT')) {
      const sesion = a[0];
      let n = 0;
      for (const e of db.etiquetasPendientes.filter((x) => x.sesion === sesion)) {
        const p = db.products.find((x) => x.global_id === e.global_id);
        if (!p) continue; // JOIN: sin producto no se publica
        const previa = db.etiquetas.find((x) => x.etiqueta === e.etiqueta && x.product_id === p.id);
        if (previa) {
          if (previa.disponible !== e.disponible || previa.global_id !== e.global_id) {
            previa.disponible = e.disponible;
            previa.global_id = e.global_id;
            previa.actualizado_en = AHORA;
            n++;
          }
        } else {
          db.etiquetas.push({ etiqueta: e.etiqueta, product_id: p.id, global_id: e.global_id, disponible: e.disponible, actualizado_en: AHORA });
          n++;
        }
      }
      return { meta: { changes: n } };
    }
    if (s.startsWith('DELETE FROM sync_etiquetas_pendientes WHERE sesion = ?')) {
      const antes = db.etiquetasPendientes.length;
      db.etiquetasPendientes = db.etiquetasPendientes.filter((e) => e.sesion !== a[0]);
      return { meta: { changes: antes - db.etiquetasPendientes.length } };
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
    this.etiquetasPendientes = data.etiquetasPendientes || [];
    this.log = [];
    this.batches = 0;
  }
  prepare(sql) {
    return new FakeStatement(this, sql);
  }
  // D1 ejecuta el batch como una transacción: si una sentencia falla, nada se
  // aplica. Aquí se simula guardando y restaurando el estado.
  async batch(sts) {
    this.batches++;
    const respaldo = JSON.stringify({
      products: this.products, variants: this.variants, eventos: this.eventos, dispositivos: this.dispositivos,
      etiquetas: this.etiquetas, etiquetasPendientes: this.etiquetasPendientes, log: this.log,
    });
    const out = [];
    try {
      for (const st of sts) out.push(await st.run());
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
