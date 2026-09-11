// Búsqueda del catálogo (público y admin), lógica PURA para poder probarla en
// node. Orden de resolución, de más específico a más laxo:
//   1. Etiqueta física exacta (product_etiquetas): es el número que el cliente
//      tiene en la mano. Si existe, la búsqueda termina aquí: se devuelven solo
//      sus productos (los que estén en la lista) y NO se cae a los pasos
//      siguientes, ni cuando está en VARIOS productos (conflicto explícito) ni
//      cuando su prenda no está en la lista (p.ej. inactiva).
//   2. Código de modelo exacto (products.codigo).
//   3. Texto en nombre/descripción, tolerante a tildes y errores de escritura.
import { normalizarCodigo } from './codigo.js';

// Quita tildes y pasa a minúsculas para comparar sin importar acentos.
export function normalizarTexto(texto) {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// Distancia de Levenshtein: cuántas letras hay que cambiar para igualar dos palabras.
export function distancia(a, b) {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return fila[b.length];
}

// ¿La prenda coincide con TODAS las palabras buscadas (exactas o con errores menores)?
export function coincidePrenda(prenda, palabras) {
  const texto = normalizarTexto(`${prenda.nombre} ${prenda.descripcion}`);
  const tokens = texto.split(/[^a-z0-9ñ]+/).filter(Boolean);
  return palabras.every((palabra) => {
    if (texto.includes(palabra)) return true;
    const tolerancia = palabra.length <= 4 ? 1 : 2;
    return tokens.some(
      (token) => Math.abs(token.length - palabra.length) <= tolerancia && distancia(token, palabra) <= tolerancia
    );
  });
}

/**
 * Aplica la cadena etiqueta → código de modelo → texto sobre una lista de
 * productos ya cargada. Cada producto devuelto lleva `coincidencia`:
 *   { tipo: 'etiqueta', etiqueta, disponible }            una sola prenda tiene la etiqueta
 *   { tipo: 'etiqueta_conflicto', etiqueta, disponible }  la etiqueta está en varias prendas
 *   { tipo: 'codigo', codigo }                             coincide el código de modelo
 *   (sin coincidencia)                                     resultado de texto
 *
 * @param {Object} p
 * @param {string} p.q                    término tal como lo escribió el usuario
 * @param {Array}  p.productos            [{ id, nombre, descripcion, codigo, ... }]
 * @param {{ tipo, etiqueta, productos: Array<{ id, disponible }> }} p.etiqueta  resultado de resolverEtiqueta
 * @returns {{ resultados: Array, modo: 'etiqueta'|'etiqueta_conflicto'|'codigo'|'texto', etiqueta: string|null }}
 */
export function buscarEnCatalogo({ q, productos = [], etiqueta }) {
  const termino = String(q ?? '').trim();
  if (!termino) return { resultados: productos, modo: 'texto', etiqueta: null };

  if (etiqueta && (etiqueta.tipo === 'etiqueta' || etiqueta.tipo === 'etiqueta_conflicto')) {
    const porId = new Map(etiqueta.productos.map((e) => [Number(e.id), e]));
    const resultados = productos
      .filter((p) => porId.has(Number(p.id)))
      .map((p) => ({
        ...p,
        coincidencia: {
          tipo: etiqueta.tipo,
          etiqueta: etiqueta.etiqueta,
          disponible: Boolean(porId.get(Number(p.id)).disponible),
          // Cuántas prendas (activas o no) llevan la etiqueta: en un conflicto la
          // UI lo informa aunque alguna no esté en la lista.
          prendas: etiqueta.productos.length,
        },
      }));
    // La etiqueta EXISTE: nunca se cae al código de modelo ni al texto, aunque
    // la lista (p.ej. solo activos) no contenga ninguno de sus productos. Un
    // resultado vacío aquí significa "esa prenda no está en venta", no "busca
    // otra cosa" (02797 caería en VESTIDO VICTORIANO por código, otra prenda).
    return { resultados, modo: etiqueta.tipo, etiqueta: etiqueta.etiqueta };
  }

  const codigo = normalizarCodigo(termino);
  const porCodigo = productos.filter((p) => p.codigo && String(p.codigo) === codigo);
  if (porCodigo.length > 0) {
    return {
      resultados: porCodigo.map((p) => ({ ...p, coincidencia: { tipo: 'codigo', codigo } })),
      modo: 'codigo',
      etiqueta: etiqueta?.etiqueta ?? null,
    };
  }

  const palabras = normalizarTexto(termino).split(/\s+/).filter(Boolean);
  return {
    resultados: productos.filter((prenda) => coincidePrenda(prenda, palabras)),
    modo: 'texto',
    etiqueta: etiqueta?.etiqueta ?? null,
  };
}
