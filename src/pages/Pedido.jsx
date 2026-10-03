import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { bs, urlImagen } from '../lib/formato.js';

const ESTADOS = {
  pendiente_pago: { texto: 'Esperando tu pago', color: 'bg-amber-100 text-amber-800' },
  comprobante_subido: { texto: 'Comprobante en verificación', color: 'bg-blue-100 text-blue-800' },
  confirmado: { texto: 'Pago confirmado ✓', color: 'bg-green-100 text-green-800' },
  entregado: { texto: 'Entregado ✓', color: 'bg-green-100 text-green-800' },
  cancelado: { texto: 'Cancelado', color: 'bg-red-100 text-red-700' },
};

const CLAVE_ULTIMO_PEDIDO = 'ultimo-pedido-codigo';

export default function Pedido() {
  const { codigo } = useParams();
  const [pedido, setPedido] = useState(null);
  const [error, setError] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [msjSubida, setMsjSubida] = useState('');
  const inputRef = useRef(null);
  const inputStickyRef = useRef(null);

  function cargar() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    fetch(`/api/pedidos/${codigo}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setError(false);
        setPedido(data);
      })
      .catch(() => {
        // Si ya había datos, no tapar la pantalla con error por un refresco fallido.
        setPedido((prev) => {
          if (!prev) queueMicrotask(() => setError(true));
          return prev;
        });
      })
      .finally(() => clearTimeout(t));
  }
  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_ULTIMO_PEDIDO, codigo);
    } catch {
      /* ignore */
    }
    cargar();
    // Refresca el estado solo: cuando el dueño confirma el pago,
    // el cliente lo ve sin tener que recargar la página.
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [codigo]);

  async function subirComprobante(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setSubiendo(true);
    setMsjSubida('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const r = await fetch(`/api/pedidos/${codigo}/comprobante`, { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo subir el comprobante');
      if (data.aviso) {
        setMsjSubida(data.aviso);
      } else {
        setMsjSubida(
          '✓ Comprobante recibido. Verificaremos tu pago y te contactaremos por WhatsApp.'
        );
      }
      cargar();
    } catch (err) {
      setMsjSubida(err.message);
    } finally {
      setSubiendo(false);
      if (inputRef.current) inputRef.current.value = '';
      if (inputStickyRef.current) inputStickyRef.current.value = '';
    }
  }

  if (error)
    return (
      <div className="py-10 text-center text-gray-500">
        Pedido no encontrado.{' '}
        <button type="button" onClick={cargar} className="underline">
          Reintentar
        </button>
        {' · '}
        <Link to="/" className="underline">
          Volver al catálogo
        </Link>
      </div>
    );
  if (!pedido) return <p className="py-10 text-center text-gray-500">Cargando pedido…</p>;

  const estado = ESTADOS[pedido.estado] || ESTADOS.pendiente_pago;
  const esperandoPago = pedido.estado === 'pendiente_pago';
  const enVerificacion = pedido.estado === 'comprobante_subido';
  const cancelado = pedido.estado === 'cancelado';
  // Tras cancelar por falta de foto, el cliente que sí pagó todavía puede subir el comprobante.
  const puedeSubir = esperandoPago || enVerificacion || cancelado;
  const referencia = codigo.slice(0, 8).toUpperCase();
  const etiquetaBoton = subiendo
    ? 'Subiendo…'
    : pedido.tiene_comprobante
      ? 'Subir de nuevo'
      : 'Subir comprobante';

  function BloqueSubida({ destacado = false }) {
    return (
      <div
        id="subir-comprobante"
        className={`rounded-xl p-4 text-center shadow ${
          destacado ? 'border-2 border-gray-900 bg-white' : 'bg-gray-100'
        }`}
      >
        <h2 className="font-bold">
          {cancelado
            ? '¿Ya pagaste? Sube tu comprobante'
            : pedido.tiene_comprobante
              ? '¿Necesitas corregir tu comprobante?'
              : 'Paso 2 · Ya pagaste: sube tu comprobante'}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {cancelado
            ? 'Si transferiste el dinero, sube la captura del pago para que podamos verificarlo (JPG o PNG, máx. 5 MB).'
            : 'Sube la captura o foto del comprobante de pago (JPG o PNG, máx. 5 MB). Sin esta foto el pedido no avanza.'}
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-xl bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-700">
          {etiquetaBoton}
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={subirComprobante}
            disabled={subiendo}
            className="hidden"
          />
        </label>
        {msjSubida && <p className="mt-2 text-sm text-gray-600">{msjSubida}</p>}
      </div>
    );
  }

  return (
    <div className={`mx-auto max-w-lg space-y-4 ${puedeSubir ? 'pb-24' : ''}`}>
      <div className="rounded-xl bg-gray-100 p-4 shadow">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Tu pedido</h1>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${estado.color}`}>
            {estado.texto}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Pedido <span className="font-mono font-medium">{referencia}</span> · Guarda este enlace
          para consultarlo cuando quieras.
        </p>

        <ul className="mt-3 divide-y text-sm">
          {(pedido.items || []).map((i, idx) => {
            const etiqueta = [i.talla, i.color].filter(Boolean).join(' · ');
            return (
              <li key={idx} className="flex items-center gap-3 py-2">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                  {i.imagen ? (
                    <img src={urlImagen(i.imagen)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xl text-gray-300">
                      👗
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-medium">{i.nombre}</p>
                  <p className="text-xs text-gray-500">
                    {etiqueta && `${etiqueta} · `}x{i.cantidad}
                  </p>
                </div>
                <span>{bs(i.precio_unit * i.cantidad)}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex justify-between border-t pt-2 font-bold">
          <span>Total</span>
          <span>{bs(pedido.total)}</span>
        </div>
      </div>

      {esperandoPago && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Completa estos 2 pasos para confirmar tu compra:</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li>Paga el monto exacto con el QR (escribe la referencia en la glosa).</li>
            <li>
              <a href="#subir-comprobante" className="font-bold underline">
                Sube la foto del comprobante
              </a>{' '}
              — sin esa foto no podemos verificar tu pago.
            </li>
          </ol>
        </div>
      )}

      {/* En móvil el QR es grande: el botón de subir va ANTES para no quedar oculto abajo. */}
      {puedeSubir && <BloqueSubida destacado />}

      {esperandoPago && (
        <div className="rounded-xl bg-gray-100 p-4 shadow text-center">
          <h2 className="font-bold">Paso 1 · Paga escaneando este QR</h2>
          <p className="mt-1 text-sm text-gray-500">
            Desde la app de tu banco o billetera móvil, por el monto exacto de{' '}
            <strong>{bs(pedido.total)}</strong>.
          </p>
          {pedido.qr ? (
            <img
              src={urlImagen(pedido.qr)}
              alt="QR de cobro"
              className="mx-auto mt-3 w-48 max-w-full rounded-lg border sm:w-56"
            />
          ) : (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              El QR de cobro aún no está configurado. Contáctanos por WhatsApp para completar tu
              pago.
            </p>
          )}
          <div className="mt-3 rounded-lg bg-white p-3 text-sm">
            <p className="text-gray-600">
              En la <strong>glosa o referencia</strong> de tu pago escribe:
            </p>
            <p className="mt-1 font-mono text-lg font-bold tracking-widest">{referencia}</p>
            <p className="mt-1 text-xs text-gray-500">
              Así identificamos tu pago más rápido en el banco.
            </p>
          </div>
        </div>
      )}

      {pedido.estado === 'confirmado' && (
        <div className="rounded-xl bg-green-50 p-4 text-center text-sm text-green-800">
          Tu pago fue verificado. Nos contactaremos por WhatsApp para coordinar la entrega.
        </div>
      )}

      {cancelado && (
        <div className="rounded-xl bg-red-50 p-4 text-center text-sm text-red-800">
          {pedido.tiene_comprobante ? (
            <>
              Este pedido estaba cancelado, pero recibimos tu comprobante. Te contactaremos por
              WhatsApp con la referencia{' '}
              <span className="font-mono font-bold">{referencia}</span>.
            </>
          ) : (
            <>
              Este pedido fue cancelado (sin comprobante en el plazo). Si ya pagaste, sube tu
              comprobante arriba o escríbenos por WhatsApp con la referencia{' '}
              <span className="font-mono font-bold">{referencia}</span>.
            </>
          )}
        </div>
      )}

      {pedido.whatsapp_tienda && (
        <a
          href={`https://wa.me/${pedido.whatsapp_tienda.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, consulto por mi pedido ${referencia}`)}`}
          target="_blank"
          rel="noreferrer"
          className="block rounded-xl bg-green-600 py-3 text-center font-medium text-white hover:bg-green-700"
        >
          💬 Escribir a la tienda por WhatsApp
        </a>
      )}

      {/* Barra fija en el celular: el botón siempre a la vista. */}
      {puedeSubir && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur sm:hidden">
          <label className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-gray-900 px-5 py-3 font-medium text-white">
            {etiquetaBoton}
            <input
              ref={inputStickyRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={subirComprobante}
              disabled={subiendo}
              className="hidden"
            />
          </label>
        </div>
      )}
    </div>
  );
}
