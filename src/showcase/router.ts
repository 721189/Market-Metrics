import { useEffect, useState } from 'react';

/**
 * Minimal, dependency-free path router for the public showcase.
 *
 * The project ships no router library, and the marketing pages are a small,
 * fixed set — so we map `window.location.pathname` to a page key and update
 * history via the History API. The existing authenticated app keeps its own
 * route at `/app`. No server changes are needed because the Express catch-all
 * already serves `index.html` for every path in production.
 */
export type Page = 'home' | 'demo' | 'pricing' | 'contact';

export const APP_PATH = '/app';

function pageFromPath(pathname: string): Page {
  const path = pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/demo':
      return 'demo';
    case '/pricing':
      return 'pricing';
    case '/contact':
      return 'contact';
    default:
      // `/`, `/app`, and unknown paths fall through to the landing page.
      return 'home';
  }
}

function pathFromPage(page: Page): string {
  switch (page) {
    case 'demo':
      return '/demo';
    case 'pricing':
      return '/pricing';
    case 'contact':
      return '/contact';
    default:
      return '/';
  }
}

/**
 * True when the current pathname is the authenticated app route (`/app`), in
 * which case the showcase should not render at all.
 */
export function isAppRoute(): boolean {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  return path === APP_PATH || path.startsWith(`${APP_PATH}/`);
}

export interface Router {
  page: Page;
  navigate: (page: Page) => void;
}

export function useRouter(): Router {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next: Page) => {
    setPage(next);
    const path = pathFromPage(next);
    if (path !== window.location.pathname) {
      window.history.pushState({}, '', path);
    }
  };

  return { page, navigate };
}
