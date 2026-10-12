/**
 * Authenticated binary/JSON download helper.
 *
 * The research export routes (`/api/v1/research/:id/export/*`) sit behind
 * `authMiddleware`, which requires a Firebase ID token in an `Authorization`
 * header. A bare `<a href download>` cannot attach that header (and must never
 * carry the token in the URL), so downloads are performed with `fetch` and the
 * resulting blob is handed to a synthetic anchor click. This centralises that
 * logic so JSON and CSV exports behave identically.
 *
 * @returns `true` when a download was triggered, `false` on any failure
 *          (non-2xx response, network error, missing token). Errors are logged,
 *          never thrown — a failed export must not crash the caller.
 */
export async function authenticatedDownload(
  url: string,
  filename: string,
  getToken: () => Promise<string | undefined>
): Promise<boolean> {
  try {
    const token = await getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      console.error(`authenticatedDownload: request failed (HTTP ${res.status}) for ${url}`);
      return false;
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch (err) {
    console.error('authenticatedDownload: unexpected error', err);
    return false;
  }
}
