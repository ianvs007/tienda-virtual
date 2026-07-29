// CORS para los endpoints machine-to-machine del POS (/api/sync y
// /api/sync/ventas). El POS es una app local (otro origen: localhost o la IP
// de la máquina), así que el navegador exige un preflight OPTIONS antes de un
// POST con header Authorization. Sin estos headers el fetch ni siquiera sale
// del POS y la sync muestra "Sin internet o la tienda está caída".
// El origen '*' es seguro acá: la autenticación es por Bearer token, no por
// cookies del navegador.
export const CORS_SYNC = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

export function preflightSync() {
  return new Response(null, { status: 204, headers: CORS_SYNC });
}

// Response.json con los headers CORS ya puestos.
export function jsonSync(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: { ...CORS_SYNC, ...(init.headers || {}) },
  });
}
