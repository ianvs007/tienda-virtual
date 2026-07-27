// Normaliza el código del sistema local para que cruce con el shortCode del
// POS ("tienda de ropas"). El POS usa 5 dígitos con ceros a la izquierda
// ('00042'); si el código viene solo con dígitos — escrito a mano sin ceros
// ('42') o leído de un Excel como número — se rellena a 5. Códigos con
// letras u otros caracteres se respetan tal cual (solo se recortan espacios).
export function normalizarCodigo(valor) {
  const c = String(valor ?? '').trim();
  return /^\d+$/.test(c) ? c.padStart(5, '0') : c;
}
