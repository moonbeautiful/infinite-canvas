import type { IdentityPolicy, MarketingTaskId } from "./product-marketing-plan";

export type QualityDecision = "pass" | "warning" | "error";

export type GeometryEvidence = {
    direct: number;
    mirrored: number;
    detailSimilarity: number;
    mirroredDetails: number;
    aspectDelta: number;
    salientAverage: number;
    salientLowerQuartile: number;
    salientSampleCount: number;
};

export type ComponentEvidence = {
    significantCount: number;
    secondaryToPrimaryRatio: number;
    duplicateShapeSimilarity: number;
    duplicatePairAreaRatio: number;
};

const wideCameraTasks = new Set<MarketingTaskId>(["lifestyle", "banner", "poster"]);

const productCountCheckTasks = new Set<MarketingTaskId>(["marketplace", "hero", "feature", "lifestyle", "aplus", "banner", "poster"]);
const automaticRepairCheckIds = new Set(["dimensions", "render", "product-text-unexpected", "marketplace", "duplicate"]);

export function evaluateGeometryEvidence(identityPolicy: IdentityPolicy, taskId: MarketingTaskId, evidence: GeometryEvidence, sourceCount: number): QualityDecision {
    const { direct, mirrored, detailSimilarity, mirroredDetails, aspectDelta, salientAverage, salientLowerQuartile, salientSampleCount } = evidence;
    const isMirrored = mirrored > direct + 0.07 && mirroredDetails > detailSimilarity + 0.06 && mirrored >= 0.42;
    const comparableInterior = salientSampleCount >= 4 && direct >= 0.24 && aspectDelta <= 0.5;
    const severeInteriorDrift = comparableInterior && salientLowerQuartile < 0.035 && salientAverage < 0.1;
    const possibleInteriorDrift = comparableInterior && salientLowerQuartile < 0.09;

    if (identityPolicy === "source-locked") {
        const error = isMirrored || direct < 0.26 || detailSimilarity < 0.08 || aspectDelta > 0.55 || (salientSampleCount >= 4 && salientLowerQuartile < 0.05);
        if (error) return "error";
        const warning = direct < 0.4 || detailSimilarity < 0.18 || aspectDelta > 0.32 || (salientSampleCount >= 4 && salientLowerQuartile < 0.12);
        return warning ? "warning" : "pass";
    }

    if (identityPolicy === "detail-crop") {
        if (direct < 0.06 && detailSimilarity < 0.02) {
            return "error";
        }
        return direct < 0.12 && detailSimilarity < 0.04 ? "warning" : "pass";
    }

    const wideCamera = wideCameraTasks.has(taskId);
    const evidenceFactor = sourceCount > 1 ? 1 : 0.82;
    const directFloor = (wideCamera ? 0.085 : 0.12) * evidenceFactor;
    const detailFloor = (wideCamera ? 0.028 : 0.045) * evidenceFactor;

    if ((direct < directFloor && detailSimilarity < detailFloor) || severeInteriorDrift) {
        return "error";
    }

    const warning = direct < (wideCamera ? 0.17 : 0.21) * evidenceFactor || detailSimilarity < (wideCamera ? 0.055 : 0.075) * evidenceFactor || aspectDelta > (wideCamera ? 1 : 0.78) || possibleInteriorDrift;
    return warning ? "warning" : "pass";
}

export function isRepeatedProductView(input: { overlap: number; edgeSimilarity: number; aspectDelta: number }) {
    const { overlap, edgeSimilarity, aspectDelta } = input;
    const poseScore = overlap * 0.65 + edgeSimilarity * 0.35;
    return aspectDelta <= 0.18 && overlap >= 0.68 && edgeSimilarity >= 0.3 && poseScore >= 0.56;
}

export function componentEvidence(componentAreas: number[], duplicateShapeSimilarity = 0, duplicatePairAreaRatio?: number): ComponentEvidence {
    const sorted = componentAreas.filter((area) => area > 0).sort((left, right) => right - left);
    if (!sorted.length) {
        return {
            significantCount: 0,
            secondaryToPrimaryRatio: 0,
            duplicateShapeSimilarity: 0,
            duplicatePairAreaRatio: 0,
        };
    }

    const total = sorted.reduce((sum, area) => sum + area, 0);
    const primary = sorted[0];
    const significantCount = sorted.filter((area) => area >= primary * 0.35 && area >= total * 0.08).length;
    return {
        significantCount,
        secondaryToPrimaryRatio: (sorted[1] || 0) / Math.max(1, primary),
        duplicateShapeSimilarity,
        duplicatePairAreaRatio: duplicatePairAreaRatio ?? (sorted[1] || 0) / Math.max(1, primary),
    };
}

export function hasRepeatedProductInstance(taskId: MarketingTaskId, evidence: ComponentEvidence, expectedProductCount = 1) {
    const allowedContextComponents = taskId === "lifestyle" && expectedProductCount > 1 ? 1 : 0;
    return productCountCheckTasks.has(taskId) && evidence.significantCount > Math.max(1, expectedProductCount) + allowedContextComponents && evidence.duplicatePairAreaRatio >= 0.35 && evidence.duplicateShapeSimilarity >= 0.52;
}

export function allowsAutomaticQualityRepair(checks: Array<{ id: string; status: string }>) {
    const errors = checks.filter((check) => check.status === "error");
    return errors.length > 0 && errors.every((check) => automaticRepairCheckIds.has(check.id));
}

export function requiresProductCountCheck(taskId: MarketingTaskId) {
    return productCountCheckTasks.has(taskId);
}
