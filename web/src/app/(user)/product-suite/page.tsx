"use client";

import { App, Button, Input, Segmented, Select, Slider, Tag } from "antd";
import { zipSync } from "fflate";
import { Check, Download, ImagePlus, LoaderCircle, LockKeyhole, RefreshCw, Sparkles, Upload, WandSparkles } from "lucide-react";
import { saveAs } from "file-saver";
import { nanoid } from "nanoid";
import { useEffect, useMemo, useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { readFileAsDataUrl } from "@/lib/image-utils";
import { createCanvasImageTask, pollCanvasImageTaskStatus, requestGeneration } from "@/services/api/image";
import { imageToDataUrl } from "@/services/image-storage";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { composeProductAd, extractProductFromWhiteBackground, extractProductWithAi, productTemplates, templateRatioLabel, type ProductCutout } from "./product-compositor";
import { buildSuiteFrames, categoryPreset, categoryPresets, createDefaultProfile, type ProductCategoryId, type ProductProfile, type SuiteFrame } from "./product-profiles";

export default function ProductSuitePage() {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const updateConfig = useConfigStore((state) => state.updateConfig);

    const [profile, setProfile] = useState<ProductProfile>(() => createDefaultProfile());
    const [activeFrameIndex, setActiveFrameIndex] = useState(0);
    const [frameOverrides, setFrameOverrides] = useState<Partial<Record<string, Partial<SuiteFrame>>>>({});
    const [productSource, setProductSource] = useState("");
    const [productCutout, setProductCutout] = useState<ProductCutout | null>(null);
    const [styleReference, setStyleReference] = useState("");
    const [backgrounds, setBackgrounds] = useState<Partial<Record<string, string>>>({});
    const [preview, setPreview] = useState("");
    const [extracting, setExtracting] = useState(false);
    const [extractionMode, setExtractionMode] = useState<"ai" | "white">("ai");
    const [extractionStatus, setExtractionStatus] = useState("");
    const [generating, setGenerating] = useState(false);
    const [rendering, setRendering] = useState(false);
    const [generationStatus, setGenerationStatus] = useState("");
    const [tolerance, setTolerance] = useState(30);
    const [feather, setFeather] = useState(24);
    const [edgeCutoff, setEdgeCutoff] = useState(72);
    const defaultPalette = categoryPreset("general").palette;
    const [primaryColor, setPrimaryColor] = useState(defaultPalette.primary);
    const [accentColor, setAccentColor] = useState(defaultPalette.accent);
    const [neutralColor, setNeutralColor] = useState(defaultPalette.neutral);
    const [darkColor, setDarkColor] = useState(defaultPalette.dark);
    const [sourceHash, setSourceHash] = useState("");

    const suiteFrames = useMemo(() => buildSuiteFrames(profile).map((frame) => ({ ...frame, ...frameOverrides[frame.id] })), [frameOverrides, profile]);
    const activeFrame = suiteFrames[activeFrameIndex] || suiteFrames[0];
    const background = backgrounds[activeFrame.id];
    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const preparedBackgrounds = suiteFrames.filter((frame) => frame.template === "catalog" || backgrounds[frame.id]).length;

    useEffect(() => {
        if (!productCutout) {
            setPreview("");
            return;
        }
        let active = true;
        setRendering(true);
        const timer = window.setTimeout(() => {
            void renderCurrent(1024)
                .then((result) => {
                    if (active) setPreview(result);
                })
                .catch((error) => {
                    if (active) message.error(error instanceof Error ? error.message : "预览生成失败");
                })
                .finally(() => {
                    if (active) setRendering(false);
                });
        }, 80);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [accentColor, activeFrame, background, darkColor, feather, neutralColor, primaryColor, productCutout]);

    const renderCurrent = (outputSize: number, frameIndex = activeFrameIndex) => {
        if (!productCutout) throw new Error("请先上传商品原图");
        const frame = suiteFrames[frameIndex];
        if (!frame) throw new Error("套图任务不存在");
        return composeProductAd({
            product: productCutout,
            background: backgrounds[frame.id],
            template: frame.template,
            headline: frame.headline,
            supportingLine: frame.supportingLine,
            primaryColor,
            accentColor,
            neutralColor,
            darkColor,
            outputSize,
            productScale: frame.productScale,
            productOffsetX: frame.productOffsetX,
            productOffsetY: frame.productOffsetY,
            detailFocusX: frame.detailFocusX,
            detailFocusY: frame.detailFocusY,
        });
    };

    const handleProductFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        setProfile((value) => ({ ...value, name: file.name.replace(/\.[^.]+$/, "") || "商品" }));
        setProductSource(dataUrl);
        setSourceHash(await sha256(file));
        await extractProduct(dataUrl);
    };

    const extractProduct = async (source = productSource, mode = extractionMode) => {
        if (!source) {
            message.warning("请先上传商品原图");
            return;
        }
        setExtracting(true);
        setExtractionStatus(mode === "ai" ? "加载本地分割模型" : "提取白底");
        try {
            if (mode === "ai") {
                try {
                    setProductCutout(
                        await extractProductWithAi(
                            source,
                            (progress) => {
                                setExtractionStatus(`${progress.message} ${Math.round(progress.progress)}%`);
                            },
                            edgeCutoff,
                        ),
                    );
                } catch {
                    setProductCutout(await extractProductFromWhiteBackground(source, tolerance, feather));
                    message.warning("本地 AI 分割不可用，已切换白底提取");
                }
            } else {
                setProductCutout(await extractProductFromWhiteBackground(source, tolerance, feather));
            }
            message.success("商品像素锁已建立");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "商品提取失败");
        } finally {
            setExtracting(false);
            setExtractionStatus("");
        }
    };

    const handleStyleFile = async (file?: File) => {
        if (!file) return;
        const dataUrl = await readFileAsDataUrl(file);
        setStyleReference(dataUrl);
        const palette = await sampleStylePalette(dataUrl);
        setPrimaryColor(palette.primary);
        setAccentColor(palette.accent);
        setDarkColor(palette.dark);
        setNeutralColor(palette.neutral);
        message.success("已读取参考配色，参考图不会传给生图模型");
    };

    const applyCategory = (category: ProductCategoryId, name = profile.name) => {
        const next = { ...createDefaultProfile(category), name };
        const palette = categoryPreset(category).palette;
        setProfile(next);
        setFrameOverrides({});
        setBackgrounds({});
        setActiveFrameIndex(0);
        setPrimaryColor(palette.primary);
        setAccentColor(palette.accent);
        setNeutralColor(palette.neutral);
        setDarkColor(palette.dark);
    };

    const loadDemo = async (id: DemoId) => {
        const demo = demos[id];
        setExtractionMode("ai");
        setFrameOverrides({});
        setActiveFrameIndex(0);
        const [sourceResponse, styleResponse] = await Promise.all([fetch(demo.source), fetch(demo.reference)]);
        const [sourceBlob, styleBlob] = await Promise.all([sourceResponse.blob(), styleResponse.blob()]);
        const sourceFile = new File([sourceBlob], `${id}-source.jpg`, { type: sourceBlob.type || "image/jpeg" });
        const sourceDataUrl = await readFileAsDataUrl(sourceFile);
        setProductSource(sourceDataUrl);
        setSourceHash(await sha256(sourceFile));
        await extractProduct(sourceDataUrl, "ai");
        await handleStyleFile(new File([styleBlob], `${id}-reference.png`, { type: styleBlob.type || "image/png" }));
        setProfile(demo.profile);
        const palette = categoryPreset(demo.profile.category).palette;
        setPrimaryColor(palette.primary);
        setAccentColor(palette.accent);
        setNeutralColor(palette.neutral);
        setDarkColor(palette.dark);
        const nextBackgrounds = Object.fromEntries(
            buildSuiteFrames(demo.profile)
                .filter((frame) => frame.template !== "catalog")
                .map((frame) => [frame.id, demo.background]),
        );
        setBackgrounds(nextBackgrounds);
        message.success(`已加载${demo.label}跨品类验收样例`);
    };

    const updateActiveFrame = (patch: Partial<SuiteFrame>) => {
        setFrameOverrides((value) => ({
            ...value,
            [activeFrame.id]: { ...value[activeFrame.id], ...patch },
        }));
    };

    const handleBackgroundFile = async (file?: File) => {
        if (!file) return;
        setBackgrounds((value) => ({ ...value, [activeFrame.id]: URL.createObjectURL(file) }));
    };

    const requestBackground = async (frame: SuiteFrame, onStatus: (status: string) => void) => {
        const templateConfig = productTemplates.find((item) => item.id === frame.template) || productTemplates[0];
        const config = {
            ...effectiveConfig,
            model,
            imageModel: model,
            count: "1",
            quality: effectiveConfig.quality === "high" ? "high" : "medium",
            size: "1:1",
        };
        const prompt = [templateConfig.scenePrompt, frame.sceneDescription.trim(), "This is a background plate only. Keep the entire scene free of products and typography so an exact locked product cutout can be composited later."]
            .filter(Boolean)
            .join("\n\n");
        return effectiveConfig.channelMode === "remote" ? generatePersistentBackground(config, prompt, onStatus) : generateDirectBackground(config, prompt);
    };

    const generateBackground = async () => {
        if (!isAiConfigReady(effectiveConfig, model)) {
            openConfigDialog(true);
            return;
        }
        if (activeFrame.template === "catalog") {
            message.info("白底目录图不需要生成背景");
            return;
        }
        setGenerating(true);
        setGenerationStatus("创建背景任务");
        try {
            const dataUrl = await requestBackground(activeFrame, setGenerationStatus);
            setBackgrounds((value) => ({ ...value, [activeFrame.id]: dataUrl }));
            message.success("背景已生成，商品像素未发送给模型");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "背景生成失败");
        } finally {
            setGenerating(false);
            setGenerationStatus("");
        }
    };

    const generateSuiteBackgrounds = async () => {
        if (!isAiConfigReady(effectiveConfig, model)) {
            openConfigDialog(true);
            return;
        }
        const targets = suiteFrames.filter((frame) => frame.template !== "catalog");
        setGenerating(true);
        try {
            for (let index = 0; index < targets.length; index += 1) {
                const frame = targets[index];
                setGenerationStatus(`背景 ${index + 1}/${targets.length}`);
                const dataUrl = await requestBackground(frame, (status) => setGenerationStatus(`${index + 1}/${targets.length} ${status}`));
                setBackgrounds((value) => ({ ...value, [frame.id]: dataUrl }));
            }
            message.success("整套空背景已生成，商品与文字均未发送给模型");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "套图背景生成失败");
        } finally {
            setGenerating(false);
            setGenerationStatus("");
        }
    };

    const downloadCurrent = async () => {
        try {
            const dataUrl = await renderCurrent(2048);
            saveAs(await (await fetch(dataUrl)).blob(), `${safeFilename(profile.name)}-${String(activeFrameIndex + 1).padStart(2, "0")}-${activeFrame.template}.png`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };

    const downloadSuite = async () => {
        if (!productCutout) {
            message.warning("请先上传商品原图");
            return;
        }
        const files: Record<string, Uint8Array> = {};
        for (const frame of suiteFrames) {
            const dataUrl = await renderCurrent(2048, frame.index);
            const filename = `${safeFilename(profile.name)}-${String(frame.index + 1).padStart(2, "0")}-${frame.template}.png`;
            files[filename] = new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
        }
        const archive = Uint8Array.from(zipSync(files, { level: 0 }));
        saveAs(new Blob([archive], { type: "application/zip" }), `${safeFilename(profile.name)}-suite.zip`);
        message.success("六张 2048 PNG 已打包导出");
    };

    return (
        <main className="flex h-full w-full min-w-0 flex-col overflow-hidden bg-background text-stone-950 dark:text-stone-100">
            <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 lg:px-6 dark:border-stone-800">
                <div className="flex items-center gap-3">
                    <WandSparkles className="size-5" />
                    <h1 className="text-base font-semibold">商品套图</h1>
                    <Tag color="green">像素锁</Tag>
                </div>
                <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
                    <ModelPicker
                        config={effectiveConfig}
                        capability="image"
                        value={model}
                        channelId={effectiveConfig.imageChannelId}
                        onChange={(value, channelId) => {
                            updateConfig("imageModel", value);
                            if (channelId) updateConfig("imageChannelId", channelId);
                        }}
                        onMissingConfig={() => openConfigDialog(false)}
                        className="!w-full min-w-0 sm:!w-fit sm:flex-none"
                    />
                    <Button className="hidden sm:inline-flex" aria-label="导出整套 ZIP" title="导出整套 ZIP" icon={<Download className="size-4" />} disabled={!productCutout} onClick={() => void downloadSuite()}>
                        导出整套 ZIP
                    </Button>
                </div>
            </header>

            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(280px,42vh)_minmax(520px,1fr)] overflow-auto lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-1 lg:overflow-hidden">
                <aside className="min-h-0 min-w-0 overflow-y-auto border-b border-stone-200 px-5 py-5 lg:border-r lg:border-b-0 dark:border-stone-800">
                    <ControlSection title="素材">
                        <div className="grid grid-cols-2 gap-2">
                            <UploadControl label={productSource ? "更换商品" : "商品原图"} icon={<ImagePlus className="size-4" />} preview={productSource} onFile={(file) => void handleProductFile(file)} />
                            <UploadControl label={styleReference ? "更换参考" : "风格参考"} icon={<Sparkles className="size-4" />} preview={styleReference} onFile={(file) => void handleStyleFile(file)} />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {(Object.keys(demos) as DemoId[]).map((id) => (
                                <Button key={id} size="small" onClick={() => void loadDemo(id)}>
                                    {demos[id].shortLabel}
                                </Button>
                            ))}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs text-stone-500">
                            <span className="flex items-center gap-1.5">
                                <LockKeyhole className="size-3.5" />
                                {sourceHash ? `SHA-256 ${sourceHash.slice(0, 10)}` : "等待商品原图"}
                            </span>
                            {productCutout ? (
                                <span className="flex items-center gap-1 text-emerald-600">
                                    <Check className="size-3.5" />
                                    方向锁定
                                </span>
                            ) : null}
                        </div>
                    </ControlSection>

                    <ControlSection title="商品档案">
                        <Select className="w-full" aria-label="商品品类" value={profile.category} options={categoryPresets.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => applyCategory(value)} />
                        <Input aria-label="商品名称" value={profile.name} onChange={(event) => setProfile((value) => ({ ...value, name: event.target.value }))} placeholder="商品名称" />
                        {profile.sellingPoints.map((point, index) => (
                            <Input
                                key={index}
                                aria-label={`卖点 ${index + 1}`}
                                value={point}
                                onChange={(event) =>
                                    setProfile((value) => ({
                                        ...value,
                                        sellingPoints: value.sellingPoints.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                                    }))
                                }
                                placeholder={`卖点 ${index + 1}`}
                            />
                        ))}
                        <Input aria-label="材质事实" value={profile.material} onChange={(event) => setProfile((value) => ({ ...value, material: event.target.value }))} placeholder="材质事实" />
                        <Input aria-label="目标买家" value={profile.audience} onChange={(event) => setProfile((value) => ({ ...value, audience: event.target.value }))} placeholder="目标买家" />
                        <div className="grid grid-cols-2 gap-2">
                            <Input aria-label="目标平台" value={profile.marketplace} onChange={(event) => setProfile((value) => ({ ...value, marketplace: event.target.value }))} placeholder="目标平台" />
                            <Input aria-label="文案语言" value={profile.language} onChange={(event) => setProfile((value) => ({ ...value, language: event.target.value }))} placeholder="文案语言" />
                        </div>
                    </ControlSection>

                    <ControlSection title="白底提取">
                        <Segmented
                            block
                            value={extractionMode}
                            options={[
                                { label: "本地 AI", value: "ai" },
                                { label: "白底快速", value: "white" },
                            ]}
                            onChange={(value) => setExtractionMode(value as "ai" | "white")}
                        />
                        {extractionMode === "white" ? (
                            <>
                                <LabeledSlider label="容差" value={tolerance} min={8} max={80} onChange={setTolerance} />
                                <LabeledSlider label="边缘羽化" value={feather} min={4} max={60} onChange={setFeather} />
                            </>
                        ) : (
                            <LabeledSlider label="边缘收紧" value={edgeCutoff} min={8} max={160} onChange={setEdgeCutoff} />
                        )}
                        <Button block icon={extracting ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} disabled={!productSource || extracting} onClick={() => void extractProduct()}>
                            {extractionStatus || "重新提取"}
                        </Button>
                    </ControlSection>

                    <ControlSection title="图序与版式">
                        <div className="grid grid-cols-2 gap-2">
                            {suiteFrames.map((frame) => (
                                <button
                                    key={frame.id}
                                    type="button"
                                    className={`min-h-14 border px-3 py-2 text-left transition ${activeFrame.id === frame.id ? "border-stone-950 dark:border-stone-100" : "border-stone-200 hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600"}`}
                                    onClick={() => setActiveFrameIndex(frame.index)}
                                >
                                    <span className="block text-sm font-medium">
                                        {String(frame.index + 1).padStart(2, "0")} · {frame.task}
                                    </span>
                                    <span className="mt-0.5 block text-xs text-stone-500">
                                        {frame.type} · {productTemplates.find((item) => item.id === frame.template)?.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </ControlSection>

                    <ControlSection title={`第 ${activeFrameIndex + 1} 张文案`}>
                        <Input aria-label="短标题" value={activeFrame.headline} onChange={(event) => updateActiveFrame({ headline: event.target.value })} placeholder="短标题" />
                        <Input.TextArea aria-label="辅助文案" value={activeFrame.supportingLine} onChange={(event) => updateActiveFrame({ supportingLine: event.target.value })} autoSize={{ minRows: 2, maxRows: 3 }} placeholder="辅助文案" />
                    </ControlSection>

                    <ControlSection title="品牌色">
                        <div className="grid grid-cols-2 gap-2">
                            <ColorControl label="主色" value={primaryColor} onChange={setPrimaryColor} />
                            <ColorControl label="强调色" value={accentColor} onChange={setAccentColor} />
                            <ColorControl label="中性色" value={neutralColor} onChange={setNeutralColor} />
                            <ColorControl label="深色" value={darkColor} onChange={setDarkColor} />
                        </div>
                    </ControlSection>

                    <ControlSection title="商品位置">
                        <LabeledSlider label="比例" value={activeFrame.productScale} min={0.65} max={1.35} step={0.01} onChange={(value) => updateActiveFrame({ productScale: value })} />
                        <LabeledSlider label="水平" value={activeFrame.productOffsetX} min={-0.3} max={0.3} step={0.01} onChange={(value) => updateActiveFrame({ productOffsetX: value })} />
                        <LabeledSlider label="垂直" value={activeFrame.productOffsetY} min={-0.3} max={0.3} step={0.01} onChange={(value) => updateActiveFrame({ productOffsetY: value })} />
                        <LabeledSlider label="细节横向" value={activeFrame.detailFocusX} min={0} max={1} step={0.01} onChange={(value) => updateActiveFrame({ detailFocusX: value })} />
                        <LabeledSlider label="细节纵向" value={activeFrame.detailFocusY} min={0} max={1} step={0.01} onChange={(value) => updateActiveFrame({ detailFocusY: value })} />
                    </ControlSection>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3 lg:px-6 dark:border-stone-800">
                        <Segmented value={activeFrameIndex} options={suiteFrames.map((frame) => ({ label: `${frame.index + 1}`, value: frame.index }))} onChange={(value) => setActiveFrameIndex(Number(value))} />
                        <Tag>{activeFrame.type}</Tag>
                        <Tag>{activeFrame.task}</Tag>
                        <Tag>版式 {templateRatioLabel(activeFrame.template)}</Tag>
                        <Tag color={productCutout ? "green" : "default"}>{productCutout ? "商品像素锁通过" : "等待商品"}</Tag>
                        <span className="ml-auto text-xs text-stone-500">背景 {preparedBackgrounds}/6 · 版式误差 0.0%</span>
                    </div>

                    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-stone-100 p-4 lg:p-8 dark:bg-stone-950">
                        <div className="mx-auto flex min-h-full min-w-0 max-w-5xl items-center justify-center">
                            <div className="relative aspect-square w-full max-w-[760px] overflow-hidden border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
                                {preview ? <img src={preview} alt="商品广告预览" className="size-full object-contain" /> : <div className="flex size-full items-center justify-center text-sm text-stone-400">上传商品原图</div>}
                                {rendering ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                        <LoaderCircle className="size-7 animate-spin text-white" />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    <footer className="min-w-0 shrink-0 border-t border-stone-200 px-4 py-4 lg:px-6 dark:border-stone-800">
                        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_auto]">
                            <div className="flex flex-wrap gap-2">
                                <Input.TextArea
                                    aria-label="背景描述"
                                    value={activeFrame.sceneDescription}
                                    onChange={(event) => updateActiveFrame({ sceneDescription: event.target.value })}
                                    autoSize={{ minRows: 2, maxRows: 3 }}
                                    disabled={activeFrame.template === "catalog"}
                                    placeholder="背景描述"
                                />
                                <label
                                    className={`relative inline-flex h-8 shrink-0 items-center gap-2 border border-stone-200 px-3 text-sm dark:border-stone-800 ${activeFrame.template === "catalog" ? "pointer-events-none opacity-40" : "cursor-pointer hover:border-stone-400"}`}
                                >
                                    <Upload className="size-4" />
                                    上传背景
                                    <input
                                        className="absolute inset-0 cursor-pointer opacity-0"
                                        type="file"
                                        accept="image/*"
                                        aria-label="上传背景"
                                        disabled={activeFrame.template === "catalog"}
                                        onChange={(event) => void handleBackgroundFile(event.target.files?.[0])}
                                    />
                                </label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Button
                                    type="primary"
                                    icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                                    disabled={!productCutout || generating || activeFrame.template === "catalog"}
                                    onClick={() => void generateBackground()}
                                >
                                    {generationStatus || "生成空背景"}
                                </Button>
                                <Button disabled={!productCutout || generating} onClick={() => void generateSuiteBackgrounds()}>
                                    批量生成背景
                                </Button>
                                <Button icon={<Download className="size-4" />} disabled={!productCutout} onClick={() => void downloadCurrent()}>
                                    导出本张
                                </Button>
                                <Button className="sm:hidden" icon={<Download className="size-4" />} disabled={!productCutout} onClick={() => void downloadSuite()}>
                                    导出整套 ZIP
                                </Button>
                            </div>
                        </div>
                    </footer>
                </section>
            </div>
        </main>
    );
}

type DemoId = "motorcycle" | "plush" | "lipstick";

const demos: Record<
    DemoId,
    {
        label: string;
        shortLabel: string;
        source: string;
        reference: string;
        background: string;
        profile: ProductProfile;
    }
> = {
    motorcycle: {
        label: "摩托车",
        shortLabel: "机械",
        source: "/demo/motorcycle-source.jpg",
        reference: "/demo/motorcycle-target.jpg",
        background: "/demo/motorcycle-empty-forest.jpg",
        profile: {
            name: "SOONER OFF-ROAD",
            category: "mechanical",
            material: "painted steel frame, knobby rubber tires and visible front disc brake",
            audience: "off-road recreation buyers and powersports distributors",
            marketplace: "B2B export catalog",
            language: "English",
            sellingPoints: ["RUGGED CONSTRUCTION", "VISIBLE FRONT DISC", "READY FOR THE TRAIL"],
        },
    },
    plush: {
        label: "毛绒玩具",
        shortLabel: "毛绒",
        source: "/demo/plush-fox-source.jpg",
        reference: "/demo/plush-linkfox-reference.png",
        background: "/demo/plush-room-plate.jpg?v=3",
        profile: {
            name: "CLOUD-SOFT FOX PILLOW",
            category: "toy",
            material: "long-pile plush fabric with a soft filled pillow body",
            audience: "families, comfort seekers and gift buyers",
            marketplace: "Amazon US",
            language: "English",
            sellingPoints: ["CLOUD-SOFT COMFORT", "HUGGABLE SUPPORT", "A GIFT TO REMEMBER"],
        },
    },
    lipstick: {
        label: "口红",
        shortLabel: "美妆",
        source: "/demo/lipstick-source.jpg",
        reference: "/demo/lipstick-linkfox-reference.png",
        background: "/demo/lipstick-marble-plate.jpg",
        profile: {
            name: "RUBY SATIN LIP COLOR",
            category: "beauty",
            material: "gem-red satin lipstick in polished luxury packaging",
            audience: "beauty buyers seeking rich color and gift-ready presentation",
            marketplace: "Amazon US",
            language: "English",
            sellingPoints: ["RICH SATIN COLOR", "PRECISION LIP SHAPE", "LUXURY IN EVERY DETAIL"],
        },
    },
};

function ControlSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="border-b border-stone-200 py-4 first:pt-0 last:border-b-0 dark:border-stone-800">
            <h2 className="mb-3 text-xs font-semibold text-stone-500">{title}</h2>
            <div className="space-y-3">{children}</div>
        </section>
    );
}

function UploadControl({ label, icon, preview, onFile }: { label: string; icon: React.ReactNode; preview: string; onFile: (file?: File) => void }) {
    return (
        <label className="relative flex h-24 cursor-pointer items-center justify-center overflow-hidden border border-stone-200 transition hover:border-stone-400 dark:border-stone-800 dark:hover:border-stone-600">
            {preview ? (
                <img src={preview} alt="" className="size-full object-cover" />
            ) : (
                <span className="flex flex-col items-center gap-2 text-xs text-stone-500">
                    {icon}
                    {label}
                </span>
            )}
            {preview ? <span className="absolute inset-x-0 bottom-0 bg-black/65 px-2 py-1 text-left text-xs text-white">{label}</span> : null}
            <input className="absolute inset-0 cursor-pointer opacity-0" type="file" accept="image/*" aria-label={label} onChange={(event) => onFile(event.target.files?.[0])} />
        </label>
    );
}

function LabeledSlider({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
    return (
        <label className="grid grid-cols-[72px_minmax(0,1fr)_42px] items-center gap-2 text-xs">
            <span className="text-stone-500">{label}</span>
            <Slider className="m-0" min={min} max={max} step={step} value={value} onChange={onChange} />
            <span className="text-right tabular-nums">{Number.isInteger(value) ? value : value.toFixed(2)}</span>
        </label>
    );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <label className="flex h-10 items-center gap-2 border border-stone-200 px-2 text-xs dark:border-stone-800">
            <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="size-6 cursor-pointer border-0 bg-transparent p-0" />
            <span className="text-stone-500">{label}</span>
            <span className="ml-auto font-mono">{value.toUpperCase()}</span>
        </label>
    );
}

async function generateDirectBackground(config: Parameters<typeof requestGeneration>[0], prompt: string) {
    const images = await requestGeneration(config, prompt);
    const image = images[0];
    if (!image) throw new Error("接口没有返回背景图");
    return imageToDataUrl(image);
}

async function generatePersistentBackground(config: Parameters<typeof createCanvasImageTask>[0], prompt: string, onStatus: (status: string) => void) {
    let task = await createCanvasImageTask(config, prompt, [], { source: "workflow", sourceId: "product-suite", clientTaskId: `product-suite-${nanoid()}` });
    for (let index = 0; index < 120; index += 1) {
        const url = task.image_url || task.url;
        if (url) return imageToDataUrl({ dataUrl: url, storageKey: task.storageKey });
        if (["failed", "error"].includes(task.status.toLowerCase())) throw new Error(task.error?.message || task.error_detail || "背景生成失败");
        onStatus(`生成背景 ${Math.max(1, Math.round(task.progress || 0))}%`);
        await wait(3000);
        task = await pollCanvasImageTaskStatus(task.parent_task_id || task.id);
    }
    throw new Error("背景生成超时");
}

async function sha256(file: File) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function sampleStylePalette(dataUrl: string) {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { primary: "#D62B28", accent: "#9BCB32", neutral: "#F5F5F0", dark: "#171A1D" };
    context.drawImage(image, 0, 0, 48, 48);
    const pixels = context.getImageData(0, 0, 48, 48).data;
    const colors: Array<{ r: number; g: number; b: number; saturation: number; luminance: number }> = [];
    for (let index = 0; index < pixels.length; index += 16) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        colors.push({ r, g, b, saturation: max ? (max - min) / max : 0, luminance: (r + g + b) / 3 });
    }
    const saturated = colors.filter((color) => color.saturation > 0.28 && color.luminance > 45 && color.luminance < 225).sort((a, b) => b.saturation - a.saturation);
    const dark = colors.filter((color) => color.luminance < 90).sort((a, b) => a.luminance - b.luminance)[0];
    const neutral = colors.filter((color) => color.saturation < 0.12 && color.luminance > 200).sort((a, b) => b.luminance - a.luminance)[0];
    return {
        primary: toHex(saturated[0] || { r: 214, g: 43, b: 40 }),
        accent: toHex(saturated[Math.min(4, saturated.length - 1)] || { r: 155, g: 203, b: 50 }),
        neutral: toHex(neutral || { r: 245, g: 245, b: 240 }),
        dark: toHex(dark || { r: 23, g: 26, b: 29 }),
    };
}

function loadImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("风格参考读取失败"));
        image.src = src;
    });
}

function toHex(color: { r: number; g: number; b: number }) {
    return `#${[color.r, color.g, color.b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function safeFilename(value: string) {
    return value.trim().replace(/[\\/:*?"<>|]+/g, "-") || "product";
}

function wait(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}
