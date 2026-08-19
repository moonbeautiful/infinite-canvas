"use client";

import type { MarketingTaskDefinition } from "./product-marketing-plan";

const referenceCutoutCache = new WeakMap<File, string>();
const referenceDescriptorCache = new WeakMap<File, Omit<ReferenceDescriptor, "index">>();

export type ReferenceDescriptor = {
    index: number;
    signature: number[];
    sharpness: number;
    colorHistogram?: number[];
    aspect?: number;
};

export type ProductReferenceSelection = {
    files: File[];
    evidenceFiles: File[];
    distinctViewCount: number;
};

export function rankDiverseReferenceIndices(descriptors: ReferenceDescriptor[], task: Pick<MarketingTaskDefinition, "identityPolicy">, limit = 2) {
    const primary = descriptors.find((item) => item.index === 0);
    const candidates = descriptors.filter((item) => item.index !== 0);
    if (!primary || !candidates.length || limit <= 0) return [];

    const selected: ReferenceDescriptor[] = [];
    while (selected.length < Math.min(limit, candidates.length)) {
        const remaining = candidates.filter((candidate) => !selected.some((item) => item.index === candidate.index));
        const sharpnessValues = candidates.map((candidate) => candidate.sharpness);
        const minSharpness = Math.min(...sharpnessValues);
        const sharpnessRange = Math.max(1, Math.max(...sharpnessValues) - minSharpness);

        const next = remaining
            .map((candidate) => {
                const anchors = [primary, ...selected];
                const diversity = Math.min(...anchors.map((anchor) => descriptorDistance(candidate, anchor)));
                const sharpness = (candidate.sharpness - minSharpness) / sharpnessRange;
                const detailBias = task.identityPolicy === "detail-crop" ? sharpness * 0.45 : sharpness * 0.08;
                return {
                    candidate,
                    score: diversity + detailBias,
                };
            })
            .sort((left, right) => right.score - left.score || left.candidate.index - right.candidate.index)[0]?.candidate;

        if (!next) break;
        selected.push(next);
    }

    return selected.map((item) => item.index);
}

export function countDistinctReferenceViews(descriptors: ReferenceDescriptor[], selectedIndices: number[], threshold = 0.12) {
    const selectedDescriptors = [descriptors.find((item) => item.index === 0), ...selectedIndices.map((index) => descriptors.find((item) => item.index === index))].filter((item): item is ReferenceDescriptor => Boolean(item));
    const accepted: ReferenceDescriptor[] = [];
    selectedDescriptors.forEach((descriptor) => {
        if (!accepted.length || Math.min(...accepted.map((current) => descriptorDistance(descriptor, current))) >= threshold) {
            accepted.push(descriptor);
        }
    });
    return accepted.length;
}

export function referenceIdentityCompatible(primary: ReferenceDescriptor, candidate: ReferenceDescriptor, maximumDistance = 0.62) {
    const structureDistance = descriptorDistance(primary, candidate);
    const colorDistance = histogramDistance(primary.colorHistogram, candidate.colorHistogram);
    const aspectDistance = primary.aspect && candidate.aspect ? Math.abs(Math.log(primary.aspect / candidate.aspect)) : 0;

    const strongStructureConflict = structureDistance > maximumDistance;
    const strongColorConflict = colorDistance !== null && colorDistance > 0.42;
    const corroboratedShapeConflict = aspectDistance > 0.7 && structureDistance > 0.34;

    return !(strongStructureConflict || strongColorConflict || corroboratedShapeConflict);
}

export async function selectDiverseProductReferences(files: File[], task: Pick<MarketingTaskDefinition, "identityPolicy">, signal?: AbortSignal) {
    if (files.length <= 1 || task.identityPolicy === "source-locked") {
        return {
            files: files.slice(0, 1),
            evidenceFiles: files.slice(0, 1),
            distinctViewCount: files.length ? 1 : 0,
        };
    }

    let descriptors: ReferenceDescriptor[];
    try {
        descriptors = (
            await Promise.all(
                files.map((file, index) =>
                    describeReference(file, index, signal).catch((error) => {
                        if (error instanceof DOMException && error.name === "AbortError") {
                            throw error;
                        }
                        return null;
                    }),
                ),
            )
        ).filter((descriptor): descriptor is ReferenceDescriptor => descriptor !== null);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
            throw error;
        }
        return {
            files: files.slice(0, 1),
            evidenceFiles: files.slice(0, 1),
            distinctViewCount: files.length ? 1 : 0,
        };
    }
    const primary = descriptors.find((item) => item.index === 0);
    if (!primary) {
        return {
            files: files.slice(0, 1),
            evidenceFiles: files.slice(0, 1),
            distinctViewCount: files.length ? 1 : 0,
        };
    }
    const compatibleDescriptors = descriptors.filter((descriptor) => descriptor.index === 0 || referenceIdentityCompatible(primary, descriptor));
    const selected = rankDiverseReferenceIndices(compatibleDescriptors, task, 2);
    const evidenceFiles = compatibleDescriptors.map((descriptor) => files[descriptor.index]).filter(Boolean);

    return {
        files: [files[0], ...selected.map((index) => files[index])].filter(Boolean),
        evidenceFiles,
        distinctViewCount: Math.max(1, countDistinctReferenceViews(compatibleDescriptors, selected)),
    };
}

export async function referenceProductCutout(file: File, signal?: AbortSignal) {
    const cached = referenceCutoutCache.get(file);
    if (cached) {
        throwIfAborted(signal);
        return cached;
    }

    const dataUrl = await fileToDataUrl(file);
    throwIfAborted(signal);
    const { extractProductWithAi } = await import("./product-compositor");
    const cutout = await extractProductWithAi(dataUrl, undefined, 54, signal);
    throwIfAborted(signal);
    referenceCutoutCache.set(file, cutout.dataUrl);
    return cutout.dataUrl;
}

function descriptorDistance(left: ReferenceDescriptor, right: ReferenceDescriptor) {
    const length = Math.min(left.signature.length, right.signature.length);
    if (!length) return 0;

    let difference = 0;
    for (let index = 0; index < length; index += 1) {
        difference += Math.abs(left.signature[index] - right.signature[index]);
    }
    return difference / (length * 255);
}

async function describeReference(file: File, index: number, signal?: AbortSignal): Promise<ReferenceDescriptor> {
    const cached = referenceDescriptorCache.get(file);
    if (cached) {
        throwIfAborted(signal);
        return { index, ...cached };
    }
    const descriptor = await describeReferenceProduct(file, signal);
    throwIfAborted(signal);
    referenceDescriptorCache.set(file, descriptor);
    return {
        index,
        ...descriptor,
    };
}

async function describeReferenceProduct(file: File, signal?: AbortSignal): Promise<Omit<ReferenceDescriptor, "index">> {
    throwIfAborted(signal);
    const cutoutUrl = await referenceProductCutout(file, signal);
    const cutoutBlob = await (await fetch(cutoutUrl, { signal })).blob();
    const bitmap = await createImageBitmap(cutoutBlob);
    try {
        throwIfAborted(signal);
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const context = canvas.getContext("2d", {
            willReadFrequently: true,
        });
        if (!context) {
            throw new Error("无法分析商品参考图");
        }
        context.clearRect(0, 0, 32, 32);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        const scale = Math.min(30 / bitmap.width, 30 / bitmap.height);
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, Math.floor((32 - width) / 2), Math.floor((32 - height) / 2), width, height);
        const pixels = context.getImageData(0, 0, 32, 32).data;
        const gray = new Array<number>(32 * 32);
        const colorHistogram = new Array<number>(64).fill(0);
        let foregroundWeight = 0;
        for (let pixel = 0; pixel < gray.length; pixel += 1) {
            const offset = pixel * 4;
            const alpha = pixels[offset + 3] / 255;
            gray[pixel] = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) * alpha + 255 * (1 - alpha);
            if (alpha >= 0.2) {
                const red = Math.min(3, Math.floor(pixels[offset] / 64));
                const green = Math.min(3, Math.floor(pixels[offset + 1] / 64));
                const blue = Math.min(3, Math.floor(pixels[offset + 2] / 64));
                colorHistogram[red * 16 + green * 4 + blue] += alpha;
                foregroundWeight += alpha;
            }
        }
        if (foregroundWeight > 0) {
            colorHistogram.forEach((value, index) => {
                colorHistogram[index] = (value / foregroundWeight) * 255;
            });
        }

        const signature: number[] = [];
        for (let y = 0; y < 8; y += 1) {
            for (let x = 0; x < 8; x += 1) {
                signature.push(gray[(y * 4 + 2) * 32 + (x * 4 + 2)]);
            }
        }

        let sharpness = 0;
        for (let y = 1; y < 31; y += 1) {
            for (let x = 1; x < 31; x += 1) {
                const offset = y * 32 + x;
                sharpness += Math.abs(gray[offset + 1] - gray[offset - 1]) + Math.abs(gray[offset + 32] - gray[offset - 32]);
            }
        }

        return {
            signature,
            sharpness: sharpness / (30 * 30),
            colorHistogram,
            aspect: bitmap.width / Math.max(1, bitmap.height),
        };
    } finally {
        bitmap.close();
    }
}

function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("无法读取商品参考图"));
        reader.readAsDataURL(file);
    });
}

function histogramDistance(left?: number[], right?: number[]) {
    if (!left?.length || !right?.length) return null;
    const length = Math.min(left.length, right.length);
    let difference = 0;
    let total = 0;
    for (let index = 0; index < length; index += 1) {
        difference += Math.abs(left[index] - right[index]);
        total += left[index] + right[index];
    }
    return difference / Math.max(1, total);
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
    }
}
