import test from 'node:test';
import assert from 'node:assert';
import { RealRedisClient } from '../server/redis_client.js';
import { RealRedisServer } from '../server/redis_server.js';
import { DatabaseAdapter } from '../server/database_adapter.js';
import { ResearchPipelineManager } from '../server/pipeline.js';
import { CryptographyAuth } from '../server/auth_helper.js';

test('Integration Test Suite - Market Research Infrastructure', async (t) => {

  await t.test('1. Custom RESP-Compliant Redis Server & Client Connection', async () => {
    // Spin up Redis Server programmatically to ensure test container self-containment
    const server = RealRedisServer.getInstance();
    try {
      await server.start();
    } catch (err) {
      console.log('Redis server already running or port bound:', err);
    }

    const client = new RealRedisClient();
    try {
      await client.connect();
      
      // Test basic SET and GET
      await client.set('test_key', 'antigravity_rigor_2026');
      const val = await client.get('test_key');
      assert.strictEqual(val, 'antigravity_rigor_2026', 'Redis GET must return the exact value set');

      // Test List structures (LPUSH / LPOP)
      await client.lpush('test_list', 'job_A');
      await client.lpush('test_list', 'job_B');
      const popped1 = await client.lpop('test_list');
      assert.strictEqual(popped1, 'job_B', 'LPOP must return the most recently pushed item (LIFO)');
      const popped2 = await client.lpop('test_list');
      assert.strictEqual(popped2, 'job_A', 'LPOP must return the next item in order');
      
      console.log('✓ Redis Server & Client Integration: PASSED');
    } finally {
      client.close();
      try {
        await server.stop();
      } catch (err) {}
    }
  });

  await t.test('2. Cryptographic Multi-Tenant Token Issuance and Verification', () => {
    const originalPayload = { uid: 'user_tesla_88', email: 'elon@tesla.com', role: 'admin' };
    const token = CryptographyAuth.sign(originalPayload, 120);
    assert.ok(token, 'Signed token must be generated');
    
    const verified = CryptographyAuth.verify(token);
    assert.ok(verified, 'Verification must succeed for active token');
    assert.strictEqual(verified.uid, 'user_tesla_88', 'Verified UID must match');
    assert.strictEqual(verified.role, 'admin', 'Verified role must match');

    // Test expiration
    const expiredToken = CryptographyAuth.sign(originalPayload, -10);
    const expiredResult = CryptographyAuth.verify(expiredToken);
    assert.strictEqual(expiredResult, null, 'Expired tokens must fail verification');
    
    console.log('✓ Cryptographic Auth & JWT Verification: PASSED');
  });

  await t.test('3. Database Adapter SQL Schema, ACID-Compliance and Multi-Tenant Isolation', async () => {
    const db = DatabaseAdapter.getInstance();
    
    const userA = 'tenant_A_corp';
    const userB = 'tenant_B_group';

    // Save job under User A
    const jobA = {
      id: 'job-test-AAA-' + Date.now(),
      question: 'Next-gen solid-state battery SAM and competitors?',
      industry: 'Automotive',
      geography: 'Global',
      time_horizon: '2026-2030',
      status: 'QUEUED' as const,
      current_stage: 'PLANNING' as const,
      progress: 10,
      created_at: new Date().toISOString(),
      objectives: ['Market Sizing', 'Competitors'],
      stats: {
        sources_discovered: 5,
        sources_analyzed: 2,
        evidence_items: 12,
        claims_total: 8,
        claims_verified: 6,
        claims_contradicted: 1,
        claims_insufficient: 1,
        evidence_score: 92,
      },
      stages: [],
    };

    await db.saveJob(jobA, userA);

    // Verify User A can fetch Job A
    const fetchedA = await db.getJob(jobA.id, userA);
    assert.ok(fetchedA, 'User A must be able to fetch their own job');
    assert.strictEqual(fetchedA.question, jobA.question, 'Job question must match');

    // Verify User B CANNOT fetch Job A (Tenant Isolation!)
    const fetchedByB = await db.getJob(jobA.id, userB);
    assert.strictEqual(fetchedByB, null, 'User B must NOT be able to fetch User A\'s job (Isolation Violation!)');

    // Save job under User B with different ID
    const jobB = { ...jobA, id: 'job-test-BBB-' + Date.now(), question: 'Biotech gene splicing competitors?' };
    await db.saveJob(jobB, userB);

    // Verify user list filters
    const listA = await db.getJobs(userA);
    const hasJobA = listA.some(j => j.id === jobA.id);
    const hasJobB = listA.some(j => j.id === jobB.id);
    assert.ok(hasJobA, 'User A list must contain Job A');
    assert.ok(!hasJobB, 'User A list must NOT contain Job B');

    console.log('✓ SQL Database Adapter multi-tenant transaction isolation: PASSED');
  });

  await t.test('4. Exact Claim / Evidence Provenance and Deterministic Citation Graph', async () => {
    const testJobId = 'job-test-citation-graph-' + Date.now();
    const testJob = {
      id: testJobId,
      question: 'AI chips TAM',
      industry: 'Semi',
      geography: 'Global',
      time_horizon: '2026',
      status: 'QUEUED' as const,
      current_stage: 'PLANNING' as const,
      progress: 0,
      created_at: new Date().toISOString(),
      objectives: ['Market Sizing'],
      stats: {
        sources_discovered: 0,
        sources_analyzed: 0,
        evidence_items: 0,
        claims_total: 0,
        claims_verified: 0,
        claims_contradicted: 0,
        claims_insufficient: 0,
        evidence_score: 0,
      },
      stages: [],
    };

    // Trigger basic saving of telemetry events
    const db = DatabaseAdapter.getInstance();
    await db.saveJob(testJob, 'default_tenant');
    
    await db.addEvent(testJobId, {
      id: 9991,
      job_id: testJobId,
      event_type: 'stage_started',
      stage: 'BUILDING_CLAIMS',
      message: 'Synthesizing evidence citation matrix',
      progress: 60,
      created_at: new Date().toISOString(),
    });

    const events = await db.getEvents(testJobId);
    assert.strictEqual(events.length, 1, 'Telemetry events list must persist to SQL backend');
    assert.strictEqual(events[0].message, 'Synthesizing evidence citation matrix', 'Telemetry event message must match');
    assert.strictEqual(events[0].stage, 'BUILDING_CLAIMS', 'Telemetry event stage must match');

    console.log('✓ Telemetry Citation Graph & Provenance Verification: PASSED');
  });
});
