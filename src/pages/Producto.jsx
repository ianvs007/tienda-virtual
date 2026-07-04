import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCart } from '../contexts/CartContext.jsx';
import { bs, urlImagen } from '../lib/formato.js';

export default function Producto() {
  const { id } = useParams();
  const { agregar } = useCart();

  const [prod, setProd] = useState(null);
  const [error, setError] = useState(false);
  const [fotoActiva, setFotoActiva] = useState(0);
  const [varianteId, setVarianteId] = useState(null);
  const [cantidad, setCantidad] = useState(1);
  const [agregado, setAgregado] = useState(false);

  useEffect(() => {
    fetch(`/api/productos/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((p) => {
        setProd(p);
        const disponible = p.variantes.find((v) => v.stock > 0);
        if (disponible) setVarianteId(disponible.id);
      })
      .catch(() => setError(true));
  }, [id]);

  if (error)
    return (
      <div className="py-10 text-center text-gray-500">
        Producto no encontrado.{' '}
        <Link to="/" className="underline">
          Volver al catálogo
        </Link>
      </div>
    );

  if (!prod) return <p className="py-10 text-center text-gray-500">Cargando…</p>;

  const variante = prod.variantes.find((v) => v.id === varianteId);
  const stockDisponible = variante ? variante.stock : 0;
  const sinStock = prod.variantes.every((v) => v.stock === 0);

  function alCarrito() {
    if (!variante) return;
    agregar({
      productId: prod.id,
      variantId: variante.id,
      nombre: prod.nombre,
      talla: variante.talla,
      color: variante.color,
      precio: prod.precio,
      imagen: prod.imagenes[0] || null,
      cantidad,
    });
    setAgregado(true);
    setTimeout(() => setAgregado(false), 2000);
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      {/* Galería */}
      <div>
        <div className="aspect-square overflow-hidden rounded-xl bg-gray-100">
          {prod.imagenes.length > 0 ? (
            <img
              src={urlImagen(prod.imagenes[fotoActiva])}
              alt={prod.nombre}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-6xl text-gray-300">👗</div>
          )}
        </div>
        {prod.imagenes.length > 1 && (
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {prod.imagenes.map((img, i) => (
              <button
                key={img}
                onClick={() => setFotoActiva(i)}
                className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 ${
                  i === fotoActiva ? 'border-gray-900' : 'border-transparent'
                }`}
              >
                <img src={urlImagen(img)} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Información y compra */}
      <div>
        {prod.categoria && <p className="text-sm text-gray-500">{prod.categoria}</p>}
        <h1 className="text-2xl font-bold">{prod.nombre}</h1>
        <p className="mt-1 text-2xl font-bold">{bs(prod.precio)}</p>
        {prod.descripcion && <p className="mt-3 whitespace-pre-line text-gray-600">{prod.descripcion}</p>}

        {sinStock ? (
          <p className="mt-6 rounded-lg bg-gray-100 p-4 text-center text-gray-500">
            Agotado por el momento
          </p>
        ) : (
          <>
            <div className="mt-6">
              <p className="mb-2 text-sm font-medium">Talla / Color</p>
              <div className="flex flex-wrap gap-2">
                {prod.variantes.map((v) => {
                  const etiqueta = [v.talla, v.color].filter(Boolean).join(' · ') || 'Única';
                  return (
                    <button
                      key={v.id}
                      disabled={v.stock === 0}
                      onClick={() => {
                        setVarianteId(v.id);
                        setCantidad(1);
                      }}
                      className={`rounded-lg border px-4 py-2 text-sm ${
                        v.stock === 0
                          ? 'cursor-not-allowed border-gray-200 text-gray-300 line-through'
                          : v.id === varianteId
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-gray-300 bg-white hover:border-gray-900'
                      }`}
                    >
                      {etiqueta}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <p className="text-sm font-medium">Cantidad</p>
              <div className="flex items-center rounded-lg border">
                <button
                  onClick={() => setCantidad(Math.max(1, cantidad - 1))}
                  className="px-3 py-1.5 hover:bg-gray-100"
                >
                  −
                </button>
                <span className="w-10 text-center">{cantidad}</span>
                <button
                  onClick={() => setCantidad(Math.min(stockDisponible, cantidad + 1))}
                  className="px-3 py-1.5 hover:bg-gray-100"
                >
                  +
                </button>
              </div>
              <span className="text-xs text-gray-400">{stockDisponible} disponibles</span>
            </div>

            <button
              onClick={alCarrito}
              disabled={!variante}
              className="mt-6 w-full rounded-xl bg-gray-900 py-3 font-medium text-white transition hover:bg-gray-700 disabled:opacity-40"
            >
              {agregado ? '✓ Agregado al carrito' : 'Agregar al carrito'}
            </button>
            {agregado && (
              <Link to="/carrito" className="mt-2 block text-center text-sm underline">
                Ver carrito →
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
