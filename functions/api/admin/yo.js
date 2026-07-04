// GET /api/admin/yo — ¿quién está conectado? (el middleware ya validó la sesión)
export async function onRequestGet({ data }) {
  return Response.json({ email: data.adminEmail });
}
