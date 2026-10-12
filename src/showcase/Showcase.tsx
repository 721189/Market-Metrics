import React, { useState } from 'react';
import { ShowcaseNav, ShowcaseFooter } from './ShowcaseNav.js';
import { Landing } from './Landing.js';
import { Demo } from './Demo.js';
import { Pricing } from './Pricing.js';
import { Contact } from './Contact.js';
import { useRouter } from './router.js';

/**
 * Public marketing shell. Owns the shared nav/menu state and swaps the four
 * public pages based on the lightweight `useRouter` hook. `main.tsx` renders
 * this for every route except `/app`, which loads the authenticated product.
 */
export const Showcase: React.FC = () => {
  const { page, navigate } = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col">
      <ShowcaseNav page={page} navigate={navigate} menuOpen={menuOpen} setMenuOpen={setMenuOpen} />

      <main className="flex-1">
        {page === 'home' && <Landing navigate={navigate} />}
        {page === 'demo' && <Demo navigate={navigate} />}
        {page === 'pricing' && <Pricing navigate={navigate} />}
        {page === 'contact' && <Contact navigate={navigate} />}
      </main>

      <ShowcaseFooter navigate={navigate} />
    </div>
  );
};
