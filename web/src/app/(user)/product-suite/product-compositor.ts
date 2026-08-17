"use client";

export type ProductTemplateId = "hero-split" | "selling-detail" | "info-panel" | "scene" | "asymmetric" | "catalog";

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
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建合成画布");

    const product = await loadImage(options.product.dataUrl);
    const background = options.background ? await loadImage(options.background) : null;
    context.fillStyle = options.neutralColor;
    context.fillRect(0, 0, size, size);

    const common = { context, canvas, product, background, options, size };
    if (options.template === "hero-split") drawHeroSplit(common);
    if (options.template === "selling-detail") drawSellingDetail(common);
    if (options.template === "info-panel") drawInfoPanel(common);
    if (options.template === "scene") drawScene(common);
    if (options.template === "asymmetric") drawAsymmetric(common);
    if (options.template === "catalog") drawCatalog(common);

    return canvas.toDataURL("image/png");
}

export function templateRatioLabel(template: ProductTemplateId) {
    if (template === "hero-split") return "38 / 24 / 38";
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
    drawProduct(context, product, size * 0.025, size * 0.15, size * 0.35, size * 0.68, options);
    drawDetail(context, product, leftWidth + centerWidth, 0, leftWidth, size, options);
    drawPlainRibbon(context, 0, size * 0.89, leftWidth, size * 0.035, options.accentColor, -0.08);
    drawPlainRibbon(context, leftWidth + centerWidth, size * 0.9, leftWidth, size * 0.035, options.accentColor, 0.07);
    drawVerticalCopy(context, leftWidth, centerWidth, size, options);
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

function fitFontSize(context: CanvasRenderingContext2D, text: string, maxWidth: number, preferred: number, minimum: number) {
    let size = preferred;
    while (size > minimum) {
        context.font = `800 ${size}px Arial Narrow, Arial, sans-serif`;
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
