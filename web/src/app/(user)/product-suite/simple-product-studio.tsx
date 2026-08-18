"use client";

import { App, Button, Input, Modal } from "antd";
import { saveAs } from "file-saver";
import { Check, Download, ExternalLink, ImagePlus, KeyRound, LoaderCircle, PackageCheck, RectangleHorizontal, RectangleVertical, RefreshCw, Settings2, ShieldCheck, Sparkles, Square, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { clearGotoccConnection, generateGotoccProductImage, loadGotoccConnection, saveGotoccConnection, testGotoccConnection, type GotoccConnection } from "@/services/api/gotocc";

type ProductPresetId = "marketplace" | "studio" | "lifestyle" | "outdoor" | "luxury" | "social";
type ProductAspect = "square" | "landscape" | "portrait";
type ProductResult = { id: string; url: string; preset: ProductPresetId };

const presets: Array<{ id: ProductPresetId; label: string; description: string; scene: string }> = [
    {
        id: "marketplace",
        label: "白底主图",
        description: "电商平台",
        scene: "a clean ecommerce catalog photograph on a seamless pure white background, centered with balanced margins and a soft natural grounding shadow",
    },
    {
        id: "studio",
        label: "高级棚拍",
        description: "品牌质感",
        scene: "a premium commercial studio photograph with a restrained neutral set, shaped softbox lighting, realistic material highlights and an elegant contact surface",
    },
    {
        id: "lifestyle",
        label: "生活场景",
        description: "自然使用",
        scene: "a believable premium lifestyle setting appropriate for this exact product, with natural daylight, realistic scale, useful context and an uncluttered composition",
    },
    {
        id: "outdoor",
        label: "户外广告",
        description: "氛围场景",
        scene: "a cinematic outdoor commercial setting appropriate for this exact product, with directional daylight, realistic ground contact and energetic but credible depth",
    },
    {
        id: "luxury",
        label: "质感特写",
        description: "材质细节",
        scene: "a close premium product photograph that keeps the complete product recognizable while emphasizing its real materials, texture, craftsmanship and controlled reflections",
    },
    {
        id: "social",
        label: "社媒广告",
        description: "醒目构图",
        scene: "a bold modern social media product advertisement with a clean graphic set, strong visual hierarchy, generous negative space and polished campaign lighting",
    },
];

const aspects: Array<{ id: ProductAspect; label: string; size: string; icon: typeof Square }> = [
    { id: "square", label: "方形", size: "1024x1024", icon: Square },
    { id: "landscape", label: "横图", size: "1536x1024", icon: RectangleHorizontal },
    { id: "portrait", label: "竖图", size: "1024x1536", icon: RectangleVertical },
];

export function SimpleProductStudio({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
    const { message } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const [images, setImages] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [presetId, setPresetId] = useState<ProductPresetId>("lifestyle");
    const [aspect, setAspect] = useState<ProductAspect>("square");
    const [results, setResults] = useState<ProductResult[]>([]);
    const [selectedResultId, setSelectedResultId] = useState("");
    const [generating, setGenerating] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [connection, setConnection] = useState<GotoccConnection | null>(null);
    const [connectionOpen, setConnectionOpen] = useState(false);
    const [connectionKey, setConnectionKey] = useState("");
    const [connecting, setConnecting] = useState(false);

    const selectedPreset = presets.find((preset) => preset.id === presetId) || presets[0];
    const selectedAspect = aspects.find((item) => item.id === aspect) || aspects[0];
    const selectedResult = results.find((result) => result.id === selectedResultId) || results[0];

    useEffect(() => {
        setConnection(loadGotoccConnection());
    }, []);

    useEffect(() => {
        if (!generating || !startedAt) return;
        const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        update();
        const timer = window.setInterval(update, 1000);
        return () => window.clearInterval(timer);
    }, [generating, startedAt]);

    useEffect(
        () => () => {
            previews.forEach((preview) => URL.revokeObjectURL(preview));
        },
        [previews],
    );

    const generationStatus = useMemo(() => {
        if (elapsed < 12) return "正在识别商品";
        if (elapsed < 35) return "正在保持商品细节";
        if (elapsed < 65) return "正在合成场景与光影";
        return "正在完成商品图";
    }, [elapsed]);

    const setProductImages = (files: File[]) => {
        const accepted = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 15 * 1024 * 1024).slice(0, 4);
        if (!accepted.length) {
            message.error("请选择 15 MB 以内的 JPEG、PNG 或 WebP 图片");
            return;
        }
        previews.forEach((preview) => URL.revokeObjectURL(preview));
        setImages(accepted);
        setPreviews(accepted.map((file) => URL.createObjectURL(file)));
        setResults([]);
        setSelectedResultId("");
    };

    const handleFiles = (files?: FileList | null) => {
        if (!files?.length) return;
        setProductImages(Array.from(files));
    };

    const loadDemo = async () => {
        try {
            const response = await fetch("/demo/motorcycle-source.jpg");
            const blob = await response.blob();
            setProductImages([new File([blob], "motorcycle-source.jpg", { type: blob.type || "image/jpeg" })]);
        } catch {
            message.error("示例图片加载失败");
        }
    };

    const connectGotocc = async () => {
        const key = connectionKey.trim() || connection?.apiKey || "";
        if (!key) return;
        setConnecting(true);
        try {
            const models = await testGotoccConnection(key);
            const next: GotoccConnection = {
                apiKey: key,
                model: models.includes("gpt-image-2") ? "gpt-image-2" : models[0],
                connectedAt: new Date().toISOString(),
            };
            saveGotoccConnection(next);
            setConnection(next);
            setConnectionKey("");
            setConnectionOpen(false);
            message.success("gotocc 额度已连接");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "连接失败");
        } finally {
            setConnecting(false);
        }
    };

    const disconnectGotocc = () => {
        clearGotoccConnection();
        setConnection(null);
        setConnectionKey("");
        setConnectionOpen(false);
    };

    const generate = async () => {
        if (!images.length) {
            inputRef.current?.click();
            return;
        }
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        setGenerating(true);
        setStartedAt(Date.now());
        setElapsed(0);
        try {
            const url = await generateGotoccProductImage(connection, images, buildProductPrompt(selectedPreset.scene), selectedAspect.size);
            const next = { id: crypto.randomUUID(), url, preset: presetId };
            setResults((current) => [next, ...current].slice(0, 4));
            setSelectedResultId(next.id);
            message.success("商品图已生成");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "商品图生成失败");
        } finally {
            setGenerating(false);
        }
    };

    const download = async () => {
        if (!selectedResult) return;
        const blob = await (await fetch(selectedResult.url)).blob();
        saveAs(blob, `product-${selectedResult.preset}-${Date.now()}.png`);
    };

    return (
        <main className="h-full min-w-0 overflow-x-hidden overflow-y-auto bg-[#f4f5f3] text-[#181a19] dark:bg-[#111312] dark:text-[#f4f5f3]">
            <header className="sticky top-0 z-20 flex min-h-16 min-w-0 items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-3 sm:px-6 dark:border-white/10 dark:bg-[#181a19]">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center bg-[#181a19] text-white dark:bg-white dark:text-black">
                        <PackageCheck className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="truncate text-base font-semibold">商品效果图</h1>
                        <p className="truncate text-xs text-black/50 dark:text-white/50">GPT Image 2</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button icon={connection ? <ShieldCheck className="size-4 text-emerald-600" /> : <KeyRound className="size-4" />} onClick={() => setConnectionOpen(true)}>
                        <span className="hidden sm:inline">{connection ? "gotocc 已连接" : "连接 gotocc"}</span>
                    </Button>
                    <Button aria-label="高级编辑" title="高级编辑" icon={<Settings2 className="size-4" />} onClick={onOpenAdvanced} />
                </div>
            </header>

            <div className="mx-auto grid min-h-[calc(100vh_-_64px)] w-full min-w-0 max-w-[1440px] grid-cols-[minmax(0,1fr)] lg:grid-cols-[400px_minmax(0,1fr)]">
                <aside className="min-w-0 overflow-hidden border-b border-black/10 bg-white p-4 sm:p-6 lg:border-r lg:border-b-0 dark:border-white/10 dark:bg-[#181a19]">
                    <section>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">商品原图</h2>
                            <button type="button" className="text-xs text-black/50 hover:text-black dark:text-white/50 dark:hover:text-white" onClick={() => void loadDemo()}>
                                试用示例
                            </button>
                        </div>
                        <button
                            type="button"
                            className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden border border-dashed border-black/25 bg-[#f7f8f6] transition hover:border-black/55 dark:border-white/25 dark:bg-black/20 dark:hover:border-white/55"
                            onClick={() => inputRef.current?.click()}
                        >
                            {previews[0] ? (
                                <img src={previews[0]} alt="商品原图" className="size-full object-contain" />
                            ) : (
                                <span className="flex flex-col items-center gap-3 text-sm text-black/45 dark:text-white/45">
                                    <span className="flex size-12 items-center justify-center border border-black/10 bg-white dark:border-white/10 dark:bg-[#242725]">
                                        <ImagePlus className="size-5" />
                                    </span>
                                    上传商品原图
                                </span>
                            )}
                        </button>
                        <input
                            ref={inputRef}
                            className="hidden"
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            multiple
                            aria-label="上传商品原图"
                            onChange={(event) => {
                                handleFiles(event.target.files);
                                event.target.value = "";
                            }}
                        />
                        {previews.length ? (
                            <div className="mt-2 flex items-center gap-2">
                                {previews.map((preview, index) => (
                                    <div key={preview} className="relative size-14 overflow-hidden border border-black/10 bg-[#f4f5f3] dark:border-white/10 dark:bg-black/20">
                                        <img src={preview} alt={`商品参考图 ${index + 1}`} className="size-full object-cover" />
                                    </div>
                                ))}
                                {previews.length < 4 ? (
                                    <button
                                        type="button"
                                        className="flex size-14 items-center justify-center border border-dashed border-black/20 text-black/45 hover:border-black/50 hover:text-black dark:border-white/20 dark:text-white/45 dark:hover:border-white/50 dark:hover:text-white"
                                        aria-label="更换商品图"
                                        title="更换商品图"
                                        onClick={() => inputRef.current?.click()}
                                    >
                                        <Upload className="size-4" />
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </section>

                    <section className="mt-7">
                        <h2 className="mb-3 text-sm font-semibold">想生成什么图</h2>
                        <div className="grid grid-cols-2 gap-2">
                            {presets.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={cn(
                                        "relative min-h-17 border px-3 py-2.5 text-left transition",
                                        preset.id === presetId ? "border-[#181a19] bg-[#eff8e9] dark:border-white dark:bg-[#23301f]" : "border-black/10 bg-white hover:border-black/35 dark:border-white/10 dark:bg-[#1d201e] dark:hover:border-white/35",
                                    )}
                                    onClick={() => setPresetId(preset.id)}
                                >
                                    <span className="block text-sm font-medium">{preset.label}</span>
                                    <span className="mt-1 block text-xs text-black/45 dark:text-white/45">{preset.description}</span>
                                    {preset.id === presetId ? <Check className="absolute top-2.5 right-2.5 size-3.5 text-emerald-700 dark:text-emerald-400" /> : null}
                                </button>
                            ))}
                        </div>
                    </section>

                    <section className="mt-7">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">画幅</h2>
                            <div className="flex border border-black/10 dark:border-white/10">
                                {aspects.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className={cn(
                                                "flex size-9 items-center justify-center border-r border-black/10 last:border-r-0 dark:border-white/10",
                                                aspect === item.id ? "bg-[#181a19] text-white dark:bg-white dark:text-black" : "hover:bg-black/5 dark:hover:bg-white/10",
                                            )}
                                            aria-label={item.label}
                                            title={item.label}
                                            onClick={() => setAspect(item.id)}
                                        >
                                            <Icon className="size-4" />
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <Button
                            block
                            type="primary"
                            size="large"
                            className="!h-12 !bg-[#181a19] !shadow-none dark:!bg-white dark:!text-black"
                            icon={generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                            loading={generating}
                            onClick={() => void generate()}
                        >
                            {generating ? `${generationStatus} · ${elapsed}s` : results.length ? "再生成一张" : "生成商品图"}
                        </Button>
                    </section>
                </aside>

                <section className="flex min-h-[560px] min-w-0 flex-col p-4 sm:p-6 lg:p-8">
                    <div className="mb-4 flex min-h-9 items-center justify-between gap-3">
                        <div>
                            <h2 className="text-sm font-semibold">生成结果</h2>
                            {selectedResult ? <p className="mt-1 text-xs text-black/45 dark:text-white/45">{presets.find((item) => item.id === selectedResult.preset)?.label}</p> : null}
                        </div>
                        {selectedResult ? (
                            <Button icon={<Download className="size-4" />} onClick={() => void download()}>
                                下载
                            </Button>
                        ) : null}
                    </div>

                    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden border border-black/10 bg-[#dfe2de] p-3 sm:p-6 dark:border-white/10 dark:bg-[#090a09]">
                        <div
                            className={cn(
                                "relative flex max-h-full max-w-full items-center justify-center overflow-hidden bg-white shadow-[0_20px_60px_rgba(0,0,0,0.14)]",
                                aspect === "square" && "aspect-square w-full max-w-[760px]",
                                aspect === "landscape" && "aspect-[3/2] w-full max-w-[960px]",
                                aspect === "portrait" && "aspect-[2/3] h-full max-h-[780px]",
                            )}
                        >
                            {selectedResult ? (
                                <img src={selectedResult.url} alt="生成的商品效果图" className="size-full object-contain" />
                            ) : previews[0] ? (
                                <div className="relative size-full">
                                    <img src={previews[0]} alt="待生成商品" className="size-full object-contain opacity-30" />
                                    <div className="absolute inset-0 flex items-center justify-center">
                                        <Button type="primary" icon={<Sparkles className="size-4" />} onClick={() => void generate()}>
                                            生成商品图
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <span className="flex flex-col items-center gap-3 text-sm text-black/35">
                                    <PackageCheck className="size-8" />
                                    生成结果会显示在这里
                                </span>
                            )}
                            {generating ? (
                                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/92 text-center backdrop-blur-[2px]">
                                    <LoaderCircle className="size-7 animate-spin" />
                                    <span className="text-sm font-medium">{generationStatus}</span>
                                    <span className="text-xs tabular-nums text-black/45">{elapsed}s</span>
                                </div>
                            ) : null}
                        </div>
                    </div>

                    {results.length ? (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                            {results.map((result, index) => (
                                <button
                                    key={result.id}
                                    type="button"
                                    className={cn("relative size-18 shrink-0 overflow-hidden border-2 bg-white", selectedResult?.id === result.id ? "border-[#181a19] dark:border-white" : "border-transparent")}
                                    onClick={() => setSelectedResultId(result.id)}
                                >
                                    <img src={result.url} alt={`生成结果 ${results.length - index}`} className="size-full object-cover" />
                                </button>
                            ))}
                            <button
                                type="button"
                                className="flex size-18 shrink-0 items-center justify-center border border-dashed border-black/20 bg-white text-black/45 hover:border-black/50 hover:text-black dark:border-white/20 dark:bg-[#181a19] dark:text-white/45"
                                aria-label="再生成一张"
                                title="再生成一张"
                                onClick={() => void generate()}
                            >
                                <RefreshCw className="size-4" />
                            </button>
                        </div>
                    ) : null}
                </section>
            </div>

            <Modal
                title="连接 gotocc 额度"
                open={connectionOpen}
                onCancel={() => setConnectionOpen(false)}
                onOk={() => void connectGotocc()}
                okText={connection ? "重新检测" : "连接"}
                cancelText="关闭"
                confirmLoading={connecting}
                okButtonProps={{ disabled: !connectionKey.trim() && !connection }}
            >
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm">
                        <span className={cn("size-2", connection ? "bg-emerald-500" : "bg-black/20")} />
                        <span>{connection ? "GPT Image 2 额度已连接" : "粘贴一次，以后自动使用"}</span>
                    </div>
                    <Button icon={<ExternalLink className="size-4" />} onClick={() => window.open("https://gotocc.xyz/keys", "_blank", "noopener,noreferrer")}>
                        打开 gotocc 密钥页
                    </Button>
                    <Input.Password aria-label="gotocc Key" value={connectionKey} onChange={(event) => setConnectionKey(event.target.value)} placeholder={connection ? "已保存，需要更换时再粘贴" : "粘贴 GPT image 2 分组的 sk- Key"} autoComplete="off" />
                    <p className="text-xs leading-5 text-black/45 dark:text-white/45">Key 仅保存在当前浏览器，不写入本站账号或数据库。</p>
                    {connection ? (
                        <Button danger icon={<X className="size-4" />} onClick={disconnectGotocc}>
                            断开连接
                        </Button>
                    ) : null}
                </div>
            </Modal>
        </main>
    );
}

function buildProductPrompt(scene: string) {
    return `PRODUCT BACKGROUND REPLACEMENT.
Use the uploaded image or images as the only identity reference for one exact product.
Keep the product exactly recognizable: preserve its geometry, proportions, colors, materials, logos, printed markings, labels, texture, perspective, visible components, count, and left-right orientation.
Do not mirror, redesign, repaint, relabel, add, remove, duplicate, crop away, or reinterpret any product part.
Create ${scene}.
Integrate the unchanged product naturally with physically realistic contact shadow, reflections, scale, depth and matching directional light.
Keep the product as the clear visual focus. No text, no people, no hands, no extra products, no watermark.`;
}
