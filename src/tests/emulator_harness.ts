/**
 * In-Memory Firestore Test Emulator Harness
 * Provides full transactional, batch, document, and collection mocking
 * conforming strictly to the Firebase Admin Firestore SDK interface.
 */

export class MockDocumentSnapshot {
  constructor(
    public id: string,
    private _data: any,
    public exists: boolean = true
  ) {}

  data() {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }
}

export class MockQuerySnapshot {
  constructor(public docs: MockDocumentSnapshot[]) {}
  get empty() {
    return this.docs.length === 0;
  }
  get size() {
    return this.docs.length;
  }
  forEach(callback: (doc: MockDocumentSnapshot) => void) {
    this.docs.forEach(callback);
  }
}

export class MockDocRef {
  constructor(
    public id: string,
    private collectionRef: MockCollectionRef,
    public store: Map<string, any>
  ) {}

  get path() {
    return `${this.collectionRef.path}/${this.id}`;
  }

  async get(): Promise<MockDocumentSnapshot> {
    const data = this.store.get(this.path);
    return new MockDocumentSnapshot(this.id, data, !!data);
  }

  async set(data: any, options: { merge?: boolean } = {}): Promise<void> {
    if (options.merge && this.store.has(this.path)) {
      const existing = this.store.get(this.path);
      this.store.set(this.path, { ...existing, ...data });
    } else {
      this.store.set(this.path, { ...data });
    }
  }

  async update(data: any): Promise<void> {
    const existing = this.store.get(this.path);
    if (!existing) throw new Error(`Document ${this.path} not found for update`);
    this.store.set(this.path, { ...existing, ...data });
  }

  async delete(): Promise<void> {
    this.store.delete(this.path);
  }
}

export class MockQuery {
  constructor(
    protected collectionRef: MockCollectionRef,
    protected store: Map<string, any>,
    protected filters: Array<{ field: string; op: string; val: any }> = [],
    protected orderField: string | null = null,
    protected orderDirection: 'asc' | 'desc' = 'asc',
    protected limitCount: number | null = null
  ) {}

  where(field: string, op: string, val: any): MockQuery {
    return new MockQuery(
      this.collectionRef,
      this.store,
      [...this.filters, { field, op, val }],
      this.orderField,
      this.orderDirection,
      this.limitCount
    );
  }

  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): MockQuery {
    return new MockQuery(
      this.collectionRef,
      this.store,
      this.filters,
      field,
      direction,
      this.limitCount
    );
  }

  limit(count: number): MockQuery {
    return new MockQuery(
      this.collectionRef,
      this.store,
      this.filters,
      this.orderField,
      this.orderDirection,
      count
    );
  }

  async get(): Promise<MockQuerySnapshot> {
    const prefix = `${this.collectionRef.path}/`;
    const matchingDocs: MockDocumentSnapshot[] = [];

    for (const [path, val] of this.store.entries()) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
        const docId = path.slice(prefix.length);
        let matches = true;

        for (const f of this.filters) {
          const docVal = val[f.field];
          if (f.op === '==' && docVal !== f.val) matches = false;
          if (f.op === '<' && !(docVal < f.val)) matches = false;
          if (f.op === '<=' && !(docVal <= f.val)) matches = false;
          if (f.op === '>' && !(docVal > f.val)) matches = false;
          if (f.op === '>=' && !(docVal >= f.val)) matches = false;
        }

        if (matches) {
          matchingDocs.push(new MockDocumentSnapshot(docId, val, true));
        }
      }
    }

    if (this.orderField) {
      const of = this.orderField;
      const dir = this.orderDirection === 'asc' ? 1 : -1;
      matchingDocs.sort((a, b) => {
        const va = a.data()[of] ?? 0;
        const vb = b.data()[of] ?? 0;
        return va > vb ? dir : va < vb ? -dir : 0;
      });
    }

    const finalDocs = this.limitCount ? matchingDocs.slice(0, this.limitCount) : matchingDocs;
    return new MockQuerySnapshot(finalDocs);
  }
}

export class MockCollectionRef extends MockQuery {
  private idCounter = 1;

  constructor(public path: string, store: Map<string, any>) {
    super({} as any, store);
    this.collectionRef = this;
  }

  doc(id?: string): MockDocRef {
    const docId = id || `auto-${this.idCounter++}`;
    return new MockDocRef(docId, this, this.store);
  }
}

export class MockFirestore {
  public store = new Map<string, any>();
  private activeTransaction = false;

  collection(path: string): MockCollectionRef {
    return new MockCollectionRef(path, this.store);
  }

  batch() {
    const ops: Array<() => void> = [];
    const store = this.store;
    return {
      update(docRef: { path?: string; ref?: { path: string } }, data: any) {
        const p = (docRef as any).path || (docRef as any).ref?.path;
        ops.push(() => {
          const existing = store.get(p);
          if (existing) store.set(p, { ...existing, ...data });
        });
      },
      set(docRef: { path: string }, data: any) {
        ops.push(() => store.set(docRef.path, data));
      },
      async commit() {
        for (const op of ops) op();
      }
    };
  }

  async runTransaction<T>(updateFunction: (transaction: any) => Promise<T>): Promise<T> {
    // Transaction isolation: acquire simulated atomic lock
    while (this.activeTransaction) {
      await new Promise(r => setTimeout(r, 5));
    }
    this.activeTransaction = true;

    try {
      const transactionOps: Array<() => void> = [];
      const store = this.store;

      const tx = {
        async get(docRef: MockDocRef) {
          return await docRef.get();
        },
        update(docRef: MockDocRef, data: any) {
          transactionOps.push(() => {
            const existing = store.get(docRef.path);
            store.set(docRef.path, { ...existing, ...data });
          });
        },
        set(docRef: MockDocRef, data: any) {
          transactionOps.push(() => {
            store.set(docRef.path, data);
          });
        },
      };

      const result = await updateFunction(tx);
      // Atomic commit
      for (const op of transactionOps) op();
      return result;
    } finally {
      this.activeTransaction = false;
    }
  }

  clear() {
    this.store.clear();
  }
}

export class TestableFirestoreQueue {
  private collectionName = 'job_queue';

  constructor(private db: MockFirestore) {}

  async add(name: string, data: any, createdAtMillis?: number) {
    const docRef = this.db.collection(this.collectionName).doc();
    const ts = createdAtMillis || Date.now();
    await docRef.set({
      name,
      data,
      status: 'QUEUED',
      created_at: { toMillis: () => ts, millis: ts },
      updated_at: { toMillis: () => ts, millis: ts },
    });
    return docRef;
  }

  async claimNextJob(workerId: string = 'worker-1') {
    return await this.db.runTransaction(async (transaction: any) => {
      const snap = await this.db.collection(this.collectionName)
        .where('status', '==', 'QUEUED')
        .get();

      if (snap.empty) return null;

      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      docs.sort((a: any, b: any) => {
        const ta = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
        const tb = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
        return ta - tb;
      });

      const target = docs[0];
      const jobRef = this.db.collection(this.collectionName).doc(target.id);
      const freshDoc = await transaction.get(jobRef);

      if (!freshDoc.exists || freshDoc.data()?.status !== 'QUEUED') {
        return null;
      }

      const leasedUntil = { toMillis: () => Date.now() + 180000, millis: Date.now() + 180000 };
      transaction.update(jobRef, {
        status: 'RUNNING',
        worker_id: workerId,
        leased_until: leasedUntil,
        updated_at: { toMillis: () => Date.now(), millis: Date.now() },
      });

      return {
        ...freshDoc.data(),
        id: target.id,
        status: 'RUNNING',
        worker_id: workerId,
        leased_until: leasedUntil,
      };
    });
  }
}

export class TestableDatabaseRepository {
  constructor(private db: MockFirestore) {}

  async saveJob(job: any, userId: string): Promise<void> {
    if (!userId) throw new Error('[DB] userId is required for saveJob');
    const jobRef = this.db.collection('jobs').doc(job.id);
    await jobRef.set({
      ...job,
      user_id: userId,
      updated_at: Date.now(),
    }, { merge: true });
  }

  async getJob(jobId: string, userId: string): Promise<any | null> {
    if (!userId) throw new Error('[DB] userId is required for getJob');
    const docSnap = await this.db.collection('jobs').doc(jobId).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (data.user_id && data.user_id !== userId) {
      return null;
    }
    return data;
  }

  async listJobs(maxLimit: number = 50, userId: string): Promise<any[]> {
    if (!userId) throw new Error('[DB] userId is required for listJobs');
    const snap = await this.db.collection('jobs')
      .where('user_id', '==', userId)
      .limit(maxLimit)
      .get();
    
    const jobs: any[] = [];
    snap.forEach(doc => {
      jobs.push(doc.data());
    });
    return jobs;
  }

  async saveReport(report: any, userId: string): Promise<void> {
    if (!userId) throw new Error('[DB] userId is required for saveReport');
    const reportRef = this.db.collection('reports').doc(report.job_id);
    await reportRef.set({
      ...report,
      user_id: userId,
      saved_at: Date.now(),
    });
  }

  async getReport(jobId: string, userId: string): Promise<any | null> {
    if (!userId) throw new Error('[DB] userId is required for getReport');
    const docSnap = await this.db.collection('reports').doc(jobId).get();
    if (!docSnap.exists) return null;
    const data = docSnap.data();
    if (data.user_id && data.user_id !== userId) {
      return null;
    }
    return data;
  }
}

