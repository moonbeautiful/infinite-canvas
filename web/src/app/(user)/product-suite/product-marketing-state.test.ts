// @ts-nocheck -- Bun provides the test runner in deployment tooling, not Next's type environment.
import { describe, expect, test } from "bun:test";

import { isLegacyQualityGateResult, recoveredUpdatedHero, restoreCampaignOptions } from "./product-marketing-state";

describe("product marketing persisted-state migration", () => {
    test("preserves a legacy custom brand color instead of silently switching to automatic", () => {
        const restored = restoreCampaignOptions({
            market: "美国",
            language: "English",
            platform: "Amazon",
            visualStyle: "自动匹配",
            brandColor: "#123456",
        });

        expect(restored.brandColorPreset).toBe("custom");
        expect(restored.brandColor).toBe("#123456");
    });

    test("restores old quality-gated images without hiding unknown upstream state", () => {
        const stored = {
            id: "hero",
            status: "error",
            url: "data:image/png;base64,result",
            error: "自动质检未通过：镜头相似",
        };

        expect(isLegacyQualityGateResult(stored, false)).toBe(true);
        expect(isLegacyQualityGateResult(stored, true)).toBe(false);
    });

    test("detects an updated hero recovered after refresh", () => {
        const recovered = {
            id: "hero",
            status: "generating",
            url: "data:image/png;base64,new-hero",
            error: "",
        };

        expect(recoveredUpdatedHero([recovered])).toBe(true);
        expect(recoveredUpdatedHero([{ ...recovered, upstreamStateUnknown: true }])).toBe(false);
        expect(recoveredUpdatedHero([{ ...recovered, status: "completed" }])).toBe(false);
    });
});
