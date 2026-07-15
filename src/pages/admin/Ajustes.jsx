import { useEffect, useRef, useState } from 'react';
import { urlImagen } from '../../lib/formato.js';

export default function AdminAjustes() {
  const [ajustes, setAjustes] = useState(null);
  const [msj, setMsj] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [subiendoQR, setSubiendoQR] = useState(false);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmarNueva, setConfirmarNueva] = useState('');
  const [guardandoPass, setGuardandoPass] = useState(false);
  const inputQR = useRef(null);

  useEffect(() => {
    fetch('/api/admin/ajustes')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setAjustes)
      .catch(() => setAjustes({}));
  }, []);

  if (!ajustes) return <p className="py-10 text-center text-gray-500">Cargando…</p>;

  function campo(clave, valor) {
    setAjustes((prev) => ({ ...prev, [clave]: valor }));
  }

  async function guardar() {
    setMsj('');
    setGuardando(true);
    const r = await fetch('/api/admin/ajustes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ajustes),
    });
    setGuardando(false);
    setMsj(r.ok ? '✓ Ajustes guardados' : 'No se pudo guardar');
  }

  async function subirQR(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendoQR(true);
    setMsj('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await fetch('/api/admin/qr', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo subir el QR');
      campo('qr_cobro_r2_key', data.r2_key);
      setMsj('✓ QR de cobro actualizado');
    } catch (err) {
      setMsj(err.message);
    } finally {
      setSubiendoQR(false);
      if (inputQR.current) inputQR.current.value = '';
    }
  }

  async function cambiarPassword(e) {
    e.preventDefault();
    setMsj('');
    if (nueva !== confirmarNueva) {
      setMsj('Las contraseñas nuevas no coinciden');
      return;
    }
    setGuardandoPass(true);
    try {
      const r = await fetch('/api/admin/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actual, nueva }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo cambiar la contraseña');
      setActual('');
      setNueva('');
      setConfirmarNueva('');
      setMsj('✓ Contraseña actualizada');
    } catch (err) {
      setMsj(err.message);
    } finally {
      setGuardandoPass(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-lg font-bold">Ajustes de la tienda</h1>

      <div className="rounded-xl bg-white p-4 shadow">
        <label className="block text-sm font-medium">Nombre de la tienda</label>
        <input
          value={ajustes.nombre_tienda || ''}
          onChange={(e) => campo('nombre_tienda', e.target.value)}
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        <label className="mt-3 block text-sm font-medium">WhatsApp de la tienda</label>
        <input
          value={ajustes.whatsapp_tienda || ''}
          onChange={(e) => campo('whatsapp_tienda', e.target.value)}
          placeholder="Ej: 59170000000 (con código de país)"
          className="mt-1 w-full rounded-lg border px-3 py-2"
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium">Envío local (Bs)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={ajustes.costo_envio_local || ''}
              onChange={(e) => campo('costo_envio_local', e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Envío nacional (Bs)</label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={ajustes.costo_envio_nacional || ''}
              onChange={(e) => campo('costo_envio_nacional', e.target.value)}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </div>
        </div>
        <p className="mt-1 text-xs text-gray-400">Con 0, el envío aparece como "A coordinar".</p>
      </div>

      <div className="rounded-xl bg-white p-4 shadow text-center">
        <p className="text-sm font-medium">QR de cobro</p>
        <p className="mt-1 text-xs text-gray-500">
          La imagen del QR de tu banco o billetera. Es el que verán los clientes al pagar.
        </p>
        {ajustes.qr_cobro_r2_key ? (
          <img
            src={urlImagen(ajustes.qr_cobro_r2_key)}
            alt="QR de cobro actual"
            className="mx-auto mt-2 w-40 rounded-lg border"
          />
        ) : (
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            Aún no subiste tu QR: los clientes no pueden pagar sin él.
          </p>
        )}
        <label className="mt-3 inline-block cursor-pointer rounded-lg bg-gray-200 px-4 py-2 text-sm hover:bg-gray-300">
          {subiendoQR ? 'Subiendo…' : ajustes.qr_cobro_r2_key ? 'Cambiar QR' : 'Subir QR'}
          <input
            ref={inputQR}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={subirQR}
            disabled={subiendoQR}
            className="hidden"
          />
        </label>
      </div>

      <div className="rounded-xl bg-white p-4 shadow">
        <p className="text-sm font-medium">Seguridad</p>
        <p className="mt-1 text-xs text-gray-500">Cambia tu contraseña de acceso al panel admin.</p>
        <form onSubmit={cambiarPassword} className="mt-3 space-y-3">
          <div>
            <label className="block text-sm font-medium">Contraseña actual</label>
            <input
              type="password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Nueva contraseña</label>
            <input
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium">Confirmar nueva contraseña</label>
            <input
              type="password"
              value={confirmarNueva}
              onChange={(e) => setConfirmarNueva(e.target.value)}
              required
              minLength={8}
              className="mt-1 w-full rounded-lg border px-3 py-2"
            />
          </div>
          <button
            disabled={guardandoPass}
            className="w-full rounded-xl bg-gray-900 py-2.5 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {guardandoPass ? 'Actualizando…' : 'Cambiar contraseña'}
          </button>
        </form>
      </div>

      {msj && <p className="rounded-lg bg-gray-100 p-2 text-center text-sm">{msj}</p>}

      <button
        type="button"
        onClick={guardar}
        disabled={guardando}
        className="w-full rounded-xl bg-gray-900 py-3 font-medium text-white hover:bg-gray-700 disabled:opacity-50"
      >
        {guardando ? 'Guardando…' : 'Guardar ajustes'}
      </button>
    </div>
  );
}
