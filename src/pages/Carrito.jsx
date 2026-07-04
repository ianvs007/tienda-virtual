import { Link } from 'react-router-dom';
import { useCart } from '../contexts/CartContext.jsx';
import { bs, urlImagen } from '../lib/formato.js';

export default function Carrito() {
  const { items, cambiarCantidad, quitar, totalBs } = useCart();

  if (items.length === 0)
    return (
      <div className="py-14 text-center text-gray-500">
        <p className="text-4xl">🛒</p>
        <p className="mt-2">Tu carrito está vacío.</p>
        <Link to="/" className="mt-3 inline-block rounded-lg bg-gray-900 px-4 py-2 text-white">
          Ver catálogo
        </Link>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-xl font-bold">Tu carrito</h1>

      <ul className="space-y-3">
        {items.map((i) => {
          const etiqueta = [i.talla, i.color].filter(Boolean).join(' · ');
          return (
            <li
              key={`${i.productId}-${i.variantId}`}
              className="flex items-center gap-3 rounded-xl bg-white p-3 shadow"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                {i.imagen ? (
                  <img src={urlImagen(i.imagen)} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl text-gray-300">👗</div>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Link to={`/producto/${i.productId}`} className="block truncate font-medium hover:underline">
                  {i.nombre}
                </Link>
                {etiqueta && <p className="text-xs text-gray-500">{etiqueta}</p>}
                <p className="text-sm font-bold">{bs(i.precio)}</p>
              </div>

              <div className="flex items-center rounded-lg border">
                <button
                  onClick={() => cambiarCantidad(i.productId, i.variantId, i.cantidad - 1)}
                  className="px-2.5 py-1 hover:bg-gray-100"
                >
                  −
                </button>
                <span className="w-8 text-center text-sm">{i.cantidad}</span>
                <button
                  onClick={() => cambiarCantidad(i.productId, i.variantId, i.cantidad + 1)}
                  className="px-2.5 py-1 hover:bg-gray-100"
                >
                  +
                </button>
              </div>

              <button
                onClick={() => quitar(i.productId, i.variantId)}
                title="Quitar"
                className="text-gray-400 hover:text-red-600"
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 rounded-xl bg-white p-4 shadow">
        <div className="flex justify-between text-lg font-bold">
          <span>Total</span>
          <span>{bs(totalBs)}</span>
        </div>
        <p className="mt-1 text-xs text-gray-500">El costo de envío se coordina en el siguiente paso.</p>
        <Link
          to="/checkout"
          className="mt-4 block w-full rounded-xl bg-gray-900 py-3 text-center font-medium text-white hover:bg-gray-700"
        >
          Continuar con la compra
        </Link>
      </div>
    </div>
  );
}
