export type MarketingTaskId = "marketplace" | "hero" | "feature" | "lifestyle" | "detail" | "aplus" | "banner" | "poster";

export type IdentityPolicy = "source-locked" | "multi-view" | "detail-crop";

export type MarketingTaskDefinition = {
    id: MarketingTaskId;
    label: string;
    usage: string;
    size: "1024x1024" | "1536x1024" | "1024x1536";
    ratio: "1:1" | "3:2" | "2:3";
    cameraLabel: string;
    cameraFamily: "reference" | "front-three-quarter" | "wide-context" | "macro" | "low-three-quarter" | "orthographic" | "opposite-three-quarter" | "high-angle";
    identityPolicy: IdentityPolicy;
    productExposure: "hero" | "medium" | "partial";
    pictureSoloStatement: string;
    scene: string;
};

export type CampaignOptions = {
    market: string;
    language: string;
    platform: string;
    visualStyle: string;
    brandColor: string;
};

export const defaultCampaignOptions: CampaignOptions = {
    market: "美国",
    language: "English",
    platform: "Amazon",
    visualStyle: "自动匹配",
    brandColor: "#6d3df5",
};

export const marketingPlan: MarketingTaskDefinition[] = [
    {
        id: "marketplace",
        label: "电商白底主图",
        usage: "商城列表 / 商品主图",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "参考视角 · 70mm",
        cameraFamily: "reference",
        identityPolicy: "source-locked",
        productExposure: "hero",
        pictureSoloStatement: "The complete product is centered on pure white and shown from the strongest supplied catalog angle; with all copy hidden, the buyer can inspect the exact SKU immediately.",
        scene: "Create a marketplace-ready catalog photograph on pure white RGB 255,255,255. Use the primary supplied view without rotating or mirroring it. Center the complete product, fill 82-88% of the canvas, keep every edge inside frame, and use even studio light with one subtle contact shadow. No props, gradients, borders, copy, or extra objects.",
    },
    {
        id: "hero",
        label: "品牌主视觉",
        usage: "官网首屏 / 核心传播",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "低机位 3/4 · 50mm",
        cameraFamily: "low-three-quarter",
        identityPolicy: "multi-view",
        productExposure: "hero",
        pictureSoloStatement: "A low three-quarter commercial portrait makes the exact product feel premium and dimensional; with all copy hidden, the buyer reads it as the campaign hero rather than a catalog repeat.",
        scene: "Create the campaign hero from a low but natural three-quarter camera, roughly 15 degrees below product center and 20-30 degrees around the product from the primary view. Use a 50mm commercial-photography perspective, sculpted key light, credible ground contact, restrained premium set design, and generous depth. If only one source view exists, limit the inferred turn to about 15 degrees and never invent an unseen back, opening, port, or component.",
    },
    {
        id: "feature",
        label: "核心卖点图",
        usage: "商品副图 / 卖点展示",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "正面 3/4 · 65mm",
        cameraFamily: "front-three-quarter",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "One clean three-quarter product view is paired with two real visible detail crops; with all copy hidden, the buyer can see what is worth noticing.",
        scene: "Create a conversion-focused feature composition from a front three-quarter camera that is visibly different from the catalog view. Keep one complete product as the main subject and add no more than two photographic detail crops of real visible materials, controls, joins, finishes, or construction. Reserve a quiet left or lower zone for deterministic copy. No icons, pictograms, badges, fake specifications, or invented internal parts.",
    },
    {
        id: "lifestyle",
        label: "真实使用场景",
        usage: "详情页 / 内容种草",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "环境广角 · 35mm",
        cameraFamily: "wide-context",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "The product appears at believable scale in the moment and place where it is actually used; with all copy hidden, the buyer understands the use case.",
        scene: "Place the exact product in one believable aspirational real-life use environment using a 35mm environmental camera and an opposite-side three-quarter or side view supported by the references. Let the scene explain use, scale, and audience. Include a person or hand only when it is physically necessary to prove real use, and keep the interaction natural. Do not turn this into another centered studio hero.",
    },
    {
        id: "detail",
        label: "材质工艺特写",
        usage: "材质说明 / 详情页",
        size: "1024x1024",
        ratio: "1:1",
        cameraLabel: "微距特写 · 100mm",
        cameraFamily: "macro",
        identityPolicy: "detail-crop",
        productExposure: "partial",
        pictureSoloStatement: "A purchase-relevant material, edge, mechanism, texture, stitch, or finish fills the frame; with all copy hidden, the buyer can judge craftsmanship.",
        scene: "Create a true 100mm macro commercial photograph of the most purchase-relevant visible material, edge, mechanism, texture, stitching, control, finish, or craftsmanship. A partial product crop is required and the full silhouette must not dominate. Preserve enough surrounding evidence to identify the SKU. Do not invent hidden layers, cutaways, internal parts, or technical claims.",
    },
    {
        id: "aplus",
        label: "A+ 内容图",
        usage: "Amazon A+ / 详情模块",
        size: "1536x1024",
        ratio: "3:2",
        cameraLabel: "正交主视 · 70mm",
        cameraFamily: "orthographic",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "An orthographic product view and one supporting photographic detail tell one clear benefit story; with all copy hidden, the module remains understandable.",
        scene: "Create a wide 3:2 A+ content module using a calm near-orthographic front or side camera and one supporting detail crop. Place the product and detail on the right 60% and keep the left 36% visually quiet for deterministic copy. Keep all critical content inside the inner 90% safe area. No icon rows, certifications, awards, dimensions, charts, or unsupported claims.",
    },
    {
        id: "banner",
        label: "横版广告图",
        usage: "Banner / 广告投放",
        size: "1536x1024",
        ratio: "3:2",
        cameraLabel: "反向 3/4 · 50mm",
        cameraFamily: "opposite-three-quarter",
        identityPolicy: "multi-view",
        productExposure: "hero",
        pictureSoloStatement: "The product is viewed from the opposite three-quarter side in a wide campaign set; with all copy hidden, the frame reads as a distinct advertising composition.",
        scene: "Create a wide campaign advertisement from the opposite three-quarter side relative to the hero, using a 50mm perspective and strong left-to-right hierarchy. Keep one product dominant, with realistic contact, directional campaign light, and broad clean negative space. If the opposite side is not evidenced, use the nearest supplied side and change camera distance rather than inventing unseen geometry.",
    },
    {
        id: "poster",
        label: "竖版社媒海报",
        usage: "Story / 小红书 / 海报",
        size: "1024x1536",
        ratio: "2:3",
        cameraLabel: "高机位编辑 · 35mm",
        cameraFamily: "high-angle",
        identityPolicy: "multi-view",
        productExposure: "medium",
        pictureSoloStatement: "A controlled high-angle editorial composition places the exact product in a vertical visual journey; with all copy hidden, it does not repeat the square hero.",
        scene: "Create a vertical editorial campaign poster from a controlled 25-40 degree high camera with a 35mm perspective. Use diagonal depth and meaningful space above and below while keeping the product recognizable in the central safe area. Avoid a centered eye-level repeat of the hero. Add no social-media interface, phone frame, username, icons, badges, or watermark.",
    },
];

export function buildCampaignManifest(brief: string, options: CampaignOptions, sourceCount: number) {
    const verifiedBrief = brief.trim() ? `USER-VERIFIED FACTS: ${brief.trim()}` : "No written facts were supplied. Use only details and benefits directly visible in the product references.";
    const sourceEvidence =
        sourceCount > 1
            ? `${sourceCount} uploaded images show the same exact SKU from complementary angles or real-use situations. Treat them as one product evidence set and use the view that best supports each requested camera.`
            : "One product image was supplied. Preserve all visible identity evidence and use conservative camera changes that do not expose or invent unseen geometry.";

    return [
        sourceEvidence,
        verifiedBrief,
        `MARKET: ${options.market}. PLATFORM: ${options.platform}. OUTPUT LANGUAGE: ${options.language}.`,
        `VISUAL SYSTEM: ${options.visualStyle}; brand accent ${options.brandColor}; premium cross-border ecommerce photography; coherent light behavior and color hierarchy without repeating composition.`,
        "SET DIVERSITY CONTRACT: the eight outputs must use distinct camera families, proof forms, crop distances, and product-to-scene relationships. A shared product does not mean a repeated product pose.",
    ].join("\n");
}

export function buildMarketingPrompt(input: { task: MarketingTaskDefinition; campaignManifest: string; repairRequest?: string; hasRepairDraft?: boolean }) {
    const { task, campaignManifest, repairRequest = "", hasRepairDraft = false } = input;
    const viewRule =
        task.identityPolicy === "source-locked"
            ? "SOURCE-LOCKED IDENTITY: keep the primary reference perspective, orientation, silhouette, proportions, visible components, native labels, and left-right direction exactly."
            : task.identityPolicy === "detail-crop"
              ? "DETAIL-CROP IDENTITY: a partial crop and macro perspective are required. Preserve the referenced material, color, surface, construction, and native markings; do not force the complete source silhouette into frame."
              : "MULTI-VIEW IDENTITY: preserve the same SKU, geometry, proportions, colors, materials, logos, labels, count, and distinctive components while following the requested new camera. Match against all supplied source views, not only the first image.";
    const repairClause = repairRequest
        ? [
              "TARGETED REPAIR:",
              hasRepairDraft ? "The final uploaded image is the rejected draft. Use it only to locate the stated defect; original product images remain the identity authority." : "",
              `Fix this issue: ${repairRequest}.`,
              "Keep correct product identity and campaign DNA, but change composition or camera whenever the issue concerns repetition or view diversity.",
          ]
              .filter(Boolean)
              .join(" ")
        : "";

    return [
        `PRODUCT SUITE TASK: ${task.label} (${task.ratio}, ${task.cameraLabel}).`,
        "All uploaded source photographs depict one exact product. They are evidence, not extra products to place in the output.",
        campaignManifest,
        `PICTURE-SOLO CONTRACT: ${task.pictureSoloStatement}`,
        viewRule,
        repairClause,
        task.scene,
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
            return task?.status !== "completed" || task.qualityStatus !== "pass" || !task.hasResult;
        })
        .map((task) => task.id);
}

export function isCompleteMarketingSuite(selectedIds: MarketingTaskId[], tasks: SuiteGateTask[]) {
    return selectedIds.length === marketingPlan.length && suiteBlockerIds(selectedIds, tasks).length === 0;
}
