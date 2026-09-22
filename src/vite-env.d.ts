/// <reference types="vite/client" />

/**
 * Build-time environment contract for the browser bundle.
 *
 * The values are injected by Vite at build time. Staging and production MUST
 * supply their own Firebase project through these variables — see
 * src/lib/firebase.ts, which refuses to boot a production bundle when any of
 * them is missing.
 */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  /** Absolute API origin when the backend runs on a different host (Railway). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
