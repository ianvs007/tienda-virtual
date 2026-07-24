import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';

const tabs = [
  { a: '/admin/pedidos', t: '📋 Pedidos' },
  { a: '/admin/productos', t: '👗 Prendas' },
  { a: '/admin/sincronizar', t: '🔄 Sincronizar' },
  { a: '/admin/ajustes', t: '⚙️ Ajustes' },
];

export default function AdminLayout({ email, onSalir }) {
  // Contador de pedidos con comprobante por verificar (se refresca cada minuto).
  const [porVerificar, setPorVerificar] = useState(0);

  useEffect(() => {
    function contar() {
      fetch('/api/admin/pedidos?estado=comprobante_subido')
        .then((r) => (r.ok ? r.json() : []))
        .then((lista) => setPorVerificar(lista.length))
        .catch(() => {});
    }
    contar();
    const t = setInterval(contar, 60000);
    return () => clearInterval(t);
  }, []);

  async function salir() {
    await fetch('/api/admin/logout', { method: 'POST' });
    onSalir();
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-gray-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-bold">Admin · Tienda Virtual</span>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/" className="text-gray-300 hover:text-white">
              Ver tienda ↗
            </Link>
            <span className="hidden text-gray-400 sm:inline">{email}</span>
            <button onClick={salir} className="rounded-lg bg-gray-700 px-3 py-1 hover:bg-gray-600">
              Salir
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-5xl gap-1 px-4">
          {tabs.map((x) => (
            <NavLink
              key={x.a}
              to={x.a}
              className={({ isActive }) =>
                `rounded-t-lg px-4 py-2 text-sm ${
                  isActive ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-300 hover:text-white'
                }`
              }
            >
              {x.t}
              {x.a === '/admin/pedidos' && porVerificar > 0 && (
                <span className="ml-1.5 rounded-full bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white">
                  {porVerificar}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
