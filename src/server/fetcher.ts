import crypto from 'crypto';
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

    const hostname = parsed.hostname.toLowerCase();

    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '0.0.0.0' ||
      hostname === '169.254.169.254' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.local')
    ) {
      throw new Error(`SSRF blocked: Access to private or internal IP/hostname "${hostname}" is forbidden.`);
    }
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

  public static async fetchUrl(url: string, timeoutMs = 6000, abortSignal?: AbortSignal): Promise<FetchedDocument> {
    this.validateUrl(url);
    let domain = 'web-source.org';
    try {
      domain = new URL(url).hostname.replace(/^www\./, '');
    } catch (e) {}

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    if (abortSignal) {
      abortSignal.addEventListener('abort', () => controller.abort());
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': this.USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
        throw new Error(`HTTP fetch failed with status: ${response.status}`);
    }

    const html = await response.text();
    const extracted = this.extractTextFromHtml(html, url, domain);
    const publishedAt = this.extractPublicationDate(html, response.headers);
    const contentHash = this.computeSha256(extracted.text);
    const sourceId = `src-${Math.random().toString(36).substring(2, 8)}`;
    const chunks = this.chunkText(sourceId, extracted.title, extracted.text);

    return {
      url,
      title: extracted.title,
      domain,
      publisher: extracted.publisher || domain,
      httpStatus: response.status,
      extractedText: extracted.text,
      paragraphs: extracted.paragraphs,
      contentLength: extracted.text.length,
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
}
