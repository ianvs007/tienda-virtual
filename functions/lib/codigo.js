// Normaliza el código del sistema local para que cruce con el shortCode del
// POS ("tienda de ropas"). El POS usa 5 dígitos con ceros a la izquierda
// ('00042'); si el código viene solo con dígitos — escrito a mano sin ceros
// ('42') o leído de un Excel como número — se rellena a 5. Códigos con
// letras u otros caracteres se respetan tal cual (solo se recortan espacios).
export function normalizarCodigo(valor) {
  const c = String(valor ?? '').trim();
  return /^\d+$/.test(c) ? c.padStart(5, '0') : c;
}

// Normalización ESTRICTA para etiquetas físicas (shortCode de unidad del POS).
// Una etiqueta válida son 1 a 5 dígitos: se conserva/rellena a 5 con ceros
// ('2797' → '02797', '02797' → '02797'). Cualquier otra cosa (letras, más de
// 5 dígitos, vacío) devuelve null: un código inválido NUNCA se convierte en uno
// válido recortando o limpiando caracteres. Debe ser idéntica a la del POS
// (src/utils/syncV2.js::normalizarEtiqueta) para que ambos lados hablen del
// mismo número.
export function normalizarEtiqueta(valor) {
  const c = String(valor ?? '').trim();
  return /^\d{1,5}$/.test(c) ? c.padStart(5, '0') : null;
}
