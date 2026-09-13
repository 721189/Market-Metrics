export interface FetchedDocument {
  url: string;
  title: string;
  domain: string;
  publisher: string;
  httpStatus: number;
  extractedText: string;
  paragraphs: string[];
  contentLength: number;
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

    return {
      url,
      title: extracted.title,
      domain,
      publisher: extracted.publisher || domain,
      httpStatus: response.status,
      extractedText: extracted.text,
      paragraphs: extracted.paragraphs,
      contentLength: extracted.text.length,
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
    const normalize = (t: string) => t.replace(/\s+/g, '').toLowerCase();
    
    const cleanQuote = normalize(extractedQuote);
    if (!cleanQuote || cleanQuote.length < 5) {
      return { quote: extractedQuote, startOffset: -1, endOffset: -1, found: false };
    }

    let minWindow = Math.max(10, extractedQuote.length - 200);
    let maxWindow = extractedQuote.length + 200;
    
    for (let i = 0; i < sourceText.length - 10; i += 20) {
      const windowStr = sourceText.slice(i, i + maxWindow);
      const cleanWindow = normalize(windowStr);
      
      const idx = cleanWindow.indexOf(cleanQuote);
      if (idx !== -1) {
        return {
          quote: extractedQuote,
          startOffset: i,
          endOffset: i + maxWindow,
          found: true
        };
      }
    }

    return { quote: extractedQuote, startOffset: -1, endOffset: -1, found: false };
  }

  public static findExactEvidenceOffset(sourceText: string, extractedQuote: string) {
    return this.findExactCharacterOffsets(sourceText, extractedQuote);
  }
}
