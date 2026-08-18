"use client";

import localforage from "localforage";

export type StoredMarketingTask = {
    id: string;
    status: "idle" | "generating" | "completed" | "error";
    url: string;
    error: string;
};

export type MarketingAgentDraft = {
    version: 1;
    updatedAt: string;
    images: File[];
    tasks: StoredMarketingTask[];
};

const store = localforage.createInstance({
    name: "product-marketing-agent",
    storeName: "drafts",
});

const draftKey = "current-v1";

export async function loadMarketingAgentDraft() {
    const draft = await store.getItem<MarketingAgentDraft>(draftKey);
    return draft?.version === 1 ? draft : null;
}

export async function saveMarketingAgentDraft(draft: Omit<MarketingAgentDraft, "version" | "updatedAt">) {
    await store.setItem<MarketingAgentDraft>(draftKey, {
        ...draft,
        version: 1,
        updatedAt: new Date().toISOString(),
    });
}
