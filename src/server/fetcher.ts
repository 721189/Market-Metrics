import crypto from 'crypto';
import dns from 'dns';
import { isIP } from 'node:net';
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import { URL } from 'url';
import { logger } from './logger.js';
import { DocumentChunk } from '../types.js';
import { PDFParse } from 'pdf-parse';

export class DocumentFetchAbortedError extends Error {
  constructor(message = 'Document fetch was cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

export class DocumentFetchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super('Document fetch timed out after ' + timeoutMs + 'ms');
    this.name = 'DocumentFetchTimeoutError';
  }
}

function asAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof DocumentFetchTimeoutError) return reason;
  if (reason instanceof DocumentFetchAbortedError) return reason;
  return new DocumentFetchAbortedError(reason instanceof Error ? reason.message : undefined);
}


function parseIpv6BigInt(raw: string): bigint | null {
  let address = raw.toLowerCase().split('%')[0];
  if (address.includes('.')) {
    const colon = address.lastIndexOf(':');
    const ipv4 = address.slice(colon + 1);
    const octets = ipv4.split('.').map(Number);
    if (octets.length !== 4 || octets.some(value =>
      !Number.isInteger(value) || value < 0 || value > 255
    )) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    address = address.slice(0, colon + 1) + high + ':' + low;
  }

  const halves = address.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  let groups: string[];

  if (halves.length === 1) {
    if (left.length !== 8) return null;
    groups = left;
  } else {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  }

  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/i.test(group))) {
    return null;
  }
  return groups.reduce((value, group) =>
    (value << 16n) | BigInt('0x' + group), 0n,
  );
}

function ipv6InPrefix(address: bigint, network: string, prefixLength: number): boolean {
  const networkValue = parseIpv6BigInt(network);
  if (networkValue === null) return false;
  const shift = 128n - BigInt(prefixLength);
  return (address >> shift) === (networkValue >> shift);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw asAbortError(signal);
}

async function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(asAbortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export interface FetchedDocument {
  url: string;
  title: string;
  domain: string;
  publisher: string;
  httpStatus: number;
  extractedText: string;
  paragraphs: string[];
  contentLength: number;
  publishedAt: string | null; // null = publication date could not be verified; NEVER fabricated
  contentHash: string;
  chunks: DocumentChunk[];
  retrievedAt: string;
}

export interface OffsetMatch {
  quote: string;
  startOffset: number;
  endOffset: number;
  found: boolean;
}

export class RealDocumentFetcher {
  private static USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 MarketResearchAgent/2.0';

  static readonly MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
  static readonly MAX_DECOMPRESSED_BYTES = 5 * 1024 * 1024;
  static readonly MAX_REDIRECTS = 5;
  static readonly FETCH_TIMEOUT_MS = 15000;

  /**
   * SSRF hostname boundary. Blocks loopback, link-local, RFC-1918, CGNAT,
   * TEST-NET, metadata endpoints, embedded credentials, and internal suffixes
   * before any DNS or socket work happens.
   */
  public static validateUrl(urlStr: string): void {
    let parsed: URL;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      throw new Error(`Invalid URL format: ${urlStr}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`SSRF blocked: Unsupported protocol "${parsed.protocol}"`);
    }

    if (parsed.username || parsed.password) {
      throw new Error('SSRF blocked: credentials embedded in URL are forbidden');
    }

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname === 'metadata.google.internal' ||
      hostname === 'metadata.google.com' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('100.64.') ||
      hostname.startsWith('192.0.2.') ||
      hostname.startsWith('198.51.100.') ||
      hostname.startsWith('203.0.113.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.invalid')
    ) {
      throw new Error(`SSRF blocked: Access to private or internal IP/hostname "${hostname}" is forbidden.`);
    }
  }

  /** True when a resolved literal IP is non-routable. Second layer behind validateUrl. */
  public static isPrivateIp(ip: string): boolean {
    if (!ip) return true;
    const value = ip.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
    const family = isIP(value);
    if (!family) return true;

    if (family === 4) {
      const parts = value.split('.').map(Number);
      if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return true;
      }
      const [a, b, c, d] = parts;

      // Non-public, special-purpose, documentation, benchmarking, multicast,
      // and reserved IPv4 ranges. Block entire special-purpose prefixes rather
      // than relying on the narrower RFC1918 list.
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 192 && b === 0 && c === 0) ||
        (a === 192 && b === 0 && c === 2) ||
        (a === 192 && b === 88 && c === 99) ||
        (a === 192 && b === 168) ||
        (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) ||
        (a === 203 && b === 0 && c === 113) ||
        (a === 255 && b === 255 && c === 255 && d === 255)
      );
    }

    const address = parseIpv6BigInt(value);
    if (address === null) return true;

    // IPv4-mapped IPv6 addresses inherit the IPv4 policy. This covers both
    // compressed and fully-expanded mapped-address notation.
    if (ipv6InPrefix(address, '::ffff:0:0', 96)) {
      const mappedV4 = Number(address & 0xffffffffn);
      const octets = [
        (mappedV4 >>> 24) & 255,
        (mappedV4 >>> 16) & 255,
        (mappedV4 >>> 8) & 255,
        mappedV4 & 255,
      ].join('.');
      return this.isPrivateIp(octets);
    }

    // Only global-unicast IPv6 (2000::/3) is eligible for outbound fetching.
    // Explicitly exclude documentation, deprecated transition, and IANA
    // special-purpose ranges within that allocation.
    if (!ipv6InPrefix(address, '2000::', 3)) return true;
    return (
      ipv6InPrefix(address, '2001::', 23) ||
      ipv6InPrefix(address, '2001:db8::', 32) ||
      ipv6InPrefix(address, '2002::', 16) ||
      ipv6InPrefix(address, '2001:20::', 28) ||
      ipv6InPrefix(address, '3fff::', 20)
    );
  }

  /** Resolve a hostname, dropping non-routable answers. Throws when none remain. */
  private static async resolvePublicIps(hostname: string): Promise<string[]> {
    let records: Array<{ address: string }>;
    try {
      records = await dns.promises.lookup(hostname, { all: true });
    } catch (err: any) {
      throw new Error(`SSRF blocked: DNS resolution failed for "${hostname}": ${err?.message || err}`);
    }
    const publicIps = records.map((r) => r.address).filter((ip) => !this.isPrivateIp(ip));
    if (publicIps.length === 0) {
      throw new Error(`SSRF blocked: "${hostname}" resolves only to private/internal addresses`);
    }
    return publicIps;
  }

  private static parseContentType(raw: string | string[] | undefined): { mime: string; charset: string | null } {
    const first = Array.isArray(raw) ? raw[0] : raw;
    const segs = String(first || '').split(';').map((s) => s.trim());
    const mime = (segs[0] || 'application/octet-stream').toLowerCase();
    let charset: string | null = null;
    for (const p of segs.slice(1)) {
      const m = p.match(/^charset\s*=\s*"?([^";]+)"?$/i);
      if (m) charset = m[1].toLowerCase();
    }
    return { mime, charset };
  }

  public static computeSha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }

  /**
   * Extracts the publication date from meta tags, JSON-LD, or HTTP headers.
   * Returns null when the date cannot be verified — an unknown publication
   * date must remain unknown (null), never fabricated as "now".
   */
  public static extractPublicationDate(html: string, _headers: Headers): string | null {
    // Parse meta elements independently so attribute order is irrelevant.
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
      const key = tag.match(/(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!key || !['article:published_time', 'og:published_time', 'date', 'datepublished', 'pubdate', 'parsely-pub-date'].includes(key)) continue;
      const value = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!value) continue;
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    }

    // JSON-LD can be an object, array, or @graph. Only explicit datePublished
    // values qualify as publication dates.
    const jsonLdBlocks = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || [];
    const findPublishedDate = (value: any): string | null => {
      if (!value || typeof value !== 'object') return null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findPublishedDate(item);
          if (found) return found;
        }
        return null;
      }
      if (typeof value.datePublished === 'string') {
        const parsed = Date.parse(value.datePublished);
        if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
      }
      return findPublishedDate(value['@graph']);
    };
    for (const block of jsonLdBlocks) {
      const json = block.replace(/^<script\b[^>]*>/i, '').replace(/<\/script>$/i, '');
      try {
        const found = findPublishedDate(JSON.parse(json));
        if (found) return found;
      } catch {
        // Malformed JSON-LD is ignored; unknown dates remain unknown.
      }
    }

    // Last-Modified is a file/cache timestamp, not necessarily publication.
    return null;
  }

  public static chunkText(sourceId: string, title: string, text: string): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    let currentOffset = 0;
    const paragraphs = text.split('\n\n');
    let chunkIdx = 0;

    for (let p of paragraphs) {
      if (!p.trim()) continue;
      const pStart = text.indexOf(p, currentOffset);
      const pEnd = pStart !== -1 ? pStart + p.length : currentOffset + p.length;
      currentOffset = pEnd;

      chunks.push({
        id: `${sourceId}-chunk-${chunkIdx++}`,
        source_id: sourceId,
        title,
        section: `Paragraph ${chunkIdx}`,
        text: p.trim(),
        word_count: p.split(/\s+/).length,
        offset_start: pStart !== -1 ? pStart : 0,
        offset_end: pEnd,
      });
    }

    if (chunks.length === 0 && text.trim().length > 0) {
      chunks.push({
        id: `${sourceId}-chunk-0`,
        source_id: sourceId,
        title,
        section: 'Full Document',
        text: text.slice(0, 800),
        word_count: text.split(/\s+/).length,
        offset_start: 0,
        offset_end: Math.min(text.length, 800),
      });
    }

    return chunks;
  }

  public static async fetchUrl(
    url: string,
    timeoutMs = 6000,
    parentSignal?: AbortSignal,
  ): Promise<FetchedDocument | null> {
    if (parentSignal?.aborted) throw asAbortError(parentSignal);

    const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? Math.floor(timeoutMs)
      : this.FETCH_TIMEOUT_MS;
    const deadlineAt = Date.now() + effectiveTimeoutMs;
    const operationController = new AbortController();
    const timeoutError = new DocumentFetchTimeoutError(effectiveTimeoutMs);
    const timeoutTimer = setTimeout(() => operationController.abort(timeoutError), effectiveTimeoutMs);
    const onParentAbort = () => operationController.abort(asAbortError(parentSignal));
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    if (parentSignal?.aborted) onParentAbort();

    try {
      throwIfAborted(operationController.signal);
      const fetchResult = await this.safeFetch(
        url, this.MAX_RESPONSE_BYTES, effectiveTimeoutMs, null,
        operationController.signal, deadlineAt, 0,
      );
      throwIfAborted(operationController.signal);
      if (!fetchResult) return null;

      const { status, headers, body, contentLength } = fetchResult;
      if (status !== 200) {
        logger.warn('fetcher.non_200', 'Non-200 response', { url, status });
        return null;
      }

      const ct = headers['content-type'];
      const contentType = (Array.isArray(ct) ? ct[0] : ct || '').toLowerCase();
      const extractedText = await awaitWithAbort(
        this.detectAndExtract(url, contentType, body),
        operationController.signal,
      );
      throwIfAborted(operationController.signal);
      if (extractedText === null) {
        logger.warn('fetcher.extract_failed', 'Failed to extract text (unsupported format or empty)', { url, contentType });
        return null;
      }

      const fetchHeaders = new Headers();
      Object.entries(headers).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach(val => fetchHeaders.append(k, val));
        else if (v !== undefined) fetchHeaders.append(k, v);
      });
      // Preserve the original HTML long enough to extract metadata. The
      // normalized text no longer contains <title>, Open Graph, or JSON-LD tags.
      const isHtmlDocument =
        /(?:text\/html|application\/xhtml\+xml)/i.test(contentType) ||
        /\.(?:html?|xhtml)(?:[?#]|$)/i.test(url);
      const originalHtml = isHtmlDocument ? body.toString('utf8') : '';
      const publishedAt = originalHtml
        ? this.extractPublicationDate(originalHtml, fetchHeaders)
        : null;
      const title = originalHtml ? this.extractTitle(originalHtml, url) : this.extractTitle('', url);
      const contentHash = this.computeSha256(extractedText);
      const sourceId = 'src-' + Math.random().toString(36).substring(2, 8);
      const chunks = this.chunkText(sourceId, title, extractedText);
      return {
        url, title, domain: new URL(url).hostname,
        publisher: this.extractPublisher(originalHtml || extractedText, url),
        httpStatus: status, extractedText,
        paragraphs: this.splitParagraphs(extractedText),
        contentLength, publishedAt, contentHash, chunks,
        retrievedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      if (parentSignal?.aborted) throw asAbortError(parentSignal);
      if (operationController.signal.aborted) {
        const reason = asAbortError(operationController.signal);
        if (reason instanceof DocumentFetchTimeoutError) {
          logger.warn('fetcher.timeout', 'Document fetch exceeded its end-to-end deadline', { url, timeout_ms: effectiveTimeoutMs });
          throw reason;
        }
        throw reason;
      }
      if (err instanceof DocumentFetchTimeoutError || err instanceof DocumentFetchAbortedError || err?.name === 'AbortError') throw err;
      logger.warn('fetcher.fetch_failed', 'HTTP fetch failed', {
        url, reason: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      clearTimeout(timeoutTimer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }

  public static extractPublisher(html: string, url: string): string {
    const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of metaTags) {
      const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (!key || !['og:site_name', 'application-name', 'publisher'].includes(key)) continue;
      const value = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
      if (value) return value;
    }
    try { return new URL(url).hostname; } catch { return 'Unknown'; }
  }

  private static splitParagraphs(text: string): string[] {
    return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
  }

  public static extractTextFromHtml(html: string, url: string, domain: string): { title: string; publisher: string; text: string; paragraphs: string[] } {
    let title = `${domain} Report`;
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim().replace(/\s+/g, ' ');
    }

    let clean = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
      .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ');

    const paragraphs: string[] = [];
    const textBlocks = clean.split(/<\/?(?:p|div|section|article|h1|h2|h3|h4|h5|h6|li)[^>]*>/i);

    for (let block of textBlocks) {
      const rawText = block.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (rawText.length > 25 && !rawText.includes('cookie') && !rawText.includes('privacy policy')) {
        paragraphs.push(rawText);
      }
    }

    const fullText = paragraphs.join('\n\n');

    return {
      title,
      publisher: domain,
      text: fullText,
      paragraphs: paragraphs,
    };
  }

  /**
   * Canonical normalization used for citation matching: lowercases and unifies
   * common Unicode punctuation variants (curly quotes, dashes, NBSP) so that
   * semantically identical text matches regardless of encoding noise.
   */
  private static canonicalNormalize(text: string): string {
    return text
      .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
      .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
      .replace(/[\u2013\u2014\u2015]/g, '-')
      .replace(/\u00A0/g, ' ')
      .toLowerCase();
  }

  /**
   * Builds the normalized-space string of `text` together with an index map
   * from every normalized character position back to its ORIGINAL offset.
   * This is the foundation of exact normalized -> original quote mapping.
   */
  private static buildNormalizedIndex(text: string): { normalized: string; indexMap: number[] } {
    const canonical = RealDocumentFetcher.canonicalNormalize(text);
    let normalized = '';
    const indexMap: number[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = canonical[i];
      if (/\s/.test(ch)) continue; // whitespace is collapsed in normalized space
      normalized += ch;
      indexMap.push(i);
    }
    return { normalized, indexMap };
  }

  public static findExactCharacterOffsets(
    sourceText: string,
    extractedQuote: string
  ): OffsetMatch {
    const failure: OffsetMatch = { quote: extractedQuote, startOffset: -1, endOffset: -1, found: false };

    if (!sourceText || !extractedQuote || extractedQuote.trim().length < 3) {
      return failure;
    }

    // 1. Exact verbatim substring match (fast path)
    const trimmedQuery = extractedQuote.trim();
    const exactIdx = sourceText.indexOf(trimmedQuery);
    if (exactIdx !== -1) {
      const startOffset = exactIdx;
      const endOffset = exactIdx + trimmedQuery.length;
      if (startOffset >= 0 && endOffset > startOffset && endOffset <= sourceText.length) {
        return {
          quote: sourceText.slice(startOffset, endOffset),
          startOffset,
          endOffset,
          found: true,
        };
      }
    }

    // 2. Exact normalized -> original mapping.
    // Both source and query are projected into the same normalized space
    // (canonical punctuation + whitespace collapse + lowercasing). A match in
    // normalized space is then mapped back through indexMap to the EXACT
    // original character coordinates, and the returned quote is the VERBATIM
    // original source substring — never the LLM's re-typed variant.
    const source = RealDocumentFetcher.buildNormalizedIndex(sourceText);
    const queryNormalized = RealDocumentFetcher.canonicalNormalize(extractedQuote);
    let queryCollapsed = '';
    for (const ch of queryNormalized) {
      if (!/\s/.test(ch)) queryCollapsed += ch;
    }
    if (queryCollapsed.length < 3) {
      return failure;
    }

    const cleanIdx = source.normalized.indexOf(queryCollapsed);
    if (cleanIdx === -1 || source.indexMap.length === 0) {
      // Reject: the quote cannot be verified against the source text.
      return failure;
    }

    const startOffset = source.indexMap[cleanIdx];
    const endMapIdx = cleanIdx + queryCollapsed.length - 1;
    const endOffset = endMapIdx < source.indexMap.length
      ? source.indexMap[endMapIdx] + 1
      : sourceText.length;

    if (startOffset < 0 || endOffset <= startOffset || endOffset > sourceText.length) {
      return failure;
    }

    // The quote is ALWAYS the exact original slice at [startOffset, endOffset).
    const quote = sourceText.slice(startOffset, endOffset);

    // Hard invariant: normalized(quote) === normalized(query). If this fails
    // the mapping is not exact and the citation is rejected.
    const normalizedQuote = RealDocumentFetcher.canonicalNormalize(quote).replace(/\s+/g, '');
    if (normalizedQuote !== queryCollapsed) {
      return failure;
    }

    return {
      quote,
      startOffset,
      endOffset,
      found: true,
    };
  }

  public static findExactEvidenceOffset(sourceText: string, extractedQuote: string) {
    return this.findExactCharacterOffsets(sourceText, extractedQuote);
  }

  private static async detectAndExtract(url: string, contentType: string, body: Buffer): Promise<string | null> {
    let mime = contentType.split(';')[0].trim().toLowerCase();
    if (!mime || mime === 'application/octet-stream') {
      const ext = url.split('.').pop()?.toLowerCase();
      if (ext === 'pdf') mime = 'application/pdf';
      else if (ext === 'txt') mime = 'text/plain';
      else if (ext === 'csv') mime = 'text/csv';
      else if (ext === 'json') mime = 'application/json';
      else if (ext === 'html' || ext === 'htm') mime = 'text/html';
    }
    switch (mime) {
      case 'text/html': return this.extractHtmlText(body.toString('utf8'), url);
      case 'text/plain': return this.normalizeText(body.toString('utf8'));
      case 'text/csv': return this.parseCsvToText(body.toString('utf8'));
      case 'application/json': {
        try { const json = JSON.parse(body.toString('utf8')); return this.normalizeJsonToText(json); } catch { return null; }
      }
      case 'application/pdf': {
        try { return await this.extractPdfText(body); }
        catch (err) { logger.warn('fetcher.pdf_failed', 'PDF extraction failed', { url, status: err instanceof Error ? err.message : String(err) }); return null; }
      }
      default: logger.warn('fetcher.unsupported_mime', 'Unsupported MIME type', { url, mime, bodySize: body.length }); return null;
    }
  }

  public static extractHtmlText(html: string, _url: string): string | null {
    if (!html || html.length < 50) return null;

    // Drop non-content regions before inserting structural separators. In
    // particular, retain paragraph and table boundaries rather than flattening
    // every whitespace character into a single space.
    let text = html
      .replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\b[^>]*\/?>/gi, '\n')
      .replace(/<\/(?:td|th)\s*>/gi, ' | ')
      .replace(/<\/tr\s*>/gi, '\n\n')
      .replace(/<tr\b[^>]*>/gi, '\n\n')
      .replace(/<\/(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|ul)\s*>/gi, '\n\n')
      .replace(/<(?:address|article|aside|blockquote|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|pre|section|table|ul)\b[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_match: string, hex: string) => {
        const codePoint = Number.parseInt(hex, 16);
        return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : ' ';
      })
      .replace(/&#(\d+);/g, (_match: string, decimal: string) => {
        const codePoint = Number.parseInt(decimal, 10);
        return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : ' ';
      });

    const paragraphs = text
      .split(/\n\s*\n+/)
      .map((paragraph: string) => paragraph
        .replace(/[ \t]+/g, ' ')
        .replace(/\s*\n\s*/g, ' ')
        .trim())
      .filter((paragraph: string) => paragraph.length > 50 || (paragraph.includes('|') && paragraph.length > 3));

    if (paragraphs.length === 0) {
      const fallback = text.replace(/\s+/g, ' ').trim();
      return fallback.length >= 100 ? fallback : null;
    }

    const scored = paragraphs
      .map((paragraph: string, index: number) => ({
        text: paragraph,
        index,
        words: paragraph.split(/\s+/).length,
      }))
      .filter((paragraph: { words: number }) => paragraph.words >= 20);

    if (scored.length === 0) return paragraphs.join('\n\n');

    // Select the substantial paragraphs covering roughly 80% of the text,
    // but always retain up to the first three candidates. Selection is done
    // explicitly (not inside Array.filter, where referencing the result array
    // would hit its temporal dead zone), then restored to document order.
    const ranked = [...scored].sort((a, b) => b.words - a.words || a.index - b.index);
    const selected: typeof ranked = [];
    const totalWords = ranked.reduce((sum, paragraph) => sum + paragraph.words, 0);
    let selectedWords = 0;

    for (const paragraph of ranked) {
      if (selected.length < Math.min(3, ranked.length) || selectedWords < totalWords * 0.8) {
        selected.push(paragraph);
        selectedWords += paragraph.words;
      } else {
        break;
      }
    }

    const selectedIndexes = new Set(selected.map(paragraph => paragraph.index));
    return paragraphs
      .filter((paragraph, index) => paragraph.includes('|') || selectedIndexes.has(index))
      .join('\n\n');
  }

  public static parseCsvToText(csv: string): string {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < csv.length; index++) {
      const char = csv[index];

      if (char === '"') {
        if (quoted && csv[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = !quoted;
        }
        continue;
      }

      if (char === ',' && !quoted) {
        row.push(field.trim());
        field = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && csv[index + 1] === '\n') index++;
        row.push(field.trim());
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = [];
        field = '';
        continue;
      }

      field += char;
    }

    row.push(field.trim());
    if (row.some(cell => cell.length > 0)) rows.push(row);

    // Preserve field boundaries for downstream extraction. Quoted commas and
    // escaped quotes are decoded, and embedded newlines remain inside a cell.
    return rows.map(cells => cells.join('\t')).join('\n');
  }

  private static normalizeJsonToText(json: any): string {
    if (typeof json === 'string') return json;
    if (Array.isArray(json)) return json.map((item: any) => this.normalizeJsonToText(item)).join('\n');
    if (typeof json === 'object' && json !== null) return Object.entries(json).map(([k, v]: [string, any]) => `${k}: ${this.normalizeJsonToText(v)}`).join('\n');
    return String(json);
  }

  public static async extractPdfText(body: Buffer): Promise<string> {
    // Use the package's documented v2 class API. A static import is important
    // here: this code runs as an ES module in tests and is bundled as CJS for
    // production, so the old implicit require() path is not available.
    const parser = new PDFParse({ data: body });
    try {
      const result = await parser.getText();
      const text = this.normalizeText(result?.text || '');
      if (!text) throw new Error('PDF parser returned no extractable text');
      return text;
    } finally {
      await parser.destroy();
    }
  }

  private static normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  }

  public static extractTitle(html: string, fallbackUrl: string): string {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match && match[1]) return match[1].trim();
    try { return new URL(fallbackUrl).hostname; } catch { return fallbackUrl; }
  }


  private static async safeFetch(
    url: string,
    maxBytes: number,
    timeoutMs: number,
    pinnedIp: string | null = null,
    parentSignal?: AbortSignal,
    deadlineAt = Date.now() + timeoutMs,
    redirectCount = 0,
  ): Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
    contentLength: number;
  }> {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) throw new DocumentFetchTimeoutError(timeoutMs);

    const controller = new AbortController();
    const timeoutError = new DocumentFetchTimeoutError(timeoutMs);
    const timeoutTimer = setTimeout(() => controller.abort(timeoutError), remainingMs);
    const onParentAbort = () => controller.abort(asAbortError(parentSignal));
    parentSignal?.addEventListener('abort', onParentAbort, { once: true });
    if (parentSignal?.aborted) onParentAbort();

    try {
      throwIfAborted(controller.signal);
      this.validateUrl(url);
      const parsed = new URL(url);
      const resolvedIp = pinnedIp || await awaitWithAbort(this.resolveIp(parsed.hostname), controller.signal);
      if (!resolvedIp || this.isPrivateIp(resolvedIp)) {
        throw new Error('SSRF blocked: destination did not resolve to a public IP address');
      }

      // Pin the connection's resolver to the exact IP already checked above.
      const family = resolvedIp.includes(':') ? 6 : 4;
      const pinnedLookup = (_hostname: string, optionsOrCallback: any, callbackArg?: any) => {
        const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback;
        const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : callbackArg;
        if (controller.signal.aborted) return callback(asAbortError(controller.signal));
        if (options?.all) return callback(null, [{ address: resolvedIp, family }]);
        return callback(null, resolvedIp, family);
      };

      const mod = parsed.protocol === 'https:' ? require('https') : require('http');
      const responsePromise = new Promise<{
        status: number;
        headers: Record<string, string | string[] | undefined>;
        body: NodeJS.ReadableStream;
      }>((resolve, reject) => {
        const req = mod.get(parsed.toString(), {
          headers: { 'User-Agent': this.USER_AGENT, 'Accept-Encoding': 'identity' },
          signal: controller.signal,
          lookup: pinnedLookup,
        }, (resp: any) => resolve({ status: resp.statusCode, headers: resp.headers, body: resp }));
        req.on('error', reject);
        req.end();
      });
      const response = await awaitWithAbort(responsePromise, controller.signal);
      throwIfAborted(controller.signal);

      if (response.status >= 300 && response.status < 400 && response.headers['location']) {
        if (redirectCount >= this.MAX_REDIRECTS) throw new Error('Redirect limit exceeded (' + this.MAX_REDIRECTS + ')');
        const redirectUrl = new URL(response.headers['location']!, url).toString();
        this.validateUrl(redirectUrl);
        const redirectHost = new URL(redirectUrl).hostname;
        const redirectedIp = await awaitWithAbort(this.resolveIp(redirectHost), controller.signal);
        if (!redirectedIp || this.isPrivateIp(redirectedIp)) {
          throw new Error('SSRF blocked: redirect target did not resolve to a public IP address');
        }
        if (redirectHost.toLowerCase() === parsed.hostname.toLowerCase() && redirectedIp !== resolvedIp) {
          throw new Error('SSRF blocked: DNS rebinding detected for redirect host');
        }
        return await this.safeFetch(
          redirectUrl, maxBytes, timeoutMs, redirectedIp,
          controller.signal, deadlineAt, redirectCount + 1,
        );
      }

      const readBody = async (): Promise<{ body: Buffer; contentLength: number }> => {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of response.body) {
          throwIfAborted(controller.signal);
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += buf.length;
          if (total > maxBytes) throw new Error('Response exceeded size limit of ' + maxBytes + ' bytes');
          if (total > RealDocumentFetcher.MAX_DECOMPRESSED_BYTES) {
            throw new Error('Decompression bomb: response exceeded ' + RealDocumentFetcher.MAX_DECOMPRESSED_BYTES + ' bytes');
          }
          chunks.push(buf);
        }
        throwIfAborted(controller.signal);
        return { body: Buffer.concat(chunks, total), contentLength: total };
      };
      const { body, contentLength } = await awaitWithAbort(readBody(), controller.signal);
      return { status: response.status, headers: response.headers, body, contentLength };
    } catch (err) {
      if (controller.signal.aborted) throw asAbortError(controller.signal);
      if (parentSignal?.aborted) throw asAbortError(parentSignal);
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  }

  private static async resolveIp(hostname: string): Promise<string | null> {
    let results: Array<{ address: string }>;
    try {
      results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    } catch (err: any) {
      throw new Error('DNS resolution failed for ' + hostname + ': ' + (err?.message || String(err)));
    }
    if (!results.length) throw new Error('DNS resolution returned no addresses for ' + hostname);
    const addresses = results.map(record => record.address);
    const privateAddress = addresses.find(address => this.isPrivateIp(address));
    if (privateAddress) throw new Error('SSRF blocked: hostname ' + hostname + ' resolves to a private/internal address');
    return addresses[0] || null;
  }
}
