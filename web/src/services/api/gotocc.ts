"use client";

import { imageToDataUrl } from "@/services/image-storage";

const GOTOCC_CONNECTION_KEY = "linkfox:gotocc-connection-v1";
const allowedModels = ["gpt-image-2", "gpt-image-2-high"] as const;

export type GotoccModel = (typeof allowedModels)[number];
export type GotoccConnection = {
    apiKey: string;
    model: GotoccModel;
    connectedAt: string;
};

export class GotoccGenerationError extends Error {
    retryable: boolean;

    constructor(message: string, retryable: boolean) {
        super(message);
        this.name = "GotoccGenerationError";
        this.retryable = retryable;
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
    const payload = (await response.json().catch(() => null)) as { data?: Array<{ id?: string }>; error?: { message?: string }; msg?: string } | null;
    if (!response.ok) throw new Error(payload?.error?.message || payload?.msg || "gotocc Key 无法使用");
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
    const form = new FormData();
    form.set("model", connection.model);
    form.set("prompt", prompt);
    form.set("size", size);
    form.set("quality", "medium");
    images.forEach((image) => form.append("image", image, image.name || "product.png"));

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
            throw new GotoccGenerationError(payload?.error?.message || payload?.msg || "商品图生成失败", retryable);
        }
        const item = payload?.data?.[0];
        const value = item?.b64_json ? `data:image/png;base64,${item.b64_json}` : item?.url || "";
        if (!value) throw new GotoccGenerationError("gotocc 没有返回商品图，本次不会自动重试", false);
        try {
            return await imageToDataUrl({ dataUrl: value, signal: controller.signal });
        } catch (error) {
            if (error instanceof DOMException && error.name === "AbortError") throw error;
            throw new GotoccGenerationError("商品图读取失败，本次不会自动重试", false);
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            if (signal?.aborted && !timedOut) throw new GotoccGenerationError("已停止生成", false);
            throw new GotoccGenerationError("生成超时，请手动重试；为避免重复扣费，本次不自动重试", false);
        }
        if (error instanceof TypeError) throw new GotoccGenerationError("网络连接中断，结果状态未知；为避免重复扣费，请手动确认后重试", false);
        throw error;
    } finally {
        signal?.removeEventListener("abort", abort);
        window.clearTimeout(timeout);
    }
}

function validGotoccKey(value: string) {
    return value.startsWith("sk-") && value.length >= 16 && value.length <= 256 && !/\s/.test(value);
}
