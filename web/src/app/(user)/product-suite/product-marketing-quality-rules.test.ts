// @ts-nocheck -- Bun provides the test runner in deployment tooling, not Next's type environment.
import { describe, expect, test } from "bun:test";

import { allowsAutomaticQualityRepair, componentEvidence, evaluateGeometryEvidence, hasRepeatedProductInstance, isRepeatedProductView, requiresProductCountCheck } from "./product-marketing-quality-rules";

const stableEvidence = {
    direct: 0.36,
    mirrored: 0.22,
    detailSimilarity: 0.16,
    mirroredDetails: 0.09,
    aspectDelta: 0.18,
    salientAverage: 0.3,
    salientLowerQuartile: 0.18,
    salientSampleCount: 8,
};

describe("product marketing quality rules", () => {
    test("rejects weak multi-view identity evidence", () => {
        expect(
            evaluateGeometryEvidence(
                "multi-view",
                "hero",
                {
                    ...stableEvidence,
                    direct: 0.08,
                    detailSimilarity: 0.02,
                },
                3,
            ),
        ).toBe("error");
    });

    test("rejects internal structure drift when the pose is comparable", () => {
        expect(
            evaluateGeometryEvidence(
                "multi-view",
                "feature",
                {
                    ...stableEvidence,
                    direct: 0.32,
                    salientAverage: 0.06,
                    salientLowerQuartile: 0.02,
                },
                3,
            ),
        ).toBe("error");
    });

    test("allows a supported wide camera with credible identity evidence", () => {
        expect(
            evaluateGeometryEvidence(
                "multi-view",
                "lifestyle",
                {
                    ...stableEvidence,
                    direct: 0.19,
                    detailSimilarity: 0.08,
                    aspectDelta: 0.72,
                },
                3,
            ),
        ).toBe("pass");
    });

    test("detects repeated product poses at a lower practical threshold", () => {
        expect(
            isRepeatedProductView({
                overlap: 0.73,
                edgeSimilarity: 0.38,
                aspectDelta: 0.11,
            }),
        ).toBe(true);
        expect(
            isRepeatedProductView({
                overlap: 0.52,
                edgeSimilarity: 0.31,
                aspectDelta: 0.24,
            }),
        ).toBe(false);
        expect(
            isRepeatedProductView({
                overlap: 0.86,
                edgeSimilarity: 0.14,
                aspectDelta: 0.08,
            }),
        ).toBe(false);
    });

    test("rejects only unexpected similarly shaped product instances", () => {
        const components = componentEvidence([1200, 940, 20], 0.72);
        expect(components.significantCount).toBe(2);
        expect(hasRepeatedProductInstance("hero", components)).toBe(true);
        expect(hasRepeatedProductInstance("feature", components)).toBe(true);
        expect(hasRepeatedProductInstance("hero", components, 2)).toBe(false);
        expect(hasRepeatedProductInstance("lifestyle", componentEvidence([1200, 940], 0.18))).toBe(false);
        expect(hasRepeatedProductInstance("lifestyle", componentEvidence([1200, 940], 0.72))).toBe(true);
        expect(hasRepeatedProductInstance("lifestyle", componentEvidence([1400, 940, 820], 0.72))).toBe(true);
        expect(hasRepeatedProductInstance("lifestyle", componentEvidence([1400, 940, 820], 0.72), 2)).toBe(false);
        expect(hasRepeatedProductInstance("hero", componentEvidence([1200, 940, 200, 180], 0.8, 0.18))).toBe(false);
        expect(requiresProductCountCheck("hero")).toBe(true);
        expect(requiresProductCountCheck("lifestyle")).toBe(true);
        expect(requiresProductCountCheck("feature")).toBe(true);
        expect(requiresProductCountCheck("detail")).toBe(false);
    });

    test("requires user confirmation for heuristic quality failures", () => {
        expect(allowsAutomaticQualityRepair([{ id: "dimensions", status: "error" }])).toBe(true);
        expect(allowsAutomaticQualityRepair([{ id: "product-text-unexpected", status: "error" }])).toBe(true);
        expect(allowsAutomaticQualityRepair([{ id: "product-text-missing", status: "error" }])).toBe(false);
        expect(allowsAutomaticQualityRepair([{ id: "view-diversity", status: "error" }])).toBe(false);
        expect(
            allowsAutomaticQualityRepair([
                { id: "duplicate", status: "error" },
                { id: "silhouette", status: "error" },
            ]),
        ).toBe(false);
        expect(allowsAutomaticQualityRepair([{ id: "silhouette", status: "warning" }])).toBe(false);
    });
});
