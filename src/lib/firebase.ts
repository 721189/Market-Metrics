import { initializeApp } from 'firebase/app';
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
        'Set VITE_FIREBASE_* in the Vercel project (staging and production values must differ).'
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

const firebaseConfig = resolveFirebaseConfig();

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export const loginWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch (error: any) {
    if (error.code === 'auth/popup-closed-by-user') {
      console.log('User closed the login popup.');
      return null;
    }
    throw error;
  }
};
export const logout = () => signOut(auth);
