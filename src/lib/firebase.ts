import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// Build-time Firebase configuration. Production (and staging) builds MUST
// receive their project through VITE_FIREBASE_* variables; the build refuses
// to start otherwise. Dev/test fall back to the local applet project so a
// fresh checkout runs with zero Firebase setup.
function resolveFirebaseConfig() {
  if (import.meta.env.DEV) {
    return {
      apiKey: 'AIzaSyBf8gwNxlu7HT2iZrnvPIPL87aiiBdIL2s',
      authDomain: 'gen-lang-client-0526957989.firebaseapp.com',
      projectId: 'gen-lang-client-0526957989',
      storageBucket: 'gen-lang-client-0526957989.firebasestorage.app',
      messagingSenderId: '1054744311444',
      appId: '1:1054744311444:web:e97a25066c8c07a1ffe681',
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
