"use client";

import type { ProductCutout } from "./product-compositor";
import type { ProductCategoryId, SuiteFrame } from "./product-profiles";

export type ProductFacts = {
    sourceWidth: number;
    sourceHeight: number;
    cutoutWidth: number;
    cutoutHeight: number;
    coverage: number;
    dominantColors: string[];
    cutoutHash: string;
};

export type QualityCheck = {
    id: "references" | "pixels" | "direction" | "edge" | "background" | "copy" | "layout";
    label: string;
    status: "pass" | "warning" | "error";
    detail: string;
};

export type QualityReport = {
    score: number;
    checks: QualityCheck[];
    canRepair: boolean;
};

export async function analyzeProductFacts(sourceDataUrl: string, cutout: ProductCutout): Promise<ProductFacts> {
    const image = await loadImage(cutout.dataUrl || sourceDataUrl);
    const dominantColors = sampleDominantColors(image);
    const cutoutHash = await hashDataUrl(cutout.dataUrl);
    return {
        sourceWidth: cutout.sourceWidth,
        sourceHeight: cutout.sourceHeight,
        cutoutWidth: cutout.width,
        cutoutHeight: cutout.height,
        coverage: Math.min(1, (cutout.width * cutout.height) / Math.max(1, cutout.sourceWidth * cutout.sourceHeight)),
        dominantColors,
        cutoutHash,
    };
}

export function inferProductCategory(filename: string): ProductCategoryId | null {
    const value = filename.toLowerCase();
    const rules: Array<[ProductCategoryId, RegExp]> = [
        ["mechanical", /motor|bike|车|machine|tool|outdoor|机械|工具/],
        ["electronics", /phone|camera|speaker|lamp|electr|电子|电器|耳机|音箱/],
        ["home", /chair|table|sofa|bed|home|家居|家具|桌|椅/],
        ["beauty", /lip|cream|serum|beauty|makeup|口红|美妆|护肤/],
        ["fashion", /shoe|bag|shirt|dress|fashion|鞋|包|服饰|衣/],
        ["food", /food|drink|coffee|tea|snack|食品|饮料|咖啡|茶/],
        ["toy", /toy|plush|pet|doll|玩具|毛绒|宠物/],
        ["jewelry", /ring|necklace|jewel|gift|戒指|项链|珠宝|礼品/],
    ];
    return rules.find(([, pattern]) => pattern.test(value))?.[0] || null;
}

export function buildQualityReport(input: {
    frame: SuiteFrame;
    cutout: ProductCutout | null;
    facts: ProductFacts | null;
    sourceHash: string;
    referenceCount?: number;
    noText?: boolean;
    background?: string;
}): QualityReport {
    const { frame, cutout, facts, sourceHash, background, referenceCount = 0, noText = false } = input;
    const layoutSafe = frame.productScale >= 0.72 && frame.productScale <= 1.28 && Math.abs(frame.productOffsetX) <= 0.24 && Math.abs(frame.productOffsetY) <= 0.24;
    const edgeSafe = Boolean(facts && facts.cutoutWidth >= 96 && facts.cutoutHeight >= 96 && facts.coverage >= 0.025);
    const copySafe = noText || frame.type !== "卖点图" || Boolean(frame.headline.trim() && frame.supportingLine.trim());
    const backgroundSafe = frame.template === "catalog" || Boolean(background);
    const checks: QualityCheck[] = [
        {
            id: "references",
            label: "事实证据",
            status: referenceCount > 0 ? "pass" : "error",
            detail: referenceCount > 1 ? `${referenceCount} 张商品图已编号并锁定` : referenceCount === 1 ? "1 张商品图，未知角度不会进入规划" : "尚未上传商品证据图",
        },
        {
            id: "pixels",
            label: "商品像素",
            status: cutout && sourceHash && facts?.cutoutHash ? "pass" : "error",
            detail: cutout && sourceHash && facts?.cutoutHash ? "原图与透明商品层已建立双哈希锁" : "商品像素锁尚未完成",
        },
        {
            id: "direction",
            label: "方向与 Logo",
            status: cutout ? "pass" : "error",
            detail: cutout ? "合成仅使用正向 drawImage，不执行镜像或重绘" : "等待商品提取",
        },
        {
            id: "edge",
            label: "抠图边缘",
            status: edgeSafe ? "pass" : facts ? "warning" : "error",
            detail: edgeSafe ? `主体边界 ${facts?.cutoutWidth}×${facts?.cutoutHeight}` : "主体过小或边界置信度不足，建议重新提取",
        },
        {
            id: "background",
            label: "空背景",
            status: backgroundSafe ? "pass" : "warning",
            detail: backgroundSafe ? (frame.template === "catalog" ? "白底目录图无需背景" : "背景已就绪") : "尚未生成或上传背景",
        },
        {
            id: "copy",
            label: "确定性文案",
            status: copySafe ? "pass" : "warning",
            detail: noText ? "无字版保留文字安全区" : copySafe ? "文字由 Canvas 渲染，不交给生图模型" : "卖点图缺少标题或辅助文案",
        },
        {
            id: "layout",
            label: "版式边界",
            status: layoutSafe ? "pass" : "warning",
            detail: layoutSafe ? "商品比例与偏移在安全范围内" : "商品位置接近版式边界，可一键校正",
        },
    ];
    const score = cutout
        ? Math.round((checks.reduce((total, item) => total + (item.status === "pass" ? 1 : item.status === "warning" ? 0.5 : 0), 0) / checks.length) * 100)
        : 0;
    return { score, checks, canRepair: checks.some((item) => item.status === "warning" && ["edge", "copy", "layout"].includes(item.id)) };
}

export function repairFrame(frame: SuiteFrame) {
    return {
        productScale: clamp(frame.productScale, 0.78, 1.2),
        productOffsetX: clamp(frame.productOffsetX, -0.16, 0.16),
        productOffsetY: clamp(frame.productOffsetY, -0.16, 0.16),
        detailFocusX: clamp(frame.detailFocusX, 0.12, 0.88),
        detailFocusY: clamp(frame.detailFocusY, 0.12, 0.88),
    };
}

function sampleDominantColors(image: HTMLImageElement) {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return ["#777777"];
    context.drawImage(image, 0, 0, 48, 48);
    const data = context.getImageData(0, 0, 48, 48).data;
    const buckets = new Map<string, number>();
    for (let index = 0; index < data.length; index += 16) {
        if (data[index + 3] < 96) continue;
        const r = Math.round(data[index] / 32) * 32;
        const g = Math.round(data[index + 1] / 32) * 32;
        const b = Math.round(data[index + 2] / 32) * 32;
        if (r + g + b > 720 || r + g + b < 42) continue;
        const key = toHex(r, g, b);
        buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return [...buckets.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([color]) => color)
        .filter((color, index, colors) => colors.slice(0, index).every((other) => colorDistance(color, other) > 72))
        .slice(0, 4);
}

async function hashDataUrl(dataUrl: string) {
    const digest = await crypto.subtle.digest("SHA-256", await (await fetch(dataUrl)).arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("商品事实分析失败"));
        image.src = src;
    });
}

function toHex(r: number, g: number, b: number) {
    return `#${[r, g, b].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("")}`;
}

function colorDistance(a: string, b: string) {
    const values = (value: string) => [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
    const left = values(a);
    const right = values(b);
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}
