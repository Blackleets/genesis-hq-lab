// URL base del backend API.
// Dev: proxy Vite (/api → localhost:8787)
// Prod: VITE_API_BASE=https://tu-backend.onrender.com

export function getApiOrigin(): string {
  const env = import.meta.env.VITE_API_BASE?.trim();
  if (env) return env.replace(/\/$/, '');
  if (typeof window !== 'undefined') return '';
  return 'http://127.0.0.1:8787';
}

/** Path completo, ej. `/api/health` o `https://host/api/health` */
export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  const origin = getApiOrigin();
  return origin ? `${origin}${p}` : p;
}

function localApiUrl(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export async function fetchApi(
  path: string,
  init?: RequestInit,
  options?: { fallbackToLocal?: boolean },
): Promise<Response> {
  const primary = apiUrl(path);
  const fallbackToLocal = options?.fallbackToLocal !== false && typeof window !== 'undefined' && getApiOrigin() !== '';
  try {
    const res = await fetch(primary, init);
    if (res.ok || !fallbackToLocal) return res;
    if (res.status < 500) return res;
  } catch (error) {
    if (!fallbackToLocal) throw error;
  }
  return fetch(localApiUrl(path), init);
}
