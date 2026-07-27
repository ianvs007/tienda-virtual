import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router-dom';
import { useCart } from '../contexts/CartContext.jsx';
import { urlImagen } from '../lib/formato.js';

export default function Layout() {
  const { totalItems } = useCart();
  const [nombreTienda, setNombreTienda] = useState('Casa Rick');
  const [logo, setLogo] = useState('');
  const [anuncio, setAnuncio] = useState('');
  const [categorias, setCategorias] = useState([]);
  const [searchParams] = useSearchParams();
  const [busqueda, setBusqueda] = useState(searchParams.get('q') || '');
  const navigate = useNavigate();

  const categoriaActiva = searchParams.get('categoria') || '';
  const qActivo = searchParams.get('q') || '';

  useEffect(() => {
    fetch('/api/ajustes')
      .then((r) => (r.ok ? r.json() : {}))
      .then((a) => {
        if (a.nombre_tienda) {
          setNombreTienda(a.nombre_tienda);
          document.title = a.nombre_tienda;
        }
        if (a.anuncio) setAnuncio(a.anuncio);
        if (a.logo_r2_key) setLogo(a.logo_r2_key);
      })
      .catch(() => {});
    fetch('/api/categorias')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCategorias)
      .catch(() => {});
  }, []);

  // Sincroniza la caja de búsqueda si la URL cambia (botón atrás, pestañas).
  useEffect(() => {
    setBusqueda(qActivo);
  }, [qActivo]);

  function buscar(e) {
    e.preventDefault();
    const q = busqueda.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : '/');
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 text-gray-900">
      {/* Membrete superior */}
      <div className="bg-gray-950 text-xs text-gray-400">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-1.5">
          <p className="truncate">
            <span className="font-semibold tracking-widest text-gray-200 uppercase">
              Casa Rick · Marca &amp; Estilo
            </span>
            <span className="ml-2 hidden sm:inline">Outfits — Cochabamba, Bolivia</span>
          </p>
          <p className="hidden shrink-0 md:block">🕠 Lun–Sáb 9:30–19:30 · Dom 9:00–15:00</p>
          <a
            href="https://wa.me/59177525264"
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-green-400 hover:underline"
          >
            💬 77525264
          </a>
        </div>
      </div>

      {/* Cabecera principal */}
      <header className="sticky top-0 z-10 bg-gray-900 text-white shadow">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
            {logo && (
              <img
                src={urlImagen(logo)}
                alt={`Logo de ${nombreTienda}`}
                className="h-9 w-9 rounded-lg bg-white object-contain p-0.5"
              />
            )}
            {nombreTienda}
          </Link>

          {/* Buscador de prendas */}
          <form onSubmit={buscar} className="order-3 flex w-full sm:order-2 sm:w-auto sm:flex-1 sm:px-4">
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar prenda… (ej: vestido, polera, jean)"
              className="w-full rounded-l-lg border-0 bg-gray-100 px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-r-lg bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"
              aria-label="Buscar"
            >
              🔍
            </button>
          </form>

          <nav className="order-2 ml-auto flex items-center gap-4 text-sm sm:order-3 sm:ml-0">
            <Link
              to="/carrito"
              className="relative rounded-lg bg-gray-100 px-3 py-1.5 font-medium text-gray-900 hover:bg-gray-200"
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

        {/* Pestañas de navegación */}
        <nav className="border-t border-gray-800">
          <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 text-sm">
            <Link
              to="/"
              className={`shrink-0 border-b-2 px-3 py-2 ${
                !categoriaActiva && !qActivo
                  ? 'border-white font-semibold text-white'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              Todo
            </Link>
            {categorias.map((c) => (
              <Link
                key={c.id}
                to={`/?categoria=${c.id}`}
                className={`shrink-0 border-b-2 px-3 py-2 whitespace-nowrap ${
                  categoriaActiva === String(c.id)
                    ? 'border-white font-semibold text-white'
                    : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                {c.nombre}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      {/* Espacio para promociones y anuncios importantes */}
      {anuncio && (
        <div className="bg-amber-400 text-center text-sm font-medium text-amber-950">
          <p className="mx-auto max-w-6xl px-4 py-2">📣 {anuncio}</p>
        </div>
      )}

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
