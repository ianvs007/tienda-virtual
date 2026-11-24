import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { hashPassword, verificarPassword, necesitaRehash, ITERACIONES } from './auth.js';

const b64 = (buf) => Buffer.from(buf).toString('base64url');

/** Hash en el formato histórico (50 000 iteraciones), generado con node:crypto. */
function hashHistorico(password, iteraciones = 50000) {
  const sal = randomBytes(16);
  return `pbkdf2$${iteraciones}$${b64(sal)}$${b64(pbkdf2Sync(password, sal, iteraciones, 32, 'sha256'))}`;
}

test('hashPassword usa el máximo de iteraciones permitido por Workers (100 000)', async () => {
  assert.equal(ITERACIONES, 100000);
  const h = await hashPassword('clave-segura-1');
  assert.match(h, /^pbkdf2\$100000\$/);
  assert.equal(await verificarPassword('clave-segura-1', h), true);
  assert.equal(await verificarPassword('otra-clave', h), false);
  assert.equal(necesitaRehash(h), false);
});

test('los hashes históricos de 50 000 iteraciones siguen verificando y piden rehash', async () => {
  const viejo = hashHistorico('clave-vieja-1');
  assert.equal(await verificarPassword('clave-vieja-1', viejo), true);
  assert.equal(await verificarPassword('clave-vieja-2', viejo), false);
  assert.equal(necesitaRehash(viejo), true);
});

test('hashes malformados o con iteraciones fuera de rango se rechazan sin lanzar', async () => {
  assert.equal(await verificarPassword('x', 'basura'), false);
  assert.equal(await verificarPassword('x', 'pbkdf2$100000$a'), false);
  assert.equal(await verificarPassword('x', 'md5$100000$AAAA$AAAA'), false);
  // > 100 000 haría lanzar NotSupportedError en Workers; < mínimo es trivial de romper.
  assert.equal(await verificarPassword('x', 'pbkdf2$5000000$AAAA$AAAA'), false);
  assert.equal(await verificarPassword('x', 'pbkdf2$10$AAAA$AAAA'), false);
  assert.equal(necesitaRehash('basura'), false);
});
