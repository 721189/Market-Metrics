import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Build-time Firebase configuration. Production (and staging) builds MUST
// receive their project through VITE_FIREBASE_* variables; the build refuses
// to start otherwise. Dev/test fall back to the local applet project so a
// fresh checkout runs with zero Firebase setup.
function resolveFirebaseConfig() {
  if (import.meta.env.DEV) {
    // Development: requires VITE_FIREBASE_* env vars (same as production).
    // A fresh checkout without Firebase setup must create a .env file with
    // VITE_FIREBASE_* values. This prevents the browser from ever being tied
    // to a hardcoded project.
    const required = [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_STORAGE_BUCKET',
      'VITE_FIREBASE_MESSAGING_SENDER_ID',
      'VITE_FIREBASE_APP_ID',
    ] as const;
    const missing = required.filter((k) => !import.meta.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `[firebase] dev build missing required env: ${missing.join(', ')}. ` +
          'Create a .env file with VITE_FIREBASE_* values for local development.',
      );
    }
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
      appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
    };
  }
  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID',
  ] as const;
  const missing = required.filter((k) => !import.meta.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[firebase] production build missing required env: ${missing.join(', ')}. ` +
        'Set the VITE_FIREBASE_* variables in your host build environment (see .env.production and render.yaml) and redeploy.'
    );
  }
  return {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  };
}

// Initialise Firebase WITHOUT ever throwing at module-evaluation time.
//
// A throw here is fatal for the SPA: this module is imported by main.tsx ->
// App.tsx, so an exception during evaluation aborts the whole bundle before
// React ever mounts. The visible result is an empty #root on the dark page
// background — a "black screen" with no diagnostic. That is exactly what a
// Render/Vercel deploy produced when the build-time VITE_FIREBASE_* variables
// were missing.
//
// Instead we capture the configuration error, expose it as
// `firebaseConfigError`, and let the UI render an explicit, actionable message.
// This still fails CLOSED: there is deliberately no silent fallback to the AI
// Studio applet project — a misconfigured deployment simply cannot authenticate
// until the operator supplies the variables. See render.yaml / .env.example.
let firebaseApp: FirebaseApp | null = null;
export const firebaseConfigError: string | null = (() => {
  try {
    const config = resolveFirebaseConfig();
    firebaseApp = initializeApp(config);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
})();

export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;
export const googleProvider = firebaseApp ? new GoogleAuthProvider() : null;

export interface GoogleSignInResult {
  ok: boolean;
  /** Firebase error code (e.g. 'auth/unauthorized-domain') when ok is false. */
  code?: string;
  /** Human-readable, actionable message when ok is false. */
  message?: string;
}

/**
 * Google sign-in via popup. Never throws — resolves with a structured result so
 * the UI can show WHY a sign-in failed. The single most common production
 * failure is `auth/unauthorized-domain`: the deployed origin (e.g.
 * https://<app>.onrender.com) is not in Firebase Console -> Authentication ->
 * Settings -> Authorized domains, so Firebase opens the popup and immediately
 * closes it. That is a Firebase Console setting, not a code bug.
 */
export const loginWithGoogle = async (): Promise<GoogleSignInResult> => {
  if (!auth || !googleProvider) {
    return {
      ok: false,
      code: 'auth/not-configured',
      message:
        firebaseConfigError ||
        'Firebase is not configured for this deployment. Set the VITE_FIREBASE_* build-time variables and redeploy.',
    };
  }
  try {
    await signInWithPopup(auth, googleProvider);
    return { ok: true };
  } catch (error: any) {
    // The user closed the popup themselves — not an error worth surfacing.
    if (error?.code === 'auth/popup-closed-by-user' || error?.code === 'auth/cancelled-popup-request') {
      return { ok: false, code: error.code };
    }
    const code: string = error?.code || 'auth/unknown';
    const host = typeof window !== 'undefined' ? window.location.host : '';
    let message = error?.message || 'Google sign-in failed. Please try again.';
    if (code === 'auth/unauthorized-domain') {
      message =
        `This domain (${host}) is not authorized for Google sign-in. ` +
        `In Firebase Console -> Authentication -> Settings -> Authorized domains, ` +
        `click "Add domain" and add: ${host || 'your onrender.com domain'}.`;
    } else if (code === 'auth/operation-not-allowed' || code === 'auth/operation-not-supported') {
      message =
        'Google sign-in is not enabled for this Firebase project. ' +
        'In Firebase Console -> Authentication -> Sign-in method, enable the "Google" provider.';
    } else if (code === 'auth/popup-blocked-by-browser') {
      message = 'Your browser blocked the sign-in popup. Allow popups for this site, then try again.';
    } else if (code === 'auth/network-request-failed') {
      message = 'A network error occurred while contacting Google/Firebase. Check your connection and try again.';
    }
    return { ok: false, code, message };
  }
};
export const logout = () => (auth ? signOut(auth) : Promise.resolve());
