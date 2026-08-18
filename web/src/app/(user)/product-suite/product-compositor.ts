"use client";

export type ProductTemplateId = "hero-split" | "beauty-ribbon" | "soft-story" | "selling-detail" | "info-panel" | "scene" | "asymmetric" | "catalog";
export type ProductAspectRatio = "square" | "portrait" | "landscape";

export type ProductTemplate = {
    id: ProductTemplateId;
    name: string;
    type: string;
    scenePrompt: string;
};

export const productTemplates: ProductTemplate[] = [
    {
        id: "hero-split",
        name: "三栏品牌主图",
        type: "卖点图",
        scenePrompt:
            "Create a square empty commercial environment plate for the product category. Deep realistic perspective, premium international ecommerce campaign lighting, clear ground plane, restrained props, no product, no vehicle, no text, no letters, no numbers, no logo, no badge, no watermark.",
    },
    {
        id: "beauty-ribbon",
        name: "奢华丝绸静物",
        type: "卖点图",
        scenePrompt:
            "Create an empty portrait 3:4 luxury beauty still-life background. Soft ivory studio wall, polished dark marble counter across the lower quarter, refined directional light, generous clean space in the upper half. No product, no fabric, no text, no letters, no logo, no badge, no watermark.",
    },
    {
        id: "soft-story",
        name: "A+ 陪伴横幅",
        type: "卖点图",
        scenePrompt:
            "Create an empty panoramic 16:9 warm family bedroom background for an ecommerce A+ module. Gentle morning window light, ivory bedding, warm wood floor, broad calm negative space on the left and a believable placement area on the right. No product, no toy, no text, no letters, no logo, no badge, no watermark.",
    },
    {
        id: "selling-detail",
        name: "主体与细节",
        type: "卖点图",
        scenePrompt: "Create a square empty premium studio-to-lifestyle background plate with one continuous ground plane and a clean right-side detail area. Photorealistic commercial lighting, no product, no text, no logo, no badge, no watermark.",
    },
    {
        id: "info-panel",
        name: "信息面板",
        type: "卖点图",
        scenePrompt:
            "Create a square empty category-appropriate commercial scene with a clear foreground placement area and quiet negative space in the upper left. Photorealistic, premium ecommerce art direction, no product, no text, no logo, no badge, no watermark.",
    },
    {
        id: "scene",
        name: "沉浸场景",
        type: "场景图",
        scenePrompt: "Create a square empty photorealistic lifestyle environment for a premium ecommerce campaign. Leave a believable foreground plane for one product, natural light and depth, no product, no text, no logo, no badge, no watermark.",
    },
    {
        id: "asymmetric",
        name: "非对称留白",
        type: "场景图",
        scenePrompt: "Create a square empty premium lifestyle background with the visual weight on the right and broad clean negative space on the left. Photorealistic commercial photography, no product, no text, no logo, no badge, no watermark.",
    },
    {
        id: "catalog",
        name: "白底目录图",
        type: "白底图",
        scenePrompt: "",
    },
];

export type ProductCutout = {
    dataUrl: string;
    width: number;
    height: number;
    sourceWidth: number;
    sourceHeight: number;
};

export type ComposeOptions = {
    product: ProductCutout;
    background?: string;
    template: ProductTemplateId;
    headline: string;
    supportingLine: string;
    primaryColor: string;
    accentColor: string;
    neutralColor: string;
    darkColor: string;
    outputSize?: number;
    aspectRatio?: ProductAspectRatio;
    productScale?: number;
    productOffsetX?: number;
    productOffsetY?: number;
    detailFocusX?: number;
    detailFocusY?: number;
};

export type ExtractionProgress = {
    step: "downloading" | "processing" | "postprocessing" | "complete";
    progress: number;
    message: string;
};

type LoadedImage = HTMLImageElement;

export async function extractProductWithAi(dataUrl: string, onProgress?: (progress: ExtractionProgress) => void, alphaFloor = 72): Promise<ProductCutout> {
    const [rembg, ort] = await Promise.all([import("@bunnio/rembg-web"), import("onnxruntime-web")]);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/wasm/";
    rembg.rembgConfig.setCustomModelPath("u2netp", "/models/u2netp.onnx");
    const source = await loadImage(dataUrl);
    const blob = await (await fetch(dataUrl)).blob();
    const session = await rembg.newSession("u2netp");
    const result = await rembg.remove(blob, {
        session,
        postProcessMask: true,
        onProgress,
    });
    return cropTransparentImage(URL.createObjectURL(result), source.naturalWidth, source.naturalHeight, alphaFloor);
}

export async function extractProductFromWhiteBackground(dataUrl: string, tolerance = 30, feather = 24): Promise<ProductCutout> {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取商品图片");
    context.drawImage(image, 0, 0);

    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const { data, width, height } = frame;
    const cornerAlpha = [3, (width - 1) * 4 + 3, (height - 1) * width * 4 + 3, (height * width - 1) * 4 + 3].map((index) => data[index]);
    const alreadyTransparent = cornerAlpha.some((alpha) => alpha < 32);

    if (!alreadyTransparent) {
        const background = sampleBorderColor(data, width, height);
        const maxDistance = tolerance + feather;
        const visited = new Uint8Array(width * height);
        const queue = new Int32Array(width * height);
        let head = 0;
        let tail = 0;

        const enqueue = (index: number) => {
            if (visited[index]) return;
            visited[index] = 1;
            const offset = index * 4;
            if (colorDistance(data[offset], data[offset + 1], data[offset + 2], background) > maxDistance) return;
            queue[tail++] = index;
        };

        for (let x = 0; x < width; x += 1) {
            enqueue(x);
            enqueue((height - 1) * width + x);
        }
        for (let y = 1; y < height - 1; y += 1) {
            enqueue(y * width);
            enqueue(y * width + width - 1);
        }

        while (head < tail) {
            const index = queue[head++];
            const x = index % width;
            const y = Math.floor(index / width);
            if (x > 0) enqueue(index - 1);
            if (x < width - 1) enqueue(index + 1);
            if (y > 0) enqueue(index - width);
            if (y < height - 1) enqueue(index + width);
        }

        for (let index = 0; index < visited.length; index += 1) {
            if (!visited[index]) continue;
            const offset = index * 4;
            const distance = colorDistance(data[offset], data[offset + 1], data[offset + 2], background);
            data[offset + 3] = distance <= tolerance ? 0 : Math.round(255 * Math.min(1, (distance - tolerance) / Math.max(1, feather)));
        }
        context.putImageData(frame, 0, 0);
    }

    return cropTransparentCanvas(canvas, frame.data, width, height, width, height);
}

async function cropTransparentImage(src: string, sourceWidth: number, sourceHeight: number, alphaFloor: number) {
    const image = await loadImage(src);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("无法读取透明商品图");
    context.drawImage(image, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    decontaminateWhiteFringe(frame.data, alphaFloor);
    context.putImageData(frame, 0, 0);
    URL.revokeObjectURL(src);
    return cropTransparentCanvas(canvas, frame.data, canvas.width, canvas.height, sourceWidth, sourceHeight);
}

function cropTransparentCanvas(canvas: HTMLCanvasElement, data: Uint8ClampedArray, width: number, height: number, sourceWidth: number, sourceHeight: number) {
    const bounds = alphaBounds(data, width, height);
    const padding = Math.max(2, Math.round(Math.max(bounds.width, bounds.height) * 0.015));
    const sx = Math.max(0, bounds.x - padding);
    const sy = Math.max(0, bounds.y - padding);
    const sw = Math.min(width - sx, bounds.width + padding * 2);
    const sh = Math.min(height - sy, bounds.height + padding * 2);
    const output = document.createElement("canvas");
    output.width = sw;
    output.height = sh;
    output.getContext("2d")?.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

    return { dataUrl: output.toDataURL("image/png"), width: sw, height: sh, sourceWidth, sourceHeight };
}

export async function composeProductAd(options: ComposeOptions) {
    const size = options.outputSize || 2048;
    const [width, height] = productAspectDimensions(options.aspectRatio || "square", size);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建合成画布");

    const product = await loadImage(options.product.dataUrl);
    const background = options.background ? await loadImage(options.background) : null;
    context.fillStyle = options.neutralColor;
    context.fillRect(0, 0, width, height);

    const common = { context, canvas, product, background, options, size: Math.min(width, height), width, height };
    if (options.template === "hero-split") drawHeroSplit(common);
    if (options.template === "beauty-ribbon") drawBeautyRibbon(common);
    if (options.template === "soft-story") drawSoftStory(common);
    if (options.template === "selling-detail") drawSellingDetail(common);
    if (options.template === "info-panel") drawInfoPanel(common);
    if (options.template === "scene") drawScene(common);
    if (options.template === "asymmetric") drawAsymmetric(common);
    if (options.template === "catalog") drawCatalog(common);

    return canvas.toDataURL("image/png");
}

export function productAspectDimensions(aspectRatio: ProductAspectRatio, maxSize: number) {
    if (aspectRatio === "portrait") return [Math.round(maxSize * 0.75), maxSize] as const;
    if (aspectRatio === "landscape") return [maxSize, Math.round(maxSize / 2.44)] as const;
    return [maxSize, maxSize] as const;
}

export function productAspectLabel(aspectRatio: ProductAspectRatio) {
    if (aspectRatio === "portrait") return "3:4";
    if (aspectRatio === "landscape") return "1464:600";
    return "1:1";
}

export function templateRatioLabel(template: ProductTemplateId) {
    if (template === "hero-split") return "38 / 24 / 38";
    if (template === "beauty-ribbon") return "竖版静物";
    if (template === "soft-story") return "A+ 横幅";
    if (template === "selling-detail") return "64 / 36";
    if (template === "info-panel") return "72 / 28";
    if (template === "asymmetric") return "40 / 60";
    return "100";
}

type DrawContext = {
    context: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    product: LoadedImage;
    background: LoadedImage | null;
    options: ComposeOptions;
    size: number;
    width: number;
    height: number;
};

function drawHeroSplit(value: DrawContext) {
    const { context, product, background, options, size } = value;
    const leftWidth = size * 0.38;
    const centerWidth = size * 0.24;
    if (background) {
        drawCover(context, background, 0, 0, leftWidth, size, 0.4, 0.5);
        drawCover(context, background, leftWidth + centerWidth, 0, leftWidth, size, 0.65, 0.5);
    } else {
        fillScenePlaceholder(context, 0, 0, leftWidth, size, options.darkColor);
        fillScenePlaceholder(context, leftWidth + centerWidth, 0, leftWidth, size, options.darkColor);
    }
    context.fillStyle = options.neutralColor;
    context.fillRect(leftWidth, 0, centerWidth, size);
    context.save();
    context.beginPath();
    context.rect(0, 0, leftWidth, size);
    context.clip();
    drawProduct(context, product, size * 0.01, size * 0.13, size * 0.37, size * 0.72, { ...options, productScale: Math.max(1.24, options.productScale || 1) });
    context.restore();
    drawDetail(context, product, leftWidth + centerWidth, 0, leftWidth, size, options);
    drawPlainRibbon(context, 0, size * 0.89, leftWidth, size * 0.035, options.accentColor, -0.08);
    drawPlainRibbon(context, leftWidth + centerWidth, size * 0.9, leftWidth, size * 0.035, options.accentColor, 0.07);
    drawVerticalCopy(context, leftWidth, centerWidth, size, options);
}

function drawBeautyRibbon(value: DrawContext) {
    const { context, product, background, options, width, height } = value;
    if (background) drawCover(context, background, 0, 0, width, height, 0.5, 0.55);
    else {
        const wall = context.createLinearGradient(0, 0, 0, height);
        wall.addColorStop(0, "#f7f5f2");
        wall.addColorStop(0.72, "#ece9e4");
        wall.addColorStop(0.73, "#595654");
        wall.addColorStop(1, "#171515");
        context.fillStyle = wall;
        context.fillRect(0, 0, width, height);
    }

    const haze = context.createLinearGradient(0, 0, 0, height * 0.62);
    haze.addColorStop(0, "rgba(255,255,255,.8)");
    haze.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = haze;
    context.fillRect(0, 0, width, height * 0.64);
    drawSilkRibbon(context, width, height, options.primaryColor);
    drawMarbleCounter(context, width, height);

    context.save();
    context.translate(width * 0.5, height * 0.16);
    context.rotate(-0.12);
    context.textAlign = "center";
    context.textBaseline = "top";
    const headlineSize = fitFontSize(context, options.headline, width * 0.88, width * 0.072, width * 0.041, "serif");
    context.font = `500 ${headlineSize}px Georgia, "Times New Roman", serif`;
    context.fillStyle = options.primaryColor;
    context.fillText(options.headline.toUpperCase(), 0, 0, width * 0.9);
    context.font = `500 ${Math.max(width * 0.025, headlineSize * 0.47)}px Georgia, "Times New Roman", serif`;
    context.fillStyle = options.darkColor;
    wrapText(context, options.supportingLine, 0, headlineSize * 1.18, width * 0.72, headlineSize * 0.53, 2);
    context.restore();

    drawProduct(context, product, width * 0.16, height * 0.34, width * 0.68, height * 0.58, { ...options, productOffsetY: 0 });
    context.fillStyle = "rgba(255,255,255,.22)";
    context.fillRect(0, height * 0.91, width, Math.max(2, height * 0.004));
}

function drawSoftStory(value: DrawContext) {
    const { context, product, background, options, width, height } = value;
    if (background) drawCover(context, background, 0, 0, width, height, 0.5, 0.48);
    else {
        const room = context.createLinearGradient(0, 0, width, height);
        room.addColorStop(0, "#f4eee5");
        room.addColorStop(0.55, "#dcc9b4");
        room.addColorStop(1, "#ad8969");
        context.fillStyle = room;
        context.fillRect(0, 0, width, height);
    }

    const editorialWash = context.createLinearGradient(0, 0, width * 0.62, 0);
    editorialWash.addColorStop(0, "rgba(251,247,240,.96)");
    editorialWash.addColorStop(0.62, "rgba(251,247,240,.68)");
    editorialWash.addColorStop(1, "rgba(251,247,240,0)");
    context.fillStyle = editorialWash;
    context.fillRect(0, 0, width * 0.68, height);

    const insetX = width * 0.038;
    const insetY = height * 0.5;
    const insetWidth = width * 0.47;
    const insetHeight = height * 0.43;
    context.save();
    roundedRect(context, insetX, insetY, insetWidth, insetHeight, height * 0.055);
    context.clip();
    context.fillStyle = "rgba(248,244,237,.92)";
    context.fillRect(insetX, insetY, insetWidth, insetHeight);
    if (background) drawCover(context, background, insetX, insetY, insetWidth, insetHeight, 0.2, 0.72);
    drawProduct(context, product, insetX + insetWidth * 0.08, insetY + insetHeight * 0.05, insetWidth * 0.84, insetHeight * 0.88, { ...options, productScale: 1.12, productOffsetX: 0, productOffsetY: 0.04 });
    context.restore();

    context.textAlign = "left";
    context.textBaseline = "top";
    const headlineSize = fitFontSize(context, options.headline, width * 0.54, height * 0.105, height * 0.064);
    context.font = `600 ${headlineSize}px "Trebuchet MS", Arial, sans-serif`;
    context.fillStyle = options.primaryColor;
    wrapText(context, titleCase(options.headline), width * 0.05, height * 0.12, width * 0.53, headlineSize * 1.02, 2);
    context.font = `400 ${Math.max(22, height * 0.047)}px "Trebuchet MS", Arial, sans-serif`;
    context.fillStyle = options.darkColor;
    wrapText(context, options.supportingLine, width * 0.05, height * 0.31, width * 0.48, height * 0.058, 3);

    drawProduct(context, product, width * 0.59, height * 0.28, width * 0.34, height * 0.64, { ...options, productScale: 1.1, productOffsetX: 0, productOffsetY: 0.02 });

    context.save();
    context.strokeStyle = "rgba(255,255,255,.92)";
    context.lineWidth = Math.max(2, height * 0.006);
    roundedRect(context, height * 0.03, height * 0.03, width - height * 0.06, height - height * 0.06, height * 0.04);
    context.stroke();
    context.restore();
}

function drawSellingDetail(value: DrawContext) {
    const { context, product, background, options, size } = value;
    if (background) drawCover(context, background, 0, 0, size, size, 0.46, 0.55);
    else fillScenePlaceholder(context, 0, 0, size, size, options.darkColor);
    context.fillStyle = `${options.neutralColor}ee`;
    context.fillRect(size * 0.64, 0, size * 0.36, size);
    drawProduct(context, product, size * 0.055, size * 0.15, size * 0.55, size * 0.7, options);
    drawDetail(context, product, size * 0.67, size * 0.28, size * 0.3, size * 0.58, options);
    drawCopy(context, size * 0.68, size * 0.08, size * 0.27, options, "left");
}

function drawInfoPanel(value: DrawContext) {
    const { context, product, background, options, size } = value;
    if (background) drawCover(context, background, 0, 0, size, size, 0.5, 0.55);
    else fillScenePlaceholder(context, 0, 0, size, size, options.darkColor);
    drawProduct(context, product, size * 0.25, size * 0.18, size * 0.64, size * 0.68, options);
    context.fillStyle = `${options.neutralColor}f2`;
    context.fillRect(size * 0.04, size * 0.06, size * 0.29, size * 0.31);
    context.fillStyle = options.accentColor;
    context.fillRect(size * 0.04, size * 0.06, size * 0.012, size * 0.31);
    drawCopy(context, size * 0.075, size * 0.115, size * 0.22, options, "left");
}

function drawScene(value: DrawContext) {
    const { context, product, background, options, size } = value;
    if (background) drawCover(context, background, 0, 0, size, size, 0.5, 0.55);
    else fillScenePlaceholder(context, 0, 0, size, size, options.darkColor);
    drawProduct(context, product, size * 0.12, size * 0.16, size * 0.76, size * 0.7, options);
}

function drawAsymmetric(value: DrawContext) {
    const { context, product, background, options, size } = value;
    if (background) drawCover(context, background, 0, 0, size, size, 0.55, 0.5);
    else fillScenePlaceholder(context, 0, 0, size, size, options.darkColor);
    context.fillStyle = `${options.neutralColor}ed`;
    context.fillRect(0, 0, size * 0.4, size);
    drawCopy(context, size * 0.07, size * 0.35, size * 0.27, options, "left");
    drawProduct(context, product, size * 0.42, size * 0.17, size * 0.53, size * 0.68, options);
}

function drawCatalog(value: DrawContext) {
    const { context, product, options, size } = value;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    drawProduct(context, product, size * 0.1, size * 0.1, size * 0.8, size * 0.8, { ...options, productScale: 1, productOffsetX: 0, productOffsetY: 0 });
}

function drawProduct(context: CanvasRenderingContext2D, image: LoadedImage, x: number, y: number, width: number, height: number, options: ComposeOptions) {
    const baseScale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const scale = baseScale * Math.max(0.65, Math.min(1.35, options.productScale || 1));
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const dx = x + (width - drawWidth) / 2 + width * (options.productOffsetX || 0);
    const dy = y + (height - drawHeight) / 2 + height * (options.productOffsetY || 0);
    context.save();
    context.filter = `blur(${Math.max(8, width * 0.025)}px)`;
    context.fillStyle = "rgba(0,0,0,.38)";
    context.beginPath();
    context.ellipse(dx + drawWidth * 0.5, dy + drawHeight * 0.96, drawWidth * 0.34, Math.max(5, drawHeight * 0.035), 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
    context.save();
    context.drawImage(image, dx, dy, drawWidth, drawHeight);
    context.restore();
}

function drawDetail(context: CanvasRenderingContext2D, image: LoadedImage, x: number, y: number, width: number, height: number, options: ComposeOptions) {
    const focusX = Math.max(0, Math.min(1, options.detailFocusX ?? 0.35));
    const focusY = Math.max(0, Math.min(1, options.detailFocusY ?? 0.55));
    drawCover(context, image, x, y, width, height, focusX, focusY);
}

function drawVerticalCopy(context: CanvasRenderingContext2D, x: number, width: number, height: number, options: ComposeOptions) {
    context.save();
    context.translate(x + width * 0.5, height * 0.5);
    context.rotate(-Math.PI / 2);
    const maxWidth = height * 0.76;
    const headlineSize = fitFontSize(context, options.headline, maxWidth, width * 0.25, 30);
    context.font = `800 ${headlineSize}px Arial Narrow, Arial, sans-serif`;
    context.textBaseline = "middle";
    context.textAlign = "center";
    drawAccentHeadline(context, options.headline, 0, -width * 0.08, options.accentColor, options.darkColor);
    context.fillStyle = options.darkColor;
    context.font = `600 ${Math.max(22, headlineSize * 0.23)}px Arial, sans-serif`;
    context.fillText(options.supportingLine.toUpperCase(), 0, width * 0.23, maxWidth);
    context.restore();
}

function drawCopy(context: CanvasRenderingContext2D, x: number, y: number, width: number, options: ComposeOptions, align: CanvasTextAlign) {
    context.textAlign = align;
    context.textBaseline = "top";
    context.fillStyle = options.darkColor;
    const headlineSize = fitFontSize(context, options.headline, width, Math.max(44, width * 0.15), 24);
    context.font = `800 ${headlineSize}px Arial Narrow, Arial, sans-serif`;
    wrapText(context, options.headline.toUpperCase(), x, y, width, headlineSize * 0.92, 2);
    context.fillStyle = options.accentColor;
    context.fillRect(x, y + headlineSize * 2.1, width * 0.26, Math.max(5, headlineSize * 0.08));
    context.fillStyle = options.darkColor;
    context.font = `600 ${Math.max(20, headlineSize * 0.29)}px Arial, sans-serif`;
    wrapText(context, options.supportingLine.toUpperCase(), x, y + headlineSize * 2.45, width, headlineSize * 0.42, 3);
}

function drawAccentHeadline(context: CanvasRenderingContext2D, text: string, x: number, y: number, accent: string, dark: string) {
    const words = text.toUpperCase().trim().split(/\s+/);
    if (words.length < 2) {
        context.fillStyle = dark;
        context.fillText(text.toUpperCase(), x, y);
        return;
    }
    const first = words.shift() || "";
    const rest = words.join(" ");
    const gap = context.measureText(" ").width;
    const firstWidth = context.measureText(first).width;
    const restWidth = context.measureText(rest).width;
    const start = x - (firstWidth + gap + restWidth) / 2;
    context.textAlign = "left";
    context.fillStyle = accent;
    context.fillText(first, start, y);
    context.fillStyle = dark;
    context.fillText(rest, start + firstWidth + gap, y);
    context.textAlign = "center";
}

function wrapText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
    const words = text.trim().split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (context.measureText(next).width <= maxWidth || !line) line = next;
        else {
            lines.push(line);
            line = word;
        }
    }
    if (line) lines.push(line);
    lines.slice(0, maxLines).forEach((value, index) => context.fillText(value, x, y + index * lineHeight, maxWidth));
}

function fitFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, preferred: number, minimum: number, family = "Arial Narrow, Arial, sans-serif") {
    let size = preferred;
    while (size > minimum) {
        context.font = `800 ${size}px ${family}`;
        if (context.measureText(text.toUpperCase()).width <= maxWidth) return size;
        size -= 2;
    }
    return minimum;
}

function drawCover(context: CanvasRenderingContext2D, image: LoadedImage, x: number, y: number, width: number, height: number, focalX = 0.5, focalY = 0.5) {
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sx = Math.max(0, Math.min(image.naturalWidth - sourceWidth, image.naturalWidth * focalX - sourceWidth / 2));
    const sy = Math.max(0, Math.min(image.naturalHeight - sourceHeight, image.naturalHeight * focalY - sourceHeight / 2));
    context.drawImage(image, sx, sy, sourceWidth, sourceHeight, x, y, width, height);
}

function drawPlainRibbon(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string, rotation: number) {
    context.save();
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation);
    context.fillStyle = color;
    context.globalAlpha = 0.94;
    context.fillRect(-width * 0.56, -height / 2, width * 1.12, height);
    context.restore();
}

function drawSilkRibbon(context: CanvasRenderingContext2D, width: number, height: number, color: string) {
    context.save();
    context.shadowColor = "rgba(54,0,5,.42)";
    context.shadowBlur = height * 0.018;
    context.shadowOffsetY = height * 0.01;
    const silk = context.createLinearGradient(0, height * 0.25, 0, height * 0.55);
    silk.addColorStop(0, shadeColor(color, -38));
    silk.addColorStop(0.34, shadeColor(color, 20));
    silk.addColorStop(0.58, shadeColor(color, -10));
    silk.addColorStop(1, shadeColor(color, -48));
    context.fillStyle = silk;
    context.beginPath();
    context.moveTo(-width * 0.12, height * 0.45);
    context.bezierCurveTo(width * 0.12, height * 0.31, width * 0.3, height * 0.5, width * 0.52, height * 0.38);
    context.bezierCurveTo(width * 0.73, height * 0.25, width * 0.9, height * 0.32, width * 1.12, height * 0.16);
    context.lineTo(width * 1.12, height * 0.29);
    context.bezierCurveTo(width * 0.91, height * 0.43, width * 0.73, height * 0.38, width * 0.55, height * 0.51);
    context.bezierCurveTo(width * 0.31, height * 0.63, width * 0.1, height * 0.46, -width * 0.12, height * 0.59);
    context.closePath();
    context.fill();
    context.shadowColor = "transparent";
    context.strokeStyle = "rgba(255,255,255,.28)";
    context.lineWidth = Math.max(2, height * 0.006);
    context.beginPath();
    context.moveTo(-width * 0.05, height * 0.475);
    context.bezierCurveTo(width * 0.18, height * 0.36, width * 0.32, height * 0.54, width * 0.54, height * 0.42);
    context.bezierCurveTo(width * 0.75, height * 0.29, width * 0.9, height * 0.36, width * 1.05, height * 0.24);
    context.stroke();
    context.restore();
}

function drawMarbleCounter(context: CanvasRenderingContext2D, width: number, height: number) {
    const top = height * 0.73;
    const marble = context.createLinearGradient(0, top, 0, height);
    marble.addColorStop(0, "rgba(63,61,60,.82)");
    marble.addColorStop(0.15, "rgba(38,35,35,.92)");
    marble.addColorStop(1, "rgba(13,12,13,.98)");
    context.fillStyle = marble;
    context.fillRect(0, top, width, height - top);
    context.save();
    context.strokeStyle = "rgba(255,255,255,.26)";
    context.lineWidth = Math.max(2, width * 0.003);
    for (let index = 0; index < 5; index += 1) {
        const y = top + (height - top) * (0.14 + index * 0.17);
        context.beginPath();
        context.moveTo(-width * 0.08, y);
        context.bezierCurveTo(width * 0.18, y - height * 0.035, width * 0.42, y + height * 0.024, width * 0.65, y - height * 0.018);
        context.bezierCurveTo(width * 0.82, y - height * 0.05, width * 0.94, y + height * 0.02, width * 1.08, y - height * 0.028);
        context.stroke();
    }
    context.restore();
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}

function shadeColor(hex: string, amount: number) {
    const value = hex.replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
    const channels = [0, 2, 4].map((offset) => Math.max(0, Math.min(255, parseInt(value.slice(offset, offset + 2), 16) + amount)));
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function titleCase(value: string) {
    return value
        .toLowerCase()
        .split(/\s+/)
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(" ");
}

function fillScenePlaceholder(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, color: string) {
    context.fillStyle = color;
    context.fillRect(x, y, width, height);
    context.fillStyle = "rgba(255,255,255,.06)";
    for (let index = 0; index < 8; index += 1) {
        context.fillRect(x + width * (0.08 + index * 0.12), y, Math.max(2, width * 0.012), height);
    }
}

function sampleBorderColor(data: Uint8ClampedArray, width: number, height: number) {
    const sample = Math.max(2, Math.min(20, Math.round(Math.min(width, height) * 0.02)));
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (const [startX, startY] of [
        [0, 0],
        [width - sample, 0],
        [0, height - sample],
        [width - sample, height - sample],
    ]) {
        for (let y = startY; y < startY + sample; y += 1) {
            for (let x = startX; x < startX + sample; x += 1) {
                const offset = (y * width + x) * 4;
                r += data[offset];
                g += data[offset + 1];
                b += data[offset + 2];
                count += 1;
            }
        }
    }
    return { r: r / count, g: g / count, b: b / count };
}

function colorDistance(r: number, g: number, b: number, background: { r: number; g: number; b: number }) {
    return Math.sqrt((r - background.r) ** 2 + (g - background.g) ** 2 + (b - background.b) ** 2);
}

function alphaBounds(data: Uint8ClampedArray, width: number, height: number) {
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (data[(y * width + x) * 4 + 3] < 12) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    if (minX > maxX || minY > maxY) return { x: 0, y: 0, width, height };
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function decontaminateWhiteFringe(data: Uint8ClampedArray, alphaFloor: number) {
    const normalizedFloor = Math.max(0, Math.min(180, alphaFloor));
    for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = data[offset + 3];
        if (alpha <= normalizedFloor) {
            data[offset + 3] = 0;
            continue;
        }
        if (alpha >= 250) continue;
        const normalizedAlpha = alpha / 255;
        for (let channel = 0; channel < 3; channel += 1) {
            data[offset + channel] = Math.max(0, Math.min(255, (data[offset + channel] - 255 * (1 - normalizedAlpha)) / normalizedAlpha));
        }
        data[offset + 3] = Math.max(0, Math.min(255, Math.round((alpha - normalizedFloor) * (255 / (250 - normalizedFloor)))));
    }
}

function loadImage(src: string) {
    return new Promise<LoadedImage>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片加载失败"));
        image.src = src;
    });
}
