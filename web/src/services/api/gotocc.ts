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

function validGotoccKey(value: string) {
    return value.startsWith("sk-") && value.length >= 16 && value.length <= 256 && !/\s/.test(value);
}
