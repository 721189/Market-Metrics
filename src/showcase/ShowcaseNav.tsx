import React from 'react';
import { motion } from 'motion/react';
import { Radar, Menu, X } from 'lucide-react';
import type { Page } from './router.js';

/**
 * Shared chrome for the public marketing pages. A lightweight nav + footer that
 * links the four public routes. Purely presentational — routing is handled by
 * the `useRouter` hook the pages receive.
 */
interface ShowcaseNavProps {
  page: Page;
  navigate: (page: Page) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

const NAV_LINKS: { page: Page; label: string }[] = [
  { page: 'home', label: 'Home' },
  { page: 'demo', label: 'Live Demo' },
  { page: 'pricing', label: 'Pricing' },
  { page: 'contact', label: 'Contact' },
];

export const ShowcaseNav: React.FC<ShowcaseNavProps> = ({
  page,
  navigate,
  menuOpen,
  setMenuOpen,
}) => {
  const go = (p: Page) => {
    navigate(p);
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <button
            onClick={() => go('home')}
            className="flex items-center gap-2.5 cursor-pointer"
            aria-label="Market-Metrics home"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10">
              <Radar className="h-5 w-5 text-cyan-400" />
            </span>
            <span className="text-lg font-bold tracking-tight text-white">
              Market<span className="text-cyan-400">Metrics</span>
            </span>
          </button>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 sm:flex">
            {NAV_LINKS.map((link) => (
              <button
                key={link.page}
                onClick={() => go(link.page)}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors cursor-pointer ${
                  page === link.page
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {link.label}
              </button>
            ))}
            <a
              href="/app"
              className="ml-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-sm font-bold text-slate-950 transition hover:brightness-110"
            >
              Launch App
            </a>
          </nav>

          {/* Mobile toggle */}
          <button
            className="sm:hidden rounded-lg border border-slate-800 p-2 text-slate-300"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <motion.nav
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            className="overflow-hidden border-t border-slate-800/60 bg-slate-950 sm:hidden"
          >
            <div className="flex flex-col gap-1 px-4 py-3">
              {NAV_LINKS.map((link) => (
                <button
                  key={link.page}
                  onClick={() => go(link.page)}
                  className={`rounded-lg px-3 py-2 text-left text-sm font-semibold ${
                    page === link.page ? 'bg-slate-800 text-white' : 'text-slate-300'
                  }`}
                >
                  {link.label}
                </button>
              ))}
              <a
                href="/app"
                className="mt-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 px-3 py-2 text-center text-sm font-bold text-slate-950"
              >
                Launch App
              </a>
            </div>
          </motion.nav>
        )}
      </header>
  );
};

/**
 * Shared marketing footer. Split from ShowcaseNav so the page shell can place
 * `<main>` content between the header and this footer.
 */
export const ShowcaseFooter: React.FC<{ navigate: (page: Page) => void }> = ({ navigate }) => {
  return (
    <footer className="border-t border-slate-800/60 bg-slate-950 py-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-500/30 bg-cyan-500/10">
                <Radar className="h-4 w-4 text-cyan-400" />
              </span>
              <span className="text-sm font-bold text-white">
                Market<span className="text-cyan-400">Metrics</span>
              </span>
            </div>
            <p className="max-w-md text-center text-xs leading-relaxed text-slate-500 sm:text-left">
              Evidence-first market intelligence. The model reasons over sourced
              evidence — it never becomes the evidence. Every claim carries a
              traceable citation.
            </p>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500 sm:justify-start">
            {NAV_LINKS.map((link) => (
              <button
                key={link.page}
                onClick={() => navigate(link.page)}
                className="hover:text-slate-300 cursor-pointer"
              >
                {link.label}
              </button>
            ))}
            <a href="/app" className="hover:text-slate-300">
              Launch App
            </a>
          </div>
          <p className="mt-6 text-[11px] text-slate-600">
            © 2026 Market-Metrics. Demo content is illustrative and not investment
            advice.
          </p>
        </div>
      </footer>
  );
};
