import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { useCart } from '../contexts/CartContext.jsx';

export default function Layout() {
  const { totalItems } = useCart();
  const [nombreTienda, setNombreTienda] = useState('Casa Rick');

  useEffect(() => {
    fetch('/api/ajustes')
      .then((r) => (r.ok ? r.json() : {}))
      .then((a) => {
        if (a.nombre_tienda) {
          setNombreTienda(a.nombre_tienda);
          document.title = a.nombre_tienda;
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-gray-900 text-white shadow">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-xl font-bold tracking-tight">
            {nombreTienda}
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className="hover:underline">
              Catálogo
            </Link>
            <Link
              to="/carrito"
              className="relative rounded-lg bg-white px-3 py-1.5 font-medium text-gray-900 hover:bg-gray-200"
            >
              🛒 Carrito
              {totalItems > 0 && (
                <span className="absolute -top-2 -right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-bold text-white">
                  {totalItems}
                </span>
              )}
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="mt-10 bg-gray-900 py-8 text-sm text-gray-300">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
          <div>
            <p className="font-semibold text-white">📍 Visítanos en Cochabamba</p>
            <p className="mt-2">
              <span className="font-medium text-gray-100">Casa matriz:</span> calle Jordán #631,
              entre Antezana y Lanza
            </p>
            <p className="mt-1">
              <span className="font-medium text-gray-100">Sucursal 1:</span> calle San Martín #563,
              entre Ladislao Cabrera
            </p>
            <img
              src="/fachada.jpg"
              alt="Fachada de la casa matriz"
              className="mt-3 w-full max-w-56 rounded-lg shadow"
              loading="lazy"
            />
          </div>
          <div>
            <p className="font-semibold text-white">🕠 Horarios de atención</p>
            <p className="mt-2">Lunes a sábado: 9:30 – 19:30</p>
            <p className="mt-1">Domingos: 9:00 – 15:00</p>
            <p className="mt-1 text-gray-500">Feriados no hay atención</p>
            <p className="mt-3">🚚 Envíos al interior del país 🇧🇴</p>
          </div>
          <div>
            <p className="font-semibold text-white">💬 WhatsApp</p>
            <p className="mt-2">
              <a
                href="https://wa.me/59177525264"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:underline"
              >
                77525264
              </a>
              {' · '}
              <a
                href="https://wa.me/59161611290"
                target="_blank"
                rel="noopener noreferrer"
                className="text-green-400 hover:underline"
              >
                61611290
              </a>
            </p>
            <p className="mt-3 text-gray-500">
              Compra fácil: elige tus prendas, paga con QR y coordinamos tu entrega por WhatsApp.
            </p>
          </div>
        </div>
        <p className="mt-6 border-t border-gray-800 pt-4 text-center text-xs text-gray-500">
          {nombreTienda} · Cochabamba, Bolivia
        </p>
      </footer>
    </div>
  );
}
