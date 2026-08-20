// @ts-nocheck -- Bun provides the test runner in deployment tooling, not Next's type environment.
import { describe, expect, test } from "bun:test";

import { buildCampaignManifest, buildMarketingPrompt, defaultCampaignOptions, isCompleteMarketingSuite, marketingPlan, normalizeMarketingSelection } from "./product-marketing-plan";
import { buildProductScenePlan } from "./product-marketing-scene-plan";

describe("product marketing task matrix", () => {
    test("defines eight distinct commercial outputs", () => {
        expect(marketingPlan).toHaveLength(8);
        expect(new Set(marketingPlan.map((task) => task.id)).size).toBe(8);
        expect(new Set(marketingPlan.map((task) => task.cameraFamily)).size).toBe(8);
    });

    test("locks only the catalog image to the source perspective", () => {
        const sourceLocked = marketingPlan.filter((task) => task.identityPolicy === "source-locked");
        expect(sourceLocked.map((task) => task.id)).toEqual(["marketplace"]);
        expect(marketingPlan.filter((task) => task.identityPolicy === "detail-crop")[0]?.id).toBe("detail");
    });

    test("automatically includes the brand hero whenever a dependent campaign image is selected", () => {
        expect(normalizeMarketingSelection(["lifestyle"])).toEqual(["hero", "lifestyle"]);
        expect(normalizeMarketingSelection(["marketplace"])).toEqual(["marketplace"]);
        expect(normalizeMarketingSelection(["marketplace", "hero", "poster"])).toEqual(["marketplace", "hero", "poster"]);
    });

    test("builds camera-specific prompts without globally freezing perspective", () => {
        const scenePlan = buildProductScenePlan("black motorcycle; red rear panel");
        const manifest = buildCampaignManifest("black motorcycle; red rear panel", defaultCampaignOptions, 3, scenePlan);
        const hero = marketingPlan.find((task) => task.id === "hero");
        if (!hero) throw new Error("hero task missing");

        const prompt = buildMarketingPrompt({
            task: hero,
            campaignManifest: manifest,
            sourceCount: 3,
            scenePlan,
        });

        expect(prompt).toContain("低机位 3/4");
        expect(prompt).toContain("MULTI-VIEW IDENTITY");
        expect(prompt).toContain("three-quarter");
        expect(prompt).toContain("HARD CAMERA CONTRACT");
        expect(prompt).toContain("SET SHOT MAP");
        expect(prompt).toContain("changing only background, lighting, crop, or focal length");
        expect(prompt).toContain("STYLE-BASELINE TASK");
        expect(prompt).toContain("controlled workshop-to-outdoor campaign set");
        expect(prompt).toContain("CAMPAIGN VISUAL DNA");
        expect(prompt).not.toContain("keep the primary reference perspective");
    });

    test("uses the brand hero as an explicit downstream style anchor", () => {
        const scenePlan = buildProductScenePlan("扫地机器人");
        const lifestyle = marketingPlan.find((task) => task.id === "lifestyle");
        if (!lifestyle) throw new Error("lifestyle task missing");

        const prompt = buildMarketingPrompt({
            task: lifestyle,
            campaignManifest: buildCampaignManifest("扫地机器人", defaultCampaignOptions, 1, scenePlan),
            sourceCount: 1,
            scenePlan,
            hasStyleReference: true,
            referenceRoleContract: "REFERENCE ROLE CONTRACT: Reference 01 = original product identity authority; Reference 02 = brand-hero style anchor only.",
        });

        expect(prompt).toContain("CAMPAIGN STYLE ANCHOR");
        expect(prompt).toContain("brand-hero style anchor only");
        expect(prompt).toContain("modern bedroom or living room floor");
        expect(prompt).toContain("never place it on a table");
    });

    test("allows a repetition repair to change the camera", () => {
        const banner = marketingPlan.find((task) => task.id === "banner");
        if (!banner) throw new Error("banner task missing");

        const prompt = buildMarketingPrompt({
            task: banner,
            campaignManifest: buildCampaignManifest("", defaultCampaignOptions, 3),
            sourceCount: 3,
            repairRequest: "camera view repeats the hero",
            hasRepairDraft: true,
        });

        expect(prompt).toContain("TARGETED REPAIR");
        expect(prompt).toContain("change composition or camera whenever the issue concerns repetition");
        expect(prompt).toContain("original product images remain the identity authority");
    });

    test("keeps single-view generation and repairs conservative", () => {
        const banner = marketingPlan.find((task) => task.id === "banner");
        if (!banner) throw new Error("banner task missing");

        const prompt = buildMarketingPrompt({
            task: banner,
            campaignManifest: buildCampaignManifest("", defaultCampaignOptions, 1),
            sourceCount: 1,
            repairRequest: "camera view repeats the hero",
            hasRepairDraft: true,
        });

        expect(prompt).toContain("SINGLE-VIEW SAFETY CAMERA CONTRACT");
        expect(prompt).toContain("Do not create an unevidenced opposite side");
        expect(prompt).toContain("SINGLE-VIEW IDENTITY SAFETY OVERRIDES");
        expect(prompt).toContain("SINGLE-VIEW SAFE SHOT MAP");
        expect(prompt).toContain("SINGLE-VIEW IDENTITY");
        expect(prompt).toContain("source-supported product side anchors a wide campaign set");
        expect(prompt).toContain("never expose unseen geometry");
        expect(prompt).not.toContain("MULTI-VIEW IDENTITY");
        expect(prompt).not.toContain("The product is viewed from the opposite three-quarter side");
        expect(prompt).not.toContain("opposite three-quarter side relative to the hero");
        expect(prompt).not.toContain("反向 3/4");
        expect(prompt).not.toContain("高机位编辑");
        expect(prompt).not.toContain("CAMERA COMPLIANCE IS A DELIVERY GATE");
    });

    test.each(["warning", "inconclusive"])("keeps user-visible results downloadable when one task is %s", (qualityStatus) => {
        const tasks = marketingPlan.map((task, index) => ({
            id: task.id,
            status: "completed",
            qualityStatus: index === 3 ? qualityStatus : "pass",
            hasResult: true,
        }));
        expect(
            isCompleteMarketingSuite(
                marketingPlan.map((task) => task.id),
                tasks,
            ),
        ).toBe(true);
    });

    test("does not unlock ZIP when one task failed", () => {
        const tasks = marketingPlan.map((task, index) => ({
            id: task.id,
            status: index === 3 ? "error" : "completed",
            qualityStatus: index === 3 ? "error" : "pass",
            hasResult: true,
        }));
        expect(
            isCompleteMarketingSuite(
                marketingPlan.map((task) => task.id),
                tasks,
            ),
        ).toBe(false);
    });

    test("does not unlock ZIP for a selected subset", () => {
        const selected = marketingPlan.slice(0, 7).map((task) => task.id);
        const tasks = marketingPlan.map((task) => ({
            id: task.id,
            status: "completed",
            qualityStatus: "pass",
            hasResult: true,
        }));
        expect(isCompleteMarketingSuite(selected, tasks)).toBe(false);
    });

    test("unlocks ZIP only when all eight tasks pass", () => {
        const tasks = marketingPlan.map((task) => ({
            id: task.id,
            status: "completed",
            qualityStatus: "pass",
            hasResult: true,
        }));
        expect(
            isCompleteMarketingSuite(
                marketingPlan.map((task) => task.id),
                tasks,
            ),
        ).toBe(true);
    });

    test("does not unlock ZIP when a passing task has no result", () => {
        const tasks = marketingPlan.map((task, index) => ({
            id: task.id,
            status: "completed",
            qualityStatus: "pass",
            hasResult: index !== 5,
        }));
        expect(
            isCompleteMarketingSuite(
                marketingPlan.map((task) => task.id),
                tasks,
            ),
        ).toBe(false);
    });
});
