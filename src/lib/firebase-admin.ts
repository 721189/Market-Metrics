import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = !getApps().length 
  ? initializeApp({ projectId: firebaseConfig.projectId }) 
  : getApps()[0];

export const adminDb = getFirestore(app);
