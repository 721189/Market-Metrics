/**
 * P0 Identity & SSE Ticket Suite
 * ---------------------------------------------------------------------------
 * Runtime guards for the P0 findings:
 *   - SSE uses short-lived single-use tickets bound to (user, job).
 *   - Production binds the shared Firestore ticket store, so a ticket minted by
 *     one replica is consumable exactly once by another.
 * Static source guards live in p0_identity_part2.ts.
 *
 * IMPORTANT: this file imports the fixture Check type from deploy_layer.test.ts
 * only for its type — the part-2 static guards share that contract.
 */

import {
  InMemoryStreamTicketStore,
  FirestoreStreamTicketStore,
  getStreamTicketStore,
  __setStreamTicketStoreForTests,
} from '../server/stream_tickets.js';
import type { Check } from './deploy_layer.test.js';

export const p0IdentityChecks: Check[] = [
  {
    name: 'stream ticket can be consumed exactly once',
    fn: async () => {
      const store = new InMemoryStreamTicketStore();
      const issued = await store.issue('job-1', 'usr-a', 60_000);
      const first = await store.consume(issued.ticket, 'job-1');
      const second = await store.consume(issued.ticket, 'job-1');
      return first?.userId === 'usr-a' && second === null;
    },
  },
  {
    name: 'stream ticket is bound to its job (cross-job replay rejected)',
    fn: async () => {
      const store = new InMemoryStreamTicketStore();
      const issued = await store.issue('job-1', 'usr-a', 60_000);
      const wrongJob = await store.consume(issued.ticket, 'job-2');
      const rightJob = await store.consume(issued.ticket, 'job-1');
      return wrongJob === null && rightJob?.userId === 'usr-a';
    },
  },
  {
    name: 'expired stream ticket is rejected',
    fn: async () => {
      const store = new InMemoryStreamTicketStore();
      const issued = await store.issue('job-x', 'usr-a', 1);
      await new Promise((r) => setTimeout(r, 8));
      return (await store.consume(issued.ticket, 'job-x')) === null;
    },
  },
  {
    name: 'forged or tampered ticket is rejected',
    fn: async () => {
      const store = new InMemoryStreamTicketStore();
      const issued = await store.issue('job-1', 'usr-a', 60_000);
      const tampered = issued.ticket.slice(0, -2) + 'ff';
      const unknown = await store.consume('deadbeef'.repeat(8), 'job-1');
      const bad = await store.consume(tampered, 'job-1');
      return unknown === null && bad === null;
    },
  },
  {
    name: 'production without an explicit store binds the shared Firestore ticket store',
    fn: async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevExplicit = process.env.STREAM_TICKET_STORE;
      try {
        __setStreamTicketStoreForTests(null);
        process.env.NODE_ENV = 'production';
        delete process.env.STREAM_TICKET_STORE;
        const store = getStreamTicketStore();
        return store.kind === 'firestore' && store instanceof FirestoreStreamTicketStore;
      } finally {
        if (prevEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevEnv;
        if (prevExplicit === undefined) delete process.env.STREAM_TICKET_STORE; else process.env.STREAM_TICKET_STORE = prevExplicit;
        __setStreamTicketStoreForTests(null);
      }
    },
  },
];
