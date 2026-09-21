export interface PictostlClientOptions {
    apiKey: string;
    apiBase?: string;
    fetchImpl?: typeof fetch;
}
export declare class PictostlApiError extends Error {
    readonly errorCode?: string;
    readonly status: number;
    constructor(message: string, errorCode?: string, status?: number);
}
export declare class PictostlClient {
    private readonly apiKey;
    private readonly apiBase;
    private readonly fetchImpl;
    constructor(options: PictostlClientOptions);
    getAccount(): Promise<unknown>;
    listOptions(): Promise<unknown>;
    createGeneration(body: unknown): Promise<unknown>;
    getGeneration(id: string): Promise<unknown>;
    listGenerations(): Promise<unknown>;
    uploadImage(buffer: Uint8Array, filename: string, mimeType: string): Promise<{
        id: string;
        assetId: string;
    }>;
    downloadGlb(taskId: string): Promise<Uint8Array<ArrayBuffer>>;
    private putUpload;
    private requestJson;
    private fetchFollow;
}
