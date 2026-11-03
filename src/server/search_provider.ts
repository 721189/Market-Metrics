/**
 * Tavily-backed live web discovery.
 *
 * Search is intentionally decoupled from the Gemini generation provider:
 * Gemini remains responsible for planning and analysis; Tavily supplies
 * source URLs and snippets for the evidence-ingestion pipeline.
 */

export interface LiveSearchSource {
  title: string;
  url: string;
  snippet: string;
  publisher: string;
}

export interface TavilyDiscoveryResult {
  sources: LiveSearchSource[];
  queriesRun: number;
  creditsUsed: number;
}

export type SearchProviderFailureReason =
  | 'missing_api_key'
  | 'cancelled'
  | 'timeout'
  | 'network_error'
  | 'unauthorized'
  | 'invalid_request'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'provider_error'
  | 'invalid_response';

export class SearchProviderError extends Error {
  readonly reason: SearchProviderFailureReason;
  readonly statusCode?: number;
  readonly retryable: boolean;

  constructor(
    reason: SearchProviderFailureReason,
    message: string,
    options: { statusCode?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'SearchProviderError';
    this.reason = reason;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable === true;
  }
}

type FetchLike = typeof fetch;

interface TavilySearchPayload {
  results?: unknown;
  usage?: { credits?: unknown };
}

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';
const MAX_QUERIES_PER_RESEARCH = 4;
const MAX_RESULTS_PER_QUERY = 5;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new SearchProviderError('cancelled', 'Search was cancelled.'));
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new SearchProviderError('cancelled', 'Search was cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryDelayMs(headerValue: string | null): number {
  if (headerValue) {
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(5_000, Math.max(250, seconds * 1_000));
    }
    const date = Date.parse(headerValue);
    if (Number.isFinite(date)) {
      return Math.min(5_000, Math.max(250, date - Date.now()));
    }
  }
  return 700;
}

function classifyHttpFailure(status: number): SearchProviderError {
  if (status === 401 || status === 403) {
    return new SearchProviderError('unauthorized', 'Tavily rejected the configured API key.', { statusCode: status });
  }
  if (status === 432 || status === 433) {
    return new SearchProviderError('quota_exhausted', 'Tavily account usage limit has been reached.', { statusCode: status });
  }
  if (status === 429) {
    return new SearchProviderError('rate_limited', 'Tavily rate limit reached.', { statusCode: status, retryable: true });
  }
  if (status === 400 || status === 422) {
    return new SearchProviderError('invalid_request', 'Tavily rejected the search request.', { statusCode: status });
  }
  if (status >= 500) {
    return new SearchProviderError('provider_error', 'Tavily search service is temporarily unavailable.', { statusCode: status, retryable: true });
  }
  return new SearchProviderError('provider_error', 'Tavily search request failed.', { statusCode: status });
}

function normalizeResult(value: unknown): LiveSearchSource | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.url !== 'string') return null;

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(item.url);
  } catch {
    return null;
  }

  if (
    !['http:', 'https:'].includes(parsedUrl.protocol) ||
    !parsedUrl.hostname ||
    parsedUrl.username ||
    parsedUrl.password
  ) {
    return null;
  }

  parsedUrl.hash = '';
  const host = parsedUrl.hostname.replace(/^www\./i, '').toLowerCase();
  const title = typeof item.title === 'string' ? item.title.trim().slice(0, 300) : '';
  const content = typeof item.content === 'string' ? item.content.trim().slice(0, 2_000) : '';

  return {
    title: title || host,
    url: parsedUrl.toString(),
    snippet: content,
    publisher: host,
  };
}

async function searchOneQuery(
  query: string,
  apiKey: string,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<{ sources: LiveSearchSource[]; creditsUsed: number }> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (signal?.aborted) {
      throw new SearchProviderError('cancelled', 'Search was cancelled.');
    }

    const controller = new AbortController();
    let timedOut = false;
    const onParentAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onParentAbort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Tavily request timed out'));
    }, REQUEST_TIMEOUT_MS);

    let response: Response;
    let responseText = '';
    try {
      response = await fetchImpl(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          topic: 'general',
          max_results: MAX_RESULTS_PER_QUERY,
          include_answer: false,
          include_raw_content: false,
          include_usage: true,
        }),
        signal: controller.signal,
      });
      if (response.ok) responseText = await response.text();
    } catch (error) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onParentAbort);
      if (signal?.aborted) {
        throw new SearchProviderError('cancelled', 'Search was cancelled.');
      }
      if (timedOut) {
        if (attempt < MAX_RETRIES) {
          await abortableSleep(300, signal);
          continue;
        }
        throw new SearchProviderError('timeout', 'Tavily search request timed out.', { retryable: true });
      }
      if (attempt < MAX_RETRIES) {
        await abortableSleep(300, signal);
        continue;
      }
      throw new SearchProviderError('network_error', 'Could not connect to the Tavily search service.', { retryable: true });
    }

    clearTimeout(timer);
    signal?.removeEventListener('abort', onParentAbort);

    if (!response.ok) {
      const failure = classifyHttpFailure(response.status);
      if (failure.retryable && attempt < MAX_RETRIES) {
        await abortableSleep(
          response.status === 429 ? retryDelayMs(response.headers.get('retry-after')) : 300,
          signal,
        );
        continue;
      }
      throw failure;
    }

    let payload: TavilySearchPayload;
    try {
      payload = JSON.parse(responseText) as TavilySearchPayload;
    } catch {
      throw new SearchProviderError('invalid_response', 'Tavily returned an unreadable response.');
    }

    if (!Array.isArray(payload.results)) {
      throw new SearchProviderError('invalid_response', 'Tavily response did not contain a results array.');
    }

    const sources = payload.results
      .map(normalizeResult)
      .filter((item): item is LiveSearchSource => item !== null);
    const credits = Number(payload.usage?.credits);

    return {
      sources,
      creditsUsed: Number.isFinite(credits) && credits >= 0 ? credits : 1,
    };
  }

  throw new SearchProviderError('provider_error', 'Tavily search failed after retry.');
}

export async function discoverSourcesWithTavily(
  queries: string[],
  options: {
    apiKey?: string;
    fetchImpl?: FetchLike;
    signal?: AbortSignal;
  } = {},
): Promise<TavilyDiscoveryResult> {
  const apiKey = (options.apiKey ?? process.env.TAVILY_API_KEY ?? '').trim();
  if (!apiKey) {
    throw new SearchProviderError('missing_api_key', 'TAVILY_API_KEY must be configured for live source discovery.');
  }

  const normalizedQueries = [...new Set(
    queries.map(query => String(query || '').trim()).filter(Boolean),
  )].slice(0, MAX_QUERIES_PER_RESEARCH);
  if (normalizedQueries.length === 0) {
    throw new SearchProviderError('invalid_request', 'No valid search queries were provided.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const byUrl = new Map<string, LiveSearchSource>();
  let creditsUsed = 0;

  // Sequential calls keep quota usage predictable and stop immediately on
  // account-level quota errors instead of launching more doomed requests.
  for (const query of normalizedQueries) {
    if (options.signal?.aborted) {
      throw new SearchProviderError('cancelled', 'Search was cancelled.');
    }
    const result = await searchOneQuery(query, apiKey, fetchImpl, options.signal);
    creditsUsed += result.creditsUsed;
    for (const source of result.sources) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
    }
  }

  return {
    sources: [...byUrl.values()],
    queriesRun: normalizedQueries.length,
    creditsUsed,
  };
}
