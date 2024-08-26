/**
 * There are slight differences in handling browser and node.js environments.
 * This folder wraps all components that get polyfilled in node.js, as well as
 * allowing uploading a video from the local filesystem on node.js
 */
import { isBlobLike } from '../utils/is-utils';
import { uploadParser } from '../utils/multipart-utils';
import type { Rev } from '../types/rev';


/**
 * used in OAuth - get random verifier string
 * @param byteLength
 */
function randomValues(byteLength: number) {
    const values = crypto.getRandomValues(new Uint8Array(byteLength / 2));
    return Array.from(values)
        .map(c => c.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * sha256 hash function for oauth2 pkce
 * @param value
 * @returns
 */
async function sha256Hash(value: string) {
    const bytes = new TextEncoder().encode(value);
    const hashed = await crypto.subtle.digest('SHA-256', bytes);
    const binary = String.fromCharCode(...(new Uint8Array(hashed)));
    return btoa(binary)
        .replace(/\//g, '_')
        .replace(/\+/g, '-')
        .replace(/=+$/, '');
}


/**
 * used to sign the verifier in OAuth workflow
 */
async function hmacSign(message: string, secret: string) {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle
        .importKey(
            'raw',
            enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            true,
            ['sign']
        );
    const signed = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
    return btoa(String.fromCharCode(...new Uint8Array(signed)));
}

export const polyfills = {
    AbortController: globalThis.AbortController,
    AbortSignal: globalThis.AbortSignal,
    createAbortError(message: string): Error {
        return new DOMException(message, 'AbortError');
    },
    fetch: globalThis.fetch,
    FormData: globalThis.FormData,
    File: globalThis.File,
    Headers: globalThis.Headers,
    Request: globalThis.Request,
    Response: globalThis.Response,
    uploadParser,
    randomValues,
    sha256Hash,
    hmacSign,
    beforeFileUploadRequest(form: FormData, headers: Headers, uploadOptions: Rev.UploadFileOptions, options: Rev.RequestOptions): FormData | undefined {
        return form;
    },
    asPlatformStream<TIn = any, TOut = TIn>(stream: TIn): TOut {
        // nothing - this is used for fixing node's stream response
        return stream as any;
    },
    asWebStream<TIn = any>(stream: TIn): ReadableStream {
        // nothing - this is used for fixing node's stream response
        return stream as any;
    }
}
export default polyfills;

export type RevPolyfills = typeof polyfills;

// logic for overriding polyfills before first network request
type InitializeCallback = (polyfills: RevPolyfills) => Promise<void> | void;
let isPendingInitialize = false;
let initializePromise: Promise<void> | undefined = undefined;
const pendingInitialize: InitializeCallback[] = [];

export function shouldInitialize() {
    return !!isPendingInitialize;
}

export function onInitialize() {
    if (!isPendingInitialize) {
        return;
    }
    
    initializePromise ||= (async () => {
        while (pendingInitialize.length > 0) {
            const pending = pendingInitialize.shift();
            if (typeof pending !== 'function') continue;
            try {
                const overrides = await pending(polyfills);
                Object.assign(polyfills, overrides);
            } catch (error) {
                // ignore
            }
        }
        isPendingInitialize = false;
        initializePromise = undefined;
    })();

    return initializePromise;
}

export function setPolyfills(overrideCallback: (polyfills: RevPolyfills) => Promise<void> | void) {
    pendingInitialize.push(overrideCallback);
    isPendingInitialize = true;
}