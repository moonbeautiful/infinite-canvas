"use client";

import { App, Button, Input, Modal, Segmented, Select, Slider, Tag } from "antd";
import { zipSync } from "fflate";
import { Check, Download, ExternalLink, FilePlus2, ImagePlus, KeyRound, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Upload, WandSparkles } from "lucide-react";
import { saveAs } from "file-saver";
import { useEffect, useMemo, useState } from "react";

import { readFileAsDataUrl } from "@/lib/image-utils";
import { clearGotoccConnection, generateGotoccBackground, loadGotoccConnection, saveGotoccConnection, testGotoccConnection, type GotoccConnection } from "@/services/api/gotocc";

import { composeProductAd, extractProductFromWhiteBackground, extractProductWithAi, productAspectDimensions, productAspectLabel, productTemplates, templateRatioLabel, type ProductCutout } from "./product-compositor";
import { analyzeProductFacts, buildQualityReport, inferProductCategory, repairFrame, type ProductFacts } from "./product-analysis";
import { buildSuiteFrames, categoryPreset, categoryPresets, createDefaultProfile, profileFromUnknown, type ProductCategoryId, type ProductProfile, type SuiteFrame } from "./product-profiles";
import { clearProductSuiteDraft, loadProductSuiteDraft, saveProductSuiteDraft, type ProductInputImage } from "./product-suite-storage";

export default function ProductSuitePage() {
    const { message, modal } = App.useApp();

    const [profile, setProfile] = useState<ProductProfile>(() => createDefaultProfile());
    const [activeFrameIndex, setActiveFrameIndex] = useState(0);
    const [frameOverrides, setFrameOverrides] = useState<Partial<Record<string, Partial<SuiteFrame>>>>({});
    const [productImages, setProductImages] = useState<ProductInputImage[]>([]);
    const [productSource, setProductSource] = useState("");
    const [productCutout, setProductCutout] = useState<ProductCutout | null>(null);
    const [styleReference, setStyleReference] = useState("");
    const [backgrounds, setBackgrounds] = useState<Partial<Record<string, string>>>({});
    const [noText, setNoText] = useState(false);
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
    const [productFacts, setProductFacts] = useState<ProductFacts | null>(null);
    const [gotoccConnection, setGotoccConnection] = useState<GotoccConnection | null>(null);
    const [gotoccStatus, setGotoccStatus] = useState<"idle" | "checking" | "connected" | "error">("idle");
    const [connectionOpen, setConnectionOpen] = useState(false);
    const [connectionKey, setConnectionKey] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [draftReady, setDraftReady] = useState(false);
    const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

    const suiteFrames = useMemo(() => buildSuiteFrames(profile).map((frame) => ({ ...frame, ...frameOverrides[frame.id] })), [frameOverrides, profile]);
    const activeFrame = suiteFrames[activeFrameIndex] || suiteFrames[0];
    const background = backgrounds[activeFrame.id];
    const preparedBackgrounds = suiteFrames.filter((frame) => frame.template === "catalog" || backgrounds[frame.id]).length;
    const qualityReport = useMemo(
        () => buildQualityReport({ frame: activeFrame, cutout: productCutout, facts: productFacts, sourceHash, referenceCount: productImages.length, noText, background }),
        [activeFrame, background, noText, productCutout, productFacts, productImages.length, sourceHash],
    );
    const suiteQualityReports = useMemo(
        () =>
            suiteFrames.map((frame) =>
                buildQualityReport({
                    frame,
                    cutout: productCutout,
                    facts: productFacts,
                    sourceHash,
                    referenceCount: productImages.length,
                    noText,
                    background: backgrounds[frame.id],
                }),
            ),
        [backgrounds, noText, productCutout, productFacts, productImages.length, sourceHash, suiteFrames],
    );
    const suiteQualityScore = productCutout ? Math.round(suiteQualityReports.reduce((total, report) => total + report.score, 0) / Math.max(1, suiteQualityReports.length)) : 0;
    const problemFrameIndexes = suiteQualityReports.flatMap((report, index) => (report.score < 100 ? [index] : []));

    useEffect(() => {
        let active = true;
        void loadProductSuiteDraft()
            .then((draft) => {
                if (!active || !draft) return;
                setProfile(profileFromUnknown(draft.profile, createDefaultProfile()));
                setActiveFrameIndex(Math.max(0, Math.min(5, draft.activeFrameIndex || 0)));
                setFrameOverrides(draft.frameOverrides || {});
                setProductImages(draft.productImages || []);
                setProductSource(draft.productSource || "");
                setSourceHash(draft.productImages?.find((item) => item.dataUrl === draft.productSource)?.hash || "");
                setProductCutout(draft.productCutout || null);
                setStyleReference(draft.styleReference || "");
                setBackgrounds(draft.backgrounds || {});
                setNoText(Boolean(draft.noText));
                setExtractionMode(draft.extractionMode || "ai");
                setTolerance(draft.tolerance || 30);
                setFeather(draft.feather || 24);
                setEdgeCutoff(draft.edgeCutoff || 72);
                setPrimaryColor(draft.colors?.primary || defaultPalette.primary);
                setAccentColor(draft.colors?.accent || defaultPalette.accent);
                setNeutralColor(draft.colors?.neutral || defaultPalette.neutral);
                setDarkColor(draft.colors?.dark || defaultPalette.dark);
                setSaveStatus("saved");
                if (draft.productSource) message.success("已恢复上次商品套图项目");
            })
            .catch(() => {
                if (active) setSaveStatus("error");
            })
            .finally(() => {
                if (active) setDraftReady(true);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!draftReady) return;
        setSaveStatus("saving");
        const timer = window.setTimeout(() => {
            void saveProductSuiteDraft({
                profile,
                activeFrameIndex,
                frameOverrides,
                productImages,
                productSource,
                productCutout,
                styleReference,
                backgrounds,
                noText,
                extractionMode,
                tolerance,
                feather,
                edgeCutoff,
                colors: { primary: primaryColor, accent: accentColor, neutral: neutralColor, dark: darkColor },
            })
                .then(() => setSaveStatus("saved"))
                .catch(() => setSaveStatus("error"));
        }, 900);
        return () => window.clearTimeout(timer);
    }, [
        accentColor,
        activeFrameIndex,
        backgrounds,
        darkColor,
        draftReady,
        edgeCutoff,
        extractionMode,
        feather,
        frameOverrides,
        neutralColor,
        noText,
        primaryColor,
        productCutout,
        productImages,
        productSource,
        profile,
        styleReference,
        tolerance,
    ]);

    useEffect(() => {
        const saved = loadGotoccConnection();
        if (!saved) return;
        setGotoccConnection(saved);
        setGotoccStatus("checking");
    }, []);

    useEffect(() => {
        if (!gotoccConnection) return;
        let active = true;
        void testGotoccConnection(gotoccConnection.apiKey)
            .then(() => {
                if (active) setGotoccStatus("connected");
            })
            .catch(() => {
                if (active) setGotoccStatus("error");
            });
        return () => {
            active = false;
        };
    }, [gotoccConnection?.apiKey]);

    useEffect(() => {
        if (!productSource || !productCutout) {
            setProductFacts(null);
            return;
        }
        let active = true;
        void analyzeProductFacts(productSource, productCutout)
            .then((facts) => {
                if (active) setProductFacts(facts);
            })
            .catch(() => {
                if (active) setProductFacts(null);
            });
        return () => {
            active = false;
        };
    }, [productCutout, productSource]);

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
            headline: noText ? "" : frame.headline,
            supportingLine: noText ? "" : frame.supportingLine,
            primaryColor,
            accentColor,
            neutralColor,
            darkColor,
            outputSize,
            aspectRatio: frame.aspectRatio,
            productScale: frame.productScale,
            productOffsetX: frame.productOffsetX,
            productOffsetY: frame.productOffsetY,
            detailFocusX: frame.detailFocusX,
            detailFocusY: frame.detailFocusY,
        });
    };

    const handleProductFiles = async (fileList?: FileList | File[]) => {
        const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/")).slice(0, 5);
        if (!files.length) return;
        const images = await Promise.all(
            files.map(async (file, index) => ({
                id: `${Date.now()}-${index}`,
                name: file.name,
                dataUrl: await readFileAsDataUrl(file),
                hash: await sha256(file),
            })),
        );
        const primary = images[0];
        const name = primary.name.replace(/\.[^.]+$/, "") || "商品";
        const inferredCategory = inferProductCategory(files.map((file) => file.name).join(" "));
        if (inferredCategory) applyCategory(inferredCategory, name);
        else setProfile((value) => ({ ...value, name }));
        setProductImages(images);
        setProductSource(primary.dataUrl);
        setSourceHash(primary.hash);
        await extractProduct(primary.dataUrl);
        message.success(`已锁定 ${images.length} 张商品证据图`);
    };

    const selectPrimaryProductImage = async (image: ProductInputImage) => {
        if (image.dataUrl === productSource) return;
        setProductSource(image.dataUrl);
        setSourceHash(image.hash);
        await extractProduct(image.dataUrl);
        message.success("已切换主商品图");
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
        const hash = await sha256(sourceFile);
        setProductImages([{ id: `${id}-source`, name: sourceFile.name, dataUrl: sourceDataUrl, hash }]);
        setProductSource(sourceDataUrl);
        setSourceHash(hash);
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

    const connectGotocc = async () => {
        setConnecting(true);
        try {
            const apiKey = connectionKey.trim() || gotoccConnection?.apiKey || "";
            await testGotoccConnection(apiKey);
            const connection: GotoccConnection = {
                apiKey,
                model: "gpt-image-2",
                connectedAt: new Date().toISOString(),
            };
            saveGotoccConnection(connection);
            setGotoccConnection(connection);
            setGotoccStatus("connected");
            setConnectionKey("");
            setConnectionOpen(false);
            message.success("gotocc 生图额度已连接");
        } catch (error) {
            setGotoccStatus("error");
            message.error(error instanceof Error ? error.message : "gotocc 连接失败");
        } finally {
            setConnecting(false);
        }
    };

    const disconnectGotocc = () => {
        clearGotoccConnection();
        setGotoccConnection(null);
        setGotoccStatus("idle");
        setConnectionKey("");
        message.success("已断开 gotocc");
    };

    const repairActiveFrame = async () => {
        updateActiveFrame(repairFrame(activeFrame));
        if (qualityReport.checks.find((item) => item.id === "edge")?.status !== "pass" && productSource) {
            await extractProduct();
        }
        message.success("已按质检结果校正版式与商品边缘");
    };

    const locateNextProblem = () => {
        if (!problemFrameIndexes.length) return;
        const next = problemFrameIndexes.find((index) => index > activeFrameIndex) ?? problemFrameIndexes[0];
        setActiveFrameIndex(next);
    };

    const createNewProject = () => {
        modal.confirm({
            title: "新建商品套图",
            content: "当前项目已自动保存；新建后会清空本机草稿。",
            okText: "新建",
            cancelText: "取消",
            onOk: async () => {
                await clearProductSuiteDraft();
                const nextProfile = createDefaultProfile();
                const palette = categoryPreset("general").palette;
                setProfile(nextProfile);
                setActiveFrameIndex(0);
                setFrameOverrides({});
                setProductImages([]);
                setProductSource("");
                setSourceHash("");
                setProductCutout(null);
                setProductFacts(null);
                setStyleReference("");
                setBackgrounds({});
                setNoText(false);
                setPreview("");
                setPrimaryColor(palette.primary);
                setAccentColor(palette.accent);
                setNeutralColor(palette.neutral);
                setDarkColor(palette.dark);
                setSaveStatus("saved");
                message.success("已新建商品套图");
            },
        });
    };

    const handleBackgroundFile = async (file?: File) => {
        if (!file) return;
        setBackgrounds((value) => ({ ...value, [activeFrame.id]: "" }));
        const dataUrl = await readFileAsDataUrl(file);
        setBackgrounds((value) => ({ ...value, [activeFrame.id]: dataUrl }));
    };

    const requestBackground = async (frame: SuiteFrame, onStatus: (status: string) => void) => {
        if (!gotoccConnection || gotoccStatus !== "connected") throw new Error("请先连接 gotocc 生图额度");
        const templateConfig = productTemplates.find((item) => item.id === frame.template) || productTemplates[0];
        const prompt = [templateConfig.scenePrompt, frame.sceneDescription.trim(), "This is a background plate only. Keep the entire scene free of products and typography so an exact locked product cutout can be composited later."]
            .filter(Boolean)
            .join("\n\n");
        onStatus("通过 gotocc 生成空背景");
        const size = frame.aspectRatio === "portrait" ? "768x1024" : frame.aspectRatio === "landscape" ? "1536x640" : "1024x1024";
        return generateGotoccBackground(gotoccConnection, prompt, size);
    };

    const generateBackground = async () => {
        if (!gotoccConnection || gotoccStatus !== "connected") {
            setConnectionOpen(true);
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
        if (!gotoccConnection || gotoccStatus !== "connected") {
            setConnectionOpen(true);
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
            const filename = `${safeFilename(profile.name)}-${String(frame.index + 1).padStart(2, "0")}-${frame.template}-${productAspectLabel(frame.aspectRatio).replace(":", "x")}.png`;
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
                <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
                    <span className={`hidden text-xs sm:inline ${saveStatus === "error" ? "text-red-500" : "text-stone-500"}`}>
                        {saveStatus === "saving" ? "保存中" : saveStatus === "saved" ? "已自动保存" : saveStatus === "error" ? "保存失败" : ""}
                    </span>
                    <Button aria-label="新建商品套图" title="新建商品套图" icon={<FilePlus2 className="size-4" />} onClick={createNewProject} />
                    <span className="hidden sm:inline-flex">
                        <Tag>GPT Image 2</Tag>
                    </span>
                    <Button
                        className="min-w-0 flex-1 sm:flex-none"
                        icon={gotoccStatus === "checking" ? <LoaderCircle className="size-4 animate-spin" /> : gotoccStatus === "connected" ? <ShieldCheck className="size-4" /> : <KeyRound className="size-4" />}
                        type={gotoccStatus === "connected" ? "default" : "primary"}
                        onClick={() => setConnectionOpen(true)}
                    >
                        {gotoccStatus === "connected" ? "gotocc 已连接" : gotoccStatus === "checking" ? "检测连接" : "连接 gotocc 额度"}
                    </Button>
                    <span className="hidden sm:inline-flex">
                        <Button aria-label="导出整套 ZIP" title="导出整套 ZIP" icon={<Download className="size-4" />} disabled={!productCutout} onClick={() => void downloadSuite()}>
                            导出整套 ZIP
                        </Button>
                    </span>
                </div>
            </header>

            <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(280px,42vh)_minmax(520px,1fr)] overflow-auto lg:grid-cols-[360px_minmax(0,1fr)] lg:grid-rows-1 lg:overflow-hidden">
                <aside className="min-h-0 min-w-0 overflow-y-auto border-b border-stone-200 px-5 py-5 lg:border-r lg:border-b-0 dark:border-stone-800">
                    <ControlSection title="素材">
                        <div className="grid grid-cols-2 gap-2">
                            <UploadControl
                                label={productImages.length ? `更换商品图 ${productImages.length}/5` : "商品图 1-5 张"}
                                icon={<ImagePlus className="size-4" />}
                                preview={productSource}
                                multiple
                                onFiles={(files) => void handleProductFiles(files)}
                            />
                            <UploadControl label={styleReference ? "更换参考" : "风格参考"} icon={<Sparkles className="size-4" />} preview={styleReference} onFile={(file) => void handleStyleFile(file)} />
                        </div>
                        {productImages.length ? (
                            <div className="grid grid-cols-5 gap-1">
                                {productImages.map((image, index) => (
                                    <button
                                        key={image.id}
                                        type="button"
                                        className={`relative aspect-square overflow-hidden border ${image.dataUrl === productSource ? "border-stone-950 dark:border-stone-100" : "border-stone-200 dark:border-stone-800"}`}
                                        title={`输入图 ${index + 1}：${image.name}`}
                                        onClick={() => void selectPrimaryProductImage(image)}
                                    >
                                        <img src={image.dataUrl} alt={`输入图 ${index + 1}`} className="size-full object-cover" />
                                        <span className="absolute bottom-0 left-0 bg-black/70 px-1 text-[10px] text-white">{index + 1}</span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
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
                        {productFacts ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-stone-500">
                                <span>
                                    原图 {productFacts.sourceWidth}×{productFacts.sourceHeight}
                                </span>
                                <span>证据 {productImages.length}/5</span>
                                <span>主体占比 {Math.round(productFacts.coverage * 100)}%</span>
                                <span>透明层 {productFacts.cutoutHash.slice(0, 8)}</span>
                                <span className="flex items-center gap-1" aria-label="商品主色">
                                    {productFacts.dominantColors.map((color) => (
                                        <span key={color} className="size-4 border border-black/10" style={{ backgroundColor: color }} title={color} />
                                    ))}
                                </span>
                            </div>
                        ) : null}
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
                        <details className="border-t border-stone-200 pt-3 text-xs dark:border-stone-800">
                            <summary className="cursor-pointer text-stone-500">更多事实与市场</summary>
                            <div className="mt-3 space-y-2">
                                <Input aria-label="材质事实" value={profile.material} onChange={(event) => setProfile((value) => ({ ...value, material: event.target.value }))} placeholder="材质事实" />
                                <Input aria-label="目标买家" value={profile.audience} onChange={(event) => setProfile((value) => ({ ...value, audience: event.target.value }))} placeholder="目标买家" />
                                <div className="grid grid-cols-2 gap-2">
                                    <Input aria-label="目标平台" value={profile.marketplace} onChange={(event) => setProfile((value) => ({ ...value, marketplace: event.target.value }))} placeholder="目标平台" />
                                    <Input aria-label="文案语言" value={profile.language} onChange={(event) => setProfile((value) => ({ ...value, language: event.target.value }))} placeholder="文案语言" />
                                </div>
                            </div>
                        </details>
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
                        <Segmented
                            block
                            value={noText ? "clean" : "copy"}
                            options={[
                                { label: "带文案", value: "copy" },
                                { label: "无字版", value: "clean" },
                            ]}
                            onChange={(value) => setNoText(value === "clean")}
                        />
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

                    <ControlSection title={`当前图质检 · ${qualityReport.score}`}>
                        <div className="flex items-center justify-between text-xs">
                            <span>整套 {suiteQualityScore}</span>
                            <span className={!productCutout ? "text-stone-500" : problemFrameIndexes.length ? "text-amber-600" : "text-emerald-600"}>
                                {!productCutout ? "等待商品" : problemFrameIndexes.length ? `${problemFrameIndexes.length} 张待处理` : "6 张通过"}
                            </span>
                        </div>
                        <div className="divide-y divide-stone-200 dark:divide-stone-800">
                            {qualityReport.checks.map((item) => (
                                <div key={item.id} className="flex items-start gap-2 py-2 first:pt-0 last:pb-0" title={item.detail}>
                                    <span className={`mt-1 size-2 shrink-0 ${item.status === "pass" ? "bg-emerald-500" : item.status === "warning" ? "bg-amber-500" : "bg-red-500"}`} />
                                    <span className="text-xs">{item.label}</span>
                                    <span className="ml-auto max-w-44 text-right text-xs text-stone-500">{item.detail}</span>
                                </div>
                            ))}
                        </div>
                        <Button block icon={<RefreshCw className="size-4" />} disabled={!qualityReport.canRepair || extracting} onClick={() => void repairActiveFrame()}>
                            一键修复
                        </Button>
                        <Button block disabled={!productCutout || !problemFrameIndexes.length} onClick={locateNextProblem}>
                            定位下一问题
                        </Button>
                    </ControlSection>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-stone-200 px-4 py-3 lg:px-6 dark:border-stone-800">
                        <Segmented value={activeFrameIndex} options={suiteFrames.map((frame) => ({ label: `${frame.index + 1}`, value: frame.index }))} onChange={(value) => setActiveFrameIndex(Number(value))} />
                        <Tag>{activeFrame.type}</Tag>
                        <Tag>{activeFrame.task}</Tag>
                        <Tag>版式 {templateRatioLabel(activeFrame.template)}</Tag>
                        <Tag>画幅 {productAspectLabel(activeFrame.aspectRatio)}</Tag>
                        <Tag color={productCutout ? "green" : "default"}>{productCutout ? "商品像素锁通过" : "等待商品"}</Tag>
                        <Tag color={suiteQualityScore >= 90 ? "green" : suiteQualityScore >= 70 ? "gold" : "red"}>整套质检 {suiteQualityScore}</Tag>
                        <span className="ml-auto text-xs text-stone-500">背景 {preparedBackgrounds}/6</span>
                    </div>

                    <div className="min-h-0 min-w-0 flex-1 overflow-auto bg-stone-100 p-4 lg:p-8 dark:bg-stone-950">
                        <div className="mx-auto flex min-h-full min-w-0 max-w-5xl items-center justify-center">
                            <div
                                className="relative w-full max-w-[760px] overflow-hidden border border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900"
                                style={{ aspectRatio: `${productAspectDimensions(activeFrame.aspectRatio, 1000)[0]} / ${productAspectDimensions(activeFrame.aspectRatio, 1000)[1]}` }}
                            >
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

            <Modal
                title="连接 gotocc 生图额度"
                open={connectionOpen}
                onCancel={() => setConnectionOpen(false)}
                onOk={() => void connectGotocc()}
                okText={gotoccStatus === "connected" ? "重新检测" : "连接"}
                cancelText="关闭"
                confirmLoading={connecting}
                okButtonProps={{ disabled: !connectionKey.trim() && gotoccStatus !== "connected" }}
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm">
                        <span className={`size-2 ${gotoccStatus === "connected" ? "bg-emerald-500" : gotoccStatus === "error" ? "bg-red-500" : "bg-stone-300"}`} />
                        <span>{gotoccStatus === "connected" ? "GPT Image 2 生图额度已连接" : gotoccStatus === "error" ? "连接已失效，请重新粘贴 Key" : "粘贴一次，以后自动使用"}</span>
                    </div>
                    <Button icon={<ExternalLink className="size-4" />} onClick={() => window.open("https://gotocc.xyz/keys", "_blank", "noopener,noreferrer")}>
                        打开 gotocc 密钥页
                    </Button>
                    <Input.Password
                        aria-label="gotocc Key"
                        value={connectionKey}
                        onChange={(event) => setConnectionKey(event.target.value)}
                        placeholder={gotoccStatus === "connected" ? "已保存，需要更换时再粘贴" : "粘贴 GPT image 2 生图分组的 sk- Key"}
                        autoComplete="off"
                    />
                    <p className="text-xs leading-5 text-stone-500">Key 仅保存在当前浏览器。调用时经固定 gotocc 生图通道转发，不写入本站账号、数据库或日志。</p>
                    {gotoccConnection ? (
                        <Button danger onClick={disconnectGotocc}>
                            断开连接
                        </Button>
                    ) : null}
                </div>
            </Modal>
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

function UploadControl({
    label,
    icon,
    preview,
    multiple = false,
    onFile,
    onFiles,
}: {
    label: string;
    icon: React.ReactNode;
    preview: string;
    multiple?: boolean;
    onFile?: (file?: File) => void;
    onFiles?: (files?: FileList) => void;
}) {
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
            <input
                className="absolute inset-0 cursor-pointer opacity-0"
                type="file"
                accept="image/*"
                multiple={multiple}
                aria-label={label}
                onChange={(event) => {
                    if (multiple) onFiles?.(event.target.files || undefined);
                    else onFile?.(event.target.files?.[0]);
                    event.target.value = "";
                }}
            />
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
