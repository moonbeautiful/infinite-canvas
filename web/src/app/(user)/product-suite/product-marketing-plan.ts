import { buildCampaignStyleLock, buildProductScenePlan, sceneInstructionForTask, type ProductScenePlan } from "./product-marketing-scene-plan";

export type MarketingTaskId = "marketplace" | "hero" | "feature" | "lifestyle" | "detail" | "aplus" | "banner" | "poster";

export type IdentityPolicy = "source-locked" | "multi-view" | "detail-crop";

export type MarketingTaskDefinition = {
    id: MarketingTaskId;
    label: string;
    usage: string;
    size: "1024x1024" | "1536x1024" | "1024x1536";
    ratio: "1:1" | "3:2" | "2:3";
    cameraLabel: string;
    cameraContract: string;
    singleViewCameraContract: string;
    cameraFamily: "reference" | "front-three-quarter" | "wide-context" | "macro" | "low-three-quarter" | "orthographic" | "opposite-three-quarter" | "high-angle";
    identityPolicy: IdentityPolicy;
    productExposure: "hero" | "medium" | "partial";
    pictureSoloStatement: string;
    singleViewPictureSoloStatement: string;
    scene: string;
    singleViewScene?: string;
};

export type CampaignOptions = {
    market: string;
    language: string;
    platform: string;
    visualStyle: string;
    brandColor: string;
    brandColorPreset: "auto" | "black" | "blue" | "red" | "green" | "orange" | "custom";
};

export const defaultCampaignOptions: CampaignOptions = {
    market: "美国",
    language: "English",
    platform: "Amazon",
    visualStyle: "自动匹配",
    brandColor: "#6d3df5",
    brandColorPreset: "auto",
};

export const marketingPlan: MarketingTaskDefinition[] = [
    {
        id: "marketplace",
        label: "电商白底主图",
        usage: "商城列表 / 商品主图",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "参考视角 · 70mm",
        cameraContract: "Azimuth and elevation must match source view 01. Full product, eye-level 70mm catalog framing. This is the only source-view slot in the suite.",
        singleViewCameraContract: "Match source view 01 exactly. Do not infer any rotation, hidden surface, or new component.",
        cameraFamily: "reference",
        identityPolicy: "source-locked",
        productExposure: "hero",
        pictureSoloStatement: "The complete product is centered on pure white and shown from the strongest supplied catalog angle; with all copy hidden, the buyer can inspect the exact SKU immediately.",
        singleViewPictureSoloStatement: "The complete product is centered on pure white and preserves source view 01 exactly; with all copy hidden, the buyer can inspect the exact SKU immediately.",
        scene: "Create a marketplace-ready catalog photograph on pure white RGB 255,255,255. Use the primary supplied view without rotating or mirroring it. Center the complete product, fill 82-88% of the canvas, keep every edge inside frame, and use even studio light with one subtle contact shadow. No props, gradients, borders, copy, or extra objects.",
    },
    {
        id: "hero",
        label: "品牌主视觉",
        usage: "官网首屏 / 核心传播",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "低机位 3/4 · 50mm",
        cameraContract: "Relative to source view 01: turn about +25 degrees around the product and lower elevation by 10-15 degrees. Full-product low three-quarter 50mm portrait with visibly changed occlusion and side exposure.",
        singleViewCameraContract: "Keep azimuth within 15 degrees of source view 01 and lower elevation by no more than 10 degrees. Create distinction through camera height, 50mm depth, lighting, and set design without exposing an unseen back or side.",
        cameraFamily: "low-three-quarter",
        identityPolicy: "multi-view",
        productExposure: "hero",
        pictureSoloStatement: "A low three-quarter commercial portrait makes the exact product feel premium and dimensional; with all copy hidden, the buyer reads it as the campaign hero rather than a catalog repeat.",
        singleViewPictureSoloStatement: "A source-supported commercial portrait makes the exact product feel premium through lighting, depth, and camera height; with all copy hidden, it reads as the campaign hero without exposing unseen geometry.",
        scene: "Create the campaign hero from a low but natural three-quarter camera, roughly 15 degrees below product center and 20-30 degrees around the product from the primary view. Use a 50mm commercial-photography perspective, sculpted key light, credible ground contact, restrained premium set design, and generous depth. If only one source view exists, limit the inferred turn to about 15 degrees and never invent an unseen back, opening, port, or component.",
        singleViewScene:
            "Create the campaign hero using the visible source side with a slightly lower but conservative camera. Use 50mm commercial depth, sculpted key light, credible ground contact, restrained premium set design, and generous depth. Do not expose any surface, opening, port, or component absent from source view 01.",
    },
    {
        id: "feature",
        label: "核心卖点图",
        usage: "商品副图 / 卖点展示",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "正面 3/4 · 65mm",
        cameraContract: "Relative to source view 01: use the opposite -20 to -30 degree front three-quarter side at near-level elevation. The main product pose must not match either the catalog or low hero silhouette.",
        singleViewCameraContract: "Keep azimuth within 12 degrees of source view 01. Use a tighter 65mm front-detail composition and evidenced crops to differ from the catalog without inventing the opposite side.",
        cameraFamily: "front-three-quarter",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "One clean three-quarter product view is paired with two real visible detail crops; with all copy hidden, the buyer can see what is worth noticing.",
        singleViewPictureSoloStatement: "One source-supported product composition is paired with up to two crops of details visible in source view 01; with all copy hidden, the buyer can see what is worth noticing.",
        scene: "Create a conversion-focused feature composition from a front three-quarter camera that is visibly different from the catalog view. Keep one complete product as the main subject and add no more than two photographic detail crops of real visible materials, controls, joins, finishes, or construction. Reserve a quiet left or lower zone for deterministic copy. No icons, pictograms, badges, fake specifications, or invented internal parts.",
        singleViewScene:
            "Create a conversion-focused feature composition using the source-supported product plane. Keep one complete product as the main subject and add no more than two photographic crops of details visibly present in source view 01. Reserve a quiet left or lower zone for deterministic copy. No opposite-side reconstruction, icons, pictograms, badges, fake specifications, or invented internal parts.",
    },
    {
        id: "lifestyle",
        label: "真实使用场景",
        usage: "详情页 / 内容种草",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "环境广角 · 35mm",
        cameraContract: "Use a 55-75 degree side or opposite-side environmental view supported by the evidence set, at believable human eye height. Product-to-scene scale and wide context must dominate over centered studio framing.",
        singleViewCameraContract: "Keep the source-supported side visible and do not rotate into hidden geometry. Use environmental 35mm distance, off-center placement, real-use scale, and scene depth to create a distinct shot.",
        cameraFamily: "wide-context",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "The product appears at believable scale in the moment and place where it is actually used; with all copy hidden, the buyer understands the use case.",
        singleViewPictureSoloStatement: "The visible product side appears at believable scale in the moment and place where it is actually used; with all copy hidden, the buyer understands the use case.",
        scene: "Place the exact product in one believable aspirational real-life use environment using a 35mm environmental camera and an opposite-side three-quarter or side view supported by the references. Let the scene explain use, scale, and audience. Include a person or hand only when it is physically necessary to prove real use, and keep the interaction natural. Do not turn this into another centered studio hero.",
        singleViewScene:
            "Place the exact visible product side in one believable aspirational real-life use environment using a 35mm environmental camera. Let off-center placement, real scale, foreground depth, and natural interaction create the distinction. Include a person or hand only when necessary, without rotating the product into hidden geometry.",
    },
    {
        id: "detail",
        label: "材质工艺特写",
        usage: "材质说明 / 详情页",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "微距特写 · 100mm",
        cameraContract: "Use a true 100mm macro crop. Only 20-55% of the complete product may be visible; the full catalog silhouette is forbidden. Focus on one source-evidenced purchase detail.",
        singleViewCameraContract: "Use a true 100mm macro crop of a detail visibly evidenced in source view 01. Never infer hidden construction or an unseen surface.",
        cameraFamily: "macro",
        identityPolicy: "detail-crop",
        productExposure: "partial",
        pictureSoloStatement: "A purchase-relevant material, edge, mechanism, texture, stitch, or finish fills the frame; with all copy hidden, the buyer can judge craftsmanship.",
        singleViewPictureSoloStatement: "A purchase-relevant material, edge, mechanism, texture, stitch, or finish visible in source view 01 fills the frame; with all copy hidden, the buyer can judge craftsmanship.",
        scene: "Create a true 100mm macro commercial photograph of the most purchase-relevant visible material, edge, mechanism, texture, stitching, control, finish, or craftsmanship. A partial product crop is required and the full silhouette must not dominate. Preserve enough surrounding evidence to identify the SKU. Do not invent hidden layers, cutaways, internal parts, or technical claims.",
    },
    {
        id: "aplus",
        label: "A+ 内容图",
        usage: "Amazon A+ / 详情模块",
        size: "1536x1024",
        ratio: "3:2",
        cameraLabel: "正交主视 · 70mm",
        cameraContract: "Use a near-orthographic profile or side elevation from the best evidenced source view. Avoid the catalog three-quarter pose and avoid low-angle perspective. Keep parallel product lines visually parallel.",
        singleViewCameraContract: "Use a calm near-orthographic treatment of the currently visible source plane. Do not rotate to an unseen profile; create separation through wide layout, scale, and one source-evidenced detail crop.",
        cameraFamily: "orthographic",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "An orthographic product view and one supporting photographic detail tell one clear benefit story; with all copy hidden, the module remains understandable.",
        singleViewPictureSoloStatement: "A calm treatment of the source-visible product plane and one evidenced detail crop tell one clear benefit story; with all copy hidden, the module remains understandable.",
        scene: "Create a wide 3:2 A+ content module using a calm near-orthographic front or side camera and one supporting detail crop. Place the product and detail on the right 60% and keep the left 36% visually quiet for deterministic copy. Keep all critical content inside the inner 90% safe area. No icon rows, certifications, awards, dimensions, charts, or unsupported claims.",
        singleViewScene:
            "Create a wide 3:2 A+ content module using a calm near-orthographic treatment of the visible source plane and one source-evidenced detail crop. Place the product and detail on the right 60% and keep the left 36% quiet for deterministic copy. Do not infer a side profile. No icon rows, certifications, awards, dimensions, charts, or unsupported claims.",
    },
    {
        id: "banner",
        label: "横版广告图",
        usage: "Banner / 广告投放",
        size: "1536x1024",
        ratio: "3:2",
        cameraLabel: "反向 3/4 · 50mm",
        cameraContract: "Use the opposite three-quarter side from the hero, roughly -35 to -50 degrees relative to source view 01 at level elevation. The visible side and occlusion order must clearly differ from the hero.",
        singleViewCameraContract: "Do not create an unevidenced opposite side. Keep the source-supported azimuth, then distinguish the banner with a wider 50mm camera distance, strong lateral hierarchy, and different product-to-frame placement.",
        cameraFamily: "opposite-three-quarter",
        identityPolicy: "multi-view",
        productExposure: "hero",
        pictureSoloStatement: "The product is viewed from the opposite three-quarter side in a wide campaign set; with all copy hidden, the frame reads as a distinct advertising composition.",
        singleViewPictureSoloStatement: "The source-supported product side anchors a wide campaign set with strong lateral hierarchy; with all copy hidden, the frame reads as a distinct advertising composition.",
        scene: "Create a wide campaign advertisement from the opposite three-quarter side relative to the hero, using a 50mm perspective and strong left-to-right hierarchy. Keep one product dominant, with realistic contact, directional campaign light, and broad clean negative space. If the opposite side is not evidenced, use the nearest supplied side and change camera distance rather than inventing unseen geometry.",
        singleViewScene:
            "Create a wide campaign advertisement using the source-supported side, a wider 50mm camera distance, and strong left-to-right hierarchy. Keep one product dominant with realistic contact, directional campaign light, and broad negative space. Do not reconstruct the opposite side.",
    },
    {
        id: "poster",
        label: "竖版社媒海报",
        usage: "Story / 小红书 / 海报",
        size: "1024x1536",
        ratio: "2:3",
        cameraLabel: "高机位编辑 · 35mm",
        cameraContract: "Use a +20 to +35 degree azimuth with a clearly elevated 25-40 degree camera. A visible top plane and diagonal depth are required; eye-level catalog or hero silhouettes are forbidden.",
        singleViewCameraContract:
            "Do not expose an unseen top or opposite side. Keep azimuth close to source view 01, raise elevation by at most 10 degrees, and create the vertical editorial difference through diagonal layout, crop distance, and space above and below.",
        cameraFamily: "high-angle",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "A controlled high-angle editorial composition places the exact product in a vertical visual journey; with all copy hidden, it does not repeat the square hero.",
        singleViewPictureSoloStatement: "A source-supported vertical editorial composition places the exact product in a diagonal visual journey; with all copy hidden, it does not repeat the square hero.",
        scene: "Create a vertical editorial campaign poster from a controlled 25-40 degree high camera with a 35mm perspective. Use diagonal depth and meaningful space above and below while keeping the product recognizable in the central safe area. Avoid a centered eye-level repeat of the hero. Add no social-media interface, phone frame, username, icons, badges, or watermark.",
        singleViewScene:
            "Create a vertical editorial campaign poster using the source-supported product plane and no more than a 10 degree elevation change. Use diagonal layout, 35mm environmental depth, and meaningful space above and below to differ from square outputs. Do not expose an unseen top plane. Add no social-media interface, phone frame, username, icons, badges, or watermark.",
    },
];

const singleViewCameraLabels: Record<MarketingTaskId, string> = {
    marketplace: "source-locked catalog · 70mm",
    hero: "source-supported low portrait · 50mm",
    feature: "source-supported detail composition · 65mm",
    lifestyle: "source-supported environmental view · 35mm",
    detail: "visible-detail macro · 100mm",
    aplus: "visible-plane wide module · 70mm",
    banner: "source-supported wide banner · 50mm",
    poster: "source-supported vertical editorial · 35mm",
};

export function buildCampaignManifest(brief: string, options: CampaignOptions, sourceCount: number, scenePlan: ProductScenePlan = buildProductScenePlan(brief)) {
    const verifiedBrief = brief.trim() ? `USER-VERIFIED FACTS: ${brief.trim()}` : "No written facts were supplied. Use only details and benefits directly visible in the product references.";
    const sourceEvidence =
        sourceCount > 1
            ? `${sourceCount} visually distinct product-view clusters are evidenced for the same exact SKU. Treat them as one product evidence set and use only a cluster that supports the requested camera.`
            : "Only one distinct product view is evidenced. Preserve all visible identity evidence and use conservative camera changes that do not expose or invent unseen geometry.";

    return [
        sourceEvidence,
        verifiedBrief,
        `MARKET: ${options.market}. PLATFORM: ${options.platform}. OUTPUT LANGUAGE: ${options.language}.`,
        `PRODUCT CONTEXT: ${scenePlan.label}. The original product references remain the authority when visible evidence conflicts with text.`,
        buildCampaignStyleLock(options, scenePlan),
        "CATALOG EXCEPTION: the marketplace white-background image follows marketplace compliance. The seven campaign images from brand hero through vertical poster must share the campaign Visual DNA above.",
        "SET DIVERSITY CONTRACT: the eight outputs must use distinct camera families, proof forms, crop distances, and product-to-scene relationships. A shared product does not mean a repeated product pose.",
    ].join("\n");
}

export function buildMarketingPrompt(input: {
    task: MarketingTaskDefinition;
    campaignManifest: string;
    sourceCount: number;
    scenePlan?: ProductScenePlan;
    referenceRoleContract?: string;
    hasStyleReference?: boolean;
    repairRequest?: string;
    hasRepairDraft?: boolean;
}) {
    const { task, campaignManifest, sourceCount, scenePlan = buildProductScenePlan(""), referenceRoleContract = "", hasStyleReference = false, repairRequest = "", hasRepairDraft = false } = input;
    const cameraContract = sourceCount > 1 ? task.cameraContract : task.singleViewCameraContract;
    const scene = sourceCount > 1 ? task.scene : task.singleViewScene || task.scene;
    const cameraLabel = sourceCount > 1 ? task.cameraLabel : singleViewCameraLabels[task.id];
    const pictureSoloStatement = sourceCount > 1 ? task.pictureSoloStatement : task.singleViewPictureSoloStatement;
    const shotMap = marketingPlan.map((item, index) => `${String(index + 1).padStart(2, "0")} ${sourceCount > 1 ? item.cameraLabel : singleViewCameraLabels[item.id]}`).join(" | ");
    const viewRule =
        task.identityPolicy === "source-locked"
            ? "SOURCE-LOCKED IDENTITY: keep the primary reference perspective, orientation, silhouette, proportions, visible components, native labels, and left-right direction exactly."
            : task.identityPolicy === "detail-crop"
              ? "DETAIL-CROP IDENTITY: a partial crop and macro perspective are required. Preserve the referenced material, color, surface, construction, and native markings; do not force the complete source silhouette into frame."
              : sourceCount > 1
                ? "MULTI-VIEW IDENTITY: preserve the same SKU, geometry, proportions, colors, materials, logos, labels, count, and distinctive components while following the requested new camera. Match against all supplied source views, not only the first image."
                : "SINGLE-VIEW IDENTITY: preserve the exact visible geometry, proportions, colors, materials, logos, labels, count, and distinctive components from source view 01. Distinguish this task without revealing or fabricating an unobserved product surface.";
    const repairClause = repairRequest
        ? [
              "TARGETED REPAIR:",
              hasRepairDraft ? "The final uploaded image is the rejected draft. Use it only to locate the stated defect; original product images remain the identity authority." : "",
              `Fix this issue: ${repairRequest}.`,
              sourceCount > 1
                  ? "Keep correct product identity and campaign DNA, but change composition or camera whenever the issue concerns repetition or view diversity."
                  : "Keep correct product identity and campaign DNA. For repetition, change layout, crop distance, limited elevation, and environment only within the single-view safety contract; never expose unseen geometry.",
          ]
              .filter(Boolean)
              .join(" ")
        : "";

    return [
        `PRODUCT SUITE TASK: ${task.label} (${task.ratio}, ${cameraLabel}).`,
        `${sourceCount > 1 ? "HARD CAMERA CONTRACT" : "SINGLE-VIEW SAFETY CAMERA CONTRACT"}: ${cameraContract}`,
        `${sourceCount > 1 ? "SET SHOT MAP" : "SINGLE-VIEW SAFE SHOT MAP"}: ${shotMap}. The current output must occupy only its assigned slot and must not drift toward another slot.`,
        sourceCount > 1
            ? "CAMERA COMPLIANCE IS A DELIVERY GATE: changing only background, lighting, crop, or focal length while keeping the same product pose and occlusion pattern is a failed result."
            : "SINGLE-VIEW IDENTITY SAFETY OVERRIDES LARGE CAMERA ROTATION: use layout, crop distance, limited elevation, and environment to create distinction without fabricating unseen geometry.",
        "All uploaded source photographs depict one exact product. They are evidence, not extra products to place in the output.",
        referenceRoleContract,
        hasStyleReference
            ? "CAMPAIGN STYLE ANCHOR: use the designated brand-hero reference only for lighting direction, shadow softness, color temperature, contrast, background material family, prop restraint, and finishing. Never use it to override product geometry from the original product references, and do not copy its composition."
            : task.id === "hero"
              ? "STYLE-BASELINE TASK: establish one clear, repeatable lighting, palette, material, and finishing signature for all later campaign images."
              : "",
        campaignManifest,
        `PICTURE-SOLO CONTRACT: ${pictureSoloStatement}`,
        viewRule,
        repairClause,
        sceneInstructionForTask(scenePlan, task.id),
        scene,
        "Render one independent final commercial image only. Integrate the product with physically credible scale, contact, reflections, perspective, and directional light.",
        "Preserve native product text and logos when visible. Add no fabricated words, letters, numbers, specifications, certifications, prices, ratings, interface controls, stock marks, or watermarks.",
        "No icons, no pictograms, no badge ribbons, no feature-icon rows, no decorative arc systems, no duplicate products, and no collage grid unless this task explicitly requests photographic detail crops.",
    ]
        .filter(Boolean)
        .join("\n");
}

export function taskById(id: MarketingTaskId) {
    return marketingPlan.find((task) => task.id === id);
}

export function selectedPlan(ids: MarketingTaskId[]) {
    const selected = new Set(ids);
    return marketingPlan.filter((task) => selected.has(task.id));
}

export function normalizeMarketingSelection(ids: MarketingTaskId[]) {
    const selected = new Set(ids);
    const needsStyleAnchor = marketingPlan.some((task) => task.id !== "marketplace" && task.id !== "hero" && selected.has(task.id));
    if (needsStyleAnchor) selected.add("hero");
    return marketingPlan.filter((task) => selected.has(task.id)).map((task) => task.id);
}

export function estimateSuiteCost(count: number) {
    return Math.round(count * 0.08 * 100) / 100;
}

export type SuiteGateTask = {
    id: MarketingTaskId;
    status: "idle" | "generating" | "completed" | "error";
    qualityStatus: "pending" | "pass" | "warning" | "inconclusive" | "error";
    hasResult: boolean;
};

export function suiteBlockerIds(selectedIds: MarketingTaskId[], tasks: SuiteGateTask[]) {
    const selected = new Set(selectedIds);
    return marketingPlan
        .filter((definition) => {
            if (!selected.has(definition.id)) return true;
            const task = tasks.find((item) => item.id === definition.id);
            return task?.status !== "completed" || !task.hasResult;
        })
        .map((task) => task.id);
}

export function isCompleteMarketingSuite(selectedIds: MarketingTaskId[], tasks: SuiteGateTask[]) {
    return selectedIds.length === marketingPlan.length && suiteBlockerIds(selectedIds, tasks).length === 0;
}
