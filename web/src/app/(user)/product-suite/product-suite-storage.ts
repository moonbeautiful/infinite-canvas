"use client";

import localforage from "localforage";

import type { ProductCutout } from "./product-compositor";
import type { ProductProfile, SuiteFrame } from "./product-profiles";

export type ProductInputImage = {
    id: string;
    name: string;
    dataUrl: string;
    hash: string;
};

export type ProductSuiteDraft = {
    version: 1;
    updatedAt: string;
    profile: ProductProfile;
    activeFrameIndex: number;
    frameOverrides: Partial<Record<string, Partial<SuiteFrame>>>;
    productImages: ProductInputImage[];
    productSource: string;
    productCutout: ProductCutout | null;
    styleReference: string;
    backgrounds: Partial<Record<string, string>>;
    noText: boolean;
    extractionMode: "ai" | "white";
    tolerance: number;
    feather: number;
    edgeCutoff: number;
    colors: {
        primary: string;
        accent: string;
        neutral: string;
        dark: string;
    };
};

const draftStore = localforage.createInstance({
    name: "infinite-canvas",
    storeName: "product_suite",
});
const latestDraftKey = "latest";

export async function loadProductSuiteDraft() {
    const draft = await draftStore.getItem<ProductSuiteDraft>(latestDraftKey);
    return draft?.version === 1 ? draft : null;
}

export async function saveProductSuiteDraft(draft: Omit<ProductSuiteDraft, "version" | "updatedAt">) {
    await draftStore.setItem<ProductSuiteDraft>(latestDraftKey, {
        ...draft,
        version: 1,
        updatedAt: new Date().toISOString(),
    });
}

export async function clearProductSuiteDraft() {
    await draftStore.removeItem(latestDraftKey);
}
