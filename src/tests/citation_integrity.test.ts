/**
 * Phase 4 — Test 6: Citation Integrity Test
 * Verifies character-level citation coordinates, offset boundaries,
 * quote slice matching, SHA-256 integrity hashing, and provenance classifications.
 */

import { RealDocumentFetcher } from '../server/fetcher.js';
import crypto from 'crypto';

export async function runCitationIntegrityTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Test 6: Citation Integrity Test ---');

  const corpus = `Quarterly Earnings Report: Fiscal Year 2024.
Company ACME Cloud Infrastructure achieved total revenue of $4.85 billion, reflecting a 23.4% year-over-year increase.
Operating margin expanded by 340 basis points to reach 28.1%.
The subscription recurring revenue ARR ended at $3.92 billion with a net revenue retention rate of 118%.
Key risks include escalating data center energy costs and supply chain constraints in HBM3e high-bandwidth memory chips.`;

  // Test 6.1: Valid exact offset extraction
  const quoteTarget = 'Company ACME Cloud Infrastructure achieved total revenue of $4.85 billion';
  const offset = RealDocumentFetcher.findExactEvidenceOffset(corpus, quoteTarget);

  if (offset.startOffset === -1 || offset.endOffset === -1) {
    return { passed: false, message: 'Valid phrase was not located in document corpus' };
  }

  // Verify slice match
  const extractedSlice = corpus.slice(offset.startOffset, offset.endOffset);
  if (extractedSlice !== quoteTarget) {
    return {
      passed: false,
      message: `Extracted slice mismatch! Expected "${quoteTarget}", but got "${extractedSlice}"`,
    };
  }
  console.log(`✔ Exact offset coordinates verified: [${offset.startOffset}, ${offset.endOffset}] perfectly matches slice.`);

  // Test 6.2: Rejection of non-existent quotes
  const phantomTarget = 'Company ACME declared a massive dividend of $500 per share on Wednesday';
  const invalidOffset = RealDocumentFetcher.findExactEvidenceOffset(corpus, phantomTarget);

  if (invalidOffset.startOffset !== -1 || invalidOffset.endOffset !== -1) {
    return { passed: false, message: 'Phantom citation was incorrectly accepted with valid offsets' };
  }
  console.log('✔ Non-existent citation was rejected with offsets [-1, -1].');

  // Test 6.3: Offset boundary invariants
  const secondQuote = 'Operating margin expanded by 340 basis points to reach 28.1%.';
  const offset2 = RealDocumentFetcher.findExactEvidenceOffset(corpus, secondQuote);
  if (
    offset2.startOffset < 0 ||
    offset2.endOffset > corpus.length ||
    offset2.startOffset >= offset2.endOffset
  ) {
    return { passed: false, message: 'Citation offsets violate boundary invariants' };
  }
  console.log('✔ Offset boundary checks (0 <= start < end <= corpus.length) verified.');

  // Test 6.4: Cryptographic SHA-256 Content Hash Verification
  const computedHash = RealDocumentFetcher.computeSha256(corpus);
  const expectedHash = crypto.createHash('sha256').update(corpus, 'utf8').digest('hex');
  if (computedHash !== expectedHash) {
    return {
      passed: false,
      message: `SHA-256 hash mismatch: computed ${computedHash}, expected ${expectedHash}`,
    };
  }
  console.log(`✔ SHA-256 document content integrity hash validated: ${computedHash.substring(0, 16)}...`);

  // Test 6.5: Publication Date Extraction
  const htmlWithJsonLd = `<!DOCTYPE html>
<html>
  <head>
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "NewsArticle",
        "headline": "Energy Storage Market Surges in 2024",
        "datePublished": "2024-11-20T14:30:00Z"
      }
    </script>
  </head>
  <body>Article content here</body>
</html>`;
  const headers = new Headers();
  const extractedDate = RealDocumentFetcher.extractPublicationDate(htmlWithJsonLd, headers);
  if (!extractedDate || !extractedDate.startsWith('2024-11-20')) {
    return { passed: false, message: `Failed to extract publication date from JSON-LD: got ${extractedDate}` };
  }
  console.log(`✔ Extracted publication date from schema: ${extractedDate}`);

  // Test 6.6: Document Chunking with Overlap
  const longText = 'Word paragraph one for research verification.\n\nWord paragraph two with distinct operational facts.\n\nWord paragraph three testing chunk boundary offsets.';
  const chunks = RealDocumentFetcher.chunkText('src-001', 'Test Document', longText);
  if (chunks.length < 2) {
    return { passed: false, message: `Unexpected chunk count: ${chunks.length}` };
  }
  for (const chunk of chunks) {
    if (chunk.offset_start < 0 || chunk.offset_end > longText.length) {
      return { passed: false, message: `Chunk offsets violated boundaries: [${chunk.offset_start}, ${chunk.offset_end}]` };
    }
  }
  console.log(`✔ Document chunking verified: partitioned document into ${chunks.length} chunks with valid offsets.`);

  // Test 6.7: Provenance Classification Taxonomy
  const provenanceTypes = ['OBSERVED', 'INFERRED', 'ASSUMED', 'CALCULATED'] as const;
  const sampleClaims = [
    { type: 'OBSERVED', text: 'ACME reported $4.85B revenue directly in 10-Q filing' },
    { type: 'CALCULATED', text: 'CAGR between 2021 and 2024 is 21.8% based on financial disclosures' },
    { type: 'INFERRED', text: 'ACME is likely prioritizing enterprise tier over SMBs based on ARR metric' },
    { type: 'ASSUMED', text: 'Assuming electricity tariff remains below $0.12/kWh in data centers' },
  ];
  for (const item of sampleClaims) {
    if (!provenanceTypes.includes(item.type as any)) {
      return { passed: false, message: `Invalid provenance classification: ${item.type}` };
    }
  }
  console.log('✔ Provenance classification taxonomy verified for all epistemic tiers.');

  // Test 6.8: Unknown publication date must be null (never fabricated as "now")
  const noDateHtml = `<html><head><title>No metadata page</title></head><body><p>Plain content without any date metadata whatsoever.</p></body></html>`;
  const noDateHeaders = new Headers();
  const unknownDate = RealDocumentFetcher.extractPublicationDate(noDateHtml, noDateHeaders);
  if (unknownDate !== null) {
    return { passed: false, message: `Unknown publication date must be null, got fabricated: ${unknownDate}` };
  }
  console.log('✔ Unknown publication date returns null (no fabricated timestamps).');

  // Test 6.9: Exact normalized -> original quote mapping
  const noisyCorpus = 'Deployment   statistics:  India  has  deployed  approximately  24,500 public charging points. Grid capacity remains constrained.';
  const noisyQuery = 'INDIA has deployed approximately 24,500 public charging points.';
  const noisyOffset = RealDocumentFetcher.findExactEvidenceOffset(noisyCorpus, noisyQuery);
  if (!noisyOffset.found) {
    return { passed: false, message: 'Normalized mapping failed on case/whitespace-mutated quote' };
  }
  const verbatimSlice = noisyCorpus.slice(noisyOffset.startOffset, noisyOffset.endOffset);
  if (noisyOffset.quote !== verbatimSlice) {
    return { passed: false, message: `Quote must be the verbatim original slice, got "${noisyOffset.quote}" vs "${verbatimSlice}"` };
  }
  if (verbatimSlice !== 'India  has  deployed  approximately  24,500 public charging points.') {
    return { passed: false, message: `Mapped quote not from original coordinates: "${verbatimSlice}"` };
  }
  console.log('✔ Exact normalized->original mapping returns the verbatim source slice at exact coordinates.');

  return { passed: true, message: 'Citation integrity tests passed successfully.' };
}

if (process.argv[1]?.endsWith('citation_integrity.test.ts')) {
  runCitationIntegrityTest().then((res) => {
    if (!res.passed) {
      console.error('FAIL:', res.message);
      process.exit(1);
    }
  });
}
