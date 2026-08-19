// @ts-nocheck -- Bun provides the test runner in deployment tooling, not Next's type environment.
import { describe, expect, test } from "bun:test";

import { countDistinctReferenceViews, rankDiverseReferenceIndices, referenceIdentityCompatible } from "./product-reference-selection";

const descriptors = [
    {
        index: 0,
        signature: [10, 10, 10, 10],
        sharpness: 20,
    },
    {
        index: 1,
        signature: [12, 12, 12, 12],
        sharpness: 18,
    },
    {
        index: 2,
        signature: [220, 220, 220, 220],
        sharpness: 25,
    },
    {
        index: 3,
        signature: [80, 80, 80, 80],
        sharpness: 90,
    },
    {
        index: 4,
        signature: [150, 150, 150, 150],
        sharpness: 30,
    },
];

describe("product reference selection", () => {
    test("selects visual diversity instead of fixed upload positions", () => {
        expect(rankDiverseReferenceIndices(descriptors, { identityPolicy: "multi-view" }, 2)).toEqual([2, 3]);
    });

    test("gives sharp detail evidence a strong bias", () => {
        const selected = rankDiverseReferenceIndices(descriptors, { identityPolicy: "detail-crop" }, 2);
        expect(selected).toContain(3);
        expect(selected).not.toContain(1);
    });

    test("returns no inferred angle for source-locked selection with no candidates", () => {
        expect(rankDiverseReferenceIndices(descriptors.slice(0, 1), { identityPolicy: "source-locked" }, 2)).toEqual([]);
    });

    test("does not treat repeated uploads as distinct camera evidence", () => {
        expect(countDistinctReferenceViews(descriptors, [1])).toBe(1);
        expect(countDistinctReferenceViews(descriptors, [2, 3])).toBe(3);
    });

    test("keeps a source-compatible alternate view", () => {
        expect(
            referenceIdentityCompatible(
                {
                    index: 0,
                    signature: [20, 20, 20, 20],
                    sharpness: 10,
                    colorHistogram: [240, 15],
                    aspect: 1,
                },
                {
                    index: 1,
                    signature: [65, 65, 65, 65],
                    sharpness: 12,
                    colorHistogram: [225, 30],
                    aspect: 1.2,
                },
            ),
        ).toBe(true);
    });

    test("rejects a candidate with corroborating color and structure conflicts", () => {
        expect(
            referenceIdentityCompatible(
                {
                    index: 0,
                    signature: [20, 20, 20, 20],
                    sharpness: 10,
                    colorHistogram: [255, 0],
                    aspect: 1,
                },
                {
                    index: 1,
                    signature: [130, 130, 130, 130],
                    sharpness: 12,
                    colorHistogram: [0, 255],
                    aspect: 1,
                },
            ),
        ).toBe(false);
    });

    test("rejects a same-shape candidate with a conflicting product color", () => {
        expect(
            referenceIdentityCompatible(
                {
                    index: 0,
                    signature: [20, 20, 20, 20],
                    sharpness: 10,
                    colorHistogram: [255, 0],
                    aspect: 1,
                },
                {
                    index: 1,
                    signature: [20, 20, 20, 20],
                    sharpness: 12,
                    colorHistogram: [0, 255],
                    aspect: 1,
                },
            ),
        ).toBe(false);
    });

    test("rejects a shared-neutral same-shape candidate with a changed accent color", () => {
        expect(
            referenceIdentityCompatible(
                {
                    index: 0,
                    signature: [20, 20, 20, 20],
                    sharpness: 10,
                    colorHistogram: [128, 127, 0],
                    aspect: 1,
                },
                {
                    index: 1,
                    signature: [20, 20, 20, 20],
                    sharpness: 12,
                    colorHistogram: [128, 0, 127],
                    aspect: 1,
                },
            ),
        ).toBe(false);
    });

    test("rejects an overwhelming structure conflict even when color matches", () => {
        expect(
            referenceIdentityCompatible(
                {
                    index: 0,
                    signature: [10, 10, 10, 10],
                    sharpness: 10,
                    colorHistogram: [255, 0],
                    aspect: 1,
                },
                {
                    index: 1,
                    signature: [240, 240, 240, 240],
                    sharpness: 12,
                    colorHistogram: [255, 0],
                    aspect: 1,
                },
            ),
        ).toBe(false);
    });
});
