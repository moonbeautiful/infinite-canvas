"use client";

import type { Worker } from "tesseract.js";

export type ProductTextIdentity = {
    status: "pass" | "warning" | "error";
    detail: string;
    issue: "none" | "unexpected" | "missing";
};

type OcrToken = {
    text: string;
    confidence: number;
};

let workerPromise: Promise<Worker> | null = null;
let workerQueue = Promise.resolve();
let workerResetPromise = Promise.resolve();
let sourceTokenCache = new WeakMap<File, Promise<OcrToken[]>>();

export function cancelProductIdentityOcr() {
    const activeWorker = workerPromise;
    workerPromise = null;
    workerQueue = Promise.resolve();
    sourceTokenCache = new WeakMap<File, Promise<OcrToken[]>>();
    if (!activeWorker) return;
    workerResetPromise = workerResetPromise
        .then(async () => {
            const worker = await activeWorker;
            await worker.terminate();
        })
        .catch(() => {});
}

export async function auditProductTextIdentity(
    sources: File[],
    resultUrl: string,
    signal?: AbortSignal,
    options: {
        requireSourceText?: boolean;
        missingSourceTextStatus?: "pass" | "warning" | "error";
    } = {},
): Promise<ProductTextIdentity> {
    throwIfAborted(signal);
    const sourceTokenSets = await Promise.all(sources.map((source) => sourceIdentityTokens(source, signal)));
    const sourceTokens = mergeTokens(sourceTokenSets.flat());
    throwIfAborted(signal);
    const resultTokens = await recognizeTokens(resultUrl, signal, 32);
    throwIfAborted(signal);
    const unexpected = resultTokens.filter((resultToken) => resultToken.confidence >= 92 && substantialToken(resultToken.text) && !sourceTokens.some((sourceToken) => tokensMatch(sourceToken.text, resultToken.text)));
    if (unexpected.length) {
        return {
            status: "error",
            detail: `结果新增了原图中没有的文字：${unexpected.map((token) => token.text).join("、")}`,
            issue: "unexpected",
        };
    }
    if (!sourceTokens.length) {
        return {
            status: "pass",
            detail: "原图未检出可核对标识，结果也未检出高置信陌生文字",
            issue: "none",
        };
    }
    const candidates = sourceTokenSets
        .map((tokens) => tokens.filter((token) => token.confidence >= 85 && substantialToken(token.text)))
        .filter((tokens) => tokens.length)
        .map((tokens) => {
            const matched = tokens.filter((sourceToken) => resultTokens.some((resultToken) => tokensMatch(sourceToken.text, resultToken.text)));
            return { tokens, matched, coverage: matched.length / tokens.length };
        })
        .sort((left, right) => right.coverage - left.coverage || right.matched.length - left.matched.length);
    if (!candidates.length) {
        return {
            status: "pass",
            detail: "原图未检出稳定可核对标识，结果也未检出高置信陌生文字",
            issue: "none",
        };
    }
    const { tokens: requiredSourceTokens, matched, coverage } = candidates[0];
    const expected = requiredSourceTokens.map((token) => token.text).join("、");
    const missing = requiredSourceTokens.filter((token) => !matched.includes(token)).map((token) => token.text);
    const missingSourceTextStatus = options.requireSourceText ? "error" : options.missingSourceTextStatus || "pass";
    if (coverage >= 0.6) {
        return {
            status: "pass",
            detail: `保留 ${matched.length}/${requiredSourceTokens.length} 个原图标识：${expected}`,
            issue: "none",
        };
    }
    if (coverage >= 0.4 || matched.length >= 2) {
        return {
            status: options.requireSourceText ? "warning" : missingSourceTextStatus,
            detail: `未检出新增文字；部分原图标识未稳定识别：${missing.join("、") || expected}`,
            issue: "missing",
        };
    }
    if (missingSourceTextStatus === "pass") {
        return {
            status: "pass",
            detail: "当前镜头未稳定检出原图标识，但未发现任何高置信陌生文字",
            issue: "none",
        };
    }
    return {
        status: missingSourceTextStatus,
        detail: `原图可见标识在结果中全部缺失或无法核对：${missing.join("、") || expected}`,
        issue: "missing",
    };
}

function sourceIdentityTokens(file: File, signal?: AbortSignal) {
    const cached = sourceTokenCache.get(file);
    if (cached)
        return cached.then((tokens) => {
            throwIfAborted(signal);
            return tokens;
        });
    const promise = recognizeTokens(file, signal, Number.POSITIVE_INFINITY).catch((error) => {
        sourceTokenCache.delete(file);
        throw error;
    });
    sourceTokenCache.set(file, promise);
    return promise;
}

function recognizeTokens(image: File | string, signal?: AbortSignal, limit = 32) {
    const job = workerQueue.then(async () => {
        throwIfAborted(signal);
        const worker = await getWorker();
        throwIfAborted(signal);
        const prepared = await prepareOcrImage(image, signal);
        const result = await worker.recognize(prepared, {}, { blocks: true, text: true });
        throwIfAborted(signal);
        const words = result.data.blocks?.flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words))) || [];
        const unique = new Map<string, OcrToken>();
        for (const word of words) {
            const text = normalizeToken(word.text);
            if (word.confidence < 65 || text.length < 2 || !/[\p{L}\p{N}]/u.test(text)) continue;
            const current = unique.get(text);
            if (!current || word.confidence > current.confidence) unique.set(text, { text, confidence: word.confidence });
        }
        const tokens = [...unique.values()].sort((left, right) => right.confidence - left.confidence);
        return Number.isFinite(limit) ? tokens.slice(0, limit) : tokens;
    });
    workerQueue = job.then(
        () => undefined,
        () => undefined,
    );
    return job;
}

async function prepareOcrImage(image: File | string, signal?: AbortSignal) {
    const blob = typeof image === "string" ? await (await fetch(image, { signal })).blob() : image;
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(blob);
    const scale = Math.max(1, Math.min(3, 1600 / Math.max(bitmap.width, bitmap.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    const imageHeight = Math.round(bitmap.height * scale);
    canvas.height = imageHeight * 2;
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        throw new Error("无法创建商品文字质检画布");
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, imageHeight);
    bitmap.close();
    const contrast = context.getImageData(0, 0, canvas.width, imageHeight);
    for (let index = 0; index < contrast.data.length; index += 4) {
        const luminance = contrast.data[index] * 0.2126 + contrast.data[index + 1] * 0.7152 + contrast.data[index + 2] * 0.0722;
        const value = luminance >= 150 ? 255 : 0;
        contrast.data[index] = value;
        contrast.data[index + 1] = value;
        contrast.data[index + 2] = value;
    }
    context.putImageData(contrast, 0, imageHeight);
    return canvas;
}

async function getWorker() {
    await workerResetPromise;
    workerPromise ||= import("tesseract.js")
        .then(({ createWorker, OEM, PSM }) =>
            createWorker(["eng", "chi_sim"], OEM.LSTM_ONLY, {
                workerPath: "/ocr/worker.min.js",
                corePath: "/ocr/core",
                langPath: "/ocr/lang",
            }).then(async (worker) => {
                await worker.setParameters({
                    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
                    preserve_interword_spaces: "1",
                    user_defined_dpi: "300",
                });
                return worker;
            }),
        )
        .catch((error) => {
            workerPromise = null;
            throw error;
        });
    return workerPromise;
}

function normalizeToken(value: string) {
    return value
        .normalize("NFKD")
        .toUpperCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
}

function tokensMatch(left: string, right: string) {
    if (left === right) return true;
    if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left))) return true;
    const distance = levenshteinDistance(left, right);
    return distance <= Math.max(1, Math.floor(Math.max(left.length, right.length) * 0.2));
}

function substantialToken(value: string) {
    return /\p{Script=Han}/u.test(value) ? value.length >= 2 : value.length >= 5;
}

function mergeTokens(tokens: OcrToken[]) {
    const unique = new Map<string, OcrToken>();
    for (const token of tokens) {
        const current = unique.get(token.text);
        if (!current || token.confidence > current.confidence) unique.set(token.text, token);
    }
    return [...unique.values()].sort((left, right) => right.confidence - left.confidence);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function levenshteinDistance(left: string, right: string) {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
        const current = [leftIndex];
        for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
            current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1));
        }
        previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
}
