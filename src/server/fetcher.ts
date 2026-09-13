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
  publishedAt: string;
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

  public static extractPublicationDate(html: string, headers: Headers): string {
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

    return new Date().toISOString();
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

  public static findExactCharacterOffsets(
    sourceText: string,
    extractedQuote: string
  ): OffsetMatch {
    if (!extractedQuote || extractedQuote.trim().length < 3) {
      return { quote: extractedQuote, startOffset: -1, endOffset: -1, found: false };
    }

    const cleanQuote = extractedQuote.trim().toLowerCase();
    const sourceLower = sourceText.toLowerCase();

    // 1. Exact substring match
    let idx = sourceLower.indexOf(cleanQuote);
    if (idx !== -1) {
      const startOffset = idx;
      const endOffset = idx + extractedQuote.trim().length;
      if (startOffset >= 0 && endOffset > startOffset && endOffset <= sourceText.length) {
        return {
          quote: extractedQuote,
          startOffset,
          endOffset,
          found: true,
        };
      }
    }

    // 2. Normalized whitespace mapping
    let cleanSource = '';
    const indexMap: number[] = [];
    for (let i = 0; i < sourceText.length; i++) {
      const char = sourceText[i];
      if (!/\s/.test(char)) {
        cleanSource += char.toLowerCase();
        indexMap.push(i);
      }
    }

    const cleanQuery = cleanQuote.replace(/\s+/g, '');
    const cleanIdx = cleanSource.indexOf(cleanQuery);

    if (cleanIdx !== -1 && indexMap.length > 0) {
      const startOffset = indexMap[cleanIdx];
      const endMapIdx = cleanIdx + cleanQuery.length - 1;
      const endOffset = endMapIdx < indexMap.length ? indexMap[endMapIdx] + 1 : sourceText.length;

      if (startOffset >= 0 && endOffset > startOffset && endOffset <= sourceText.length) {
        return {
          quote: extractedQuote,
          startOffset,
          endOffset,
          found: true,
        };
      }
    }

    // Reject invalid offsets
    return { quote: extractedQuote, startOffset: -1, endOffset: -1, found: false };
  }

  public static findExactEvidenceOffset(sourceText: string, extractedQuote: string) {
    return this.findExactCharacterOffsets(sourceText, extractedQuote);
  }
}
