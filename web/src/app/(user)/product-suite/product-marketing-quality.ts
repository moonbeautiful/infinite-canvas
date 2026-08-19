"use client";

import { auditProductTextIdentity } from "./product-identity-ocr";

export type MarketingQualityStatus = "pending" | "pass" | "warning" | "error";

export type MarketingQualityCheck = {
    id: "dimensions" | "render" | "product-color" | "product-text" | "silhouette" | "marketplace" | "duplicate" | "campaign";
    label: string;
    status: "pass" | "warning" | "error";
    detail: string;
};

export type MarketingQualityReport = {
    status: MarketingQualityStatus;
    score: number;
    summary: string;
    checks: MarketingQualityCheck[];
};

type AuditInput = {
    taskId: string;
    source: File;
    sources: File[];
    resultUrl: string;
    identityUrl?: string;
    expectedSize: string;
    heroUrl?: string;
    signal?: AbortSignal;
    previousResults: Array<{ id: string; label: string; url: string }>;
};

type ImageSample = {
    width: number;
    height: number;
    pixels: Uint8ClampedArray;
    luminance: number[];
    hash: string;
    palette: Array<[number, number, number]>;
    histogram: number[];
};

const sampleSize = 96;
const silhouetteSize = 64;
const sourceSilhouetteCache = new WeakMap<File, Map<string, Promise<SilhouetteSample>>>();
const sourceProductSampleCache = new WeakMap<File, Promise<ImageSample>>();

type SilhouetteSample = {
    mask: Uint8Array;
    edges: Uint8Array;
    interiorEdges: Uint8Array;
    aspect: number;
};

export function pendingQualityReport(): MarketingQualityReport {
    return { status: "pending", score: 0, summary: "等待质检", checks: [] };
}

export async function auditMarketingImage(input: AuditInput): Promise<MarketingQualityReport> {
    throwIfAborted(input.signal);
    const [source, result, hero, previous, sourceProduct] = await Promise.all([
        sampleImage(input.source, input.signal),
        sampleImage(input.resultUrl, input.signal),
        input.heroUrl ? sampleImage(input.heroUrl, input.signal) : Promise.resolve(null),
        Promise.all(input.previousResults.map(async (item) => ({ ...item, sample: await sampleImage(item.url, input.signal) }))),
        sourceProductSample(input.source, input.signal).catch(() => null),
    ]);
    throwIfAborted(input.signal);
    const checks: MarketingQualityCheck[] = [];

    const [expectedWidth, expectedHeight] = input.expectedSize.split("x").map(Number);
    const expectedRatio = expectedWidth / expectedHeight;
    const ratioDelta = Math.abs(result.width / result.height - expectedRatio) / expectedRatio;
    const dimensionsMatch = result.width === expectedWidth && result.height === expectedHeight;
    checks.push({
        id: "dimensions",
        label: "画幅",
        status: dimensionsMatch && ratioDelta <= 0.025 ? "pass" : "error",
        detail: dimensionsMatch && ratioDelta <= 0.025 ? `${result.width}×${result.height}` : `返回尺寸 ${result.width}×${result.height}，任务要求 ${expectedWidth}×${expectedHeight}`,
    });

    const sortedLuminance = [...result.luminance].sort((a, b) => a - b);
    const dynamicRange = percentile(sortedLuminance, 0.95) - percentile(sortedLuminance, 0.05);
    checks.push({
        id: "render",
        label: "有效成像",
        status: dynamicRange >= 24 ? "pass" : "error",
        detail: dynamicRange >= 24 ? "图片包含有效明暗与细节" : "图片接近空白、纯色或损坏",
    });

    const productPalette = sourceProduct?.palette || source.palette;
    const productColorCoverage = paletteCoverage(result.pixels, productPalette);
    const colorStatus = !productPalette.length ? "warning" : productColorCoverage >= 0.012 ? "pass" : productColorCoverage >= 0.005 ? "warning" : "error";
    checks.push({
        id: "product-color",
        label: "商品颜色证据",
        status: colorStatus,
        detail: !productPalette.length ? "商品主体取色不可用，已由结构质检兜底" : `商品主体主色在结果中占比 ${Math.round(productColorCoverage * 1000) / 10}%`,
    });

    if (["hero", "marketplace", "feature", "lifestyle", "detail", "aplus", "banner", "poster"].includes(input.taskId)) {
        try {
            const primarySubjectOnly = ["feature", "detail", "aplus"].includes(input.taskId);
            const [sourceShape, resultShape] = await Promise.all([sourceSilhouette(input.source, primarySubjectOnly, input.signal), resultSilhouette(input.resultUrl, primarySubjectOnly, input.signal)]);
            throwIfAborted(input.signal);
            const direct = maskIou(sourceShape.mask, resultShape.mask, false);
            const mirrored = maskIou(sourceShape.mask, resultShape.mask, true);
            const detailSimilarity = edgeSimilarity(sourceShape.edges, resultShape.edges, false);
            const mirroredDetails = edgeSimilarity(sourceShape.edges, resultShape.edges, true);
            const salientDetails = salientEdgeSimilarity(sourceShape.interiorEdges, resultShape.interiorEdges, false);
            const aspectDelta = Math.abs(sourceShape.aspect - resultShape.aspect) / Math.max(0.01, sourceShape.aspect);
            const isMirrored = mirrored > direct + 0.07 && mirroredDetails > detailSimilarity + 0.06 && mirrored >= 0.42;
            const identityDetailError = salientDetails.sampleCount >= 4 && salientDetails.lowerQuartile < 0.05;
            const identityDetailWarning = !identityDetailError && salientDetails.sampleCount >= 4 && salientDetails.lowerQuartile < 0.12;
            const geometryError = isMirrored || direct < 0.26 || detailSimilarity < 0.08 || aspectDelta > 0.55 || identityDetailError;
            const geometryWarning = !geometryError && (direct < 0.4 || detailSimilarity < 0.18 || aspectDelta > 0.32 || identityDetailWarning);
            checks.push({
                id: "silhouette",
                label: "主体结构与方向",
                status: geometryError ? "error" : geometryWarning ? "warning" : "pass",
                detail: isMirrored
                    ? "结果主体疑似被镜像"
                    : `轮廓 ${Math.round(direct * 100)}%，结构细节 ${Math.round(detailSimilarity * 100)}%，内部标识与部件 ${Math.round(salientDetails.average * 100)}% / ${Math.round(salientDetails.lowerQuartile * 100)}%，比例偏差 ${Math.round(aspectDelta * 100)}%`,
            });
        } catch {
            checks.push({
                id: "silhouette",
                label: "主体结构与方向",
                status: "error",
                detail: "本地主体结构质检不可用，不能作为完整交付",
            });
        }
    }

    try {
        const identity = await auditProductTextIdentity(input.sources, input.identityUrl || input.resultUrl, input.signal);
        throwIfAborted(input.signal);
        checks.push({
            id: "product-text",
            label: "商品文字与标识",
            status: identity.status,
            detail: identity.detail,
        });
    } catch {
        checks.push({
            id: "product-text",
            label: "商品文字与标识",
            status: "error",
            detail: "本地文字标识质检不可用，不能作为完整交付",
        });
    }

    if (input.taskId === "marketplace") {
        const borderWhite = whiteBorderRatio(result.pixels);
        const nonWhite = nonWhiteRatio(result.pixels);
        const marketplacePass = borderWhite >= 0.86 && nonWhite >= 0.12 && nonWhite <= 0.78;
        checks.push({
            id: "marketplace",
            label: "白底规范",
            status: marketplacePass ? "pass" : "error",
            detail: marketplacePass ? `边缘白底 ${Math.round(borderWhite * 100)}%，主体占比 ${Math.round(nonWhite * 100)}%` : "背景不够纯白、主体过小或触碰画布边缘",
        });
    }

    const duplicate = previous.find((item) => hammingDistance(result.hash, item.sample.hash) <= 2 && pixelDifference(result.pixels, item.sample.pixels) <= 0.035);
    checks.push({
        id: "duplicate",
        label: "任务差异",
        status: duplicate ? "error" : "pass",
        detail: duplicate ? `与“${duplicate.label}”几乎重复` : "未发现与已完成任务重复",
    });

    if (hero && ["feature", "lifestyle", "detail", "aplus", "banner", "poster"].includes(input.taskId)) {
        const similarity = cosineSimilarity(result.histogram, hero.histogram);
        checks.push({
            id: "campaign",
            label: "整套风格",
            status: similarity >= 0.28 ? "pass" : similarity >= 0.16 ? "warning" : "error",
            detail: `与品牌主视觉的色彩/明暗关联 ${Math.round(similarity * 100)}%`,
        });
    }

    const errors = checks.filter((check) => check.status === "error");
    const warnings = checks.filter((check) => check.status === "warning");
    const score = Math.max(0, 100 - errors.length * 35 - warnings.length * 12);
    const status: MarketingQualityStatus = errors.length ? "error" : warnings.length ? "warning" : "pass";
    const summary = errors.length ? errors.map((check) => check.detail).join("；") : warnings.length ? warnings.map((check) => check.detail).join("；") : "自动质检通过";
    return { status, score, summary, checks };
}

async function sampleImage(source: Blob | string, signal?: AbortSignal): Promise<ImageSample> {
    const blob = typeof source === "string" ? await (await fetch(source, { signal })).blob() : source;
    throwIfAborted(signal);
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        bitmap.close();
        throw new Error("浏览器无法执行图片质检");
    }
    context.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
    const pixels = context.getImageData(0, 0, sampleSize, sampleSize).data;
    const luminance: number[] = [];
    for (let index = 0; index < pixels.length; index += 4) {
        luminance.push(pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722);
    }
    const sample = {
        width: bitmap.width,
        height: bitmap.height,
        pixels,
        luminance,
        hash: averageHash(luminance),
        palette: extractPalette(pixels),
        histogram: colorHistogram(pixels),
    };
    bitmap.close();
    return sample;
}

function extractPalette(pixels: Uint8ClampedArray) {
    const counts = new Map<number, number>();
    for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        if (pixels[index + 3] < 96) continue;
        const key = (Math.min(7, Math.round(r / 32)) << 6) | (Math.min(7, Math.round(g / 32)) << 3) | Math.min(7, Math.round(b / 32));
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key]) => [((key >> 6) & 7) * 32, ((key >> 3) & 7) * 32, (key & 7) * 32] as [number, number, number]);
}

async function sourceProductSample(file: File, signal?: AbortSignal) {
    const cached = sourceProductSampleCache.get(file);
    if (cached)
        return cached.then((sample) => {
            throwIfAborted(signal);
            return sample;
        });
    const promise = fileToDataUrl(file)
        .then(async (dataUrl) => {
            const { extractProductWithAi } = await import("./product-compositor");
            const cutout = await extractProductWithAi(dataUrl, undefined, 54, signal);
            return sampleImage(cutout.dataUrl, signal);
        })
        .catch((error) => {
            sourceProductSampleCache.delete(file);
            throw error;
        });
    sourceProductSampleCache.set(file, promise);
    return promise;
}

function paletteCoverage(pixels: Uint8ClampedArray, palette: Array<[number, number, number]>) {
    if (!palette.length) return 0;
    let matches = 0;
    const total = pixels.length / 4;
    for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        if (palette.some(([pr, pg, pb]) => Math.hypot(r - pr, g - pg, b - pb) <= 68)) matches += 1;
    }
    return matches / total;
}

function whiteBorderRatio(pixels: Uint8ClampedArray) {
    let white = 0;
    let total = 0;
    for (let y = 0; y < sampleSize; y += 1) {
        for (let x = 0; x < sampleSize; x += 1) {
            if (x > 7 && x < sampleSize - 8 && y > 7 && y < sampleSize - 8) continue;
            const index = (y * sampleSize + x) * 4;
            total += 1;
            if (pixels[index] >= 238 && pixels[index + 1] >= 238 && pixels[index + 2] >= 238) white += 1;
        }
    }
    return white / Math.max(1, total);
}

function nonWhiteRatio(pixels: Uint8ClampedArray) {
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 238 || pixels[index + 1] < 238 || pixels[index + 2] < 238) count += 1;
    }
    return count / Math.max(1, pixels.length / 4);
}

function averageHash(luminance: number[]) {
    const values: number[] = [];
    for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
            values.push(luminance[Math.floor((y + 0.5) * (sampleSize / 8)) * sampleSize + Math.floor((x + 0.5) * (sampleSize / 8))]);
        }
    }
    const average = values.reduce((sum, value) => sum + value, 0) / values.length;
    return values.map((value) => (value >= average ? "1" : "0")).join("");
}

function colorHistogram(pixels: Uint8ClampedArray) {
    const histogram = new Array<number>(64).fill(0);
    for (let index = 0; index < pixels.length; index += 4) {
        const r = Math.min(3, Math.floor(pixels[index] / 64));
        const g = Math.min(3, Math.floor(pixels[index + 1] / 64));
        const b = Math.min(3, Math.floor(pixels[index + 2] / 64));
        histogram[r * 16 + g * 4 + b] += 1;
    }
    return histogram;
}

function cosineSimilarity(left: number[], right: number[]) {
    let dot = 0;
    let leftLength = 0;
    let rightLength = 0;
    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftLength += left[index] ** 2;
        rightLength += right[index] ** 2;
    }
    return dot / Math.max(1, Math.sqrt(leftLength * rightLength));
}

function hammingDistance(left: string, right: string) {
    let count = 0;
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        if (left[index] !== right[index]) count += 1;
    }
    return count;
}

function pixelDifference(left: Uint8ClampedArray, right: Uint8ClampedArray) {
    const length = Math.min(left.length, right.length);
    let difference = 0;
    for (let index = 0; index < length; index += 4) {
        difference += Math.abs(left[index] - right[index]);
        difference += Math.abs(left[index + 1] - right[index + 1]);
        difference += Math.abs(left[index + 2] - right[index + 2]);
    }
    return difference / Math.max(1, (length / 4) * 3 * 255);
}

function percentile(values: number[], ratio: number) {
    return values[Math.min(values.length - 1, Math.max(0, Math.floor(values.length * ratio)))] || 0;
}

function sourceSilhouette(file: File, primarySubjectOnly: boolean, signal?: AbortSignal) {
    const key = primarySubjectOnly ? "primary" : "full";
    const cache = sourceSilhouetteCache.get(file) || new Map<string, Promise<SilhouetteSample>>();
    const cached = cache.get(key);
    if (cached)
        return cached.then((sample) => {
            throwIfAborted(signal);
            return sample;
        });
    const promise = fileToDataUrl(file)
        .then((dataUrl) => extractSilhouette(dataUrl, primarySubjectOnly, signal))
        .catch((error) => {
            cache.delete(key);
            if (!cache.size) sourceSilhouetteCache.delete(file);
            throw error;
        });
    cache.set(key, promise);
    sourceSilhouetteCache.set(file, cache);
    return promise;
}

function resultSilhouette(dataUrl: string, primarySubjectOnly: boolean, signal?: AbortSignal) {
    return extractSilhouette(dataUrl, primarySubjectOnly, signal);
}

async function extractSilhouette(dataUrl: string, primarySubjectOnly = false, signal?: AbortSignal): Promise<SilhouetteSample> {
    const { extractProductWithAi } = await import("./product-compositor");
    const cutout = await extractProductWithAi(dataUrl, undefined, 54, signal);
    throwIfAborted(signal);
    const image = await loadHtmlImage(cutout.dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = silhouetteSize;
    canvas.height = silhouetteSize;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法创建轮廓质检画布");
    const scale = Math.min((silhouetteSize - 4) / image.naturalWidth, (silhouetteSize - 4) / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const x = Math.floor((silhouetteSize - width) / 2);
    const y = Math.floor((silhouetteSize - height) / 2);
    context.drawImage(image, x, y, width, height);
    const pixels = context.getImageData(0, 0, silhouetteSize, silhouetteSize).data;
    const mask = new Uint8Array(silhouetteSize * silhouetteSize);
    for (let index = 0; index < mask.length; index += 1) mask[index] = pixels[index * 4 + 3] >= 96 ? 1 : 0;
    if (primarySubjectOnly) {
        return normalizePrimarySubject(pixels, largestConnectedComponent(mask));
    }
    const subjectMask = mask;
    const bounds = maskBounds(subjectMask);
    return {
        mask: subjectMask,
        edges: edgeMap(pixels, subjectMask),
        interiorEdges: interiorEdgeMap(pixels, subjectMask),
        aspect: bounds.width / Math.max(1, bounds.height),
    };
}

function normalizePrimarySubject(pixels: Uint8ClampedArray, subjectMask: Uint8Array): SilhouetteSample {
    const bounds = maskBounds(subjectMask);
    const source = document.createElement("canvas");
    source.width = silhouetteSize;
    source.height = silhouetteSize;
    const sourceContext = source.getContext("2d", { willReadFrequently: true });
    const output = document.createElement("canvas");
    output.width = silhouetteSize;
    output.height = silhouetteSize;
    const outputContext = output.getContext("2d", { willReadFrequently: true });
    if (!sourceContext || !outputContext) throw new Error("无法规范化主体质检区域");

    const isolated = new Uint8ClampedArray(pixels);
    for (let index = 0; index < subjectMask.length; index += 1) {
        if (!subjectMask[index]) isolated[index * 4 + 3] = 0;
    }
    sourceContext.putImageData(new ImageData(isolated, silhouetteSize, silhouetteSize), 0, 0);
    const scale = Math.min((silhouetteSize - 4) / bounds.width, (silhouetteSize - 4) / bounds.height);
    const width = Math.max(1, Math.round(bounds.width * scale));
    const height = Math.max(1, Math.round(bounds.height * scale));
    outputContext.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, Math.floor((silhouetteSize - width) / 2), Math.floor((silhouetteSize - height) / 2), width, height);
    const normalizedPixels = outputContext.getImageData(0, 0, silhouetteSize, silhouetteSize).data;
    const normalizedMask = new Uint8Array(subjectMask.length);
    for (let index = 0; index < normalizedMask.length; index += 1) normalizedMask[index] = normalizedPixels[index * 4 + 3] >= 96 ? 1 : 0;
    return {
        mask: normalizedMask,
        edges: edgeMap(normalizedPixels, normalizedMask),
        interiorEdges: interiorEdgeMap(normalizedPixels, normalizedMask),
        aspect: bounds.width / Math.max(1, bounds.height),
    };
}

function largestConnectedComponent(mask: Uint8Array) {
    const visited = new Uint8Array(mask.length);
    let largest: number[] = [];
    for (let start = 0; start < mask.length; start += 1) {
        if (!mask[start] || visited[start]) continue;
        const component: number[] = [];
        const queue = [start];
        visited[start] = 1;
        for (let head = 0; head < queue.length; head += 1) {
            const index = queue[head];
            component.push(index);
            const x = index % silhouetteSize;
            const y = Math.floor(index / silhouetteSize);
            for (const neighbor of [x > 0 ? index - 1 : -1, x < silhouetteSize - 1 ? index + 1 : -1, y > 0 ? index - silhouetteSize : -1, y < silhouetteSize - 1 ? index + silhouetteSize : -1]) {
                if (neighbor >= 0 && mask[neighbor] && !visited[neighbor]) {
                    visited[neighbor] = 1;
                    queue.push(neighbor);
                }
            }
        }
        if (component.length > largest.length) largest = component;
    }
    if (!largest.length) return mask;
    const result = new Uint8Array(mask.length);
    largest.forEach((index) => {
        result[index] = 1;
    });
    return result;
}

function maskBounds(mask: Uint8Array) {
    let minX = silhouetteSize;
    let minY = silhouetteSize;
    let maxX = -1;
    let maxY = -1;
    for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) continue;
        const x = index % silhouetteSize;
        const y = Math.floor(index / silhouetteSize);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return maxX < minX || maxY < minY ? { x: 0, y: 0, width: silhouetteSize, height: silhouetteSize } : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function maskIou(source: Uint8Array, result: Uint8Array, mirrorResult: boolean) {
    let intersection = 0;
    let union = 0;
    for (let y = 0; y < silhouetteSize; y += 1) {
        for (let x = 0; x < silhouetteSize; x += 1) {
            const sourceValue = source[y * silhouetteSize + x];
            const resultX = mirrorResult ? silhouetteSize - 1 - x : x;
            const resultValue = result[y * silhouetteSize + resultX];
            if (sourceValue && resultValue) intersection += 1;
            if (sourceValue || resultValue) union += 1;
        }
    }
    return intersection / Math.max(1, union);
}

function edgeMap(pixels: Uint8ClampedArray, mask: Uint8Array) {
    const gray = new Uint8Array(silhouetteSize * silhouetteSize);
    for (let index = 0; index < gray.length; index += 1) {
        if (!mask[index]) continue;
        gray[index] = Math.round(pixels[index * 4] * 0.2126 + pixels[index * 4 + 1] * 0.7152 + pixels[index * 4 + 2] * 0.0722);
    }
    const edges = new Uint8Array(gray.length);
    for (let y = 1; y < silhouetteSize - 1; y += 1) {
        for (let x = 1; x < silhouetteSize - 1; x += 1) {
            const index = y * silhouetteSize + x;
            const horizontal = Math.abs(gray[index + 1] - gray[index - 1]);
            const vertical = Math.abs(gray[index + silhouetteSize] - gray[index - silhouetteSize]);
            edges[index] = Math.min(255, horizontal + vertical);
        }
    }
    return edges;
}

function interiorEdgeMap(pixels: Uint8ClampedArray, mask: Uint8Array) {
    const edges = edgeMap(pixels, mask);
    for (let y = 1; y < silhouetteSize - 1; y += 1) {
        for (let x = 1; x < silhouetteSize - 1; x += 1) {
            const index = y * silhouetteSize + x;
            if (!mask[index] || !mask[index - 1] || !mask[index + 1] || !mask[index - silhouetteSize] || !mask[index + silhouetteSize]) {
                edges[index] = 0;
            }
        }
    }
    return edges;
}

function edgeSimilarity(source: Uint8Array, result: Uint8Array, mirrorResult: boolean) {
    let dot = 0;
    let sourceLength = 0;
    let resultLength = 0;
    for (let y = 0; y < silhouetteSize; y += 1) {
        for (let x = 0; x < silhouetteSize; x += 1) {
            const sourceValue = source[y * silhouetteSize + x];
            const resultX = mirrorResult ? silhouetteSize - 1 - x : x;
            const resultValue = result[y * silhouetteSize + resultX];
            dot += sourceValue * resultValue;
            sourceLength += sourceValue ** 2;
            resultLength += resultValue ** 2;
        }
    }
    return dot / Math.max(1, Math.sqrt(sourceLength * resultLength));
}

function salientEdgeSimilarity(source: Uint8Array, result: Uint8Array, mirrorResult: boolean) {
    const blockSize = 8;
    const blocks: Array<{ energy: number; score: number }> = [];
    for (let blockY = 0; blockY < silhouetteSize; blockY += blockSize) {
        for (let blockX = 0; blockX < silhouetteSize; blockX += blockSize) {
            let dot = 0;
            let sourceLength = 0;
            let resultLength = 0;
            for (let y = blockY; y < blockY + blockSize; y += 1) {
                for (let x = blockX; x < blockX + blockSize; x += 1) {
                    const sourceValue = source[y * silhouetteSize + x];
                    const resultX = mirrorResult ? silhouetteSize - 1 - x : x;
                    const resultValue = result[y * silhouetteSize + resultX];
                    dot += sourceValue * resultValue;
                    sourceLength += sourceValue ** 2;
                    resultLength += resultValue ** 2;
                }
            }
            if (sourceLength < 1_600) continue;
            blocks.push({
                energy: sourceLength,
                score: dot / Math.max(1, Math.sqrt(sourceLength * resultLength)),
            });
        }
    }
    const salient = blocks.sort((left, right) => right.energy - left.energy).slice(0, 20);
    if (!salient.length) return { average: 0, lowerQuartile: 0, sampleCount: 0 };
    const scores = salient.map((block) => block.score).sort((left, right) => left - right);
    return {
        average: scores.reduce((sum, score) => sum + score, 0) / scores.length,
        lowerQuartile: scores[Math.floor((scores.length - 1) * 0.25)] || 0,
        sampleCount: scores.length,
    };
}

function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("无法读取商品原图"));
        reader.readAsDataURL(file);
    });
}

function loadHtmlImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("无法读取商品轮廓"));
        image.src = src;
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
