import { API_KEYS_URL, OFFICIAL_SITE, PRICING_URL } from './links.js';
const API_PREFIX = '/api/v1';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export class PictostlApiError extends Error {
    errorCode;
    status;
    constructor(message, errorCode, status = 400) {
        super(message);
        this.name = 'PictostlApiError';
        this.errorCode = errorCode;
        this.status = status;
    }
}
export class PictostlClient {
    apiKey;
    apiBase;
    fetchImpl;
    constructor(options) {
        this.apiKey = options.apiKey;
        this.apiBase = (options.apiBase ?? OFFICIAL_SITE).replace(/\/+$/, '');
        this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
    }
    getAccount() {
        return this.requestJson('GET', '/account');
    }
    listOptions() {
        return this.requestJson('GET', '/options');
    }
    createGeneration(body) {
        return this.requestJson('POST', '/generations', body);
    }
    getGeneration(id) {
        return this.requestJson('GET', `/generations/${encodeURIComponent(id)}`);
    }
    listGenerations() {
        return this.requestJson('GET', '/generations');
    }
    async uploadImage(buffer, filename, mimeType) {
        const intent = await this.requestJson('POST', '/uploads/intents', {
            filename,
            mimeType,
            sizeBytes: buffer.byteLength,
        });
        const record = asRecord(intent);
        const id = typeof record.id === 'string' ? record.id : undefined;
        const uploadUrl = typeof record.uploadUrl === 'string' ? record.uploadUrl : undefined;
        if (!id || !uploadUrl) {
            throw new Error('Upload intent did not return id and uploadUrl');
        }
        const putHeaders = headersFromUnknown(record.headers);
        if (!putHeaders.has('Content-Type'))
            putHeaders.set('Content-Type', mimeType);
        await this.putUpload(uploadUrl, buffer, putHeaders);
        const completed = await this.requestJson('POST', `/uploads/${encodeURIComponent(id)}/complete`);
        if (completed && typeof completed === 'object' && !Array.isArray(completed)) {
            const data = completed;
            const completedId = typeof data.id === 'string' ? data.id : id;
            return { ...data, id: completedId, assetId: completedId };
        }
        return { id, assetId: id };
    }
    async downloadGlb(taskId) {
        const url = `${this.apiBase}${API_PREFIX}/assets/${encodeURIComponent(taskId)}?format=glb`;
        const response = await this.fetchFollow(url, true);
        if (!response.ok) {
            throw await errorFromResponse(response);
        }
        return new Uint8Array(await response.arrayBuffer());
    }
    async putUpload(url, buffer, headers) {
        headers.delete('Authorization');
        const body = new Uint8Array(buffer.byteLength);
        body.set(buffer);
        const response = await this.fetchImpl(url, {
            method: 'PUT',
            headers,
            body,
            redirect: 'manual',
        });
        if (response.status >= 400) {
            throw new PictostlApiError(`Upload PUT failed (${response.status})`, undefined, response.status);
        }
    }
    async requestJson(method, path, body) {
        const headers = new Headers({
            Authorization: `Bearer ${this.apiKey}`,
        });
        let payload;
        if (body !== undefined) {
            headers.set('Content-Type', 'application/json');
            payload = JSON.stringify(body);
        }
        const response = await this.fetchImpl(`${this.apiBase}${API_PREFIX}${path}`, {
            method,
            headers,
            body: payload,
            redirect: 'manual',
        });
        const envelope = await readEnvelope(response);
        if (response.status >= 400 || envelope.ok === false) {
            throw errorFromEnvelope(envelope, response.status);
        }
        return envelope.data;
    }
    async fetchFollow(url, authorizeFirst, hops = 0) {
        if (hops > 5)
            throw new Error('Too many redirects');
        const headers = new Headers();
        if (authorizeFirst && isApiV1Url(url, this.apiBase)) {
            headers.set('Authorization', `Bearer ${this.apiKey}`);
        }
        const response = await this.fetchImpl(url, {
            method: 'GET',
            headers,
            redirect: 'manual',
        });
        if (REDIRECT_STATUSES.has(response.status)) {
            const location = response.headers.get('Location');
            if (!location) {
                throw new PictostlApiError(`Redirect missing Location (${response.status})`, undefined, response.status);
            }
            const next = new URL(location, url).toString();
            return this.fetchFollow(next, false, hops + 1);
        }
        return response;
    }
}
function isApiV1Url(url, apiBase) {
    try {
        const target = new URL(url);
        const base = new URL(apiBase);
        return target.host === base.host && target.pathname.startsWith(API_PREFIX);
    }
    catch {
        return false;
    }
}
function asRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function headersFromUnknown(value) {
    const headers = new Headers();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, nested] of Object.entries(value)) {
            if (typeof nested === 'string')
                headers.set(key, nested);
        }
    }
    return headers;
}
async function readEnvelope(response) {
    try {
        return (await response.json());
    }
    catch {
        return {
            ok: false,
            error: { message: `Request failed with status ${response.status}` },
        };
    }
}
function readErrorCode(envelope) {
    const code = envelope.error?.code;
    return typeof code === 'string' ? code : undefined;
}
function readErrorMessage(envelope, status) {
    const message = envelope.error?.message;
    if (typeof message === 'string' && message.trim())
        return message;
    return `Request failed with status ${status}`;
}
function formatErrorMessage(message, errorCode) {
    if (errorCode === 'INVALID_API_KEY' && !message.includes(API_KEYS_URL)) {
        return `${message} ${API_KEYS_URL}`;
    }
    if (errorCode === 'INSUFFICIENT_CREDITS' && !message.includes(PRICING_URL)) {
        return `${message} ${PRICING_URL}`;
    }
    return message;
}
function errorFromEnvelope(envelope, status) {
    const errorCode = readErrorCode(envelope);
    return new PictostlApiError(formatErrorMessage(readErrorMessage(envelope, status), errorCode), errorCode, status);
}
async function errorFromResponse(response) {
    const envelope = await readEnvelope(response);
    return errorFromEnvelope(envelope, response.status);
}
