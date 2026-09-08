import { useEffect, useRef, useState } from 'react';

// Sincronización de stock con el sistema local (offline), al cierre de caja.
// 1) Se sube el Excel de stock del sistema local → vista previa del resultado.
// 2) Al confirmar, el servidor RECALCULA y aplica: stock nuevo = stock Excel
//    − ventas en línea desde la última sincronización.
// 3) Se descarga el Excel de ventas en línea para registrarlo en el sistema local.
// Nota: 'xlsx' se importa dinámicamente para no inflar el bundle de la tienda pública.

// Acepta encabezados flexibles (codigo/código, stock/cantidad/existencias…).
// Los alias van ya normalizados (norm quita tildes y todo lo que no sea a-z).
const COLUMNAS = {
  codigo: ['codigo', 'code', 'cod'],
  nombre: ['nombre', 'producto'],
  talla: ['talla', 'size'],
  color: ['color'],
  stock: ['stock', 'cantidad', 'existencias', 'existencia'],
  precio: ['precio', 'preciounit', 'preciounitario', 'price'],
};

function norm(clave) {
  return String(clave || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

function mapearFilas(json) {
  return json.map((fila) => {
    const porClave = {};
    for (const [k, v] of Object.entries(fila)) porClave[norm(k)] = v;
    const buscar = (alias) => {
      for (const a of alias) if (porClave[a] !== undefined) return porClave[a];
      return '';
    };
    return {
      codigo: String(buscar(COLUMNAS.codigo) ?? '').trim(),
      nombre: String(buscar(COLUMNAS.nombre) ?? '').trim(),
      talla: String(buscar(COLUMNAS.talla) ?? '').trim(),
      color: String(buscar(COLUMNAS.color) ?? '').trim(),
      stock: buscar(COLUMNAS.stock),
      precio: buscar(COLUMNAS.precio),
    };
  });
}

function fechaBonita(valor) {
  if (!valor || valor.startsWith('1970')) return 'nunca';
  return new Date(valor.replace(' ', 'T') + 'Z').toLocaleString('es-BO');
}

export default function AdminSincronizar() {
  const [info, setInfo] = useState(null); // { ultima_sincronizacion, ventas }
  const [filas, setFilas] = useState(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [previa, setPrevia] = useState(null);
  const [reporte, setReporte] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const inputRef = useRef(null);

  // ── Estado propio de la tarjeta ④ (importación de catálogo, una sola vez) ──
  const [filasCatalogo, setFilasCatalogo] = useState(null);
  const [nombreArchivoCatalogo, setNombreArchivoCatalogo] = useState('');
  const [previaCatalogo, setPreviaCatalogo] = useState(null);
  const [reporteCatalogo, setReporteCatalogo] = useState(null);
  const [errorCatalogo, setErrorCatalogo] = useState('');
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false);
  const [progresoCatalogo, setProgresoCatalogo] = useState(null); // { hechas, total }
  const inputCatalogoRef = useRef(null);

  function cargarInfo() {
    fetch('/api/admin/sincronizar/ventas')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setInfo({ ultima_sincronizacion: null, ventas: [] }));
  }
  useEffect(cargarInfo, []);

  async function leerExcel(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setError('');
    setPrevia(null);
    setReporte(null);
    setFilas(null);
    setCargando(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await archivo.arrayBuffer());
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const mapeadas = mapearFilas(json).filter(
        (f) => f.codigo || f.nombre || f.talla || f.color || f.stock !== ''
      );
      if (!mapeadas.length)
        throw new Error(
          'No se encontraron filas con datos. El Excel debe tener encabezados: codigo, talla, color, stock.'
        );
      setFilas(mapeadas);
      setNombreArchivo(archivo.name);

      const r = await fetch('/api/admin/sincronizar/previsualizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas: mapeadas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo previsualizar');
      setPrevia(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function aplicar() {
    setCargando(true);
    setError('');
    try {
      const r = await fetch('/api/admin/sincronizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo aplicar la sincronización');
      setReporte(data);
      setPrevia(null);
      setFilas(null);
      cargarInfo();
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function descargarVentas() {
    if (!info?.ventas?.length) return;
    const XLSX = await import('xlsx');
    const filasXlsx = info.ventas.map((v) => ({
      globalId: v.globalId || '',
      codigo: v.codigo || '',
      nombre: v.nombre,
      talla: v.talla || '',
      color: v.color || '',
      cantidad: v.cantidad,
      precio_unit: v.precio_unit,
      estado: v.estado,
      pedido: (v.pedido_ref || '').toUpperCase(),
      fecha: v.creado_en,
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(filasXlsx), 'ventas_en_linea');
    XLSX.writeFile(wb, `ventas-en-linea-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ── Tarjeta ④: importación de catálogo inicial (una sola vez) ──
  async function leerExcelCatalogo(e) {
    const archivo = e.target.files?.[0];
    if (!archivo) return;
    setErrorCatalogo('');
    setPreviaCatalogo(null);
    setReporteCatalogo(null);
    setFilasCatalogo(null);
    setCargandoCatalogo(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await archivo.arrayBuffer());
      const json = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const mapeadas = mapearFilas(json).filter(
        (f) => f.codigo || f.nombre || f.talla || f.color || f.stock !== ''
      );
      if (!mapeadas.length)
        throw new Error(
          'No se encontraron filas con datos. El Excel debe tener encabezados: codigo, nombre, talla, color, stock, precio.'
        );
      setFilasCatalogo(mapeadas);
      setNombreArchivoCatalogo(archivo.name);

      const r = await fetch('/api/admin/catalogo/previsualizar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filas: mapeadas }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo previsualizar');
      setPreviaCatalogo(data);
    } catch (err) {
      setErrorCatalogo(err.message);
    } finally {
      setCargandoCatalogo(false);
      if (inputCatalogoRef.current) inputCatalogoRef.current.value = '';
    }
  }

  async function aplicarCatalogo() {
    setCargandoCatalogo(true);
    setErrorCatalogo('');
    setProgresoCatalogo({ hechas: 0, total: filasCatalogo.length });
    try {
      // Se importa en lotes de 250: el servidor omite lo ya existente, así que
      // los lotes son independientes, y entre lote y lote se actualiza la
      // barra de avance (con miles de prendas, una sola llamada dejaría la
      // pantalla minutos sin señal de vida).
      const TAM_LOTE = 250;
      let creadas = 0;
      let omitidas = 0;
      const detalle = [];
      for (let i = 0; i < filasCatalogo.length; i += TAM_LOTE) {
        const r = await fetch('/api/admin/catalogo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filas: filasCatalogo.slice(i, i + TAM_LOTE) }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'No se pudo aplicar la importación');
        creadas += data.creadas;
        omitidas += data.omitidas;
        detalle.push(...data.detalle);
        setProgresoCatalogo({
          hechas: Math.min(i + TAM_LOTE, filasCatalogo.length),
          total: filasCatalogo.length,
        });
      }
      setReporteCatalogo({ filas: filasCatalogo.length, creadas, omitidas, detalle });
      setPreviaCatalogo(null);
      setFilasCatalogo(null);
    } catch (err) {
      setErrorCatalogo(
        `${err.message} (si el avance se detuvo a la mitad, vuelve a subir el mismo Excel: lo ya importado se omite y no se duplica)`
      );
    } finally {
      setCargandoCatalogo(false);
      setProgresoCatalogo(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gray-100 p-4 shadow">
        <h1 className="text-lg font-bold">Sincronizar stock con la tienda física</h1>
        <p className="mt-1 text-sm text-gray-500">
          Última sincronización:{' '}
          <strong>{info ? fechaBonita(info.ultima_sincronizacion) : '…'}</strong>
          {info?.ventas?.length > 0 && (
            <>
              {' '}· <strong>{info.ventas.length}</strong> ítems vendidos en línea desde entonces
            </>
          )}
        </p>
        <p className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
          Ritual de cierre de caja: ① exporta el Excel de stock en el sistema local (recién
          exportado, no uno viejo) → ② súbelo aquí y confirma → ③ descarga el Excel de ventas en
          línea y regístralo en el sistema local.
        </p>
      </div>

      <div className="rounded-xl bg-gray-100 p-4 shadow">
        <p className="text-sm font-medium">① Subir Excel de cierre de caja</p>
        <p className="mt-1 text-xs text-gray-500">
          Columnas esperadas: <code>codigo</code>, <code>talla</code>, <code>color</code>,{' '}
          <code>stock</code> (una fila por variante; talla/color opcionales si la prenda no tiene).
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700">
          {cargando && !previa ? 'Procesando…' : 'Elegir archivo .xlsx'}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={leerExcel}
            disabled={cargando}
            className="hidden"
          />
        </label>
        {nombreArchivo && !reporte && (
          <span className="ml-3 text-sm text-gray-500">{nombreArchivo}</span>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {previa && (
        <div className="rounded-xl bg-gray-100 p-4 shadow">
          <p className="text-sm font-medium">
            ② Vista previa: {previa.filas} filas · {previa.cambios} con cambios ·{' '}
            <span className={previa.advertencias ? 'font-bold text-amber-700' : ''}>
              {previa.advertencias} advertencias
            </span>
          </p>
          <TablaDetalle detalle={previa.detalle} />
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={aplicar}
              disabled={cargando}
              className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {cargando ? 'Aplicando…' : '✓ Confirmar y aplicar'}
            </button>
            <button
              onClick={() => {
                setPrevia(null);
                setFilas(null);
                setNombreArchivo('');
              }}
              className="rounded-lg border px-4 py-2 text-gray-600 hover:bg-gray-50"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {reporte && (
        <div className="rounded-xl bg-green-50 p-4 shadow">
          <p className="text-sm font-medium text-green-800">
            ✓ Sincronización aplicada: {reporte.actualizadas} variantes actualizadas de{' '}
            {reporte.filas} filas
            {reporte.advertencias > 0 && ` · ${reporte.advertencias} advertencias (revisar abajo)`}
          </p>
          {reporte.advertencias > 0 && <TablaDetalle detalle={reporte.detalle.filter((r) => r.aviso)} />}
        </div>
      )}

      <div className="rounded-xl bg-gray-100 p-4 shadow">
        <p className="text-sm font-medium">③ Ventas en línea para el sistema local</p>
        <p className="mt-1 text-xs text-gray-500">
          Excel con lo vendido en la web desde la última sincronización, para que el stock del
          sistema local también baje.
        </p>
        <button
          onClick={descargarVentas}
          disabled={!info?.ventas?.length}
          className="mt-3 rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          Descargar Excel de ventas en línea ({info?.ventas?.length ?? 0})
        </button>
      </div>

      <div className="rounded-xl bg-gray-100 p-4 shadow">
        <p className="text-sm font-medium">④ Importar catálogo inicial (una sola vez)</p>
        <p className="mt-1 text-xs text-gray-500">
          Sube el mismo Excel que exporta el sistema local: crea una prenda por fila con su
          talla/color. Crea las prendas sin foto ni categoría; después edítalas en Prendas para
          subir la foto y ajustar el stock. Las prendas cuyo código ya existe no se tocan.
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-xl bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-700">
          {cargandoCatalogo && !previaCatalogo ? 'Procesando…' : 'Elegir archivo .xlsx'}
          <input
            ref={inputCatalogoRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={leerExcelCatalogo}
            disabled={cargandoCatalogo}
            className="hidden"
          />
        </label>
        {nombreArchivoCatalogo && !reporteCatalogo && (
          <span className="ml-3 text-sm text-gray-500">{nombreArchivoCatalogo}</span>
        )}
      </div>

      {errorCatalogo && (
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errorCatalogo}</p>
      )}

      {previaCatalogo && (
        <div className="rounded-xl bg-gray-100 p-4 shadow">
          <p className="text-sm font-medium">
            Vista previa del catálogo: {previaCatalogo.filas} filas ·{' '}
            <span className="text-green-700">{previaCatalogo.creadas} por crear</span> ·{' '}
            <span className={previaCatalogo.omitidas ? 'font-bold text-amber-700' : ''}>
              {previaCatalogo.omitidas} omitidas
            </span>
          </p>
          <TablaCatalogo detalle={previaCatalogo.detalle} />
          {progresoCatalogo && (
            <div className="mt-4">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-200">
                <div
                  className="h-full rounded-full bg-green-600 transition-all"
                  style={{
                    width: `${Math.round((progresoCatalogo.hechas / progresoCatalogo.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-gray-600">
                Importando {progresoCatalogo.hechas} de {progresoCatalogo.total} (
                {Math.round((progresoCatalogo.hechas / progresoCatalogo.total) * 100)}%) — no
                cierres esta página
              </p>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              onClick={aplicarCatalogo}
              disabled={cargandoCatalogo || previaCatalogo.creadas === 0}
              className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {cargandoCatalogo ? 'Importando…' : '✓ Confirmar e importar'}
            </button>
            <button
              onClick={() => {
                setPreviaCatalogo(null);
                setFilasCatalogo(null);
                setNombreArchivoCatalogo('');
              }}
              disabled={cargandoCatalogo}
              className="rounded-lg border px-4 py-2 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {reporteCatalogo && (
        <div className="rounded-xl bg-green-50 p-4 shadow">
          <p className="text-sm font-medium text-green-800">
            ✓ Catálogo importado: {reporteCatalogo.creadas} prendas creadas de{' '}
            {reporteCatalogo.filas} filas
            {reporteCatalogo.omitidas > 0 && ` · ${reporteCatalogo.omitidas} omitidas (revisar abajo)`}
          </p>
          {reporteCatalogo.omitidas > 0 && (
            <TablaCatalogo detalle={reporteCatalogo.detalle.filter((r) => r.aviso)} />
          )}
        </div>
      )}
    </div>
  );
}

function TablaCatalogo({ detalle }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="py-1 pr-2">Código</th>
            <th className="py-1 pr-2">Nombre</th>
            <th className="py-1 pr-2">Variante</th>
            <th className="py-1 pr-2 text-right">Stock</th>
            <th className="py-1 pr-2 text-right">Precio</th>
            <th className="py-1">Acción</th>
          </tr>
        </thead>
        <tbody>
          {detalle.map((r, i) => (
            <tr key={i} className={`border-b last:border-0 ${r.aviso ? 'bg-amber-50' : ''}`}>
              <td className="py-1 pr-2 font-mono text-xs">{r.codigo || '—'}</td>
              <td className="py-1 pr-2">{r.nombre || '—'}</td>
              <td className="py-1 pr-2">{[r.talla, r.color].filter(Boolean).join(' · ') || '—'}</td>
              <td className="py-1 pr-2 text-right">{r.stock ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{r.precio ?? '—'}</td>
              <td className="py-1">
                {r.accion === 'crear' ? (
                  <span className="text-xs font-medium text-green-700">Crear</span>
                ) : (
                  <span className="text-xs text-amber-700">{r.aviso}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaDetalle({ detalle }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-gray-500">
            <th className="py-1 pr-2">Código</th>
            <th className="py-1 pr-2">Prenda</th>
            <th className="py-1 pr-2">Variante</th>
            <th className="py-1 pr-2 text-right">Stock nube</th>
            <th className="py-1 pr-2 text-right">Stock Excel</th>
            <th className="py-1 pr-2 text-right">Vendidas web</th>
            <th className="py-1 text-right">Stock nuevo</th>
          </tr>
        </thead>
        <tbody>
          {detalle.map((r, i) => (
            <tr key={i} className={`border-b last:border-0 ${r.aviso ? 'bg-amber-50' : ''}`}>
              <td className="py-1 pr-2 font-mono text-xs">{r.codigo || '—'}</td>
              <td className="py-1 pr-2">
                {r.nombre || ''}
                {r.aviso && <p className="text-xs text-amber-700">{r.aviso}</p>}
              </td>
              <td className="py-1 pr-2">{[r.talla, r.color].filter(Boolean).join(' · ') || '—'}</td>
              <td className="py-1 pr-2 text-right">{r.stockActual ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{r.stockExcel ?? '—'}</td>
              <td className="py-1 pr-2 text-right">{r.vendidas ?? '—'}</td>
              <td className="py-1 text-right font-medium">{r.stockNuevo ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
