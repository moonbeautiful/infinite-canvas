import type { CampaignOptions, MarketingTaskId } from "./product-marketing-plan";
import { categoryPreset, type ProductCategoryId } from "./product-profiles";

export type ProductScenePlan = {
    id: string;
    label: string;
    category: ProductCategoryId;
    heroEnvironment: string;
    useEnvironment: string;
    alternateEnvironment: string;
    surfaceAndProps: string;
    lighting: string;
    scaleAndPlacement: string;
    avoid: string;
    recommendedColor: string;
    industryVisualDirection: string;
};

type SceneRule = Omit<ProductScenePlan, "recommendedColor" | "industryVisualDirection"> & {
    pattern: RegExp;
};

const sceneRules: SceneRule[] = [
    {
        id: "robot-vacuum",
        label: "扫地机器人 / 清洁家电",
        category: "electronics",
        pattern: /robot\s*vacuum|roomba|floor\s*cleaner|扫地机器人|扫拖|清洁机器人/i,
        heroEnvironment: "a refined modern bedroom-to-living-room interior with a continuous clean floor plane",
        useEnvironment: "a believable modern bedroom or living room floor, moving naturally along furniture edges with realistic clearance",
        alternateEnvironment: "a coordinated hallway or dining-room floor from the same modern home",
        surfaceAndProps: "matte wood or stone flooring, restrained bed or sofa edges, one subtle plant or textile accent",
        lighting: "soft directional window daylight with one consistent side-light direction and clean contact shadows",
        scaleAndPlacement: "the product must sit directly on the floor at true appliance scale; never place it on a table, shelf, bed, or pedestal",
        avoid: "industrial workshops, outdoor terrain, decorative podiums, floating placement, oversized furniture-scale product",
    },
    {
        id: "plush-toy",
        label: "毛绒玩具 / 陪伴玩偶",
        category: "toy",
        pattern: /plush|stuffed|teddy|doll|soft\s*toy|毛绒|玩偶|公仔|布偶/i,
        heroEnvironment: "a warm family bedroom with an ivory linen bed and a calm reading-nook mood",
        useEnvironment: "a child-safe bedroom or cozy playroom, naturally placed on a bed, rug, or reading chair",
        alternateEnvironment: "a coordinated gift-ready bedside setting using the same textiles and room palette",
        surfaceAndProps: "ivory linen, soft woven rug, warm pale wood, restrained books or cushions",
        lighting: "gentle morning window light from one side, soft open shadows, warm-neutral white balance",
        scaleAndPlacement: "keep the toy at believable cuddle scale with soft fabric compression where it touches the bed, rug, or chair",
        avoid: "hard industrial sets, wet surfaces, dramatic neon light, unsafe small props, luxury stone podiums",
    },
    {
        id: "formal-dress",
        label: "礼服 / 宴会服饰",
        category: "fashion",
        pattern: /gown|evening\s*dress|formal\s*dress|ball\s*gown|礼服|晚礼服|宴会裙|婚纱/i,
        heroEnvironment: "an elegant hotel ballroom foyer or refined banquet interior with understated architectural depth",
        useEnvironment: "a believable gala, banquet, ceremony, or evening reception setting appropriate to formalwear",
        alternateEnvironment: "a coordinated dressing room or grand staircase from the same event venue",
        surfaceAndProps: "polished stone or dark wood floor, restrained drapery, subtle warm practical lights, no busy party clutter",
        lighting: "controlled editorial side light with warm ambient fill, consistent highlight direction, fabric-preserving contrast",
        scaleAndPlacement: "show the garment at true full-body scale on a natural model or dress form when appropriate; preserve drape and hem contact",
        avoid: "casual street scenes, sports settings, office desks, product podiums, stiff impossible fabric, mismatched daytime beach scenes",
    },
    {
        id: "coffee-kitchen-appliance",
        label: "咖啡机 / 厨房家电",
        category: "electronics",
        pattern: /coffee\s*machine|espresso|kettle|toaster|blender|air\s*fryer|咖啡机|意式机|水壶|烤面包机|破壁机|空气炸锅/i,
        heroEnvironment: "a premium contemporary kitchen or café counter with clean architectural lines",
        useEnvironment: "a believable kitchen worktop or refined café service area with the product ready for normal use",
        alternateEnvironment: "a coordinated breakfast bar using the same counter material and cabinet palette",
        surfaceAndProps: "stone or sealed wood counter, one cup or ingredient cue, restrained metal and ceramic accessories",
        lighting: "soft window daylight plus a controlled warm practical accent, all shadows sharing one direction",
        scaleAndPlacement: "keep correct countertop scale, grounded feet, believable clearance, and realistic cable or opening orientation",
        avoid: "bedrooms, floor placement, outdoor trails, crowded restaurant tables, excessive ingredients hiding the product",
    },
    {
        id: "beauty",
        label: "美妆 / 个护",
        category: "beauty",
        pattern: /lipstick|serum|cream|cosmetic|makeup|perfume|skincare|口红|精华|面霜|香水|美妆|护肤/i,
        heroEnvironment: "a refined beauty still-life set transitioning naturally into a premium vanity environment",
        useEnvironment: "a believable dressing table or bathroom vanity with a clean placement surface",
        alternateEnvironment: "a coordinated gift-ready beauty setting using the same stone, glass, and textile material family",
        surfaceAndProps: "polished or honed stone, subtle mirror reflection, one restrained fabric or botanical accent",
        lighting: "large soft key light with controlled specular highlights and one stable highlight direction",
        scaleAndPlacement: "keep true hand-scale proportions, precise upright contact, and packaging reflections consistent with the surface",
        avoid: "industrial floors, outdoor trails, kitchen food props, excessive flowers, fake liquid splashes, cluttered cosmetics",
    },
    {
        id: "jewelry",
        label: "珠宝 / 礼赠",
        category: "jewelry",
        pattern: /ring|necklace|bracelet|earring|watch|jewel|戒指|项链|手链|耳环|腕表|珠宝/i,
        heroEnvironment: "a precise luxury still-life set with restrained ceremony or dressing-table cues",
        useEnvironment: "an elegant dressing table, ceremony preparation, or gift moment at believable jewelry scale",
        alternateEnvironment: "a coordinated velvet, stone, or lacquer presentation setting from the same luxury campaign",
        surfaceAndProps: "dark velvet, honed stone, lacquer, one subtle fabric fold, no generic treasure pile",
        lighting: "small controlled highlights plus soft fill, crisp metal or gemstone definition, stable reflection direction",
        scaleAndPlacement: "preserve exact small-object scale and fine contact shadows; macro views must retain recognizable SKU details",
        avoid: "oversized jewelry, busy floral sets, harsh blown highlights, outdoor dirt, unrelated household scenes",
    },
    {
        id: "food-drink",
        label: "食品 / 饮品",
        category: "food",
        pattern: /food|drink|coffee|tea|snack|chocolate|wine|食品|饮料|咖啡|茶|零食|巧克力|酒/i,
        heroEnvironment: "a fresh premium kitchen-to-table set with appetizing material and ingredient cues",
        useEnvironment: "a believable dining, serving, breakfast, or refreshment moment appropriate to the product",
        alternateEnvironment: "a coordinated sharing or gift-ready tabletop using the same tableware and light direction",
        surfaceAndProps: "food-safe stone, wood, ceramic, linen, and no more than two relevant ingredient cues",
        lighting: "warm natural side or soft top light that preserves freshness, texture, and package readability",
        scaleAndPlacement: "keep package and serving scale truthful with physically plausible condensation, steam, or crumbs only when appropriate",
        avoid: "cool blue lighting, unrelated tech props, bathroom scenes, excessive ingredients, impossible floating food",
    },
    {
        id: "home-furniture",
        label: "家居 / 家具",
        category: "home",
        pattern: /coffee\s*table|side\s*table|dining\s*table|dressing\s*table|chair|table|sofa|bed|lamp|cabinet|furniture|茶几|边桌|餐桌|梳妆台|椅|桌|沙发|床|灯|柜|家具|家居/i,
        heroEnvironment: "a calm editorial home interior that shows the product's material and silhouette at true room scale",
        useEnvironment: "a believable lived-in living room, bedroom, dining room, or study selected from the product's real function",
        alternateEnvironment: "a coordinated second room angle using the same architecture, flooring, and daylight direction",
        surfaceAndProps: "warm wood, soft white walls, tactile textiles, at most two restrained household props",
        lighting: "natural directional daylight with soft interior fill and consistent floor shadows",
        scaleAndPlacement: "respect human and room scale, floor contact, wall clearance, and normal ergonomic placement",
        avoid: "miniature furniture, floating legs, empty abstract podiums, unrelated outdoor scenes, excessive décor",
    },
    {
        id: "consumer-electronics",
        label: "电子产品 / 智能家电",
        category: "electronics",
        pattern: /phone|camera|speaker|headphone|keyboard|monitor|projector|gadget|手机|相机|音箱|耳机|键盘|显示器|投影|家电|电子/i,
        heroEnvironment: "a clean modern home-technology or workspace set chosen from the product's real function",
        useEnvironment: "a believable desk, media room, bedroom, or living-room context where this exact device is normally used",
        alternateEnvironment: "a coordinated second workspace or home zone using the same surfaces and cool-neutral palette",
        surfaceAndProps: "clean matte desk or home surface, restrained cable or companion device only when functionally relevant",
        lighting: "soft cool-neutral side light with precise edge highlights and one consistent shadow direction",
        scaleAndPlacement: "keep device scale, screen or control orientation, support, ventilation, and cable clearance physically credible",
        avoid: "random luxury podiums, unrelated kitchens or outdoor trails, excessive neon, floating devices, impossible reflections",
    },
    {
        id: "mechanical-outdoor",
        label: "机械 / 户外装备",
        category: "mechanical",
        pattern: /motor|bike|machine|tool|outdoor|vehicle|摩托|自行车|机械|工具|户外|车辆/i,
        heroEnvironment: "a controlled workshop-to-outdoor campaign set with rugged material contrast",
        useEnvironment: "an authentic trail, road, garage, workshop, or jobsite selected from the product's actual use",
        alternateEnvironment: "a coordinated preparation or storage setting using the same hard materials and warm directional light",
        surfaceAndProps: "dirt, asphalt, concrete, metal, rubber, and at most two functional tools or terrain cues",
        lighting: "warm directional sunlight or one hard workshop key with consistent shadow direction and readable dark detail",
        scaleAndPlacement: "preserve full mechanical scale, tire or foot contact, load-bearing orientation, and believable clearance",
        avoid: "bedrooms, vanity tables, soft toy props, floating machinery, duplicate vehicles, fake specifications",
    },
    {
        id: "fashion",
        label: "服饰 / 配件",
        category: "fashion",
        pattern: /dress|shirt|coat|shoe|bag|fashion|clothing|服装|裙|衣|外套|鞋|包|穿搭/i,
        heroEnvironment: "a restrained editorial fashion studio connected to a context appropriate to the garment's formality",
        useEnvironment: "a believable wardrobe, city, hospitality, social, or daily-wear setting selected from the garment and audience",
        alternateEnvironment: "a coordinated fitting room or editorial location using the same palette and light signature",
        surfaceAndProps: "clean architecture, tactile fabric-compatible surfaces, one restrained accessory cue",
        lighting: "editorial side light with fabric-preserving fill, consistent shadow and color temperature",
        scaleAndPlacement: "preserve true wearable scale, natural fabric drape, seams, hardware, and body interaction",
        avoid: "clashing backgrounds, stiff impossible folds, unrelated product podiums, duplicated garments, wrong occasion",
    },
    {
        id: "toy",
        label: "玩具 / 宠物用品",
        category: "toy",
        pattern: /pet\s+(?:bed|sofa|furniture|toy|bowl|carrier|mat|house)|bed\s+for\s+pets?|toy|pet|game|puzzle|宠物(?:床|沙发|家具|玩具|碗|航空箱|垫|窝)|玩具|宠物|游戏|拼图/i,
        heroEnvironment: "a warm, safe family lifestyle set appropriate to play, companionship, or pet use",
        useEnvironment: "a believable playroom, bedroom, family living area, or pet corner selected from the product's function",
        alternateEnvironment: "a coordinated gift or storage moment using the same room palette and soft materials",
        surfaceAndProps: "soft rug, pale wood, child-safe or pet-safe textiles, no more than two relevant play cues",
        lighting: "gentle natural daylight with soft open shadows and friendly warm-neutral color",
        scaleAndPlacement: "keep true play or pet scale, stable support, and natural interaction without multiplying the product",
        avoid: "industrial danger, sharp tools, luxury stone podiums, unsafe clutter, duplicated toys",
    },
];

const visualStyleDirections: Record<string, string> = {
    自动匹配: "",
    高端编辑: "refined editorial commercial photography, controlled contrast, restrained premium materials, precise art direction",
    极简科技: "clean geometric minimalism, cool-neutral surfaces, precise edge light, broad uncluttered negative space",
    自然生活: "authentic natural-light lifestyle photography, warm candid atmosphere, tactile real materials, gentle depth",
    活力社媒: "bright energetic campaign photography, confident color blocking, lively but realistic composition, crisp modern finish",
};

export function buildProductScenePlan(brief: string, fileNames: string[] = []): ProductScenePlan {
    const evidence = `${brief} ${fileNames.join(" ")}`.trim();
    const matched = sceneRules
        .map((rule, index) => {
            const matchedText = evidence.match(rule.pattern)?.[0] || "";
            return {
                rule,
                index,
                score: matchedText.replace(/[\s/_-]+/g, "").length,
            };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.rule;
    if (matched) return completePlan(matched);

    const fallback: SceneRule = {
        id: "general",
        label: "智能识别商品场景",
        category: "general",
        pattern: /(?:)/,
        heroEnvironment: "a premium commercial set derived from the product's visible category, function, materials, and buyer context",
        useEnvironment: "the most natural real-world place where this exact product is normally stored, worn, operated, displayed, or consumed",
        alternateEnvironment: "a second coordinated context from the same real-world use journey, not an unrelated decorative set",
        surfaceAndProps: "category-native surfaces and no more than two functionally relevant props inferred from the source product",
        lighting: "one coherent commercial lighting signature with stable direction, color temperature, contrast, and shadow softness",
        scaleAndPlacement: "infer true scale from the source product and place it with physically correct support, contact, clearance, and perspective",
        avoid: "generic luxury podiums unrelated to the product, arbitrary rooms, floating placement, implausible scale, decorative clutter",
    };
    return completePlan(fallback);
}

export function resolveCampaignBrandColor(options: CampaignOptions, plan: ProductScenePlan) {
    return options.brandColorPreset === "auto" ? plan.recommendedColor : options.brandColor;
}

export function buildCampaignStyleLock(options: CampaignOptions, plan: ProductScenePlan) {
    const accent = resolveCampaignBrandColor(options, plan);
    const selectedDirection = visualStyleDirections[options.visualStyle] || "";
    return [
        `CAMPAIGN VISUAL DNA: ${selectedDirection || plan.industryVisualDirection}.`,
        `COLOR SYSTEM: use ${accent} as the single restrained brand accent; support it with category-native neutrals; keep the dominant palette to no more than three colors.`,
        `LIGHTING SIGNATURE: ${plan.lighting}. Preserve the same light direction, shadow softness, color temperature, contrast curve, and highlight behavior from brand hero through vertical poster.`,
        `SET MATERIAL FAMILY: ${plan.surfaceAndProps}. Reuse this material and prop vocabulary across the campaign without repeating the same composition.`,
        "FINISH: photoreal commercial photography, consistent lens rendering, realistic contact and reflections, restrained retouching, no unrelated visual theme changes.",
    ].join("\n");
}

export function sceneInstructionForTask(plan: ProductScenePlan, taskId: MarketingTaskId) {
    if (taskId === "marketplace") return "";
    const environment =
        taskId === "hero" ? plan.heroEnvironment : taskId === "lifestyle" ? plan.useEnvironment : taskId === "banner" || taskId === "poster" ? plan.alternateEnvironment : `${plan.heroEnvironment}; borrow detail or layout cues from ${plan.useEnvironment}`;
    return [
        `PRODUCT-SCENE FIT: ${environment}.`,
        `PHYSICAL PLACEMENT: ${plan.scaleAndPlacement}.`,
        `SCENE EXCLUSIONS: ${plan.avoid}.`,
        "The scene must explain this product's real category, function, scale, and buyer occasion at first glance. Never choose a generic decorative scene merely because it looks premium.",
    ].join(" ");
}

function completePlan(rule: SceneRule): ProductScenePlan {
    const preset = categoryPreset(rule.category);
    const { pattern: _pattern, ...plan } = rule;
    return {
        ...plan,
        recommendedColor: preset.palette.primary,
        industryVisualDirection: preset.visualDirection,
    };
}
