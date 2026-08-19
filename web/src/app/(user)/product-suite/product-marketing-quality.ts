"use client";

import { auditProductTextIdentity } from "./product-identity-ocr";
import { componentEvidence, evaluateGeometryEvidence, hasRepeatedProductInstance, isRepeatedProductView, requiresProductCountCheck } from "./product-marketing-quality-rules";
import type { IdentityPolicy, MarketingTaskId } from "./product-marketing-plan";
import { referenceProductCutout } from "./product-reference-selection";

export type MarketingQualityStatus = "pending" | "pass" | "warning" | "inconclusive" | "error";
type MarketingQualityCheckStatus = "pass" | "warning" | "inconclusive" | "error";

export type MarketingQualityCheck = {
    id: "dimensions" | "render" | "product-color" | "product-text-unexpected" | "product-text-missing" | "product-count" | "silhouette" | "marketplace" | "duplicate" | "view-diversity" | "campaign";
    label: string;
    status: MarketingQualityCheckStatus;
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
    identityPolicy?: IdentityPolicy;
    distinctViewCount?: number;
    previousResults: Array<{ id: string; label: string; url: string; identityPolicy?: IdentityPolicy }>;
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

type ShapeEvidence = {
    mask: Uint8Array;
    edges: Uint8Array;
    interiorEdges: Uint8Array;
    pixels: Uint8ClampedArray;
    aspect: number;
};

type SilhouetteSample = ShapeEvidence & {
    significantComponents: number;
    secondaryComponentRatio: number;
    duplicateComponentSimilarity: number;
    duplicateComponentAreaRatio: number;
    candidates: ShapeEvidence[];
};

export function pendingQualityReport(): MarketingQualityReport {
    return { status: "pending", score: 0, summary: "等待质检", checks: [] };
}

function consistentSourceShapeEvidence(samples: SilhouetteSample[]): ShapeEvidence[] {
    if (samples.length <= 1) {
        const sample = samples[0];
        return sample ? [sample.candidates[0] || sample] : [];
    }

    return samples.map((sample, sampleIndex) => {
        const candidates = sample.candidates.length ? sample.candidates : [sample];
        return (
            candidates
                .map((candidate) => {
                    const consistency =
                        samples.reduce((sum, other, otherIndex) => {
                            if (otherIndex === sampleIndex) {
                                return sum;
                            }
                            const otherCandidates = other.candidates.length ? other.candidates : [other];
                            const best = Math.max(
                                ...otherCandidates.map((otherCandidate) => {
                                    const overlap = Math.max(maskIou(candidate.mask, otherCandidate.mask, false), maskIou(candidate.mask, otherCandidate.mask, true));
                                    const edge = Math.max(edgeSimilarity(candidate.edges, otherCandidate.edges, false), edgeSimilarity(candidate.edges, otherCandidate.edges, true));
                                    return overlap * 0.65 + edge * 0.35;
                                }),
                            );
                            return sum + best;
                        }, 0) / Math.max(1, samples.length - 1);
                    return { candidate, consistency };
                })
                .sort((left, right) => right.consistency - left.consistency)[0]?.candidate || sample
        );
    });
}

export async function auditMarketingImage(input: AuditInput): Promise<MarketingQualityReport> {
    throwIfAborted(input.signal);
    const identityPolicy = input.identityPolicy || "source-locked";
    const distinctViewCount = input.distinctViewCount ?? input.sources.length;
    const [result, hero, previous, sourceProducts] = await Promise.all([
        sampleImage(input.resultUrl, input.signal),
        input.heroUrl ? optionalImageSample(input.heroUrl, input.signal) : Promise.resolve(null),
        Promise.all(
            input.previousResults.map(async (item) => {
                const sample = await optionalImageSample(item.url, input.signal);
                return sample ? { ...item, sample } : null;
            }),
        ).then((items) => items.filter((item): item is NonNullable<typeof item> => item !== null)),
        Promise.all(
            input.sources.map((source) =>
                sourceProductSample(source, input.signal).catch((error) => {
                    rethrowAbort(error);
                    return null;
                }),
            ),
        ),
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

    const extractedProductColors = sourceProducts.flatMap((sample) => sample?.palette || []);
    const productPalette = mergePalettes(extractedProductColors);
    let resultShapeForDiversity: SilhouetteSample | null = null;

    if (["hero", "marketplace", "feature", "lifestyle", "detail", "aplus", "banner", "poster"].includes(input.taskId)) {
        try {
            const primarySubjectOnly = identityPolicy !== "source-locked" || ["feature", "detail", "aplus"].includes(input.taskId);
            const [sourceShapes, resultShape] = await Promise.all([Promise.all(input.sources.map((source) => sourceSilhouette(source, primarySubjectOnly, input.signal))), resultSilhouette(input.resultUrl, primarySubjectOnly, input.signal)]);
            throwIfAborted(input.signal);
            const resultCandidates = resultShape.candidates.length ? resultShape.candidates : [resultShape];
            const sourceAnchors = consistentSourceShapeEvidence(sourceShapes);
            const matches = sourceAnchors.flatMap((sourceShape) =>
                resultCandidates.map((resultCandidate) => {
                    const direct = maskIou(sourceShape.mask, resultCandidate.mask, false);
                    const mirrored = maskIou(sourceShape.mask, resultCandidate.mask, true);
                    const detailSimilarity = edgeSimilarity(sourceShape.edges, resultCandidate.edges, false);
                    const mirroredDetails = edgeSimilarity(sourceShape.edges, resultCandidate.edges, true);
                    const salientDetails = salientEdgeSimilarity(sourceShape.interiorEdges, resultCandidate.interiorEdges, false);
                    const aspectDelta = Math.abs(sourceShape.aspect - resultCandidate.aspect) / Math.max(0.01, sourceShape.aspect);
                    return {
                        direct,
                        mirrored,
                        detailSimilarity,
                        mirroredDetails,
                        salientDetails,
                        aspectDelta,
                        resultCandidate,
                        score: direct * 0.55 + detailSimilarity * 0.35 - Math.min(1, aspectDelta) * 0.1,
                    };
                }),
            );
            const best = matches.sort((left, right) => right.score - left.score)[0];
            const { direct, mirrored, detailSimilarity, mirroredDetails, salientDetails, aspectDelta, resultCandidate } = best;
            resultShapeForDiversity = {
                ...resultShape,
                ...resultCandidate,
            };
            const isMirrored = mirrored > direct + 0.07 && mirroredDetails > detailSimilarity + 0.06 && mirrored >= 0.42;
            const productColorCoverage = paletteCoverage(resultCandidate.pixels, productPalette);
            const colorStatus = !productPalette.length ? "warning" : productColorCoverage >= 0.08 ? "pass" : productColorCoverage >= 0.03 ? "warning" : "error";
            checks.push({
                id: "product-color",
                label: "商品主体颜色证据",
                status: colorStatus,
                detail: !productPalette.length ? "商品主体取色不可用，已由结构质检兜底" : `抠出商品主体后的原色覆盖 ${Math.round(productColorCoverage * 1000) / 10}%`,
            });
            const geometryStatus = evaluateGeometryEvidence(
                identityPolicy,
                input.taskId as MarketingTaskId,
                {
                    direct,
                    mirrored,
                    detailSimilarity,
                    mirroredDetails,
                    aspectDelta,
                    salientAverage: salientDetails.average,
                    salientLowerQuartile: salientDetails.lowerQuartile,
                    salientSampleCount: salientDetails.sampleCount,
                },
                distinctViewCount,
            );
            checks.push({
                id: "silhouette",
                label: identityPolicy === "source-locked" ? "主体结构与方向" : identityPolicy === "detail-crop" ? "局部商品证据" : "多视角商品证据",
                status: geometryStatus,
                detail:
                    identityPolicy === "source-locked" && isMirrored
                        ? "结果主体疑似被镜像"
                        : `已在 ${sourceShapes.length} 张原图中取最佳匹配：轮廓 ${Math.round(direct * 100)}%，结构细节 ${Math.round(detailSimilarity * 100)}%，内部证据 ${Math.round(salientDetails.average * 100)}%，比例偏差 ${Math.round(aspectDelta * 100)}%`,
            });

            const componentCheck = {
                significantCount: resultShape.significantComponents,
                secondaryToPrimaryRatio: resultShape.secondaryComponentRatio,
                duplicateShapeSimilarity: resultShape.duplicateComponentSimilarity,
                duplicatePairAreaRatio: resultShape.duplicateComponentAreaRatio,
            };
            const expectedProductCount = 1;
            const repeatedProduct = hasRepeatedProductInstance(input.taskId as MarketingTaskId, componentCheck, expectedProductCount);
            if (requiresProductCountCheck(input.taskId as MarketingTaskId)) {
                checks.push({
                    id: "product-count",
                    label: "商品实例数量",
                    status: repeatedProduct ? "error" : "pass",
                    detail: repeatedProduct
                        ? `来源商品主体数约 ${expectedProductCount}，结果出现 ${componentCheck.significantCount} 个且附加主体形状相似度 ${Math.round(componentCheck.duplicateShapeSimilarity * 100)}%，疑似重复商品`
                        : `结果未出现超出来源数量的同形商品主体（来源约 ${expectedProductCount} 个）`,
                });
            }
        } catch (error) {
            rethrowAbort(error);
            const fallbackCoverage = paletteCoverage(result.pixels, productPalette);
            checks.push({
                id: "product-color",
                label: "商品颜色证据",
                status: productPalette.length && fallbackCoverage >= 0.012 ? "warning" : "inconclusive",
                detail: "主体抠图不可用，整图颜色只能作为弱证据；结果需人工复核",
            });
            checks.push({
                id: "silhouette",
                label: "商品结构证据",
                status: "inconclusive",
                detail: "本地主体结构质检暂不可用；结果保留待人工复核，不会因此自动扣费返修",
            });
        }
    }

    if (identityPolicy !== "detail-crop" && resultShapeForDiversity && distinctViewCount > 1) {
        try {
            const comparable = input.previousResults.filter((item) => item.id !== "detail");
            const previousShapes = (
                await Promise.all(
                    comparable.map(async (item) => {
                        let sample: SilhouetteSample;
                        try {
                            sample = await resultSilhouette(item.url, true, input.signal);
                        } catch (error) {
                            if (error instanceof DOMException && error.name === "AbortError") {
                                throw error;
                            }
                            return null;
                        }
                        const candidate = (sample.candidates.length ? sample.candidates : [sample])
                            .map((shape) => {
                                const overlap = maskIou(shape.mask, resultShapeForDiversity.mask, false);
                                const edge = edgeSimilarity(shape.edges, resultShapeForDiversity.edges, false);
                                const aspect = Math.abs(shape.aspect - resultShapeForDiversity.aspect) / Math.max(0.01, shape.aspect);
                                return {
                                    shape,
                                    score: overlap * 0.65 + edge * 0.35 - Math.min(1, aspect) * 0.1,
                                };
                            })
                            .sort((left, right) => right.score - left.score)[0]?.shape;
                        return {
                            ...item,
                            shape: candidate || sample,
                        };
                    }),
                )
            ).filter((item): item is NonNullable<typeof item> => item !== null);
            const repeatedView = previousShapes.find(({ shape }) => {
                const directOverlap = maskIou(shape.mask, resultShapeForDiversity.mask, false);
                const mirroredOverlap = maskIou(shape.mask, resultShapeForDiversity.mask, true);
                const directEdge = edgeSimilarity(shape.edges, resultShapeForDiversity.edges, false);
                const mirroredEdge = edgeSimilarity(shape.edges, resultShapeForDiversity.edges, true);
                const aspect = Math.abs(shape.aspect - resultShapeForDiversity.aspect) / Math.max(0.01, shape.aspect);
                return (
                    isRepeatedProductView({
                        overlap: directOverlap,
                        edgeSimilarity: directEdge,
                        aspectDelta: aspect,
                    }) ||
                    isRepeatedProductView({
                        overlap: mirroredOverlap,
                        edgeSimilarity: mirroredEdge,
                        aspectDelta: aspect,
                    })
                );
            });
            checks.push({
                id: "view-diversity",
                label: "镜头差异",
                status: repeatedView ? "error" : "pass",
                detail: repeatedView ? `商品镜头与“${repeatedView.label}”过于相似，需要更换机位` : `商品机位与 ${previousShapes.length} 个可用历史镜头存在明确差异`,
            });
        } catch (error) {
            rethrowAbort(error);
            checks.push({
                id: "view-diversity",
                label: "镜头差异",
                status: "inconclusive",
                detail: "历史镜头对比暂不可用；结果保留待免费重新质检",
            });
        }
    } else if (identityPolicy !== "detail-crop" && resultShapeForDiversity) {
        const comparable = previous.filter((item) => item.id !== "detail");
        const repeatedComposition = comparable.find((item) => hammingDistance(result.hash, item.sample.hash) <= 6 && pixelDifference(result.pixels, item.sample.pixels) <= 0.08);
        checks.push({
            id: "view-diversity",
            label: "单图安全差异",
            status: repeatedComposition ? "error" : "pass",
            detail: repeatedComposition ? `整幅构图与“${repeatedComposition.label}”过于相似；请改变场景、主体尺度或版式，但不要虚构隐藏结构` : `在保持来源可见面的前提下，与 ${comparable.length} 个历史任务的整幅构图存在差异`,
        });
    }

    try {
        const identity = await auditProductTextIdentity(input.sources, input.identityUrl || input.resultUrl, input.signal, {
            requireSourceText: identityPolicy === "source-locked",
            missingSourceTextStatus: identityPolicy === "detail-crop" ? "pass" : "warning",
        });
        throwIfAborted(input.signal);
        checks.push({
            id: identity.issue === "unexpected" ? "product-text-unexpected" : "product-text-missing",
            label: "商品文字与标识",
            status: identity.status,
            detail: identity.detail,
        });
    } catch (error) {
        rethrowAbort(error);
        checks.push({
            id: "product-text-missing",
            label: "商品文字与标识",
            status: "inconclusive",
            detail: "本地文字标识质检暂不可用；结果保留待人工复核，不会因此自动扣费返修",
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
            status: similarity >= 0.28 ? "pass" : "warning",
            detail: `与品牌主视觉的色彩/明暗关联 ${Math.round(similarity * 100)}%`,
        });
    }

    const errors = checks.filter((check) => check.status === "error");
    const warnings = checks.filter((check) => check.status === "warning");
    const inconclusive = checks.filter((check) => check.status === "inconclusive");
    const score = Math.max(0, 100 - errors.length * 35 - warnings.length * 12 - inconclusive.length * 6);
    const status: MarketingQualityStatus = errors.length ? "error" : inconclusive.length ? "inconclusive" : warnings.length ? "warning" : "pass";
    const summary = errors.length ? errors.map((check) => check.detail).join("；") : inconclusive.length ? inconclusive.map((check) => check.detail).join("；") : warnings.length ? warnings.map((check) => check.detail).join("；") : "自动质检通过";
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

async function optionalImageSample(source: string, signal?: AbortSignal) {
    try {
        return await sampleImage(source, signal);
    } catch (error) {
        rethrowAbort(error);
        return null;
    }
}

function rethrowAbort(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
    }
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

function mergePalettes(colors: Array<[number, number, number]>) {
    const result: Array<[number, number, number]> = [];
    for (const color of colors) {
        if (result.some((current) => Math.hypot(current[0] - color[0], current[1] - color[1], current[2] - color[2]) < 36)) continue;
        result.push(color);
        if (result.length >= 12) break;
    }
    return result;
}

async function sourceProductSample(file: File, signal?: AbortSignal) {
    const cached = sourceProductSampleCache.get(file);
    if (cached)
        return cached.then((sample) => {
            throwIfAborted(signal);
            return sample;
        });
    const promise = referenceProductCutout(file, signal)
        .then((dataUrl) => sampleImage(dataUrl, signal))
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
    let total = 0;
    for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] < 96) continue;
        total += 1;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        if (palette.some(([pr, pg, pb]) => Math.hypot(r - pr, g - pg, b - pb) <= 68)) matches += 1;
    }
    return matches / Math.max(1, total);
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
    const promise = referenceProductCutout(file, signal)
        .then((dataUrl) => extractSilhouette(dataUrl, primarySubjectOnly, signal, true))
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

async function extractSilhouette(dataUrl: string, primarySubjectOnly = false, signal?: AbortSignal, alreadyCutout = false): Promise<SilhouetteSample> {
    const cutoutUrl = alreadyCutout ? dataUrl : await import("./product-compositor").then(async ({ extractProductWithAi }) => (await extractProductWithAi(dataUrl, undefined, 54, signal)).dataUrl);
    throwIfAborted(signal);
    const image = await loadHtmlImage(cutoutUrl);
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
    const components = connectedComponents(mask);
    const duplicatePair = bestDuplicateComponentPair(significantComponents(components).slice(0, 4));
    const componentStats = componentEvidence(
        components.map((component) => component.length),
        duplicatePair.similarity,
        duplicatePair.areaRatio,
    );
    if (primarySubjectOnly) {
        const candidates = components.slice(0, 4).map((component) => normalizeSubjectEvidence(pixels, componentMask(component, mask.length)));
        const primary = candidates[0] || normalizeSubjectEvidence(pixels, mask);
        return {
            ...primary,
            significantComponents: componentStats.significantCount,
            secondaryComponentRatio: componentStats.secondaryToPrimaryRatio,
            duplicateComponentSimilarity: componentStats.duplicateShapeSimilarity,
            duplicateComponentAreaRatio: componentStats.duplicatePairAreaRatio,
            candidates,
        };
    }
    const subjectMask = mask;
    const bounds = maskBounds(subjectMask);
    const fullEvidence: ShapeEvidence = {
        mask: subjectMask,
        edges: edgeMap(pixels, subjectMask),
        interiorEdges: interiorEdgeMap(pixels, subjectMask),
        pixels,
        aspect: bounds.width / Math.max(1, bounds.height),
    };
    return {
        ...fullEvidence,
        significantComponents: componentStats.significantCount,
        secondaryComponentRatio: componentStats.secondaryToPrimaryRatio,
        duplicateComponentSimilarity: componentStats.duplicateShapeSimilarity,
        duplicateComponentAreaRatio: componentStats.duplicatePairAreaRatio,
        candidates: [fullEvidence],
    };
}

function normalizeSubjectEvidence(pixels: Uint8ClampedArray, subjectMask: Uint8Array): ShapeEvidence {
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
        pixels: normalizedPixels,
        aspect: bounds.width / Math.max(1, bounds.height),
    };
}

function connectedComponents(mask: Uint8Array) {
    const visited = new Uint8Array(mask.length);
    const components: number[][] = [];
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
        components.push(component);
    }
    return components.sort((left, right) => right.length - left.length);
}

function componentMask(component: number[] | undefined, length: number) {
    if (!component?.length) return new Uint8Array(length);
    const result = new Uint8Array(length);
    component.forEach((index) => {
        result[index] = 1;
    });
    return result;
}

function similarComponentShape(primary: number[] | undefined, secondary: number[] | undefined) {
    if (!primary?.length || !secondary?.length) return 0;
    const size = 24;
    const left = normalizeComponentShape(primary, size);
    const right = normalizeComponentShape(secondary, size);
    let best = 0;
    for (const mirror of [false, true]) {
        let intersection = 0;
        let union = 0;
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                const leftValue = left[y * size + x];
                const rightX = mirror ? size - 1 - x : x;
                const rightValue = right[y * size + rightX];
                if (leftValue && rightValue) intersection += 1;
                if (leftValue || rightValue) union += 1;
            }
        }
        best = Math.max(best, intersection / Math.max(1, union));
    }
    return best;
}

function significantComponents(components: number[][]) {
    const total = components.reduce((sum, component) => sum + component.length, 0);
    const primary = components[0]?.length || 0;
    return components.filter((component) => component.length >= primary * 0.35 && component.length >= total * 0.08);
}

function bestDuplicateComponentPair(components: number[][]) {
    let best = {
        similarity: 0,
        areaRatio: 0,
        score: 0,
    };
    for (let left = 0; left < components.length; left += 1) {
        for (let right = left + 1; right < components.length; right += 1) {
            const similarity = similarComponentShape(components[left], components[right]);
            const areaRatio = Math.min(components[left].length, components[right].length) / Math.max(1, components[left].length, components[right].length);
            const score = similarity * Math.sqrt(areaRatio);
            if (score > best.score) {
                best = {
                    similarity,
                    areaRatio,
                    score,
                };
            }
        }
    }
    return best;
}

function normalizeComponentShape(component: number[], size: number) {
    let minX = silhouetteSize;
    let minY = silhouetteSize;
    let maxX = -1;
    let maxY = -1;
    component.forEach((index) => {
        const x = index % silhouetteSize;
        const y = Math.floor(index / silhouetteSize);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    });
    const sourceWidth = Math.max(1, maxX - minX + 1);
    const sourceHeight = Math.max(1, maxY - minY + 1);
    const scale = Math.min((size - 2) / sourceWidth, (size - 2) / sourceHeight);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const offsetX = Math.floor((size - width) / 2);
    const offsetY = Math.floor((size - height) / 2);
    const normalized = new Uint8Array(size * size);
    component.forEach((index) => {
        const sourceX = index % silhouetteSize;
        const sourceY = Math.floor(index / silhouetteSize);
        const x = Math.min(size - 1, offsetX + Math.floor((sourceX - minX) * scale));
        const y = Math.min(size - 1, offsetY + Math.floor((sourceY - minY) * scale));
        normalized[y * size + x] = 1;
    });
    return normalized;
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
