// D1 de prueba sobre node:sqlite con el esquema REAL (todas las migraciones en
// orden). Solo para tests: no exporta handlers.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const DIR = new URL('../../migrations/', import.meta.url);

export function entornoSqlite(extra = {}, { hasta } = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
    if (hasta && f > hasta) break;
    db.exec(readFileSync(new URL(f, DIR), 'utf8'));
  }
  const sentencia = (sql, args) => ({
    sql,
    args,
    async first() {
      return db.prepare(sql).get(...args) ?? null;
    },
    async all() {
      return { results: db.prepare(sql).all(...args) };
    },
    async run() {
      return { meta: db.prepare(sql).run(...args) };
    },
  });
  const DB = {
    prepare(sql) {
      return { ...sentencia(sql, []), bind: (...args) => sentencia(sql, args) };
    },
    async batch(lista) {
      db.exec('BEGIN');
      try {
        const salida = lista.map(({ sql, args }) => ({ meta: db.prepare(sql).run(...args) }));
        db.exec('COMMIT');
        return salida;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, env: { DB, ...extra } };
}

export function peticion(url, { metodo = 'POST', cuerpo, ip = '186.5.1.1', headers = {} } = {}) {
  return new Request(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
    ...(cuerpo !== undefined ? { body: JSON.stringify(cuerpo) } : {}),
  });
}
