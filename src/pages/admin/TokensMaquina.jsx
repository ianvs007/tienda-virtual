import { useEffect, useState } from 'react';

// Tokens de máquina con alcance y sucursal (migración 010): uno por tienda/POS.
export default function TokensMaquina() {
  const [datos, setDatos] = useState({ tokens: [], legacySyncEnTraslados: true });
  const [nombre, setNombre] = useState('');
  const [sucursal, setSucursal] = useState('');
  const [alcance, setAlcance] = useState({ sync: false, traslados: true });
  const [nuevo, setNuevo] = useState('');
  const [msj, setMsj] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function cargar() {
    const r = await fetch('/api/admin/api-tokens');
    if (r.ok) setDatos(await r.json());
  }
  useEffect(() => {
    cargar().catch(() => {});
  }, []);

  async function llamar(url, opciones) {
    setOcupado(true);
    setMsj('');
    try {
      const r = await fetch(url, opciones);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo completar la acción');
      await cargar();
      return data;
    } catch (err) {
      setMsj(err.message);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function crear(e) {
    e.preventDefault();
    const lista = Object.keys(alcance).filter((k) => alcance[k]);
    const data = await llamar('/api/admin/api-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre, sucursal, alcance: lista }),
    });
    if (data) {
      setNuevo(data.token);
      setNombre('');
    }
  }

  const revocar = (id) => {
    if (window.confirm('¿Revocar este token? El POS que lo use dejará de conectarse.'))
      llamar(`/api/admin/api-tokens?id=${id}`, { method: 'DELETE' });
  };

  const alternarHeredado = () =>
    llamar('/api/admin/api-tokens', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ legacySyncEnTraslados: !datos.legacySyncEnTraslados }),
    });

  return (
    <div className="rounded-xl bg-gray-100 p-4 shadow">
      <p className="text-sm font-medium">Tokens por tienda (traslados y sincronización)</p>
      <p className="mt-1 text-xs text-gray-500">
        Un token por POS. Con alcance "traslados" el servidor solo permite operar a la sucursal
        indicada. Se muestra completo una sola vez.
      </p>

      {datos.migracionPendiente && (
        <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          Falta aplicar la migración 010 en la base de datos para usar esta función.
        </p>
      )}

      {nuevo && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-800">
            Copia este token ahora: no se volverá a mostrar. Configúralo en el POS (campo de token).
          </p>
          <p className="mt-1 break-all rounded bg-white p-2 font-mono text-xs select-all">{nuevo}</p>
        </div>
      )}

      <form onSubmit={crear} className="mt-3 space-y-2">
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Nombre (ej. POS Sucursal 1)"
          required
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <input
          value={sucursal}
          onChange={(e) => setSucursal(e.target.value)}
          placeholder="Sucursal (igual que en el POS, ej. SUCURSAL 1)"
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />
        <div className="flex gap-4 text-sm">
          {['traslados', 'sync'].map((a) => (
            <label key={a} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={alcance[a]}
                onChange={(e) => setAlcance({ ...alcance, [a]: e.target.checked })}
              />
              {a === 'sync' ? 'Sincronización de stock' : 'Traslados'}
            </label>
          ))}
        </div>
        <button
          disabled={ocupado}
          className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          Crear token
        </button>
      </form>

      {msj && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{msj}</p>}

      <ul className="mt-3 space-y-1 text-xs">
        {datos.tokens.map((t) => (
          <li key={t.id} className="flex items-center justify-between rounded bg-white p-2">
            <span>
              <b>{t.nombre}</b> · {t.alcance.join(' + ')}
              {t.sucursal ? ` · ${t.sucursal}` : ''}
              {t.activo ? '' : ' · revocado'}
              {t.ultimo_uso ? ` · último uso ${t.ultimo_uso}` : ''}
            </span>
            {t.activo ? (
              <button type="button" onClick={() => revocar(t.id)} className="text-red-700 hover:underline">
                Revocar
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <label className="mt-3 flex items-start gap-2 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={datos.legacySyncEnTraslados}
          onChange={alternarHeredado}
          disabled={ocupado}
          className="mt-0.5"
        />
        <span>
          Aceptar también el token general de sincronización en traslados (modo heredado, sin control
          de sucursal). Desmárcalo cuando todos los POS usen su propio token.
        </span>
      </label>
    </div>
  );
}
