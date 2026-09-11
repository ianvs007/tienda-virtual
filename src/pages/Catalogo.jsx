import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { bs, urlImagen } from '../lib/formato.js';

export default function Catalogo() {
  const [productos, setProductos] = useState(null);
  const [error, setError] = useState(false);
  const [searchParams] = useSearchParams();

  const categoria = searchParams.get('categoria') || '';
  const q = (searchParams.get('q') || '').trim();

  useEffect(() => {
    setProductos(null);
    const params = new URLSearchParams();
    if (categoria) params.set('categoria', categoria);
    if (q) params.set('q', q);
    const qs = params.toString();
    fetch(`/api/productos${qs ? `?${qs}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProductos)
      .catch(() => setError(true));
  }, [categoria, q]);

  if (error)
    return <p className="py-10 text-center text-gray-500">El catálogo no está disponible ahora. Intenta de nuevo en unos minutos.</p>;

  // Cómo se resolvió la búsqueda (la API marca cada resultado con `coincidencia`).
  const coincidencia = q && productos?.length ? productos[0].coincidencia || null : null;
  const esEtiqueta = coincidencia?.tipo === 'etiqueta';
  const esConflicto = coincidencia?.tipo === 'etiqueta_conflicto';
  const esCodigo = coincidencia?.tipo === 'codigo';

  return (
    <div>
      {/* Portada de la tienda (solo en la vista principal, sin búsqueda ni filtro) */}
      {!categoria && !q && (
        <section className="mb-6 overflow-hidden rounded-2xl bg-gray-900 text-white shadow">
          <div className="px-6 py-8 text-center sm:py-10">
            <p className="text-xs font-medium tracking-[0.3em] text-gray-400 uppercase">
              Marca &amp; Estilo · Outfits
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Casa Rick</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-gray-300">
              Ropa con estilo en Cochabamba. Elige tus prendas, paga con QR y coordinamos tu entrega
              por WhatsApp.
            </p>
            <p className="mt-4 text-xs text-gray-400">
              📍 Calle Jordán #631, entre Antezana y Lanza · 🛍 Sucursal: Calle San Martín #563
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
              <a
                href="https://wa.me/59177525264?text=Hola%20Casa%20Rick%2C%20quiero%20consultar%20por%20una%20prenda"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium hover:bg-green-500"
              >
                💬 Escríbenos por WhatsApp
              </a>
              <span className="text-xs text-gray-400">🚚 Envíos al interior del país 🇧🇴</span>
            </div>
          </div>
        </section>
      )}

      {q && (
        <p className="mb-2 text-sm text-gray-600">
          Resultados para <span className="font-semibold">“{q}”</span>
          {productos && productos.length > 0 && <> · {productos.length} prenda(s)</>}
        </p>
      )}

      {/* Origen de la coincidencia: etiqueta física ≠ código de modelo */}
      {esEtiqueta && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p>
            🏷 Etiqueta <span className="font-mono font-semibold">{coincidencia.etiqueta}</span>: es la prenda que
            tienes en la mano.
          </p>
          {!coincidencia.disponible && (
            <p className="mt-1 text-xs text-emerald-800">
              Esa unidad en particular ya se vendió en la tienda; la prenda puede seguir disponible en otras
              unidades (mira el stock de la ficha).
            </p>
          )}
        </div>
      )}
      {esConflicto && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <p className="font-semibold">
            ⚠ La etiqueta <span className="font-mono">{coincidencia.etiqueta}</span> figura en{' '}
            {coincidencia.prendas || productos.length} prendas distintas
            {coincidencia.prendas > productos.length ? ' (alguna ya no está en venta)' : ''}.
          </p>
          <p className="mt-1 text-xs">
            No podemos saber cuál es la tuya: revísalas abajo o escríbenos por WhatsApp con la foto de la
            etiqueta.
          </p>
        </div>
      )}
      {esCodigo && (
        <p className="mb-4 text-xs text-gray-500">
          Coincide con el código de modelo <span className="font-mono font-semibold">{coincidencia.codigo}</span>{' '}
          (ninguna etiqueta física registrada con ese número).
        </p>
      )}

      {!productos ? (
        <p className="py-10 text-center text-gray-500">Cargando catálogo…</p>
      ) : productos.length === 0 ? (
        <div className="py-14 text-center text-gray-500">
          <p className="text-4xl">🔍</p>
          <p className="mt-2">
            {q
              ? `No encontramos prendas para “${q}”.`
              : 'Pronto tendremos prendas disponibles.'}
          </p>
          {q && (
            <Link to="/" className="mt-3 inline-block rounded-lg bg-gray-900 px-4 py-2 text-white">
              Ver todo el catálogo
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {productos.map((p) => (
            <Link
              key={p.id}
              to={`/producto/${p.id}`}
              className="group overflow-hidden rounded-xl bg-gray-100 shadow transition hover:shadow-md"
            >
              <div className="relative aspect-square bg-gray-100">
                {p.imagen ? (
                  <img
                    src={urlImagen(p.imagen)}
                    alt={p.nombre}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl text-gray-300">👗</div>
                )}
                {p.stock_total === 0 && (
                  <span className="absolute top-2 left-2 rounded bg-gray-900/80 px-2 py-0.5 text-xs text-white">
                    Agotado
                  </span>
                )}
                {p.coincidencia?.tipo === 'etiqueta' && (
                  <span className="absolute right-2 bottom-2 rounded bg-emerald-600/90 px-2 py-0.5 font-mono text-xs text-white">
                    🏷 {p.coincidencia.etiqueta}
                  </span>
                )}
                {p.coincidencia?.tipo === 'etiqueta_conflicto' && (
                  <span className="absolute right-2 bottom-2 rounded bg-red-600/90 px-2 py-0.5 font-mono text-xs text-white">
                    ⚠ {p.coincidencia.etiqueta}
                  </span>
                )}
                {p.coincidencia?.tipo === 'codigo' && (
                  <span className="absolute right-2 bottom-2 rounded bg-gray-700/90 px-2 py-0.5 font-mono text-xs text-white">
                    Cód. {p.coincidencia.codigo}
                  </span>
                )}
              </div>
              <div className="p-3">
                <h2 className="truncate text-sm font-medium">{p.nombre}</h2>
                <p className="font-bold">{bs(p.precio)}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
