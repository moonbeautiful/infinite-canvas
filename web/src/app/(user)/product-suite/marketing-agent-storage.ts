"use client";

import localforage from "localforage";

import type { MarketingQualityReport } from "./product-marketing-quality";
import type { CampaignOptions, MarketingTaskId } from "./product-marketing-plan";

export type StoredMarketingTask = {
    id: string;
    status: "idle" | "generating" | "completed" | "error";
    url: string;
    modelUrl?: string;
    error: string;
    upstreamStateUnknown?: boolean;
    quality?: MarketingQualityReport;
};

export type MarketingAgentDraft = {
    version: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    updatedAt: string;
    images: File[];
    brief?: string;
    campaignOptions?: CampaignOptions;
    selectedTaskIds?: MarketingTaskId[];
    tasks: StoredMarketingTask[];
};

export type MarketingAgentHistoryItem = MarketingAgentDraft & {
    id: string;
};

const store = localforage.createInstance({
    name: "product-marketing-agent",
    storeName: "drafts",
});

const draftKey = "current-v1";
const historyKey = "history-v1";

export async function loadMarketingAgentDraft() {
    const draft = await store.getItem<MarketingAgentDraft>(draftKey);
    return draft?.version === 1 || draft?.version === 2 || draft?.version === 3 || draft?.version === 4 || draft?.version === 5 || draft?.version === 6 || draft?.version === 7 ? draft : null;
}

export async function saveMarketingAgentDraft(draft: Omit<MarketingAgentDraft, "version" | "updatedAt">) {
    await store.setItem<MarketingAgentDraft>(draftKey, {
        ...draft,
        version: 7,
        updatedAt: new Date().toISOString(),
    });
}

export async function loadMarketingAgentHistory() {
    return (await store.getItem<MarketingAgentHistoryItem[]>(historyKey)) || [];
}

export async function saveMarketingAgentHistory(draft: Omit<MarketingAgentDraft, "version" | "updatedAt">) {
    const updatedAt = new Date().toISOString();
    const current = await loadMarketingAgentHistory();
    const item: MarketingAgentHistoryItem = {
        ...draft,
        id: `${Date.now()}-${crypto.randomUUID()}`,
        version: 7,
        updatedAt,
    };
    const next = [item, ...current].slice(0, 5);
    await store.setItem(historyKey, next);
    return next;
}
