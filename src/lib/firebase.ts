import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyBf8gwNxlu7HT2iZrnvPIPL87aiiBdIL2s",
  authDomain: "gen-lang-client-0526957989.firebaseapp.com",
  projectId: "gen-lang-client-0526957989",
  storageBucket: "gen-lang-client-0526957989.firebasestorage.app",
  messagingSenderId: "1054744311444",
  appId: "1:1054744311444:web:e97a25066c8c07a1ffe681"
};

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
