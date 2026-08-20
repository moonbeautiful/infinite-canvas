import type { StoredMarketingTask } from "./marketing-agent-storage";
import { defaultCampaignOptions, type CampaignOptions } from "./product-marketing-plan";

export function restoreCampaignOptions(stored?: Partial<CampaignOptions>): CampaignOptions {
    const brandColorPreset = stored?.brandColorPreset || (stored?.brandColor && stored.brandColor.toLowerCase() !== defaultCampaignOptions.brandColor.toLowerCase() ? "custom" : defaultCampaignOptions.brandColorPreset);
    return {
        ...defaultCampaignOptions,
        ...stored,
        brandColorPreset,
    };
}

export function isLegacyQualityGateResult(stored: StoredMarketingTask, upstreamStateUnknown: boolean) {
    return Boolean(stored.url && !upstreamStateUnknown && /(?:自动|免费|新版多镜头).*质检|付费原稿已收到/.test(stored.error || ""));
}

export function recoveredUpdatedHero(tasks: StoredMarketingTask[]) {
    const hero = tasks.find((task) => task.id === "hero");
    return Boolean(hero?.status === "generating" && hero.url && !hero.upstreamStateUnknown);
}
