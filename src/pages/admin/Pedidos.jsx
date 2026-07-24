import { useEffect, useState } from 'react';
import { bs } from '../../lib/formato.js';

const FILTROS = [
  { id: '', t: 'Todos' },
  { id: 'comprobante_subido', t: 'Por verificar' },
  { id: 'pendiente_pago', t: 'Esperando pago' },
  { id: 'confirmado', t: 'Confirmados' },
  { id: 'entregado', t: 'Entregados' },
  { id: 'cancelado', t: 'Cancelados' },
];

const COLORES = {
  pendiente_pago: 'bg-amber-100 text-amber-800',
  comprobante_subido: 'bg-blue-100 text-blue-800',
  confirmado: 'bg-green-100 text-green-800',
  entregado: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-700',
};

const ENTREGAS = { local: 'Envío local', nacional: 'Envío nacional', recojo: 'Recojo en tienda' };

export default function AdminPedidos() {
  const [filtro, setFiltro] = useState('comprobante_subido');
  const [pedidos, setPedidos] = useState(null);
  const [abierto, setAbierto] = useState(null); // codigo del pedido expandido
  const [msj, setMsj] = useState('');

  function cargar() {
    setPedidos(null);
    fetch(`/api/admin/pedidos${filtro ? `?estado=${filtro}` : ''}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPedidos)
      .catch(() => setPedidos([]));
  }
  useEffect(cargar, [filtro]);

  async function cambiarEstado(codigo, estado) {
    setMsj('');
    const r = await fetch(`/api/admin/pedidos/${codigo}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado }),
    });
    const data = await r.json();
    if (!r.ok) {
      setMsj(data.error || 'No se pudo actualizar');
      return;
    }
    cargar();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-3 py-1.5 text-sm ${
              filtro === f.id ? 'bg-gray-900 text-white' : 'bg-white shadow hover:bg-gray-50'
            }`}
          >
            {f.t}
          </button>
        ))}
      </div>

      {msj && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{msj}</p>}

      {!pedidos ? (
        <p className="py-10 text-center text-gray-500">Cargando…</p>
      ) : pedidos.length === 0 ? (
        <p className="py-10 text-center text-gray-500">No hay pedidos en esta bandeja.</p>
      ) : (
        <ul className="space-y-3">
          {pedidos.map((p) => (
            <li key={p.codigo} className="rounded-xl bg-white p-4 shadow">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {p.cliente_nombre}{' '}
                    <span className="font-mono text-xs text-gray-400">
                      #{p.codigo.slice(0, 8).toUpperCase()}
                    </span>{' '}
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${COLORES[p.estado]}`}>
                      {p.estado.replaceAll('_', ' ')}
                    </span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(p.creado_en + 'Z').toLocaleString('es-BO')} · {ENTREGAS[p.tipo_entrega]}
                    {p.ciudad && ` · ${p.ciudad}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-bold">{bs(p.total)}</p>
                  <button
                    onClick={() => setAbierto(abierto === p.codigo ? null : p.codigo)}
                    className="text-sm text-gray-500 underline"
                  >
                    {abierto === p.codigo ? 'Cerrar' : 'Ver detalle'}
                  </button>
                </div>
              </div>

              {abierto === p.codigo && (
                <DetallePedido pedido={p} onCambiarEstado={cambiarEstado} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DetallePedido({ pedido, onCambiarEstado }) {
  const [detalle, setDetalle] = useState(null);

  useEffect(() => {
    fetch(`/api/admin/pedidos/${pedido.codigo}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setDetalle)
      .catch(() => {});
  }, [pedido.codigo]);

  if (!detalle) return <p className="mt-3 text-sm text-gray-400">Cargando detalle…</p>;

  const puedeConfirmar = ['pendiente_pago', 'comprobante_subido'].includes(detalle.estado);
  const puedeEntregar = detalle.estado === 'confirmado';
  const puedeCancelar = !['entregado', 'cancelado'].includes(detalle.estado);

  // Mensaje de WhatsApp prefijado según el estado, para avisar al cliente sin tipear.
  const ref = detalle.codigo.slice(0, 8).toUpperCase();
  const mensajeCliente = {
    pendiente_pago: `Hola, te escribimos de la tienda por tu pedido ${ref}: aún está pendiente de pago.`,
    comprobante_subido: `Hola, recibimos el comprobante de tu pedido ${ref} y estamos verificando tu pago.`,
    confirmado: `Hola, tu pago del pedido ${ref} fue confirmado ✓. ¡Coordinemos la entrega!`,
    entregado: `Hola, tu pedido ${ref} fue entregado. ¡Gracias por tu compra!`,
    cancelado: `Hola, te escribimos por tu pedido ${ref}, que fue cancelado.`,
  }[detalle.estado];

  return (
    <div className="mt-3 border-t pt-3 text-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p>
            <strong>WhatsApp:</strong>{' '}
            <a
              href={`https://wa.me/${detalle.cliente_whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(mensajeCliente)}`}
              target="_blank"
              rel="noreferrer"
              className="text-green-700 underline"
            >
              {detalle.cliente_whatsapp}
            </a>{' '}
            <span className="text-xs text-gray-400">(abre con mensaje listo para enviar)</span>
          </p>
          {detalle.direccion && (
            <p>
              <strong>Dirección:</strong> {detalle.direccion}
            </p>
          )}
          <ul className="mt-2 space-y-1">
            {detalle.items.map((i, idx) => (
              <li key={idx}>
                • {i.nombre} {[i.talla, i.color].filter(Boolean).join(' · ')} × {i.cantidad} —{' '}
                {bs(i.precio_unit * i.cantidad)}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="font-medium">Comprobante de pago</p>
          {detalle.comprobante_r2_key ? (
            <a
              href={`/api/admin/comprobante/${detalle.comprobante_r2_key}`}
              target="_blank"
              rel="noreferrer"
            >
              <img
                src={`/api/admin/comprobante/${detalle.comprobante_r2_key}`}
                alt="Comprobante"
                className="mt-1 max-h-56 rounded-lg border object-contain"
              />
            </a>
          ) : (
            <p className="text-gray-400">Aún no subió comprobante.</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {puedeConfirmar && (
          <button
            onClick={() => onCambiarEstado(detalle.codigo, 'confirmado')}
            className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700"
          >
            ✓ Confirmar pago (verificado en mi banco)
          </button>
        )}
        {puedeEntregar && (
          <button
            onClick={() => onCambiarEstado(detalle.codigo, 'entregado')}
            className="rounded-lg bg-gray-900 px-4 py-2 text-white hover:bg-gray-700"
          >
            📦 Marcar entregado
          </button>
        )}
        {puedeCancelar && (
          <button
            onClick={() =>
              confirm('¿Cancelar este pedido? El stock se repondrá.') &&
              onCambiarEstado(detalle.codigo, 'cancelado')
            }
            className="rounded-lg border border-red-300 px-4 py-2 text-red-700 hover:bg-red-50"
          >
            Cancelar pedido
          </button>
        )}
      </div>
    </div>
  );
}
