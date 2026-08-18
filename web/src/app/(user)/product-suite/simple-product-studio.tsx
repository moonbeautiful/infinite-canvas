"use client";

import { App, Button, Input, Modal } from "antd";
import { zipSync } from "fflate";
import { saveAs } from "file-saver";
import { Archive, Check, Download, ExternalLink, ImagePlus, KeyRound, LoaderCircle, PackageCheck, RefreshCw, ShieldCheck, Sparkles, Square, StopCircle, Upload, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { clearGotoccConnection, generateGotoccProductImage, loadGotoccConnection, saveGotoccConnection, testGotoccConnection, type GotoccConnection } from "@/services/api/gotocc";

import { loadMarketingAgentDraft, saveMarketingAgentDraft } from "./marketing-agent-storage";

type MarketingTaskId = "hero" | "marketplace" | "lifestyle" | "detail" | "banner" | "poster";
type TaskStatus = "idle" | "generating" | "completed" | "error";

type MarketingTaskDefinition = {
    id: MarketingTaskId;
    label: string;
    usage: string;
    size: "1024x1024" | "1536x1024" | "1024x1536";
    ratio: "1:1" | "3:2" | "2:3";
    scene: string;
};

type MarketingTask = MarketingTaskDefinition & {
    status: TaskStatus;
    url: string;
    error: string;
};

const marketingPlan: MarketingTaskDefinition[] = [
    {
        id: "hero",
        label: "品牌主视觉",
        usage: "官网首屏 / 核心传播",
        size: "1024x1024",
        ratio: "1:1",
        scene: "Create the campaign-defining hero image: a premium commercial studio set tailored to this exact product, with a restrained supporting palette derived from the product, sculpted key light, credible surface contact, elegant depth, and generous composition. This image establishes the visual language for the rest of the campaign.",
    },
    {
        id: "marketplace",
        label: "电商白底主图",
        usage: "商城列表 / 商品主图",
        size: "1024x1024",
        ratio: "1:1",
        scene: "Create a marketplace-ready catalog packshot on pure white RGB 255,255,255. Center the complete product and let it fill about 85% of the frame with balanced margins. Use even professional studio light and only a subtle physically realistic grounding shadow. No props, decoration, gradient, border, or floating effect.",
    },
    {
        id: "lifestyle",
        label: "真实使用场景",
        usage: "详情页 / 内容种草",
        size: "1024x1024",
        ratio: "1:1",
        scene: "Place the exact product in its most believable aspirational real-life use environment. Infer the appropriate setting and scale from the product itself. Use natural directional light, realistic surrounding materials, editorial depth of field, and an uncluttered composition that immediately explains when and where the product is used.",
    },
    {
        id: "detail",
        label: "材质工艺特写",
        usage: "卖点说明 / 详情页",
        size: "1024x1024",
        ratio: "1:1",
        scene: "Create a premium detail photograph focused on the product's most purchase-relevant real material, texture, mechanism, finish, stitching, edge, or craftsmanship. Keep enough of the complete product visible to preserve recognition. Use macro-quality directional lighting and physically accurate reflections without inventing internal parts.",
    },
    {
        id: "banner",
        label: "横版广告图",
        usage: "Banner / 广告投放",
        size: "1536x1024",
        ratio: "3:2",
        scene: "Create a wide campaign advertisement using the same visual language as the hero reference. Place the exact product as the dominant subject with clear negative space for future copy, strong left-to-right visual hierarchy, premium campaign lighting, realistic contact, and a polished brand-advertising finish.",
    },
    {
        id: "poster",
        label: "竖版社媒海报",
        usage: "小红书 / Story / 海报",
        size: "1024x1536",
        ratio: "2:3",
        scene: "Create a vertical social campaign poster using the same visual language as the hero reference. Keep the exact product fully recognizable in the central safe area, add visual depth above and below, reserve clean negative space for future headline and CTA, and use a premium editorial composition without adding any text or interface elements.",
    },
];

const taskOrder = new Map(marketingPlan.map((task, index) => [task.id, index]));

function createTasks(): MarketingTask[] {
    return marketingPlan.map((task) => ({ ...task, status: "idle", url: "", error: "" }));
}

export function SimpleProductStudio({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
    const { message, modal } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const [images, setImages] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [tasks, setTasks] = useState<MarketingTask[]>(createTasks);
    const [generating, setGenerating] = useState(false);
    const [activeTaskId, setActiveTaskId] = useState<MarketingTaskId | "">("");
    const [startedAt, setStartedAt] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [connection, setConnection] = useState<GotoccConnection | null>(null);
    const [connectionOpen, setConnectionOpen] = useState(false);
    const [connectionKey, setConnectionKey] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [draftReady, setDraftReady] = useState(false);

    const completedTasks = tasks.filter((task) => task.status === "completed");
    const failedTasks = tasks.filter((task) => task.status === "error");
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    const progress = Math.round((completedTasks.length / marketingPlan.length) * 100);

    useEffect(() => {
        setConnection(loadGotoccConnection());
        void loadMarketingAgentDraft()
            .then((draft) => {
                if (!draft?.images?.length) return;
                setImages(draft.images);
                setPreviews(draft.images.map((file) => URL.createObjectURL(file)));
                setTasks(
                    createTasks().map((task) => {
                        const stored = draft.tasks.find((item) => item.id === task.id);
                        if (!stored) return task;
                        if (stored.status === "generating") return { ...task, status: "error", url: stored.url || "", error: "生成被中断，请重试" };
                        return { ...task, status: stored.status, url: stored.url || "", error: stored.error || "" };
                    }),
                );
            })
            .catch(() => {})
            .finally(() => setDraftReady(true));
    }, []);

    useEffect(() => {
        if (!draftReady) return;
        const timer = window.setTimeout(() => {
            void saveMarketingAgentDraft({
                images,
                tasks: tasks.map(({ id, status, url, error }) => ({ id, status, url, error })),
            });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [draftReady, images, tasks]);

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
            abortRef.current?.abort();
        },
        [previews],
    );

    const statusText = useMemo(() => {
        if (!generating) {
            if (completedTasks.length === marketingPlan.length) return "整套营销图已完成";
            if (completedTasks.length) return `已完成 ${completedTasks.length} / ${marketingPlan.length}`;
            return "等待生成";
        }
        return activeTask ? `正在生成：${activeTask.label}` : "正在准备营销套图";
    }, [activeTask, completedTasks.length, generating]);

    const updateTask = (id: MarketingTaskId, patch: Partial<MarketingTask>) => {
        setTasks((current) => current.map((task) => (task.id === id ? { ...task, ...patch } : task)));
    };

    const setProductImages = (files: File[]) => {
        const accepted = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 15 * 1024 * 1024).slice(0, 4);
        if (!accepted.length) {
            message.error("请选择 15 MB 以内的 JPEG、PNG 或 WebP 图片");
            return;
        }
        previews.forEach((preview) => URL.revokeObjectURL(preview));
        setImages(accepted);
        setPreviews(accepted.map((file) => URL.createObjectURL(file)));
        setTasks(createTasks());
        setActiveTaskId("");
    };

    const handleFiles = (files?: FileList | null) => {
        if (files?.length) setProductImages(Array.from(files));
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

    const referencesForTask = async (task: MarketingTaskDefinition, heroUrl: string) => {
        if (!heroUrl || task.id === "hero" || task.id === "marketplace") return images.slice(0, 4);
        const heroBlob = await (await fetch(heroUrl)).blob();
        const heroFile = new File([heroBlob], "campaign-hero.png", { type: heroBlob.type || "image/png" });
        return [...images.slice(0, 3), heroFile];
    };

    const renderTask = async (task: MarketingTaskDefinition, heroUrl: string, signal: AbortSignal) => {
        updateTask(task.id, { status: "generating", error: "" });
        setActiveTaskId(task.id);
        const references = await referencesForTask(task, heroUrl);
        const prompt = buildMarketingPrompt(task, Boolean(heroUrl && task.id !== "hero" && task.id !== "marketplace"));
        return generateGotoccProductImage(connection as GotoccConnection, references, prompt, task.size, signal);
    };

    const generateSuite = async () => {
        if (!images.length) {
            inputRef.current?.click();
            return;
        }
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        setTasks(createTasks());
        setGenerating(true);
        setStartedAt(Date.now());
        setElapsed(0);
        let heroUrl = "";
        let completed = 0;
        let failed = 0;

        try {
            for (const task of marketingPlan) {
                if (controller.signal.aborted) break;
                try {
                    const url = await renderTask(task, heroUrl, controller.signal);
                    if (task.id === "hero") heroUrl = url;
                    updateTask(task.id, { status: "completed", url, error: "" });
                    completed += 1;
                } catch (error) {
                    if (controller.signal.aborted) {
                        updateTask(task.id, { status: "idle", error: "" });
                        break;
                    }
                    updateTask(task.id, { status: "error", error: error instanceof Error ? error.message : "生成失败" });
                    failed += 1;
                }
            }
        } finally {
            abortRef.current = null;
            setGenerating(false);
            setActiveTaskId("");
        }

        if (controller.signal.aborted) message.info("已停止，已完成的图片会保留");
        else if (failed) message.warning(`完成 ${completed} 张，${failed} 张可单独重试`);
        else message.success("6 张商品营销图已全部生成");
    };

    const requestGenerateSuite = () => {
        if (!completedTasks.length) {
            void generateSuite();
            return;
        }
        modal.confirm({
            title: "重新生成整套 6 张？",
            content: "现有结果会被替换，预计再次消耗 $0.36。",
            okText: "确认生成",
            cancelText: "取消",
            onOk: generateSuite,
        });
    };

    const retryTask = async (task: MarketingTask) => {
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        if (!images.length || generating) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setGenerating(true);
        setStartedAt(Date.now());
        setElapsed(0);
        try {
            const heroUrl = tasks.find((item) => item.id === "hero")?.url || "";
            const url = await renderTask(task, heroUrl, controller.signal);
            updateTask(task.id, { status: "completed", url, error: "" });
            message.success(`${task.label}已重新生成`);
        } catch (error) {
            if (!controller.signal.aborted) updateTask(task.id, { status: "error", error: error instanceof Error ? error.message : "生成失败" });
        } finally {
            abortRef.current = null;
            setGenerating(false);
            setActiveTaskId("");
        }
    };

    const stopGeneration = () => {
        abortRef.current?.abort();
    };

    const downloadTask = async (task: MarketingTask) => {
        if (!task.url) return;
        saveAs(await (await fetch(task.url)).blob(), `${String((taskOrder.get(task.id) || 0) + 1).padStart(2, "0")}-${task.id}-${task.ratio.replace(":", "x")}.png`);
    };

    const downloadSuite = async () => {
        if (!completedTasks.length) return;
        const files: Record<string, Uint8Array> = {};
        for (const task of completedTasks) {
            const index = (taskOrder.get(task.id) || 0) + 1;
            files[`${String(index).padStart(2, "0")}-${task.id}-${task.ratio.replace(":", "x")}.png`] = new Uint8Array(await (await fetch(task.url)).arrayBuffer());
        }
        const archive = Uint8Array.from(zipSync(files, { level: 0 }));
        saveAs(new Blob([archive], { type: "application/zip" }), "product-marketing-suite.zip");
    };

    return (
        <main className="h-full min-w-0 overflow-x-hidden overflow-y-auto bg-[#f2f4f1] text-[#171918] dark:bg-[#0d0f0e] dark:text-[#f5f6f4]">
            <header className="sticky top-0 z-20 flex min-h-17 min-w-0 items-center justify-between gap-3 border-b border-black/10 bg-white px-4 py-3 sm:px-6 dark:border-white/10 dark:bg-[#151816]">
                <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center bg-[#e45d2f] text-white">
                        <WandSparkles className="size-5" />
                    </span>
                    <div className="min-w-0">
                        <h1 className="truncate text-base font-semibold">商品营销图 Agent</h1>
                        <p className="truncate text-xs text-black/50 dark:text-white/50">一次上传，自动生成完整营销套图</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {completedTasks.length ? (
                        <Button className="hidden sm:inline-flex" icon={<Archive className="size-4" />} onClick={() => void downloadSuite()}>
                            下载整套
                        </Button>
                    ) : null}
                    <Button
                        aria-label={connection ? "gotocc 已连接" : "连接 gotocc"}
                        title={connection ? "gotocc 已连接" : "连接 gotocc"}
                        icon={connection ? <ShieldCheck className="size-4 text-emerald-600" /> : <KeyRound className="size-4" />}
                        onClick={() => setConnectionOpen(true)}
                    >
                        <span className="hidden sm:inline">{connection ? "gotocc 已连接" : "连接 gotocc"}</span>
                    </Button>
                </div>
            </header>

            <div className="mx-auto grid min-h-[calc(100vh_-_68px)] w-full min-w-0 max-w-[1500px] grid-cols-[minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)]">
                <aside className="min-w-0 border-b border-black/10 bg-white p-4 sm:p-6 xl:border-r xl:border-b-0 dark:border-white/10 dark:bg-[#151816]">
                    <section>
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">1. 上传商品原图</h2>
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
                                    上传 1-4 张商品原图
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
                            <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
                                {previews.map((preview, index) => (
                                    <div key={preview} className="size-13 shrink-0 overflow-hidden border border-black/10 bg-[#f4f5f3] dark:border-white/10 dark:bg-black/20">
                                        <img src={preview} alt={`商品参考图 ${index + 1}`} className="size-full object-cover" />
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    className="flex size-13 shrink-0 items-center justify-center border border-dashed border-black/20 text-black/45 hover:border-black/50 hover:text-black dark:border-white/20 dark:text-white/45"
                                    aria-label="更换商品图"
                                    title="更换商品图"
                                    onClick={() => inputRef.current?.click()}
                                >
                                    <Upload className="size-4" />
                                </button>
                            </div>
                        ) : null}
                    </section>

                    <section className="mt-5">
                        <div className="mb-3 flex items-center justify-between text-xs text-black/50 dark:text-white/50">
                            <span>整套 6 张 · 约 8-12 分钟</span>
                            <span>预计 $0.36</span>
                        </div>
                        {generating ? (
                            <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                                <Button block size="large" className="!h-12" icon={<LoaderCircle className="size-4 animate-spin" />} disabled>
                                    {activeTask ? `${activeTask.label} · ${formatTime(elapsed)}` : "正在准备"}
                                </Button>
                                <Button danger size="large" className="!h-12 !w-11 !p-0" aria-label="停止生成" title="停止生成" icon={<StopCircle className="size-4" />} onClick={stopGeneration} />
                            </div>
                        ) : (
                            <Button block type="primary" size="large" className="!h-12 !bg-[#e45d2f] !shadow-none hover:!bg-[#cf4d23]" icon={<Sparkles className="size-4" />} onClick={requestGenerateSuite}>
                                {completedTasks.length ? "重新生成整套 6 张" : "一键生成整套 6 张"}
                            </Button>
                        )}
                        <p className="mt-2 text-xs leading-5 text-black/40 dark:text-white/40">先生成品牌主视觉，后续图片自动沿用同一套色彩、光影和商品外观。</p>
                    </section>

                    <section className="mt-6">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">2. Agent 自动规划</h2>
                            <span className="text-xs text-black/45 dark:text-white/45">6 张</span>
                        </div>
                        <div className="divide-y divide-black/8 border border-black/10 dark:divide-white/8 dark:border-white/10">
                            {marketingPlan.map((task, index) => (
                                <div key={task.id} className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5">
                                    <span className="text-xs tabular-nums text-black/35 dark:text-white/35">{String(index + 1).padStart(2, "0")}</span>
                                    <div className="min-w-0">
                                        <span className="block truncate text-sm font-medium">{task.label}</span>
                                        <span className="block truncate text-xs text-black/45 dark:text-white/45">{task.usage}</span>
                                    </div>
                                    <span className="text-[11px] text-black/40 dark:text-white/40">{task.ratio}</span>
                                </div>
                            ))}
                        </div>
                    </section>
                </aside>

                <section className="min-w-0 p-4 sm:p-6 xl:p-8">
                    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h2 className="text-base font-semibold">营销套图</h2>
                            <p className="mt-1 text-xs text-black/45 dark:text-white/45">{statusText}</p>
                        </div>
                        <div className="flex items-center gap-2">
                            {completedTasks.length ? <Button className="sm:hidden" aria-label="下载整套" title="下载整套" icon={<Archive className="size-4" />} onClick={() => void downloadSuite()} /> : null}
                            <span className="text-sm tabular-nums">
                                {completedTasks.length}/{marketingPlan.length}
                            </span>
                        </div>
                    </div>

                    <div className="mb-5 h-1 overflow-hidden bg-black/10 dark:bg-white/10">
                        <div className="h-full bg-[#e45d2f] transition-[width] duration-500" style={{ width: `${progress}%` }} />
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        {tasks.map((task, index) => (
                            <article key={task.id} className="min-w-0 overflow-hidden border border-black/10 bg-white dark:border-white/10 dark:bg-[#151816]">
                                <div className="flex min-h-13 items-center gap-3 border-b border-black/8 px-3 dark:border-white/8">
                                    <span className="text-xs tabular-nums text-black/35 dark:text-white/35">{String(index + 1).padStart(2, "0")}</span>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="truncate text-sm font-medium">{task.label}</h3>
                                        <p className="truncate text-xs text-black/45 dark:text-white/45">{task.usage}</p>
                                    </div>
                                    <TaskStatusMark status={task.status} />
                                </div>

                                <div className="relative aspect-square overflow-hidden bg-[#e7e9e6] dark:bg-[#080a09]">
                                    {task.url ? (
                                        <img src={task.url} alt={task.label} className={cn("size-full object-contain", task.ratio === "3:2" && "mx-auto aspect-[3/2] h-auto", task.ratio === "2:3" && "mx-auto h-full w-auto aspect-[2/3]")} />
                                    ) : (
                                        <div className="flex size-full flex-col items-center justify-center gap-3 text-center text-black/30 dark:text-white/30">
                                            {task.status === "generating" ? <LoaderCircle className="size-7 animate-spin text-[#e45d2f]" /> : <Square className="size-7" />}
                                            <span className="text-xs">{task.status === "generating" ? "Agent 正在生成" : task.error || "等待生成"}</span>
                                        </div>
                                    )}
                                    {task.status === "completed" ? (
                                        <div className="absolute right-2 bottom-2 flex gap-1">
                                            <button
                                                type="button"
                                                className="flex size-8 items-center justify-center bg-black/75 text-white backdrop-blur hover:bg-black"
                                                aria-label={`下载${task.label}`}
                                                title={`下载${task.label}`}
                                                onClick={() => void downloadTask(task)}
                                            >
                                                <Download className="size-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                className="flex size-8 items-center justify-center bg-black/75 text-white backdrop-blur hover:bg-black disabled:opacity-50"
                                                aria-label={`重新生成${task.label}`}
                                                title={`重新生成${task.label}`}
                                                disabled={generating}
                                                onClick={() => void retryTask(task)}
                                            >
                                                <RefreshCw className="size-3.5" />
                                            </button>
                                        </div>
                                    ) : null}
                                    {task.status === "error" ? (
                                        <button
                                            type="button"
                                            className="absolute inset-x-3 bottom-3 flex h-9 items-center justify-center gap-2 bg-white text-xs font-medium text-black shadow-sm disabled:opacity-50"
                                            disabled={generating}
                                            onClick={() => void retryTask(task)}
                                        >
                                            <RefreshCw className="size-3.5" />
                                            重试本张
                                        </button>
                                    ) : null}
                                </div>
                            </article>
                        ))}
                    </div>

                    {completedTasks.length ? (
                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-5 dark:border-white/10">
                            <p className="text-xs text-black/45 dark:text-white/45">{failedTasks.length ? `${failedTasks.length} 张需要重试，其余结果已保留。` : "整套图片可分别下载，也可打包为 ZIP。"}</p>
                            <div className="flex gap-2">
                                <Button icon={<PackageCheck className="size-4" />} onClick={onOpenAdvanced}>
                                    精修单张
                                </Button>
                                <Button type="primary" className="!bg-[#171918] dark:!bg-white dark:!text-black" icon={<Archive className="size-4" />} onClick={() => void downloadSuite()}>
                                    下载整套 ZIP
                                </Button>
                            </div>
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

function TaskStatusMark({ status }: { status: TaskStatus }) {
    if (status === "completed") return <Check className="size-4 text-emerald-600" />;
    if (status === "generating") return <LoaderCircle className="size-4 animate-spin text-[#e45d2f]" />;
    if (status === "error") return <span className="size-2 bg-red-500" title="生成失败" />;
    return <span className="size-2 border border-black/20 dark:border-white/20" />;
}

function buildMarketingPrompt(task: MarketingTaskDefinition, hasCampaignAnchor: boolean) {
    const consistency = hasCampaignAnchor
        ? "The uploaded references include original product evidence and a generated campaign hero. Use the original product evidence as the authority for product identity. Use the campaign hero only as the visual-system anchor for palette, lighting language, surface treatment, and premium mood. Do not copy its composition."
        : "Infer one coherent premium campaign visual system from the product's real colors, materials, category, and intended use.";
    return `PRODUCT MARKETING SUITE — ${task.label} (${task.ratio}).
Use the uploaded image or images as the only identity reference for one exact product.
Keep the product exactly recognizable: preserve its geometry, proportions, colors, materials, logos, printed markings, labels, texture, perspective, visible components, count, packaging, and left-right orientation.
Do not mirror, redesign, repaint, relabel, add, remove, duplicate, crop away, open, disassemble, or reinterpret any product part.
${consistency}
${task.scene}
Integrate the unchanged product with physically realistic scale, contact shadow, reflections, depth, and matching directional light.
Preserve all native text and logos already printed on the product, but add no new text, letters, numbers, badges, interface elements, people, hands, extra products, or watermark.`;
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}
