"use client";

import { imageToDataUrl } from "@/services/image-storage";

const GOTOCC_CONNECTION_KEY = "linkfox:gotocc-connection-v1";
const allowedModels = ["gpt-image-2", "gpt-image-2-high"] as const;
const preparedReferenceCache = new WeakMap<File, Promise<File>>();
const referenceMaxDimension = 1024;
const referenceMaxBytes = 1024 * 1024;

export type GotoccModel = (typeof allowedModels)[number];
export type GotoccConnection = {
    apiKey: string;
    model: GotoccModel;
    connectedAt: string;
};

export class GotoccGenerationError extends Error {
    retryable: boolean;
    upstreamStateUnknown: boolean;

    constructor(message: string, retryable: boolean, upstreamStateUnknown = false) {
        super(message);
        this.name = "GotoccGenerationError";
        this.retryable = retryable;
        this.upstreamStateUnknown = upstreamStateUnknown;
    }
}

export class GotoccConnectionError extends Error {
    clearSavedKey: boolean;
    status: number;

    constructor(message: string, status: number, clearSavedKey = false) {
        super(message);
        this.name = "GotoccConnectionError";
        this.status = status;
        this.clearSavedKey = clearSavedKey;
    }
}

export function loadGotoccConnection(): GotoccConnection | null {
    if (typeof window === "undefined") return null;
    try {
        const value = JSON.parse(window.localStorage.getItem(GOTOCC_CONNECTION_KEY) || "null") as Partial<GotoccConnection> | null;
        if (!value?.apiKey || !validGotoccKey(value.apiKey)) return null;
        return {
            apiKey: value.apiKey,
            model: allowedModels.includes(value.model as GotoccModel) ? (value.model as GotoccModel) : "gpt-image-2",
            connectedAt: value.connectedAt || new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

export function saveGotoccConnection(connection: GotoccConnection) {
    window.localStorage.setItem(GOTOCC_CONNECTION_KEY, JSON.stringify(connection));
}

export function clearGotoccConnection() {
    window.localStorage.removeItem(GOTOCC_CONNECTION_KEY);
}

export async function testGotoccConnection(apiKey: string) {
    const key = apiKey.trim();
    if (!validGotoccKey(key)) throw new Error("请输入以 sk- 开头的 gotocc Key");
    const response = await fetch("/api/gotocc/models", {
        headers: { "X-Gotocc-API-Key": key },
        cache: "no-store",
    });
    const responseText = await response.text();
    const payload = (() => {
        try {
            return JSON.parse(responseText) as { data?: Array<{ id?: string }>; error?: { message?: string }; msg?: string; message?: string };
        } catch {
            return null;
        }
    })();
    if (!response.ok) {
        const upstreamMessage = payload?.error?.message || payload?.msg || payload?.message;
        const authenticationFailed = response.status === 401 && Boolean(payload);
        throw new GotoccConnectionError(upstreamMessage || (authenticationFailed ? "gotocc Key 无法使用" : `gotocc 连接服务暂时不可用（${response.status}），请稍后重试`), response.status, authenticationFailed);
    }
    const models = (payload?.data || []).map((item) => item.id || "").filter(Boolean);
    if (!models.includes("gpt-image-2")) throw new Error("这把 Key 不属于 GPT Image 2 生图分组");
    return models.filter((model): model is GotoccModel => allowedModels.includes(model as GotoccModel));
}

export async function generateGotoccBackground(connection: GotoccConnection, prompt: string, size: string) {
    const response = await fetch("/api/gotocc/images/generations", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Gotocc-API-Key": connection.apiKey,
        },
        body: JSON.stringify({
            model: connection.model,
            prompt,
            size,
            quality: "medium",
            n: 1,
        }),
    });
    const payload = (await response.json().catch(() => null)) as {
        data?: Array<{ url?: string; b64_json?: string }>;
        error?: { message?: string };
        msg?: string;
    } | null;
    if (!response.ok) throw new Error(payload?.error?.message || payload?.msg || "gotocc 生图失败");
    const item = payload?.data?.[0];
    const value = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url || "";
    if (!value) throw new Error("gotocc 没有返回背景图");
    return imageToDataUrl({ dataUrl: value });
}

export async function generateGotoccProductImage(connection: GotoccConnection, images: File[], prompt: string, size: string, signal?: AbortSignal) {
    if (!images.length || images.length > 4) throw new Error("请上传 1 至 4 张商品图片");
    const references = await Promise.all(images.map((image) => prepareGotoccReference(image, signal)));
    throwIfAborted(signal);
    const form = new FormData();
    form.set("model", connection.model);
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("quality", connection.model === "gpt-image-2-high" ? "high" : "medium");
    references.forEach((image) => form.append("image", image, image.name || "product.webp"));

    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 180_000);
    try {
        const response = await fetch("/api/gotocc/images/edits", {
            method: "POST",
            headers: { "X-Gotocc-API-Key": connection.apiKey },
            body: form,
            signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as {
            data?: Array<{ url?: string; b64_json?: string }>;
            error?: { message?: string };
            msg?: string;
        } | null;
        if (!response.ok) {
            const retryable = response.status === 425 || response.status === 429;
            const upstreamStateUnknown = response.headers.get("X-Upstream-State") === "unknown";
            throw new GotoccGenerationError(payload?.error?.message || payload?.msg || "商品图生成失败", retryable, upstreamStateUnknown);
        }
        const item = payload?.data?.[0];
        const value = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url || "";
        if (!value) throw new GotoccGenerationError("gotocc 没有返回商品图；付费状态可能已产生，请先核对 gotocc 记录", false, true);
        try {
            return await imageToDataUrl({ dataUrl: value, signal: controller.signal });
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new GotoccGenerationError("付费结果读取失败，请先核对 gotocc 记录再决定是否重试", false, true);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            if (signal?.aborted && !timedOut) throw new GotoccGenerationError("已停止生成，上游结果状态未知", false, true);
            throw new GotoccGenerationError("生成超时，上游结果状态未知；请先确认 gotocc 记录，为避免重复扣费本次不自动重试", false, true);
        }
        if (error instanceof TypeError) throw new GotoccGenerationError("网络连接中断，结果状态未知；为避免重复扣费，请手动确认后重试", false, true);
        throw error;
    } finally {
        signal?.removeEventListener("abort", abort);
        window.clearTimeout(timeout);
    }
}

function validGotoccKey(value: string) {
    return value.startsWith("sk-") && value.length >= 16 && value.length <= 256 && !/\s/.test(value);
}

function prepareGotoccReference(file: File, signal?: AbortSignal) {
    const cached = preparedReferenceCache.get(file);
    if (cached)
        return cached.then((reference) => {
            throwIfAborted(signal);
            return reference;
        });
    const promise = resizeGotoccReference(file, signal).catch((error) => {
        preparedReferenceCache.delete(file);
        throw error;
    });
    preparedReferenceCache.set(file, promise);
    return promise;
}

async function resizeGotoccReference(file: File, signal?: AbortSignal) {
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(file);
    throwIfAborted(signal);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= referenceMaxDimension && file.size <= referenceMaxBytes) {
        bitmap.close();
        return file;
    }

    const scale = Math.min(1, referenceMaxDimension / Math.max(1, longestSide));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        return file;
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    throwIfAborted(signal);

    let blob = await canvasToBlob(canvas, "image/webp", 0.9);
    if (blob.size > referenceMaxBytes) blob = await canvasToBlob(canvas, "image/webp", 0.78);
    throwIfAborted(signal);
    return new File([blob], `${stripExtension(file.name) || "product"}-reference.webp`, {
        type: "image/webp",
        lastModified: file.lastModified,
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("商品参考图压缩失败"))), type, quality);
    });
}

function stripExtension(value: string) {
    return value.replace(/\.[^.]+$/, "");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
