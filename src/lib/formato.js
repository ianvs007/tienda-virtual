// Formato de precios en bolivianos.
export function bs(monto) {
  return `Bs ${Number(monto).toFixed(2).replace(/\.00$/, '')}`;
}

// URL pública de una foto guardada en R2.
export function urlImagen(key) {
  return key ? `/api/img/${key}` : null;
}
