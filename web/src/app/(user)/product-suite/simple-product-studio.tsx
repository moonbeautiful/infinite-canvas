"use client";

import { App, Button, Input, Modal } from "antd";
import { zipSync } from "fflate";
import { saveAs } from "file-saver";
import { Archive, Check, Download, ExternalLink, ImagePlus, KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Square, StopCircle, Upload, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { clearGotoccConnection, generateGotoccProductImage, loadGotoccConnection, saveGotoccConnection, testGotoccConnection, type GotoccConnection } from "@/services/api/gotocc";

import { loadMarketingAgentDraft, saveMarketingAgentDraft } from "./marketing-agent-storage";
import { cancelProductExtraction } from "./product-compositor";
import { cancelProductIdentityOcr } from "./product-identity-ocr";
import { auditMarketingImage, pendingQualityReport, type MarketingQualityReport } from "./product-marketing-quality";

type MarketingTaskId = "hero" | "marketplace" | "feature" | "lifestyle" | "detail" | "aplus" | "banner" | "poster";
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
    modelUrl: string;
    error: string;
    quality: MarketingQualityReport;
};

type ActiveRun = {
    id: number;
    sourceRevision: number;
    sourceImages: File[];
    brief: string;
    mode: "suite" | "retry";
    controller: AbortController;
    taskId?: MarketingTaskId;
    previousTask?: MarketingTask;
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
        id: "feature",
        label: "核心卖点图",
        usage: "卖点展示 / 商品副图",
        size: "1024x1024",
        ratio: "1:1",
        scene: "Create a conversion-focused selling-point image. Keep the complete product as the main subject and add two or three clean visual detail zones that reveal only real visible features, materials, controls, construction, or benefits supported by the references. Use disciplined hierarchy and clear callout space. Never invent specifications or hidden components.",
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
        id: "aplus",
        label: "A+ 内容图",
        usage: "Amazon A+ / 详情模块",
        size: "1536x1024",
        ratio: "3:2",
        scene: "Create a wide Amazon A+ style content module with the exact product, one supporting detail crop, and a clear visual story about a real visible benefit. Keep all important product content inside the inner 90% safe area. Use premium brand-consistent composition and clean copy zones. Never invent specifications, awards, dimensions, or certifications.",
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
    return marketingPlan.map((task) => ({ ...task, status: "idle", url: "", modelUrl: "", error: "", quality: pendingQualityReport() }));
}

export function SimpleProductStudio() {
    const { message, modal } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const activeRunRef = useRef<ActiveRun | null>(null);
    const runIdRef = useRef(0);
    const sourceRevisionRef = useRef(0);
    const generatingRef = useRef(false);
    const demoRequestRef = useRef(0);
    const loadingDemoRef = useRef(false);
    const [images, setImages] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [tasks, setTasks] = useState<MarketingTask[]>(createTasks);
    const tasksRef = useRef(tasks);
    const [brief, setBrief] = useState("");
    const briefRef = useRef(brief);
    const [generating, setGenerating] = useState(false);
    const [activeTaskId, setActiveTaskId] = useState<MarketingTaskId | "">("");
    const [activeAttempt, setActiveAttempt] = useState(1);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [connection, setConnection] = useState<GotoccConnection | null>(null);
    const [connectionOpen, setConnectionOpen] = useState(false);
    const [connectionKey, setConnectionKey] = useState("");
    const [connecting, setConnecting] = useState(false);
    const [draftReady, setDraftReady] = useState(false);
    const [loadingDemo, setLoadingDemo] = useState(false);
    const [repairTask, setRepairTask] = useState<MarketingTask | null>(null);
    const [repairNote, setRepairNote] = useState("");

    const completedTasks = tasks.filter((task) => task.status === "completed");
    const failedTasks = tasks.filter((task) => task.status === "error");
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    const progress = Math.round((completedTasks.length / marketingPlan.length) * 100);
    const remainingTasks = marketingPlan.length - completedTasks.length;
    const suiteComplete = completedTasks.length === marketingPlan.length && !failedTasks.length;
    const productInputDisabled = !draftReady || loadingDemo || generating;

    useEffect(() => {
        setConnection(loadGotoccConnection());
        void loadMarketingAgentDraft()
            .then((draft) => {
                if (!draft?.images?.length || sourceRevisionRef.current !== 0 || generatingRef.current) return;
                sourceRevisionRef.current += 1;
                setImages(draft.images);
                setBrief(draft.brief || "");
                briefRef.current = draft.brief || "";
                setPreviews(draft.images.map((file) => URL.createObjectURL(file)));
                const restoredTasks: MarketingTask[] = createTasks().map((task): MarketingTask => {
                    const stored = draft.tasks.find((item) => item.id === task.id);
                    if (!stored) return task;
                    const restored = { ...task, url: stored.url || "", modelUrl: stored.modelUrl || "", quality: stored.quality || pendingQualityReport() };
                    if (stored.status === "generating") return { ...restored, status: "error", error: "生成被中断，请重试" };
                    if (stored.status === "completed" && (draft.version < 5 || !stored.quality || stored.quality.status === "pending")) {
                        return { ...restored, status: "error", error: "旧结果未经过新版商品身份质检，请重新生成", quality: pendingQualityReport() };
                    }
                    return { ...restored, status: stored.status, error: stored.error || "" };
                });
                tasksRef.current = restoredTasks;
                setTasks(restoredTasks);
            })
            .catch(() => {})
            .finally(() => setDraftReady(true));
    }, []);

    useEffect(() => {
        if (!draftReady) return;
        const timer = window.setTimeout(() => {
            void saveMarketingAgentDraft({
                images,
                brief,
                tasks: tasks.map(({ id, status, url, modelUrl, error, quality }) => ({ id, status, url, modelUrl, error, quality })),
            });
        }, 300);
        return () => window.clearTimeout(timer);
    }, [brief, draftReady, images, tasks]);

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
            cancelProductExtraction();
            cancelProductIdentityOcr();
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
        setTasks((current) => {
            const next = current.map((task) => (task.id === id ? { ...task, ...patch } : task));
            tasksRef.current = next;
            return next;
        });
    };

    const startRun = (mode: ActiveRun["mode"], previousTask?: MarketingTask) => {
        const controller = new AbortController();
        const run: ActiveRun = {
            id: ++runIdRef.current,
            sourceRevision: sourceRevisionRef.current,
            sourceImages: images.slice(),
            brief: briefRef.current,
            mode,
            controller,
            taskId: previousTask?.id,
            previousTask,
        };
        demoRequestRef.current += 1;
        loadingDemoRef.current = false;
        setLoadingDemo(false);
        activeRunRef.current = run;
        abortRef.current = controller;
        generatingRef.current = true;
        setGenerating(true);
        setStartedAt(Date.now());
        setElapsed(0);
        return run;
    };

    const isRunActive = (run: ActiveRun) => !run.controller.signal.aborted && activeRunRef.current?.id === run.id && sourceRevisionRef.current === run.sourceRevision;

    const assertRunActive = (run: ActiveRun) => {
        if (!isRunActive(run)) throw new DOMException("Aborted", "AbortError");
    };

    const finishRun = (run: ActiveRun) => {
        if (activeRunRef.current?.id !== run.id) return false;
        activeRunRef.current = null;
        abortRef.current = null;
        generatingRef.current = false;
        setGenerating(false);
        setActiveTaskId("");
        setActiveAttempt(1);
        return true;
    };

    const handleBriefChange = (value: string) => {
        if (generatingRef.current) return;
        briefRef.current = value;
        setBrief(value);
        if (!tasksRef.current.some((task) => task.url || task.status === "completed")) return;
        setTasks((current) => {
            const next = current.map((task) => (task.status === "completed" ? { ...task, status: "error" as const, error: "商品卖点已修改，请重新生成", quality: pendingQualityReport() } : task));
            tasksRef.current = next;
            return next;
        });
    };

    const setProductImages = (files: File[], keepDemoRequest = false) => {
        if (generatingRef.current) {
            message.warning("请先停止当前生成，再更换商品原图");
            return;
        }
        const accepted = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 15 * 1024 * 1024).slice(0, 4);
        if (!accepted.length) {
            message.error("请选择 15 MB 以内的 JPEG、PNG 或 WebP 图片");
            return;
        }
        sourceRevisionRef.current += 1;
        if (!keepDemoRequest) demoRequestRef.current += 1;
        previews.forEach((preview) => URL.revokeObjectURL(preview));
        setImages(accepted);
        setPreviews(accepted.map((file) => URL.createObjectURL(file)));
        const freshTasks = createTasks();
        tasksRef.current = freshTasks;
        setTasks(freshTasks);
        setActiveTaskId("");
    };

    const handleFiles = (files?: FileList | null) => {
        if (files?.length) setProductImages(Array.from(files));
    };

    const loadDemo = async () => {
        if (!draftReady || generatingRef.current || loadingDemoRef.current) return;
        const requestId = ++demoRequestRef.current;
        loadingDemoRef.current = true;
        setLoadingDemo(true);
        try {
            const response = await fetch("/demo/motorcycle-source.jpg");
            const blob = await response.blob();
            if (requestId !== demoRequestRef.current || generatingRef.current) return;
            setProductImages([new File([blob], "motorcycle-source.jpg", { type: blob.type || "image/jpeg" })], true);
        } catch {
            message.error("示例图片加载失败");
        } finally {
            if (requestId === demoRequestRef.current) {
                loadingDemoRef.current = false;
                setLoadingDemo(false);
            }
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

    const referencesForTask = async (task: MarketingTaskDefinition, heroUrl: string, run: ActiveRun, currentResultUrl = "") => {
        const sourceImages = run.sourceImages;
        if (currentResultUrl) {
            const currentBlob = await (await fetch(currentResultUrl)).blob();
            const currentFile = new File([currentBlob], `current-${task.id}.png`, { type: currentBlob.type || "image/png" });
            if (task.id === "hero") return [...sourceImages.slice(0, 3), currentFile];
            const heroBlob = await (await fetch(heroUrl)).blob();
            const heroFile = new File([heroBlob], "campaign-hero.png", { type: heroBlob.type || "image/png" });
            return [...sourceImages.slice(0, 2), heroFile, currentFile];
        }
        if (!heroUrl || task.id === "hero" || task.id === "marketplace") return sourceImages.slice(0, 4);
        const heroBlob = await (await fetch(heroUrl)).blob();
        const heroFile = new File([heroBlob], "campaign-hero.png", { type: heroBlob.type || "image/png" });
        return [...sourceImages.slice(0, 3), heroFile];
    };

    const renderTask = async (task: MarketingTaskDefinition, heroUrl: string, run: ActiveRun, repairRequest = "", currentResultUrl = "") => {
        assertRunActive(run);
        run.taskId = task.id;
        updateTask(task.id, { status: "generating", error: "", quality: pendingQualityReport() });
        setActiveTaskId(task.id);
        let lastError: unknown;
        let repairDraftUrl = currentResultUrl;
        let activeRepairRequest = repairRequest;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
            assertRunActive(run);
            setActiveAttempt(attempt);
            try {
                const references = await referencesForTask(task, heroUrl, run, repairDraftUrl);
                assertRunActive(run);
                const hasCampaignAnchor = Boolean(heroUrl && task.id !== "hero" && (task.id !== "marketplace" || repairDraftUrl));
                const prompt = buildMarketingPrompt(task, hasCampaignAnchor, run.brief, activeRepairRequest);
                const generatedUrl = await generateGotoccProductImage(connection as GotoccConnection, references, prompt, task.size, run.controller.signal);
                assertRunActive(run);
                const url = await applyMarketingCopy(generatedUrl, task, run.brief);
                assertRunActive(run);
                const quality = await auditMarketingImage({
                    taskId: task.id,
                    source: run.sourceImages[0],
                    sources: run.sourceImages,
                    resultUrl: url,
                    identityUrl: generatedUrl,
                    expectedSize: task.size,
                    heroUrl: task.id === "hero" ? undefined : heroUrl,
                    signal: run.controller.signal,
                    previousResults: tasksRef.current.filter((item) => item.id !== task.id && item.status === "completed" && item.url).map((item) => ({ id: item.id, label: item.label, url: item.url })),
                });
                assertRunActive(run);
                const modelUrl = generatedUrl === url ? "" : generatedUrl;
                updateTask(task.id, { url, modelUrl, quality });
                if (quality.status === "error") {
                    repairDraftUrl = generatedUrl;
                    activeRepairRequest = automaticRepairRequest(task, quality, repairRequest);
                    throw Object.assign(new Error(`自动质检未通过：${quality.summary}`), { retryable: true });
                }
                return { url, modelUrl, quality };
            } catch (error) {
                lastError = error;
                if (!isRunActive(run) || attempt === 2 || !shouldRetry(error)) throw error;
                await waitForRetry(run.controller.signal);
            }
        }
        throw lastError;
    };

    const generateSuite = async () => {
        if (!draftReady || loadingDemoRef.current || generatingRef.current) return;
        if (!images.length) {
            inputRef.current?.click();
            return;
        }
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        const run = startRun("suite");
        const freshTasks = createTasks();
        tasksRef.current = freshTasks;
        setTasks(freshTasks);
        let heroUrl = "";
        let completed = 0;
        let failed = 0;
        let finishedCurrentRun = false;

        try {
            for (const task of marketingPlan) {
                if (!isRunActive(run)) break;
                try {
                    const result = await renderTask(task, heroUrl, run);
                    assertRunActive(run);
                    if (task.id === "hero") heroUrl = result.url;
                    updateTask(task.id, { status: "completed", url: result.url, modelUrl: result.modelUrl, error: "", quality: result.quality });
                    completed += 1;
                } catch (error) {
                    if (!isRunActive(run)) {
                        const interrupted = tasksRef.current.find((item) => item.id === task.id);
                        if (activeRunRef.current?.id === run.id) {
                            updateTask(
                                task.id,
                                interrupted?.url && interrupted.quality.status === "error"
                                    ? { status: "error", error: `自动质检未通过：${interrupted.quality.summary}` }
                                    : { status: "idle", url: "", modelUrl: "", error: "", quality: pendingQualityReport() },
                            );
                        }
                        break;
                    }
                    const errorMessage = error instanceof Error ? error.message : "生成失败";
                    updateTask(task.id, { status: "error", error: errorMessage });
                    failed += 1;
                    if (task.id === "hero") {
                        for (const dependent of marketingPlan.slice(1)) {
                            updateTask(dependent.id, { status: "error", error: "品牌主视觉未通过，未启动关联任务" });
                            failed += 1;
                        }
                        break;
                    }
                }
            }
        } finally {
            finishedCurrentRun = finishRun(run);
        }

        if (!finishedCurrentRun) return;
        if (run.controller.signal.aborted) message.info("已停止，已完成的图片会保留");
        else if (failed) message.warning(`完成 ${completed} 张，${failed} 张可单独重试`);
        else message.success(`${marketingPlan.length} 张商品营销图已全部生成并完成自动质检`);
    };

    const requestGenerateSuite = () => {
        if (!draftReady || loadingDemoRef.current || generatingRef.current) return;
        if (!completedTasks.length) {
            void generateSuite();
            return;
        }
        modal.confirm({
            title: `重新生成整套 ${marketingPlan.length} 张？`,
            content: "现有结果会被替换，基础费用约 $0.64；自动质检或异常重试可能增加用量。",
            okText: "确认生成",
            cancelText: "取消",
            onOk: generateSuite,
        });
    };

    const retryTask = async (task: MarketingTask, repairRequest = "") => {
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        if (!draftReady || loadingDemoRef.current || !images.length || generatingRef.current) return;
        const heroUrl = tasks.find((item) => item.id === "hero" && item.status === "completed")?.url || "";
        if (task.id !== "hero" && !heroUrl) {
            message.warning("品牌主视觉尚未通过，请先重试整套");
            return;
        }
        const run = startRun("retry", task);
        const previousTask = task;
        let finishedCurrentRun = false;
        try {
            const qualityRepairRequest = task.quality.status === "error" ? automaticRepairRequest(task, task.quality, "") : "";
            const activeRepairRequest = repairRequest || qualityRepairRequest;
            const currentDraftUrl = activeRepairRequest ? task.modelUrl || task.url : "";
            const result = await renderTask(task, heroUrl, run, activeRepairRequest, currentDraftUrl);
            assertRunActive(run);
            updateTask(task.id, { status: "completed", url: result.url, modelUrl: result.modelUrl, error: "", quality: result.quality });
            message.success(`${task.label}已重新生成并通过自动质检`);
        } catch (error) {
            if (!isRunActive(run)) {
                if (activeRunRef.current?.id !== run.id) return;
                updateTask(task.id, {
                    status: previousTask.status,
                    url: previousTask.url,
                    modelUrl: previousTask.modelUrl,
                    error: previousTask.error,
                    quality: previousTask.quality,
                });
                message.info("已停止，原结果已保留");
            } else {
                updateTask(task.id, { status: "error", error: error instanceof Error ? error.message : "生成失败" });
            }
        } finally {
            finishedCurrentRun = finishRun(run);
        }
        if (!finishedCurrentRun) return;
    };

    const openRepair = (task: MarketingTask) => {
        setRepairTask(task);
        setRepairNote(task.error.startsWith("自动质检未通过") ? task.error.replace("自动质检未通过：", "") : "");
    };

    const submitRepair = async () => {
        if (!repairTask || !repairNote.trim()) return;
        const target = repairTask;
        setRepairTask(null);
        await retryTask(target, repairNote.trim());
        setRepairNote("");
    };

    const stopGeneration = () => {
        const run = activeRunRef.current;
        if (!run) return;
        run.controller.abort();
        cancelProductExtraction();
        cancelProductIdentityOcr();
        activeRunRef.current = null;
        runIdRef.current += 1;
        abortRef.current = null;
        generatingRef.current = false;
        setGenerating(false);
        setActiveTaskId("");
        setActiveAttempt(1);
        if (run.mode === "retry" && run.previousTask) {
            updateTask(run.previousTask.id, {
                status: run.previousTask.status,
                url: run.previousTask.url,
                modelUrl: run.previousTask.modelUrl,
                error: run.previousTask.error,
                quality: run.previousTask.quality,
            });
            message.info("已停止，原结果已保留");
            return;
        }
        if (run.taskId) {
            const interrupted = tasksRef.current.find((item) => item.id === run.taskId);
            updateTask(
                run.taskId,
                interrupted?.url && interrupted.quality.status === "error" ? { status: "error", error: `自动质检未通过：${interrupted.quality.summary}` } : { status: "idle", url: "", modelUrl: "", error: "", quality: pendingQualityReport() },
            );
        }
        message.info("已停止，已完成的图片会保留");
    };

    const downloadTask = async (task: MarketingTask) => {
        if (!task.url) return;
        saveAs(await (await fetch(task.url)).blob(), `${String((taskOrder.get(task.id) || 0) + 1).padStart(2, "0")}-${task.id}-${task.ratio.replace(":", "x")}.png`);
    };

    const downloadSuite = async () => {
        if (!suiteComplete) {
            message.warning(`整套尚未完成：${completedTasks.length}/${marketingPlan.length}，请先重试失败任务`);
            return;
        }
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
                    {suiteComplete ? (
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
                            <button type="button" className="text-xs text-black/50 hover:text-black disabled:cursor-not-allowed disabled:opacity-40 dark:text-white/50 dark:hover:text-white" disabled={productInputDisabled} onClick={() => void loadDemo()}>
                                {loadingDemo ? "加载示例中" : "试用示例"}
                            </button>
                        </div>
                        <button
                            type="button"
                            className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden border border-dashed border-black/25 bg-[#f7f8f6] transition hover:border-black/55 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/25 dark:bg-black/20 dark:hover:border-white/55"
                            disabled={productInputDisabled}
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
                            disabled={productInputDisabled}
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
                                    className="flex size-13 shrink-0 items-center justify-center border border-dashed border-black/20 text-black/45 hover:border-black/50 hover:text-black disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/20 dark:text-white/45"
                                    aria-label="更换商品图"
                                    title="更换商品图"
                                    disabled={productInputDisabled}
                                    onClick={() => inputRef.current?.click()}
                                >
                                    <Upload className="size-4" />
                                </button>
                            </div>
                        ) : null}
                        <Input.TextArea
                            className="mt-3"
                            aria-label="商品名称和卖点"
                            value={brief}
                            disabled={productInputDisabled}
                            maxLength={180}
                            autoSize={{ minRows: 2, maxRows: 4 }}
                            placeholder="商品名称和卖点（可选）&#10;例如：轻量车架；前碟刹；越野轮胎"
                            onChange={(event) => handleBriefChange(event.target.value)}
                        />
                    </section>

                    <section className="mt-5">
                        <div className="mb-3 flex items-center justify-between text-xs text-black/50 dark:text-white/50">
                            <span>整套 {marketingPlan.length} 张 · 约 12-20 分钟</span>
                            <span>基础约 $0.64</span>
                        </div>
                        {generating ? (
                            <div className="grid grid-cols-[minmax(0,1fr)_44px] gap-2">
                                <Button block size="large" className="!h-12" icon={<LoaderCircle className="size-4 animate-spin" />} disabled>
                                    {activeTask ? `${activeTask.label}${activeAttempt > 1 ? " · 自动重试" : ""} · ${formatTime(elapsed)}` : "正在准备"}
                                </Button>
                                <Button danger size="large" className="!h-12 !w-11 !p-0" aria-label="停止生成" title="停止生成" icon={<StopCircle className="size-4" />} onClick={stopGeneration} />
                            </div>
                        ) : (
                            <Button block type="primary" size="large" disabled={!draftReady || loadingDemo} className="!h-12 !bg-[#e45d2f] !shadow-none hover:!bg-[#cf4d23]" icon={<Sparkles className="size-4" />} onClick={requestGenerateSuite}>
                                {completedTasks.length ? `重新生成整套 ${marketingPlan.length} 张` : `一键生成整套 ${marketingPlan.length} 张`}
                            </Button>
                        )}
                        <p className="mt-2 text-xs leading-5 text-black/40 dark:text-white/40">每张先自动质检再交付；主视觉、画幅、白底或商品颜色证据不合格时会自动重试一次。</p>
                    </section>

                    <section className="mt-6">
                        <div className="mb-3 flex items-center justify-between">
                            <h2 className="text-sm font-semibold">2. Agent 自动规划</h2>
                            <span className="text-xs text-black/45 dark:text-white/45">{marketingPlan.length} 张</span>
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
                            {suiteComplete ? <Button className="sm:hidden" aria-label="下载整套" title="下载整套" icon={<Archive className="size-4" />} onClick={() => void downloadSuite()} /> : null}
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
                                        <p className="truncate text-xs text-black/45 dark:text-white/45">{task.status === "completed" ? `${task.usage} · 质检 ${task.quality.score}` : task.usage}</p>
                                    </div>
                                    <TaskStatusMark status={task.status} quality={task.quality} />
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
                                    {task.status === "error" && task.url && task.error ? (
                                        <div className="absolute inset-x-2 top-2 max-h-16 overflow-hidden bg-red-950/90 px-2 py-1.5 text-[11px] leading-4 text-white" title={task.error}>
                                            {task.error}
                                        </div>
                                    ) : null}
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
                                                aria-label={task.id === "hero" ? "重新生成整套视觉" : `重新生成${task.label}`}
                                                title={task.id === "hero" ? "主视觉变化会影响整套，重新生成全部图片" : `重新生成${task.label}`}
                                                disabled={generating}
                                                onClick={task.id === "hero" ? requestGenerateSuite : () => void retryTask(task)}
                                            >
                                                <RefreshCw className="size-3.5" />
                                            </button>
                                            {task.id !== "hero" ? (
                                                <button
                                                    type="button"
                                                    className="flex size-8 items-center justify-center bg-[#e45d2f] text-white hover:bg-[#cf4d23] disabled:opacity-50"
                                                    aria-label={`定向返修${task.label}`}
                                                    title={`定向返修${task.label}`}
                                                    disabled={generating}
                                                    onClick={() => openRepair(task)}
                                                >
                                                    <WandSparkles className="size-3.5" />
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                    {task.status === "error" ? (
                                        <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                className={cn("flex h-9 items-center justify-center gap-2 bg-white text-xs font-medium text-black shadow-sm disabled:opacity-50", task.id === "hero" && "col-span-2")}
                                                disabled={generating}
                                                onClick={task.id === "hero" || task.error === "品牌主视觉未通过，未启动关联任务" ? () => void generateSuite() : () => void retryTask(task)}
                                            >
                                                <RefreshCw className="size-3.5" />
                                                {task.id === "hero" || task.error === "品牌主视觉未通过，未启动关联任务" ? "重试整套" : "重试本张"}
                                            </button>
                                            {task.id !== "hero" && task.error !== "品牌主视觉未通过，未启动关联任务" ? (
                                                <button type="button" className="flex h-9 items-center justify-center gap-2 bg-[#e45d2f] text-xs font-medium text-white shadow-sm disabled:opacity-50" disabled={generating} onClick={() => openRepair(task)}>
                                                    <WandSparkles className="size-3.5" />
                                                    定向返修
                                                </button>
                                            ) : null}
                                        </div>
                                    ) : null}
                                </div>
                            </article>
                        ))}
                    </div>

                    {completedTasks.length ? (
                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-black/10 pt-5 dark:border-white/10">
                            <p className="text-xs text-black/45 dark:text-white/45">
                                {suiteComplete ? `${marketingPlan.length} 张已全部完成自动质检；警告项会显示琥珀色分数。` : `${remainingTasks} 张尚未完成${failedTasks.length ? `（${failedTasks.length} 张需处理）` : ""}，整套 ZIP 暂不可下载。`}
                            </p>
                            <Button type="primary" disabled={!suiteComplete} className="!bg-[#171918] dark:!bg-white dark:!text-black" icon={<Archive className="size-4" />} onClick={() => void downloadSuite()}>
                                {suiteComplete ? "下载整套 ZIP" : `等待 ${remainingTasks} 张`}
                            </Button>
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
            <Modal
                title={repairTask ? `定向返修 · ${repairTask.label}` : "定向返修"}
                open={Boolean(repairTask)}
                okText="按要求返修"
                cancelText="取消"
                okButtonProps={{ disabled: !repairNote.trim() || generating }}
                confirmLoading={generating}
                onCancel={() => {
                    setRepairTask(null);
                    setRepairNote("");
                }}
                onOk={() => void submitRepair()}
            >
                <p className="mb-3 text-xs leading-5 text-black/45 dark:text-white/45">Agent 会同时参考商品原图、品牌主视觉和当前结果，只修改你指出的问题，其他构图与风格尽量保持。</p>
                <Input.TextArea
                    aria-label="返修要求"
                    value={repairNote}
                    maxLength={300}
                    autoSize={{ minRows: 3, maxRows: 6 }}
                    placeholder="例如：不要镜像商品；恢复原图车头贴花；背景更明亮，但保持当前构图"
                    onChange={(event) => setRepairNote(event.target.value)}
                />
            </Modal>
        </main>
    );
}

function TaskStatusMark({ status, quality }: { status: TaskStatus; quality: MarketingQualityReport }) {
    if (status === "completed")
        return (
            <span title={quality.summary} aria-label={quality.summary}>
                <Check className={cn("size-4", quality.status === "warning" ? "text-amber-500" : "text-emerald-600")} />
            </span>
        );
    if (status === "generating") return <LoaderCircle className="size-4 animate-spin text-[#e45d2f]" />;
    if (status === "error") return <span className="size-2 bg-red-500" title="生成失败" />;
    return <span className="size-2 border border-black/20 dark:border-white/20" />;
}

function buildMarketingPrompt(task: MarketingTaskDefinition, hasCampaignAnchor: boolean, brief: string, repairRequest = "") {
    const consistency = hasCampaignAnchor
        ? "The uploaded references include original product evidence and a generated campaign hero. Use the original product evidence as the authority for product identity. Use the campaign hero only as the visual-system anchor for palette, lighting language, surface treatment, and premium mood. Do not copy its composition."
        : "Infer one coherent premium campaign visual system from the product's real colors, materials, category, and intended use.";
    const verifiedBrief = brief.trim()
        ? `User-provided product facts and selling points (use as semantic context, do not add unsupported claims): ${brief.trim()}`
        : "No product copy was provided. Emphasize only benefits directly visible in the reference images.";
    const copyZone =
        task.id === "feature"
            ? "Keep the bottom 28% visually quiet for deterministic selling-point copy that will be added after generation."
            : task.id === "aplus"
              ? "Place the product and detail crop on the right side and keep the left 38% visually quiet for deterministic A+ copy that will be added after generation."
              : "";
    const repairClause = repairRequest
        ? `TARGETED REPAIR: The last uploaded reference is the current draft. Fix only this issue: ${repairRequest}. Preserve every correct product detail, composition, crop, palette, lighting direction, and background element not explicitly mentioned.`
        : "";
    return `PRODUCT MARKETING SUITE — ${task.label} (${task.ratio}).
Use the uploaded image or images as the only identity reference for one exact product.
Keep the product exactly recognizable: preserve its geometry, proportions, colors, materials, logos, printed markings, labels, texture, perspective, visible components, count, packaging, and left-right orientation.
Do not mirror, redesign, repaint, relabel, add, remove, duplicate, crop away, open, disassemble, or reinterpret any product part.
${consistency}
${verifiedBrief}
${copyZone}
${repairClause}
${task.scene}
Integrate the unchanged product with physically realistic scale, contact shadow, reflections, depth, and matching directional light.
Preserve all native text and logos already printed on the product, but add no new text, letters, numbers, badges, interface elements, people, hands, extra products, or watermark.`;
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function shouldRetry(error: unknown) {
    return Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);
}

function automaticRepairRequest(task: MarketingTaskDefinition, quality: MarketingQualityReport, originalRequest: string) {
    const directives = quality.checks
        .filter((check) => check.status === "error")
        .map((check) => {
            switch (check.id) {
                case "dimensions":
                    return `Return exactly the requested ${task.size} canvas.`;
                case "render":
                    return "Return a complete, detailed, nonblank commercial image.";
                case "product-color":
                    return "Restore the product's exact original colors and visible markings.";
                case "product-text":
                    return "Restore every original logo, printed word, letter, number, and label exactly as shown in the product references.";
                case "silhouette":
                    return "Restore the original product silhouette, proportions, visible components, perspective, and left-right orientation.";
                case "marketplace":
                    return "Use a pure white background, keep the complete product inside the canvas, and size it for a marketplace main image.";
                case "duplicate":
                    return "Create a clearly different task-specific composition while preserving the same exact product.";
                case "campaign":
                    return "Match the campaign hero's palette, light direction, surface treatment, and premium mood.";
            }
        });
    return [originalRequest ? `Keep satisfying the user's repair request: ${originalRequest}` : "", "The automatic quality gate rejected the current draft.", ...directives, `Observed quality evidence: ${quality.summary}`].filter(Boolean).join(" ");
}

function waitForRetry(signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const abort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = window.setTimeout(() => {
            signal.removeEventListener("abort", abort);
            resolve();
        }, 1500);
        signal.addEventListener("abort", abort, { once: true });
    });
}

async function applyMarketingCopy(dataUrl: string, task: MarketingTaskDefinition, brief: string) {
    const suppliedLines = brief
        .split(/[\n；;。]+/)
        .map((line, index) => line.trim().slice(0, index === 0 ? 20 : 24))
        .filter(Boolean)
        .slice(0, 4);
    if (task.id !== "feature" && task.id !== "aplus") return dataUrl;
    const lines = suppliedLines.length ? suppliedLines : task.id === "feature" ? ["核心设计", "可见结构细节", "原图信息参考"] : ["商品展示", "可见细节", "原图信息为准"];

    const image = await loadMarketingImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0);

    const panel =
        task.id === "aplus"
            ? { x: 0, y: 0, width: Math.round(canvas.width * 0.4), height: canvas.height, padding: Math.round(canvas.width * 0.045) }
            : { x: 0, y: Math.round(canvas.height * 0.7), width: canvas.width, height: Math.round(canvas.height * 0.3), padding: Math.round(canvas.width * 0.055) };
    context.fillStyle = "rgba(12, 14, 13, 0.82)";
    context.fillRect(panel.x, panel.y, panel.width, panel.height);

    const titleSize = Math.max(32, Math.round(canvas.width * 0.042));
    const bodySize = Math.max(22, Math.round(canvas.width * 0.025));
    let y = panel.y + panel.padding + titleSize;
    context.fillStyle = "#ffffff";
    context.font = `600 ${titleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    context.textBaseline = "alphabetic";
    y = drawWrappedText(context, lines[0], panel.x + panel.padding, y, panel.width - panel.padding * 2, titleSize * 1.25);
    context.font = `400 ${bodySize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    context.fillStyle = "rgba(255,255,255,0.84)";
    for (const line of lines.slice(1)) {
        y += bodySize * 0.55;
        y = drawWrappedText(context, `• ${line}`, panel.x + panel.padding, y, panel.width - panel.padding * 2, bodySize * 1.35);
    }
    return canvas.toDataURL("image/png");
}

function drawWrappedText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    let line = "";
    for (const character of text) {
        const candidate = line + character;
        if (line && context.measureText(candidate).width > maxWidth) {
            context.fillText(line, x, y);
            y += lineHeight;
            line = character;
        } else {
            line = candidate;
        }
    }
    if (line) {
        context.fillText(line, x, y);
        y += lineHeight;
    }
    return y;
}

function loadMarketingImage(src: string) {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("营销图文案合成失败"));
        image.src = src;
    });
}
