// @ts-nocheck -- Bun provides the test runner in deployment tooling, not Next's type environment.
import { describe, expect, test } from "bun:test";

import { componentEvidence, evaluateGeometryEvidence, hasRepeatedProductInstance, requiresProductCountCheck } from "./product-marketing-quality-rules";

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
});
