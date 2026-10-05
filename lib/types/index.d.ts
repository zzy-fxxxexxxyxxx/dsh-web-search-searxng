import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web';
export declare const name: string;
export declare const inject: readonly string[];
export declare const Config: unknown;
export declare function apply(ctx: unknown, config: unknown): void;
export declare function toISODate(value: unknown): string | undefined;
export declare function toSource(result: unknown): WebSearchSource | undefined;
export declare function normalizeBaseURL(value: string): string;
export declare class SearxngSearchProvider implements WebSearchProvider {
    readonly id: string;
    constructor(resolveOptions: () => unknown);
    available(): boolean;
    search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>;
}
