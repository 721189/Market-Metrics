/**
 * Single API URL resolver. Render's full-stack deployment uses same-origin
 * requests; split frontend/backend deployments set VITE_API_URL at build time.
 */
const configuredApiBase = (import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith("/") ? path : "/" + path;
  return configuredApiBase ? configuredApiBase + normalizedPath : normalizedPath;
}
