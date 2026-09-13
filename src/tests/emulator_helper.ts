/**
 * Test Environment & Firestore Emulator Helper
 * Provides deterministic in-memory/emulator support for isolated testing
 */

export class MockFirestoreCollection {
  private docs: Map<string, any> = new Map();

  doc(id?: string) {
    const docId = id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      id: docId,
      set: async (data: any, opts?: any) => {
        if (opts?.merge && this.docs.has(docId)) {
          this.docs.set(docId, { ...this.docs.get(docId), ...data });
        } else {
          this.docs.set(docId, { ...data });
        }
      },
      get: async () => {
        const exists = this.docs.has(docId);
        return {
          exists,
          id: docId,
          data: () => (exists ? this.docs.get(docId) : undefined),
        };
      },
      update: async (data: any) => {
        if (!this.docs.has(docId)) throw new Error(`Document ${docId} not found`);
        this.docs.set(docId, { ...this.docs.get(docId), ...data });
      },
      delete: async () => {
        this.docs.delete(docId);
      },
    };
  }

  where(field: string, op: string, val: any) {
    return {
      where: (f2: string, op2: string, v2: any) => this.filterDocs([[field, op, val], [f2, op2, v2]]),
      orderBy: (_f: string, _dir?: string) => this.filterDocs([[field, op, val]]),
      limit: (n: number) => this.filterDocs([[field, op, val]], n),
      get: async () => this.filterDocs([[field, op, val]]).get(),
    };
  }

  limit(n: number) {
    return this.filterDocs([], n);
  }

  orderBy(_field: string, _dir?: string) {
    return {
      limit: (n: number) => this.filterDocs([], n),
      get: async () => this.filterDocs([]).get(),
    };
  }

  async get() {
    return this.filterDocs([]).get();
  }

  private filterDocs(conditions: [string, string, any][], limitCount?: number) {
    return {
      limit: (n: number) => this.filterDocs(conditions, n),
      get: async () => {
        let results: { id: string; ref: any; data: () => any }[] = [];
        for (const [id, data] of this.docs.entries()) {
          let match = true;
          for (const [field, op, val] of conditions) {
            if (op === '==' && data[field] !== val) match = false;
            if (op === '<' && !(data[field] < val)) match = false;
            if (op === '>' && !(data[field] > val)) match = false;
          }
          if (match) {
            results.push({
              id,
              ref: this.doc(id),
              data: () => data,
            });
          }
        }
        if (limitCount) {
          results = results.slice(0, limitCount);
        }
        return {
          empty: results.length === 0,
          size: results.length,
          docs: results,
          forEach: (fn: (d: any) => void) => results.forEach(fn),
        };
      },
    };
  }

  clear() {
    this.docs.clear();
  }
}

export class MockFirestoreDatabase {
  private collections: Map<string, MockFirestoreCollection> = new Map();

  collection(name: string) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockFirestoreCollection());
    }
    return this.collections.get(name)!;
  }

  async runTransaction<T>(updateFn: (transaction: any) => Promise<T>): Promise<T> {
    const tx = {
      get: async (docRef: any) => docRef.get(),
      set: async (docRef: any, data: any) => docRef.set(data),
      update: async (docRef: any, data: any) => docRef.update(data),
      delete: async (docRef: any) => docRef.delete(),
    };
    return await updateFn(tx);
  }

  batch() {
    const operations: (() => Promise<void>)[] = [];
    return {
      set: (docRef: any, data: any) => {
        operations.push(async () => docRef.set(data));
      },
      update: (docRef: any, data: any) => {
        operations.push(async () => docRef.update(data));
      },
      delete: (docRef: any) => {
        operations.push(async () => docRef.delete());
      },
      commit: async () => {
        for (const op of operations) {
          await op();
        }
      },
    };
  }

  clearAll() {
    this.collections.clear();
  }
}
