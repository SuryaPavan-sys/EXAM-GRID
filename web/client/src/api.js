const TOKEN_KEY = 'examgrid.token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
};

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
  return data;
}

/** Open an authenticated PDF in a new tab. */
export const pdfUrl = (path) => `/api${path}?token=${encodeURIComponent(getToken() || '')}`;

export const fmt = (n) => (n ?? 0).toLocaleString('en-IN');
export const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN',
  { weekday: 'short', day: 'numeric', month: 'short' }) : '-');
