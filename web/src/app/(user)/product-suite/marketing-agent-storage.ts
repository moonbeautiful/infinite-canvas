"use client";

import localforage from "localforage";

import type { MarketingQualityReport } from "./product-marketing-quality";

export type StoredMarketingTask = {
    id: string;
    status: "idle" | "generating" | "completed" | "error";
    url: string;
    modelUrl?: string;
    error: string;
    quality?: MarketingQualityReport;
};

export type MarketingAgentDraft = {
    version: 1 | 2 | 3 | 4 | 5;
    updatedAt: string;
    images: File[];
    brief?: string;
    tasks: StoredMarketingTask[];
};

const store = localforage.createInstance({
    name: "product-marketing-agent",
    storeName: "drafts",
});

const draftKey = "current-v1";

export async function loadMarketingAgentDraft() {
    const draft = await store.getItem<MarketingAgentDraft>(draftKey);
    return draft?.version === 1 || draft?.version === 2 || draft?.version === 3 || draft?.version === 4 || draft?.version === 5 ? draft : null;
}

export async function saveMarketingAgentDraft(draft: Omit<MarketingAgentDraft, "version" | "updatedAt">) {
    await store.setItem<MarketingAgentDraft>(draftKey, {
        ...draft,
        version: 5,
        updatedAt: new Date().toISOString(),
    });
}
