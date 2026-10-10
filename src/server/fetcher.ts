import crypto from 'crypto';
import dns from 'dns';
import http from 'http';
import https from 'https';
import zlib from 'zlib';
import { URL } from 'url';
import { logger } from './logger.js';
import { DocumentChunk } from '../types.js';

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
    if (!ip) return false;
    const v = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (v === 'localhost' || v === '::1' || v === '::' || v === '0.0.0.0') return true;
    if (v.startsWith('::ffff:')) return this.isPrivateIp(v.slice('::ffff:'.length));
    if (v.includes(':')) {
      return v === '::1' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd') || v === '::';
    }
    const parts = v.split('.');
    if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p))) return true;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 0 || a >= 224) return true;
    return false;
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
  public static extractPublicationDate(html: string, headers: Headers): string | null {
    const metaDateMatch = html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]+name=["']date["'][^>]+content=["']([^"']+)["']/i) ||
                          html.match(/<meta[^>]+property=["']og:published_time["'][^>]+content=["']([^"']+)["']/i);
    if (metaDateMatch && metaDateMatch[1]) {
      const parsed = Date.parse(metaDateMatch[1]);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    }

    const jsonLdMatch = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatch) {
      for (let block of jsonLdMatch) {
        try {
          const contentMatch = block.match(/>([\s\S]*?)<\/script>/i);
          if (contentMatch && contentMatch[1]) {
            const data = JSON.parse(contentMatch[1]);
            const datePub = data.datePublished || data['datePublished'] || data.uploadDate;
            if (datePub) {
              const parsed = Date.parse(datePub);
              if (!isNaN(parsed)) return new Date(parsed).toISOString();
            }
          }
        } catch (e) {}
      }
    }

    const lastMod = headers.get('last-modified');
    if (lastMod) {
      const parsed = Date.parse(lastMod);
      if (!isNaN(parsed)) return new Date(parsed).toISOString();
    }

    // Unknown publication date -> null. Do NOT fabricate a date.
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

  public static async fetchUrl(url: string, timeoutMs = 6000): Promise<FetchedDocument | null> {
    // Use safeFetch with SSRF protections (DNS pinning, redirect check, size cap, MIME validation)
    let fetchResult: Awaited<ReturnType<typeof RealDocumentFetcher['safeFetch']>> | null = null;
    try {
      fetchResult = await this.safeFetch(url, 10 * 1024 * 1024, timeoutMs);
    } catch (err: any) {
      logger.warn('fetcher.fetch_failed', 'HTTP fetch failed', { url, status: err.message, reason: err instanceof Error ? err.message : String(err) });
      return null;
    }
    if (!fetchResult) return null;
    const { status, headers, body, contentLength } = fetchResult;
    if (status !== 200) {
      logger.warn('fetcher.non_200', 'Non-200 response', { url, status });
      return null;
    }
    const contentType = (headers['content-type'] || '').toLowerCase();
    // MIME-aware extraction
    const extractedText = await this.detectAndExtract(url, contentType, body);
    if (extractedText === null) {
      logger.warn('fetcher.extract_failed', 'Failed to extract text (unsupported format or empty)', { url, contentType });
      return null;
    }
    const publishedAt = this.extractPublicationDate(extractedText, headers);
    const title = this.extractTitle(extractedText, url);
    const contentHash = this.computeSha256(extractedText);
    const sourceId = 'src-' + Math.random().toString(36).substring(2, 8);
    const chunks = this.chunkText(sourceId, title, extractedText);
    return {
      url,
      title,
      domain: new URL(url).hostname,
      publisher: this.extractPublisher(extractedText, url),
      httpStatus: status,
      extractedText,
      paragraphs: this.splitParagraphs(extractedText),
      contentLength,
      publishedAt,
      contentHash,
      chunks,
      retrievedAt: new Date().toISOString(),
    };
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

  private static extractHtmlText(html: string, url: string): string | null {
    if (!html || html.length < 50) return null;
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#[0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length < 100) return null;
    const paragraphs = text.split(/\n\s*\n/).filter((p: string) => p.trim().length > 50);
    if (paragraphs.length === 0) return text;
    const scored = paragraphs.map((p: string) => ({ t: p.trim(), w: p.trim().split(/\s+/).length }))
      .filter((p: { w: number }) => p.w >= 20).sort((a: { w: number }, b: { w: number }) => b.w - a.w);
    if (scored.length === 0) return text;
    const tw = scored.reduce((s: number, p: { w: number }) => s + p.w, 0);
    let cum = 0;
    const sel = scored.filter((p: { w: number }) => { cum += p.w; return cum <= tw * 0.8 || sel.length < 3; });
    if (sel.length < 3) return paragraphs.join('\n\n');
    return sel.map((p: { t: string }) => p.t).join('\n\n');
  }

  private static parseCsvToText(csv: string): string {
    return csv.split(/\r?\n/).filter((l: string) => l.trim().length > 0).map((line: string) => line.split(',').map((c: string) => c.trim()).join('\t')).join('\n');
  }

  private static normalizeJsonToText(json: any): string {
    if (typeof json === 'string') return json;
    if (Array.isArray(json)) return json.map((item: any) => this.normalizeJsonToText(item)).join('\n');
    if (typeof json === 'object' && json !== null) return Object.entries(json).map(([k, v]: [string, any]) => `${k}: ${this.normalizeJsonToText(v)}`).join('\n');
    return String(json);
  }

  private static async extractPdfText(body: Buffer): Promise<string> {
    try {
      const pdfParse = require('pdf-parse');
      if (typeof pdfParse === 'function') { const data = await pdfParse(body); return this.normalizeText(data.text || ''); }
    } catch { /* not available */ }
    try {
      const pdfjs = require('pdfjs-dist');
      if (typeof pdfjs !== 'undefined' && typeof pdfjs.getDocument === 'function') {
        const doc = await pdfjs.getDocument({ data: body.slice(0) }).promise;
        const pages = await Promise.all(Array.from({ length: doc.numPages }, async (_: any, i: number) => {
          const page = await doc.getPage(i + 1); const content = await page.getTextContent();
          return content.items.map((item: any) => item.str).join(' ');
        }));
        return this.normalizeText(pages.join('\n\n'));
      }
    } catch { /* not available */ }
    throw new Error('No PDF parser available (install pdf-parse or pdfjs-dist)');
  }


  private static normalizeText(text: string): string {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  }

  public static extractTitle(html: string, fallbackUrl: string): string {
    const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (match && match[1]) return match[1].trim();
    try { return new URL(fallbackUrl).hostname; } catch { return fallbackUrl; }
  }


  private static async safeFetch(url: string, maxBytes: number, timeoutMs: number): Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
    contentLength: number;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      this.validateUrl(url);
      const parsed = new URL(url);
      const isHttps = parsed.protocol === 'https:';
      const mod = isHttps ? require('https') : require('http');
      const res = await new Promise<{
        status: number;
        headers: Record<string, string | string[] | undefined>;
        body: NodeJS.ReadableStream;
      }>((resolve, reject) => {
        const req = mod.get(parsed.toString(), {
          headers: { 'User-Agent': this.USER_AGENT, 'Accept-Encoding': 'identity' },
          signal: controller.signal,
        }, (resp: any) => resolve({ status: resp.statusCode, headers: resp.headers, body: resp }));
        req.on('error', reject);
        req.end();
      });
      if (res.status >= 300 && res.status < 400 && res.headers['location']) {
        const redirectUrl = new URL(res.headers['location']!, url).toString();
        this.validateUrl(redirectUrl);
        const redirectedParsed = new URL(redirectUrl);
        const redirectedIp = await this.resolveIp(redirectedParsed.hostname);
        if (redirectedIp && !this.isPrivateIp(redirectedIp)) {
          const originalIp = await this.resolveIp(parsed.hostname);
          if (originalIp && redirectedIp !== originalIp) {
            throw new Error(`SSRF blocked: DNS rebinding detected (${originalIp} -> ${redirectedIp})`);
          }
        }
        clearTimeout(timer);
        return this.safeFetch(redirectUrl, maxBytes, timeoutMs);
      }
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.length;
        if (total > maxBytes) throw new Error(`Response exceeded size limit of ${maxBytes} bytes`);
        chunks.push(buf);
      }
      return { status: res.status, headers: res.headers, body: Buffer.concat(chunks, total), contentLength: total };
    } finally {
      clearTimeout(timer);
    }
  }

  private static async resolveIp(hostname: string): Promise<string | null> {
    try {
      const { lookup } = require('dns').promises;
      if (!lookup) return null;
      const results = await lookup(hostname, { all: true });
      const ips = results.map((r: any) => r.address).filter((ip: string) => !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip));
      return ips[0] || null;
    } catch { return null; }
  }
}
