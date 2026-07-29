import { useEffect, useState } from 'react';

// Auditoría de stock: quién/cómo cambió el stock de cada variante
// (altas, ediciones, ventas, cancelaciones, expiraciones, sincronización
// e importación del catálogo). Los datos los llena functions/lib/stockLog.js.
const ORIGENES = {
  creacion: { texto: 'Alta', clase: 'bg-blue-100 text-blue-800' },
  edicion: { texto: 'Edición', clase: 'bg-gray-200 text-gray-700' },
  venta: { texto: 'Venta', clase: 'bg-green-100 text-green-800' },
  cancelacion: { texto: 'Cancelación', clase: 'bg-amber-100 text-amber-800' },
  expiracion: { texto: 'Expiración', clase: 'bg-amber-100 text-amber-800' },
  sincronizacion: { texto: 'Sincronización', clase: 'bg-purple-100 text-purple-800' },
  importacion: { texto: 'Importación', clase: 'bg-blue-100 text-blue-800' },
};

function fechaBonita(valor) {
  if (!valor) return '—';
  return new Date(valor.replace(' ', 'T') + 'Z').toLocaleString('es-BO');
}

export default function AdminAuditoria() {
  const [filas, setFilas] = useState(null);
  const [busqueda, setBusqueda] = useState('');

  function cargar(q = '') {
    fetch(`/api/admin/stock-log?limite=300${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setFilas)
      .catch(() => setFilas([]));
  }

  useEffect(() => {
    cargar();
  }, []);

  function buscar(e) {
    e.preventDefault();
    setFilas(null);
    cargar(busqueda.trim());
  }

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold">Auditoría de stock</h1>
      <p className="mb-4 text-sm text-gray-500">
        Registro de todos los cambios de cantidad: altas, ediciones, ventas, cancelaciones,
        expiraciones, sincronización e importación. Se muestran los últimos 300 movimientos.
      </p>

      <form onSubmit={buscar} className="mb-4 flex gap-2">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre, código o pedido…"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <button className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700">
          Buscar
        </button>
      </form>

      {!filas ? (
        <p className="py-10 text-center text-gray-500">Cargando…</p>
      ) : filas.length === 0 ? (
        <p className="py-10 text-center text-gray-500">Sin movimientos registrados.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-gray-100 p-3 shadow">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="py-1 pr-2">Fecha</th>
                <th className="py-1 pr-2">Código</th>
                <th className="py-1 pr-2">Prenda</th>
                <th className="py-1 pr-2">Variante</th>
                <th className="py-1 pr-2 text-right">Antes</th>
                <th className="py-1 pr-2 text-right">Después</th>
                <th className="py-1 pr-2">Origen</th>
                <th className="py-1">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => {
                const o = ORIGENES[f.origen] || { texto: f.origen, clase: 'bg-gray-200 text-gray-700' };
                return (
                  <tr key={f.id} className="border-b last:border-0">
                    <td className="py-1 pr-2 whitespace-nowrap text-xs text-gray-500">
                      {fechaBonita(f.creado_en)}
                    </td>
                    <td className="py-1 pr-2 font-mono text-xs">{f.codigo || '—'}</td>
                    <td className="py-1 pr-2">{f.nombre || '—'}</td>
                    <td className="py-1 pr-2 text-xs text-gray-500">{f.variante || '—'}</td>
                    <td className="py-1 pr-2 text-right">
                      {f.stock_anterior ?? <span className="text-xs text-gray-400">nuevo</span>}
                    </td>
                    <td className="py-1 pr-2 text-right font-medium">{f.stock_nuevo}</td>
                    <td className="py-1 pr-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${o.clase}`}>{o.texto}</span>
                    </td>
                    <td className="py-1 text-xs text-gray-500">{f.detalle || ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
