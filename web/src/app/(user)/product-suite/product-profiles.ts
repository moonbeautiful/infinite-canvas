import type { ProductAspectRatio, ProductTemplateId } from "./product-compositor";

export type ProductCategoryId = "mechanical" | "electronics" | "home" | "beauty" | "fashion" | "food" | "toy" | "jewelry" | "general";

export type ProductProfile = {
    name: string;
    category: ProductCategoryId;
    material: string;
    audience: string;
    marketplace: string;
    language: string;
    sellingPoints: string[];
};

export type SuiteFrame = {
    id: string;
    index: number;
    type: "卖点图" | "场景图" | "白底图";
    task: string;
    template: ProductTemplateId;
    aspectRatio: ProductAspectRatio;
    headline: string;
    supportingLine: string;
    sceneDescription: string;
    productScale: number;
    productOffsetX: number;
    productOffsetY: number;
    detailFocusX: number;
    detailFocusY: number;
};

export type CategoryPreset = {
    id: ProductCategoryId;
    label: string;
    visualDirection: string;
    defaultMaterial: string;
    defaultAudience: string;
    defaultSellingPoints: string[];
    palette: {
        primary: string;
        accent: string;
        neutral: string;
        dark: string;
    };
    frames: Array<{
        type: SuiteFrame["type"];
        task: string;
        template: ProductTemplateId;
        aspectRatio?: ProductAspectRatio;
        headline: string;
        supportingLine?: string;
        scene: string;
        productScale: number;
        productOffsetX?: number;
        productOffsetY?: number;
        detailFocusX?: number;
        detailFocusY?: number;
    }>;
};

export const categoryPresets: CategoryPreset[] = [
    {
        id: "mechanical",
        label: "机械 / 户外",
        visualDirection: "bold, precise, outdoors-focused commercial photography with hard material contrast and controlled dramatic light",
        defaultMaterial: "metal, rubber and engineered components",
        defaultAudience: "outdoor and performance-focused buyers",
        defaultSellingPoints: ["RUGGED CONSTRUCTION", "VISIBLE FUNCTIONAL DETAILS", "READY FOR REAL USE"],
        palette: { primary: "#D62B28", accent: "#9BCB32", neutral: "#F5F5F0", dark: "#171A1D" },
        frames: [
            {
                type: "卖点图",
                task: "最强购买理由",
                template: "hero-split",
                headline: "{PRODUCT}",
                supportingLine: "RUGGED CONSTRUCTION | VISIBLE FUNCTIONAL DETAILS | READY FOR REAL USE",
                scene: "empty rugged outdoor trail with a clear dirt contact plane and warm directional sunlight",
                productScale: 1.12,
                productOffsetY: 0.1,
                detailFocusX: 0.35,
                detailFocusY: 0.58,
            },
            {
                type: "卖点图",
                task: "结构与材质",
                template: "selling-detail",
                headline: "ENGINEERED TO PERFORM",
                scene: "empty premium workshop-to-outdoor environment with restrained technical lighting",
                productScale: 1.02,
                productOffsetY: 0.05,
                detailFocusX: 0.38,
                detailFocusY: 0.58,
            },
            {
                type: "卖点图",
                task: "功能证据",
                template: "info-panel",
                headline: "FUNCTION YOU CAN SEE",
                scene: "empty category-appropriate technical environment with quiet upper-left negative space",
                productScale: 1.02,
                detailFocusX: 0.38,
                detailFocusY: 0.55,
            },
            { type: "场景图", task: "核心使用场景", template: "scene", headline: "", scene: "empty authentic outdoor use environment with a believable foreground ground plane", productScale: 1.02, productOffsetY: 0.1 },
            { type: "场景图", task: "生活方式与信任", template: "asymmetric", headline: "READY WHEN YOU ARE", scene: "empty aspirational outdoor staging area with broad clean negative space on the left", productScale: 1.02, productOffsetY: 0.08 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "electronics",
        label: "电子 / 家电",
        visualDirection: "quiet technical premium ecommerce photography, clean geometry, cool neutral light and subtle functional cues",
        defaultMaterial: "precision molded housing and electronic components",
        defaultAudience: "modern home and technology buyers",
        defaultSellingPoints: ["SMARTER EVERYDAY USE", "PRECISION-BUILT DETAILS", "CLEAN MODERN DESIGN"],
        palette: { primary: "#1677FF", accent: "#55D6BE", neutral: "#F5F7FA", dark: "#111827" },
        frames: [
            { type: "卖点图", task: "核心功能", template: "info-panel", headline: "SMARTER EVERYDAY", scene: "empty modern technical studio with quiet upper-left information space", productScale: 1.05, productOffsetY: 0.05 },
            { type: "卖点图", task: "结构与接口", template: "selling-detail", headline: "DESIGNED IN DETAIL", scene: "empty cool-gray studio-to-desk environment with controlled edge lighting", productScale: 1.02, detailFocusX: 0.55, detailFocusY: 0.55 },
            {
                type: "卖点图",
                task: "性能证据",
                template: "hero-split",
                headline: "POWER MEETS SIMPLICITY",
                scene: "empty modern home technology environment with clean surfaces and cool daylight",
                productScale: 1.05,
                productOffsetY: 0.04,
                detailFocusX: 0.55,
                detailFocusY: 0.55,
            },
            { type: "场景图", task: "家庭使用场景", template: "scene", headline: "", scene: "empty modern home interior with a realistic placement surface and natural daylight", productScale: 1.02, productOffsetY: 0.08 },
            { type: "场景图", task: "桌面或移动场景", template: "asymmetric", headline: "FITS YOUR ROUTINE", scene: "empty refined workspace with broad negative space and subtle ambient lighting", productScale: 1 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "home",
        label: "家居 / 家具",
        visualDirection: "warm editorial home photography, tactile materials, natural daylight and calm lived-in elegance",
        defaultMaterial: "home-grade tactile materials",
        defaultAudience: "design-conscious households",
        defaultSellingPoints: ["COMFORT IN EVERY DETAIL", "MADE FOR DAILY LIVING", "TIMELESS HOME STYLE"],
        palette: { primary: "#3F6F68", accent: "#CDAA7D", neutral: "#F7F4EF", dark: "#25302E" },
        frames: [
            { type: "卖点图", task: "舒适与设计", template: "asymmetric", headline: "COMFORT, BEAUTIFULLY MADE", scene: "empty warm editorial living room with natural side light and broad negative space", productScale: 1.08, productOffsetY: 0.1 },
            { type: "卖点图", task: "材质细节", template: "selling-detail", headline: "TEXTURE YOU CAN FEEL", scene: "empty refined interior close-up environment with soft window light", productScale: 1.02, detailFocusX: 0.5, detailFocusY: 0.5 },
            { type: "卖点图", task: "结构与尺寸", template: "info-panel", headline: "DESIGNED FOR REAL HOMES", scene: "empty bright interior with quiet upper-left space and a stable floor plane", productScale: 1.02, productOffsetY: 0.08 },
            { type: "场景图", task: "核心家居场景", template: "scene", headline: "", scene: "empty aspirational lived-in home interior with natural daylight and a clear placement area", productScale: 1.05, productOffsetY: 0.12 },
            { type: "场景图", task: "第二空间场景", template: "asymmetric", headline: "MAKE SPACE FEEL YOURS", scene: "empty complementary home setting with calm styling and broad negative space", productScale: 1.02, productOffsetY: 0.1 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "beauty",
        label: "美妆 / 个护",
        visualDirection: "luxury beauty still-life photography, refined highlights, tactile color, polished stone and restrained editorial drama",
        defaultMaterial: "premium cosmetic packaging and sensorial formula",
        defaultAudience: "beauty and self-care buyers",
        defaultSellingPoints: ["LUXURY IN EVERY DETAIL", "RICH SENSORIAL COLOR", "ELEVATE YOUR DAILY RITUAL"],
        palette: { primary: "#8E1F2D", accent: "#D6B36A", neutral: "#F8F4F1", dark: "#231719" },
        frames: [
            {
                type: "卖点图",
                task: "品牌与质感",
                template: "beauty-ribbon",
                aspectRatio: "portrait",
                headline: "LUXURY WEIGHT DESIGN",
                supportingLine: "Crafted with substantial packaging for stability and precision.",
                scene: "empty portrait luxury beauty still-life with an ivory wall and a polished dark marble counter across the lower quarter",
                productScale: 1.12,
                productOffsetY: 0.12,
                detailFocusX: 0.5,
                detailFocusY: 0.35,
            },
            {
                type: "卖点图",
                task: "色泽与配方表现",
                template: "selling-detail",
                headline: "COLOR THAT COMMANDS ATTENTION",
                scene: "empty editorial beauty studio with controlled specular light and a clean detail area",
                productScale: 1.04,
                detailFocusX: 0.5,
                detailFocusY: 0.28,
            },
            { type: "卖点图", task: "包装与使用体验", template: "asymmetric", headline: "BEAUTY, REFINED", scene: "empty premium vanity with broad negative space, subtle mirror reflections and soft daylight", productScale: 1.08, productOffsetY: 0.08 },
            { type: "场景图", task: "日常妆容场景", template: "scene", headline: "", scene: "empty refined dressing table at golden hour with a clear placement surface", productScale: 1.05, productOffsetY: 0.12 },
            { type: "场景图", task: "礼赠与情绪价值", template: "asymmetric", headline: "A RITUAL WORTH KEEPING", scene: "empty luxury gift-ready beauty setting with silk, stone and broad negative space", productScale: 1.04, productOffsetY: 0.1 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "fashion",
        label: "服饰 / 配件",
        visualDirection: "fashion editorial product photography, confident composition, tactile fabric and clean directional light",
        defaultMaterial: "wearable fabric and finished hardware",
        defaultAudience: "style-conscious shoppers",
        defaultSellingPoints: ["STYLE THAT MOVES WITH YOU", "DETAILS THAT DEFINE THE LOOK", "MADE FOR EVERYDAY WEAR"],
        palette: { primary: "#1F2937", accent: "#D9485F", neutral: "#F7F7F5", dark: "#111111" },
        frames: [
            { type: "卖点图", task: "整体造型", template: "asymmetric", headline: "STYLE THAT MOVES WITH YOU", scene: "empty fashion editorial studio with broad negative space and directional light", productScale: 1.08, productOffsetY: 0.05 },
            { type: "卖点图", task: "面料与工艺", template: "selling-detail", headline: "DETAILS DEFINE THE LOOK", scene: "empty tactile fashion studio with a clean macro detail zone", productScale: 1.02, detailFocusX: 0.5, detailFocusY: 0.5 },
            { type: "卖点图", task: "版型与搭配", template: "info-panel", headline: "DESIGNED TO WEAR WELL", scene: "empty minimal wardrobe setting with quiet upper-left information space", productScale: 1.03 },
            { type: "场景图", task: "日常穿搭场景", template: "scene", headline: "", scene: "empty urban lifestyle setting with a clear foreground placement area", productScale: 1.04, productOffsetY: 0.08 },
            { type: "场景图", task: "第二风格场景", template: "asymmetric", headline: "MAKE IT YOURS", scene: "empty complementary fashion editorial setting with broad negative space", productScale: 1.02 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "food",
        label: "食品 / 饮品",
        visualDirection: "fresh premium food photography, appetizing natural color, clean ingredients and directional daylight",
        defaultMaterial: "food-safe packaging and visible ingredients",
        defaultAudience: "quality-focused food and beverage buyers",
        defaultSellingPoints: ["FRESHNESS YOU CAN SEE", "MADE WITH CARE", "READY TO ENJOY"],
        palette: { primary: "#2F6B3B", accent: "#F2B134", neutral: "#FFF9F0", dark: "#253025" },
        frames: [
            { type: "卖点图", task: "风味与新鲜度", template: "info-panel", headline: "FRESHNESS YOU CAN SEE", scene: "empty bright culinary set with ingredient-inspired shadows and quiet upper-left space", productScale: 1.08, productOffsetY: 0.08 },
            { type: "卖点图", task: "原料与质地", template: "selling-detail", headline: "MADE WITH CARE", scene: "empty clean kitchen-to-table setting with a macro detail area", productScale: 1.04, detailFocusX: 0.5, detailFocusY: 0.45 },
            { type: "卖点图", task: "包装与份量", template: "asymmetric", headline: "GOODNESS, READY TO SHARE", scene: "empty fresh tabletop set with broad negative space and natural daylight", productScale: 1.05, productOffsetY: 0.08 },
            { type: "场景图", task: "食用场景", template: "scene", headline: "", scene: "empty appetizing dining scene with a clear foreground serving surface", productScale: 1.05, productOffsetY: 0.1 },
            { type: "场景图", task: "分享或礼赠场景", template: "asymmetric", headline: "A MOMENT TO ENJOY", scene: "empty social tabletop scene with broad negative space and warm daylight", productScale: 1.03, productOffsetY: 0.08 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "toy",
        label: "玩具 / 宠物",
        visualDirection: "warm family lifestyle photography, soft tactile detail, friendly color and gentle natural light",
        defaultMaterial: "soft tactile child-friendly materials",
        defaultAudience: "families, gift buyers and comfort seekers",
        defaultSellingPoints: ["CLOUD-SOFT COMFORT", "HUGGABLE SUPPORT", "A GIFT TO REMEMBER"],
        palette: { primary: "#C65E26", accent: "#7DA7A0", neutral: "#FAF6EF", dark: "#332722" },
        frames: [
            {
                type: "卖点图",
                task: "触感与情绪价值",
                template: "soft-story",
                aspectRatio: "landscape",
                headline: "YOUR CUDDLE BUDDY AWAITS",
                supportingLine: "Ergonomically designed in a prone position, an ideal companion for hugs and naps.",
                scene: "empty panoramic warm bedroom with ivory bedding, linen textures, gentle window light and clear product placement areas",
                productScale: 1.1,
                productOffsetY: 0.15,
                detailFocusX: 0.55,
                detailFocusY: 0.48,
            },
            { type: "卖点图", task: "材质细节", template: "selling-detail", headline: "TEXTURE MADE FOR HUGS", scene: "empty soft textile studio-to-bedroom setting with a clean detail area", productScale: 1.04, detailFocusX: 0.58, detailFocusY: 0.48 },
            { type: "卖点图", task: "结构与陪伴", template: "info-panel", headline: "HUGGABLE SUPPORT", scene: "empty cozy reading nook with quiet upper-left information space", productScale: 1.06, productOffsetY: 0.08 },
            { type: "场景图", task: "卧室陪伴场景", template: "scene", headline: "", scene: "empty warm family bedroom with an ivory linen bed and clear placement area", productScale: 1.08, productOffsetY: 0.12 },
            { type: "场景图", task: "礼赠场景", template: "asymmetric", headline: "A GIFT TO REMEMBER", scene: "empty warm gift-ready bedroom setting with ribbon-free styling and broad negative space", productScale: 1.05, productOffsetY: 0.1 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "jewelry",
        label: "珠宝 / 礼品",
        visualDirection: "luxury jewelry still-life photography, precise highlights, dark-to-light contrast and refined minimalism",
        defaultMaterial: "precious metal, crystal or polished decorative material",
        defaultAudience: "luxury and gift buyers",
        defaultSellingPoints: ["BRILLIANCE IN EVERY DETAIL", "CRAFTED WITH PRECISION", "A GIFT THAT LASTS"],
        palette: { primary: "#B08D57", accent: "#E2CFA8", neutral: "#F7F4EE", dark: "#171717" },
        frames: [
            {
                type: "卖点图",
                task: "光泽与高级感",
                template: "info-panel",
                headline: "BRILLIANCE IN EVERY DETAIL",
                scene: "empty luxury jewelry still-life set with precise highlights and quiet upper-left space",
                productScale: 1.12,
                productOffsetY: 0.08,
                detailFocusX: 0.5,
                detailFocusY: 0.5,
            },
            { type: "卖点图", task: "工艺细节", template: "selling-detail", headline: "CRAFTED WITH PRECISION", scene: "empty dark velvet-to-stone studio with a clean macro detail area", productScale: 1.04, detailFocusX: 0.5, detailFocusY: 0.5 },
            { type: "卖点图", task: "设计与佩戴价值", template: "asymmetric", headline: "DESIGNED TO BE REMEMBERED", scene: "empty refined luxury setting with broad negative space", productScale: 1.08, productOffsetY: 0.08 },
            { type: "场景图", task: "仪式感场景", template: "scene", headline: "", scene: "empty elegant dressing table or ceremony setting with a clear placement surface", productScale: 1.05, productOffsetY: 0.1 },
            { type: "场景图", task: "礼赠场景", template: "asymmetric", headline: "A GIFT THAT LASTS", scene: "empty gift-ready luxury setting with subtle fabric and broad negative space", productScale: 1.04, productOffsetY: 0.08 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
    {
        id: "general",
        label: "其他商品",
        visualDirection: "premium international ecommerce photography, restrained styling, realistic materials and clean visual hierarchy",
        defaultMaterial: "category-appropriate product materials",
        defaultAudience: "online shoppers",
        defaultSellingPoints: ["DESIGNED FOR REAL LIFE", "DETAILS THAT MATTER", "MADE TO BE USED"],
        palette: { primary: "#2E5D62", accent: "#D2A84A", neutral: "#F7F6F2", dark: "#1F292B" },
        frames: [
            { type: "卖点图", task: "最强购买理由", template: "asymmetric", headline: "DESIGNED FOR REAL LIFE", scene: "empty category-appropriate premium commercial setting with broad negative space", productScale: 1.08, productOffsetY: 0.08 },
            { type: "卖点图", task: "材质与细节", template: "selling-detail", headline: "DETAILS THAT MATTER", scene: "empty premium studio-to-lifestyle setting with a clean detail area", productScale: 1.02, detailFocusX: 0.5, detailFocusY: 0.5 },
            { type: "卖点图", task: "功能证据", template: "info-panel", headline: "MADE TO BE USED", scene: "empty category-appropriate setting with quiet upper-left information space", productScale: 1.04 },
            { type: "场景图", task: "核心使用场景", template: "scene", headline: "", scene: "empty authentic lifestyle environment with a clear placement plane", productScale: 1.04, productOffsetY: 0.1 },
            { type: "场景图", task: "第二使用或礼赠场景", template: "asymmetric", headline: "FITS THE WAY YOU LIVE", scene: "empty complementary lifestyle environment with broad negative space", productScale: 1.02, productOffsetY: 0.08 },
            { type: "白底图", task: "完整商品展示", template: "catalog", headline: "", scene: "", productScale: 1 },
        ],
    },
];

export function categoryPreset(category: ProductCategoryId) {
    return categoryPresets.find((item) => item.id === category) || categoryPresets[categoryPresets.length - 1];
}

export function createDefaultProfile(category: ProductCategoryId = "general"): ProductProfile {
    const preset = categoryPreset(category);
    return {
        name: "PRODUCT NAME",
        category,
        material: preset.defaultMaterial,
        audience: preset.defaultAudience,
        marketplace: "Amazon US",
        language: "English",
        sellingPoints: [...preset.defaultSellingPoints],
    };
}

export function buildSuiteFrames(profile: ProductProfile): SuiteFrame[] {
    const preset = categoryPreset(profile.category);
    const points = normalizeSellingPoints(profile.sellingPoints, preset.defaultSellingPoints);
    return preset.frames.map((frame, index) => {
        const headline = frame.headline === "{PRODUCT}" ? profile.name.trim().toUpperCase() || points[0] : frame.headline || points[Math.min(index, points.length - 1)];
        const supportingLine = frame.type === "白底图" ? "" : points[Math.min(index, points.length - 1)] || preset.defaultSellingPoints[Math.min(index, preset.defaultSellingPoints.length - 1)];
        return {
            id: `frame-${index + 1}`,
            index,
            type: frame.type,
            task: frame.task,
            template: frame.template,
            aspectRatio: frame.aspectRatio || "square",
            headline,
            supportingLine: frame.supportingLine || supportingLine,
            sceneDescription: [
                frame.scene,
                preset.visualDirection,
                profile.material ? `Material context: ${profile.material}.` : "",
                profile.audience ? `Audience context: ${profile.audience}.` : "",
                profile.marketplace ? `Marketplace context: ${profile.marketplace}.` : "",
            ]
                .filter(Boolean)
                .join(" "),
            productScale: frame.productScale,
            productOffsetX: frame.productOffsetX || 0,
            productOffsetY: frame.productOffsetY || 0,
            detailFocusX: frame.detailFocusX ?? 0.5,
            detailFocusY: frame.detailFocusY ?? 0.5,
        };
    });
}

export function profileFromUnknown(value: unknown, fallback: ProductProfile): ProductProfile {
    if (!value || typeof value !== "object") return fallback;
    const source = value as Record<string, unknown>;
    const requestedCategory = String(source.category || "") as ProductCategoryId;
    const category = categoryPresets.some((item) => item.id === requestedCategory) ? requestedCategory : fallback.category;
    const preset = categoryPreset(category);
    const sellingPoints = Array.isArray(source.sellingPoints)
        ? source.sellingPoints
              .map(String)
              .map((item) => item.trim())
              .filter(Boolean)
              .slice(0, 3)
        : fallback.sellingPoints;
    return {
        name: String(source.name || fallback.name).trim() || fallback.name,
        category,
        material: String(source.material || preset.defaultMaterial).trim(),
        audience: String(source.audience || preset.defaultAudience).trim(),
        marketplace: String(source.marketplace || fallback.marketplace).trim(),
        language: String(source.language || fallback.language).trim(),
        sellingPoints: normalizeSellingPoints(sellingPoints, preset.defaultSellingPoints),
    };
}

function normalizeSellingPoints(value: string[], fallback: string[]) {
    const next = value
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 3);
    while (next.length < 3) next.push(fallback[next.length] || "VISIBLE PRODUCT VALUE");
    return next;
}
