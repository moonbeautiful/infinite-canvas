// @ts-nocheck -- Bun provides the test runner in deployment tooling, not Next's type environment.
import { describe, expect, test } from "bun:test";

import { defaultCampaignOptions } from "./product-marketing-plan";
import { buildCampaignStyleLock, buildProductScenePlan, resolveCampaignBrandColor, sceneInstructionForTask } from "./product-marketing-scene-plan";

describe("product marketing scene planning", () => {
    test.each([
        ["扫地机器人", "robot-vacuum", "modern bedroom or living room floor"],
        ["毛绒狐狸玩偶", "plush-toy", "child-safe bedroom or cozy playroom"],
        ["宴会晚礼服裙", "formal-dress", "gala, banquet, ceremony"],
        ["espresso coffee machine", "coffee-kitchen-appliance", "kitchen worktop or refined café"],
    ])("matches %s to a native-use scene", (brief, expectedId, expectedScene) => {
        const plan = buildProductScenePlan(brief);
        expect(plan.id).toBe(expectedId);
        expect(plan.useEnvironment).toContain(expectedScene);
    });

    test("uses file names as a fallback category signal", () => {
        expect(buildProductScenePlan("", ["plush-fox-source.jpg"]).id).toBe("plush-toy");
        expect(buildProductScenePlan("", ["lipstick-source.jpg"]).id).toBe("beauty");
    });

    test("prefers a specific product phrase when category keywords conflict", () => {
        expect(buildProductScenePlan("solid oak coffee table").id).toBe("home-furniture");
        expect(buildProductScenePlan("automatic coffee machine").id).toBe("coffee-kitchen-appliance");
        expect(buildProductScenePlan("washable pet bed").id).toBe("toy");
        expect(buildProductScenePlan("compact pet furniture").id).toBe("toy");
    });

    test("keeps one verbatim visual signature across campaign tasks", () => {
        const plan = buildProductScenePlan("扫地机器人");
        const lock = buildCampaignStyleLock(defaultCampaignOptions, plan);

        expect(lock).toContain("CAMPAIGN VISUAL DNA");
        expect(lock).toContain("LIGHTING SIGNATURE");
        expect(lock).toContain("SET MATERIAL FAMILY");
        expect(sceneInstructionForTask(plan, "hero")).toContain("refined modern bedroom-to-living-room");
        expect(sceneInstructionForTask(plan, "lifestyle")).toContain("modern bedroom or living room floor");
        expect(sceneInstructionForTask(plan, "poster")).toContain("coordinated hallway or dining-room");
    });

    test("makes automatic color selection category-aware", () => {
        const beauty = buildProductScenePlan("luxury lipstick");
        const electronics = buildProductScenePlan("robot vacuum");

        expect(resolveCampaignBrandColor(defaultCampaignOptions, beauty)).toBe("#8E1F2D");
        expect(resolveCampaignBrandColor(defaultCampaignOptions, electronics)).toBe("#1677FF");
        expect(
            resolveCampaignBrandColor(
                {
                    ...defaultCampaignOptions,
                    brandColorPreset: "custom",
                    brandColor: "#123456",
                },
                beauty,
            ),
        ).toBe("#123456");
    });

    test("falls back to model-led scene inference without generic podiums", () => {
        const plan = buildProductScenePlan("unknown object");
        expect(plan.id).toBe("general");
        expect(plan.useEnvironment).toContain("most natural real-world place");
        expect(plan.avoid).toContain("generic luxury podiums");
    });
});
