import { initializeApp, getApps, App } from 'firebase-admin/app';
import { getFirestore, Firestore, CollectionReference, DocumentReference, Transaction, WriteBatch, FieldValue } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

// Lazy singleton: Firebase Admin app + Firestore instance, initialized on
// first actual use. Importing this module in test environments without Google
// credentials (or where the module is never used) is safe — no auth errors
// are triggered at import time.
let _app: App | null = null;
let _firestore: Firestore | null = null;

function getApp(): App {
  if (!_app) {
    _app = !getApps().length
      ? initializeApp({ projectId: firebaseConfig.projectId })
      : getApps()[0];
  }
  return _app;
}

function getFirestoreInstance(): Firestore {
  if (!_firestore) {
    const app = getApp();
    _firestore = firebaseConfig.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app);
  }
  return _firestore;
}

// Methods that require the real Firestore instance. Only when one of these
// is accessed do we trigger initialization. All other property accesses
// (e.g. typeof checks, unrelated property reads) are safe without init.
const METHODS_NEEDING_INSTANCE = new Set([
  'collection', 'doc', 'collectionGroup', 'runTransaction', 'batch',
  'getAll', 'set', 'update', 'delete', 'write',
  'FieldValue', 'InputData' as never,
]);

/**
 * Lazy proxy to the Firebase Admin Firestore instance. Only forwards method
 * calls that need the real Firestore (collection, doc, get, set, update,
 * delete, runTransaction, etc.) to the lazily-initialized instance. All other
 * property accesses are forwarded without triggering initialization.
 *
 * This preserves the full Firestore interface so that existing code
 * (db.ts, firestore_queue.ts) works without changes, while preventing the
 * "Could not load default credentials" error when this module is imported
 * but never used for actual Firestore operations (e.g. in tests that use
 * mock Firestore).
 */
export const adminDb: Firestore = new Proxy({} as Firestore, {
  get(_target, prop) {

    const key = String(prop);

    // If this is a method that needs the real instance, initialize now.
    if (METHODS_NEEDING_INSTANCE.has(key)) {
      const instance = getFirestoreInstance();
      const method = instance[key];
      if (typeof method === 'function') {
        return method.bind(instance);
      }
      // It's a property like FieldValue on the instance itself.
      return instance[key];
    }

    // For everything else, first check the real instance if it exists.
    // If the instance hasn't been created yet, just return undefined
    // (safe for typeof checks, property existence tests, etc.).
    if (_firestore) {
      return (_firestore as any)[key];
    }

    // Not yet initialized and not a method that needs init — return undefined
    // to avoid triggering auth. This is safe for typeof checks etc.
    return undefined;
  },
}) as Firestore;

export { getApp as getAdminApp };
