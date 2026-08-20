"use client";

import { App, Button, ConfigProvider, Input, Modal, theme as antdTheme } from "antd";
import { zip } from "fflate";
import { saveAs } from "file-saver";
import { Archive, Check, ChevronDown, CircleHelp, Download, Eye, FileImage, History, ImagePlus, Images, KeyRound, Layers3, LoaderCircle, Palette, RefreshCw, ShieldCheck, Sparkles, Square, StopCircle, Upload, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { clearGotoccConnection, generateGotoccProductImage, GotoccConnectionError, loadGotoccConnection, saveGotoccConnection, testGotoccConnection, type GotoccConnection } from "@/services/api/gotocc";

import { loadMarketingAgentDraft, loadMarketingAgentHistory, saveMarketingAgentDraft, saveMarketingAgentHistory, type MarketingAgentHistoryItem, type StoredMarketingTask } from "./marketing-agent-storage";
import { cancelProductExtraction } from "./product-compositor";
import { cancelProductIdentityOcr } from "./product-identity-ocr";
import { auditMarketingImage, pendingQualityReport, type MarketingQualityReport } from "./product-marketing-quality";
import { buildProductScenePlan, resolveCampaignBrandColor, type ProductScenePlan } from "./product-marketing-scene-plan";
import { isLegacyQualityGateResult, recoveredUpdatedHero, restoreCampaignOptions } from "./product-marketing-state";
import { selectDiverseProductReferences } from "./product-reference-selection";
import {
    buildCampaignManifest,
    buildMarketingPrompt,
    defaultCampaignOptions,
    estimateSuiteCost,
    isCompleteMarketingSuite,
    marketingPlan,
    normalizeMarketingSelection,
    selectedPlan,
    suiteBlockerIds,
    taskById,
    type CampaignOptions,
    type MarketingTaskDefinition,
    type MarketingTaskId,
} from "./product-marketing-plan";

type TaskStatus = "idle" | "generating" | "completed" | "error";
type WorkspaceTab = "results" | "examples" | "history";

type MarketingTask = MarketingTaskDefinition & {
    status: TaskStatus;
    url: string;
    modelUrl: string;
    error: string;
    upstreamStateUnknown: boolean;
    quality: MarketingQualityReport;
};

type ActiveRun = {
    id: number;
    sourceRevision: number;
    sourceImages: File[];
    brief: string;
    campaignOptions: CampaignOptions;
    plan: MarketingTaskDefinition[];
    mode: "suite" | "retry";
    controller: AbortController;
    contactSheet?: Promise<File | null>;
    styleReference?: {
        url: string;
        file: Promise<File>;
    };
    scenePlan: ProductScenePlan;
    resolvedBrandColor: string;
    previousTasks: MarketingTask[];
    heroUpdated: boolean;
    taskId?: MarketingTaskId;
    previousTask?: MarketingTask;
};

type ExampleCase = {
    id: string;
    label: string;
    description: string;
    source: string;
    result: string;
    brief: string;
};

const allTaskIds = marketingPlan.map((task) => task.id);
const taskOrder = new Map(marketingPlan.map((task, index) => [task.id, index]));
const styleDependentTaskIds = new Set<MarketingTaskId>(["feature", "lifestyle", "detail", "aplus", "banner", "poster"]);
const brandColorPresets = [
    { id: "black", label: "高级黑", color: "#1f2329" },
    { id: "blue", label: "科技蓝", color: "#1677ff" },
    { id: "red", label: "活力红", color: "#d62b28" },
    { id: "green", label: "自然绿", color: "#2f7d5c" },
    { id: "orange", label: "温暖橙", color: "#e07a2d" },
] as const;
const exampleCases: ExampleCase[] = [
    {
        id: "lipstick",
        label: "高端美妆",
        description: "静物 / 材质 / 社媒",
        source: "/demo/lipstick-source.jpg",
        result: "/demo/lipstick-linkfox-reference.png",
        brief: "奢华口红；金属包装质感；高端编辑风；保留原有品牌标识和色号",
    },
    {
        id: "plush",
        label: "毛绒玩具",
        description: "陪伴 / 家居 / 礼赠",
        source: "/demo/plush-fox-source.jpg",
        result: "/demo/plush-linkfox-reference.png",
        brief: "毛绒狐狸玩具；柔软陪伴；儿童礼物；保留原有造型、颜色和面部细节",
    },
];

function createTasks(): MarketingTask[] {
    return marketingPlan.map((task) => ({
        ...task,
        status: "idle",
        url: "",
        modelUrl: "",
        error: "",
        upstreamStateUnknown: false,
        quality: pendingQualityReport(),
    }));
}

function restoreMarketingTask(task: MarketingTask, stored: StoredMarketingTask, interruptedMessage: string): MarketingTask {
    const url = stored.url || "";
    const upstreamStateUnknown = Boolean(stored.upstreamStateUnknown || (stored.status === "generating" && !url));
    const legacyQualityGate = isLegacyQualityGateResult(stored, upstreamStateUnknown);
    const receivedBeforeRefresh = stored.status === "generating" && Boolean(url) && !upstreamStateUnknown;
    return {
        ...task,
        url,
        modelUrl: stored.modelUrl || "",
        status: legacyQualityGate || receivedBeforeRefresh ? "completed" : stored.status === "generating" ? "error" : stored.status,
        error: legacyQualityGate || receivedBeforeRefresh ? "" : stored.status === "generating" ? interruptedMessage : stored.error || "",
        upstreamStateUnknown,
        quality: stored.quality || pendingQualityReport(),
    };
}

export function LinkFoxProductStudio() {
    const { message, modal } = App.useApp();
    const inputRef = useRef<HTMLInputElement>(null);
    const addInputRef = useRef<HTMLInputElement>(null);
    const resultsPanelRef = useRef<HTMLElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const activeRunRef = useRef<ActiveRun | null>(null);
    const runIdRef = useRef(0);
    const sourceRevisionRef = useRef(0);
    const localEditRevisionRef = useRef(0);
    const generatingRef = useRef(false);
    const loadingExampleRef = useRef(false);
    const exampleRequestRef = useRef(0);
    const [images, setImages] = useState<File[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [tasks, setTasks] = useState<MarketingTask[]>(createTasks);
    const tasksRef = useRef(tasks);
    const [brief, setBrief] = useState("");
    const briefRef = useRef(brief);
    const [campaignOptions, setCampaignOptions] = useState<CampaignOptions>(defaultCampaignOptions);
    const campaignOptionsRef = useRef(campaignOptions);
    const [selectedTaskIds, setSelectedTaskIds] = useState<MarketingTaskId[]>(allTaskIds);
    const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>("results");
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
    const [loadingExample, setLoadingExample] = useState(false);
    const [repairTask, setRepairTask] = useState<MarketingTask | null>(null);
    const [repairNote, setRepairNote] = useState("");
    const [previewTask, setPreviewTask] = useState<MarketingTask | null>(null);
    const [historyItems, setHistoryItems] = useState<MarketingAgentHistoryItem[]>([]);
    const [downloadingSuite, setDownloadingSuite] = useState(false);

    const currentScenePlan = useMemo(
        () =>
            buildProductScenePlan(
                brief,
                images.map((file) => file.name),
            ),
        [brief, images],
    );
    const currentPlan = useMemo(() => selectedPlan(selectedTaskIds), [selectedTaskIds]);
    const currentTaskIdSet = useMemo(() => new Set(selectedTaskIds), [selectedTaskIds]);
    const selectedTasks = tasks.filter((task) => currentTaskIdSet.has(task.id));
    const completedTasks = selectedTasks.filter((task) => task.status === "completed");
    const activeTask = tasks.find((task) => task.id === activeTaskId);
    const progress = currentPlan.length ? Math.round((completedTasks.length / currentPlan.length) * 100) : 0;
    const suiteGateTasks = tasks.map((task) => ({
        id: task.id,
        status: task.status,
        qualityStatus: task.quality.status,
        hasResult: Boolean(task.url),
    }));
    const fullSuiteBlockers = suiteBlockerIds(selectedTaskIds, suiteGateTasks);
    const suiteComplete = isCompleteMarketingSuite(selectedTaskIds, suiteGateTasks);
    const productInputDisabled = loadingExample || generating;
    const estimatedCost = estimateSuiteCost(currentPlan.length);
    const repairUnknownUpstreamState = Boolean(repairTask?.upstreamStateUnknown);

    const showWorkspaceTab = (tab: WorkspaceTab) => {
        setWorkspaceTab(tab);
        window.requestAnimationFrame(() => resultsPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };

    useEffect(() => {
        setConnection(loadGotoccConnection());
        void loadMarketingAgentHistory()
            .then(setHistoryItems)
            .catch(() => {});
        void loadMarketingAgentDraft()
            .then((draft) => {
                if (!draft?.images?.length || sourceRevisionRef.current !== 0 || localEditRevisionRef.current !== 0 || generatingRef.current) return;
                sourceRevisionRef.current += 1;
                setImages(draft.images);
                setBrief(draft.brief || "");
                briefRef.current = draft.brief || "";
                const nextOptions = restoreCampaignOptions(draft.campaignOptions);
                setCampaignOptions(nextOptions);
                campaignOptionsRef.current = nextOptions;
                const restoredSelection = (draft.selectedTaskIds || allTaskIds).filter((id): id is MarketingTaskId => Boolean(taskById(id)));
                setSelectedTaskIds(normalizeMarketingSelection(restoredSelection.length ? restoredSelection : allTaskIds));
                setPreviews(draft.images.map((file) => URL.createObjectURL(file)));
                let restoredTasks = createTasks().map((task): MarketingTask => {
                    const stored = draft.tasks.find((item) => item.id === task.id);
                    if (!stored) return task;
                    return restoreMarketingTask(task, stored, "页面刷新时上游结果状态未知；为避免重复扣费，请先确认 gotocc 记录后再重试");
                });
                if (recoveredUpdatedHero(draft.tasks)) {
                    restoredTasks = restoredTasks.map((task) =>
                        styleDependentTaskIds.has(task.id) && task.url
                            ? {
                                  ...task,
                                  status: "error",
                                  error: "品牌主视觉已更新，请重新生成以延续同一套风格",
                                  quality: pendingQualityReport(),
                              }
                            : task,
                    );
                }
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
                campaignOptions,
                selectedTaskIds,
                tasks: tasks.map(({ id, status, url, modelUrl, error, upstreamStateUnknown, quality }) => ({
                    id,
                    status,
                    url,
                    modelUrl,
                    error,
                    upstreamStateUnknown,
                    quality,
                })),
            }).catch(() => {});
        }, 300);
        return () => window.clearTimeout(timer);
    }, [brief, campaignOptions, draftReady, images, selectedTaskIds, tasks]);

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
            if (suiteComplete) return "已完成全部 8 张商品营销图";
            if (completedTasks.length) return `已完成 ${completedTasks.length} / ${currentPlan.length}`;
            return images.length ? "商品档案已就绪" : "等待上传商品图片";
        }
        return activeTask ? `正在生成：${activeTask.label}` : "正在建立商品生成任务";
    }, [activeTask, completedTasks.length, currentPlan.length, generating, images.length, suiteComplete]);

    const updateTask = (id: MarketingTaskId, patch: Partial<MarketingTask>) => {
        const next = tasksRef.current.map((task) => (task.id === id ? { ...task, ...patch } : task));
        tasksRef.current = next;
        setTasks(next);
    };

    const acknowledgeUnknownUpstreamState = (ids?: MarketingTaskId[]) => {
        const selected = ids ? new Set(ids) : null;
        const next = tasksRef.current.map((task) => (task.upstreamStateUnknown && (!selected || selected.has(task.id)) ? { ...task, upstreamStateUnknown: false } : task));
        tasksRef.current = next;
        setTasks(next);
    };

    const persistRunDraft = async (run: ActiveRun) => {
        try {
            await saveMarketingAgentDraft({
                images: run.sourceImages,
                brief: run.brief,
                campaignOptions: run.campaignOptions,
                selectedTaskIds,
                tasks: tasksRef.current.map(({ id, status, url, modelUrl, error, upstreamStateUnknown, quality }) => ({
                    id,
                    status,
                    url,
                    modelUrl,
                    error,
                    upstreamStateUnknown,
                    quality,
                })),
            });
            return true;
        } catch {
            return false;
        }
    };

    const archiveRun = async (run: ActiveRun) => {
        if (!tasksRef.current.some((task) => task.status === "completed" && task.url)) return;
        const next = await saveMarketingAgentHistory({
            images: run.sourceImages,
            brief: run.brief,
            campaignOptions: run.campaignOptions,
            selectedTaskIds: run.plan.map((task) => task.id),
            tasks: tasksRef.current.map(({ id, status, url, modelUrl, error, upstreamStateUnknown, quality }) => ({
                id,
                status,
                url,
                modelUrl,
                error,
                upstreamStateUnknown,
                quality,
            })),
        });
        setHistoryItems(next);
    };

    const invalidateCompleted = (reason: string) => {
        if (!tasksRef.current.some((task) => task.status === "completed")) return;
        setTasks((current) => {
            const next = current.map((task) =>
                task.status === "completed"
                    ? {
                          ...task,
                          status: "error" as const,
                          error: reason,
                          quality: pendingQualityReport(),
                      }
                    : task,
            );
            tasksRef.current = next;
            return next;
        });
    };

    const invalidateStyleDependentResults = (reason: string) => {
        const next = tasksRef.current.map((task) =>
            styleDependentTaskIds.has(task.id) && task.url
                ? {
                      ...task,
                      status: "error" as const,
                      error: reason,
                      quality: pendingQualityReport(),
                  }
                : task,
        );
        tasksRef.current = next;
        setTasks(next);
    };

    const startRun = (mode: ActiveRun["mode"], plan: MarketingTaskDefinition[], previousTask?: MarketingTask) => {
        const controller = new AbortController();
        const sourceImages = images.slice();
        const brief = briefRef.current;
        const scenePlan = buildProductScenePlan(
            brief,
            sourceImages.map((file) => file.name),
        );
        const campaignOptions = { ...campaignOptionsRef.current };
        const resolvedBrandColor = resolveCampaignBrandColor(campaignOptions, scenePlan);
        const run: ActiveRun = {
            id: ++runIdRef.current,
            sourceRevision: sourceRevisionRef.current,
            sourceImages,
            brief,
            campaignOptions,
            plan,
            mode,
            controller,
            scenePlan,
            resolvedBrandColor,
            previousTasks: tasksRef.current.map((task) => ({ ...task })),
            heroUpdated: false,
            taskId: previousTask?.id,
            previousTask,
        };
        exampleRequestRef.current += 1;
        loadingExampleRef.current = false;
        setLoadingExample(false);
        activeRunRef.current = run;
        abortRef.current = controller;
        generatingRef.current = true;
        setGenerating(true);
        setStartedAt(Date.now());
        setElapsed(0);
        setWorkspaceTab("results");
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
        localEditRevisionRef.current += 1;
        briefRef.current = value;
        setBrief(value);
        invalidateCompleted("商品信息已修改，请重新生成");
    };

    const updateCampaignOption = <K extends keyof CampaignOptions>(key: K, value: CampaignOptions[K]) => {
        if (generatingRef.current) return;
        localEditRevisionRef.current += 1;
        const next = { ...campaignOptionsRef.current, [key]: value };
        campaignOptionsRef.current = next;
        setCampaignOptions(next);
        invalidateCompleted("市场或品牌设置已修改，请重新生成");
    };

    const selectBrandColor = (preset: CampaignOptions["brandColorPreset"], color: string) => {
        if (generatingRef.current) return;
        localEditRevisionRef.current += 1;
        const next = {
            ...campaignOptionsRef.current,
            brandColorPreset: preset,
            brandColor: color,
        };
        campaignOptionsRef.current = next;
        setCampaignOptions(next);
        invalidateCompleted("品牌颜色已修改，请重新生成");
    };

    const setProductImages = (files: File[], keepExampleRequest = false) => {
        if (generatingRef.current) {
            message.warning("请先停止当前生成，再更换商品原图");
            return;
        }
        const accepted = files.filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 15 * 1024 * 1024).slice(0, 5);
        if (!accepted.length) {
            message.error("请选择 15 MB 以内的 JPEG、PNG 或 WebP 图片");
            return;
        }
        sourceRevisionRef.current += 1;
        if (!keepExampleRequest) exampleRequestRef.current += 1;
        previews.forEach((preview) => URL.revokeObjectURL(preview));
        setImages(accepted);
        setPreviews(accepted.map((file) => URL.createObjectURL(file)));
        const freshTasks = createTasks();
        tasksRef.current = freshTasks;
        setTasks(freshTasks);
        setActiveTaskId("");
        setWorkspaceTab("results");
    };

    const handleFiles = (files?: FileList | null, mode: "add" | "replace" = "replace") => {
        if (!files?.length) return;
        if (mode === "add" && images.length >= 5) {
            message.warning("最多 5 张；请先移除一张或选择“更换全部”");
            return;
        }
        setProductImages(mode === "add" ? [...images, ...Array.from(files)] : Array.from(files));
    };

    const clearProductImages = () => {
        if (generatingRef.current) return;
        sourceRevisionRef.current += 1;
        exampleRequestRef.current += 1;
        previews.forEach((preview) => URL.revokeObjectURL(preview));
        setImages([]);
        setPreviews([]);
        const freshTasks = createTasks();
        tasksRef.current = freshTasks;
        setTasks(freshTasks);
        setActiveTaskId("");
    };

    const removeProductImage = (index: number) => {
        if (generatingRef.current) return;
        const next = images.filter((_, imageIndex) => imageIndex !== index);
        if (next.length) setProductImages(next);
        else clearProductImages();
    };

    const restoreHistory = (item: MarketingAgentHistoryItem) => {
        if (generatingRef.current) return;
        sourceRevisionRef.current += 1;
        localEditRevisionRef.current += 1;
        previews.forEach((preview) => URL.revokeObjectURL(preview));
        setImages(item.images);
        setPreviews(item.images.map((file) => URL.createObjectURL(file)));
        setBrief(item.brief || "");
        briefRef.current = item.brief || "";
        const nextOptions = restoreCampaignOptions(item.campaignOptions);
        setCampaignOptions(nextOptions);
        campaignOptionsRef.current = nextOptions;
        const nextSelection = (item.selectedTaskIds || allTaskIds).filter((id): id is MarketingTaskId => Boolean(taskById(id)));
        setSelectedTaskIds(normalizeMarketingSelection(nextSelection.length ? nextSelection : allTaskIds));
        const restoredTasks = createTasks().map((task) => {
            const stored = item.tasks.find((candidate) => candidate.id === task.id);
            return stored ? restoreMarketingTask(task, stored, "历史快照中的上游任务状态未知") : task;
        });
        tasksRef.current = restoredTasks;
        setTasks(restoredTasks);
        showWorkspaceTab("results");
        message.success("历史项目已恢复");
    };

    const loadExample = async (example: ExampleCase) => {
        if (generatingRef.current || loadingExampleRef.current) return;
        const requestId = ++exampleRequestRef.current;
        loadingExampleRef.current = true;
        setLoadingExample(true);
        try {
            const response = await fetch(example.source);
            const blob = await response.blob();
            if (requestId !== exampleRequestRef.current || generatingRef.current) return;
            setProductImages(
                [
                    new File([blob], `${example.id}-source.jpg`, {
                        type: blob.type || "image/jpeg",
                    }),
                ],
                true,
            );
            briefRef.current = example.brief;
            setBrief(example.brief);
            message.success(`${example.label}示例已载入`);
        } catch {
            message.error("示例图片加载失败");
        } finally {
            if (requestId === exampleRequestRef.current) {
                loadingExampleRef.current = false;
                setLoadingExample(false);
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
                model: models.includes("gpt-image-2-high") ? "gpt-image-2-high" : "gpt-image-2",
                connectedAt: new Date().toISOString(),
            };
            saveGotoccConnection(next);
            setConnection(next);
            setConnectionKey("");
            setConnectionOpen(false);
            message.success(next.model === "gpt-image-2-high" ? "gotocc 高质模型已连接" : "gotocc GPT Image 2 已连接");
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "连接失败";
            if (error instanceof GotoccConnectionError && error.clearSavedKey) {
                clearGotoccConnection();
                setConnection(null);
            }
            message.error(errorMessage);
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

    const referencesForTask = async (task: MarketingTaskDefinition, run: ActiveRun, currentResultUrl = "", heroStyleUrl = "") => {
        const selection = await selectDiverseProductReferences(run.sourceImages, task, run.controller.signal);
        const contactSheet =
            selection.evidenceFiles.length > 1
                ? await (run.contactSheet ||= createReferenceContactSheet(selection.evidenceFiles, run.controller.signal).catch((error) => {
                      run.contactSheet = undefined;
                      if (error instanceof DOMException && error.name === "AbortError") throw error;
                      return null;
                  }))
                : null;
        const shouldUseHeroStyle = Boolean(heroStyleUrl && task.id !== "marketplace" && task.id !== "hero");
        let styleReference: File | null = null;
        if (shouldUseHeroStyle) {
            if (run.styleReference?.url !== heroStyleUrl) {
                run.styleReference = {
                    url: heroStyleUrl,
                    file: imageUrlToFile(heroStyleUrl, "campaign-style-reference.png", run.controller.signal),
                };
            }
            styleReference = await run.styleReference.file;
        }

        const primary = selection.files[0];
        const secondary = selection.files[1];
        const tertiary = selection.files[2];
        const roleEntries: Array<{ file: File; role: string }> = [];
        const addRole = (file: File | null | undefined, role: string) => {
            if (!file || roleEntries.some((entry) => entry.file === file)) return;
            roleEntries.push({ file, role });
        };

        addRole(primary, "original product identity authority");
        if (currentResultUrl) {
            addRole(contactSheet || secondary, contactSheet ? "original multi-view contact sheet" : "additional original product evidence");
            addRole(styleReference, "brand-hero style anchor only; never product geometry authority");
            addRole(await imageUrlToFile(currentResultUrl, `rejected-${task.id}.png`, run.controller.signal), "rejected draft for locating the stated defect only");
        } else {
            addRole(secondary, "additional original product view");
            addRole(contactSheet || tertiary, contactSheet ? "original multi-view contact sheet" : "additional original product view");
            addRole(styleReference, "brand-hero style anchor only; never product geometry authority");
        }

        const selectedRoles = roleEntries.slice(0, 4);
        return {
            images: selectedRoles.map((entry) => entry.file),
            evidenceFiles: selection.evidenceFiles,
            distinctViewCount: selection.distinctViewCount,
            hasStyleReference: Boolean(styleReference),
            referenceRoleContract: `REFERENCE ROLE CONTRACT: ${selectedRoles.map((entry, index) => `Reference ${String(index + 1).padStart(2, "0")} = ${entry.role}`).join("; ")}.`,
        };
    };

    const renderTask = async (task: MarketingTaskDefinition, heroUrl: string, run: ActiveRun, repairRequest = "", currentResultUrl = "") => {
        assertRunActive(run);
        run.taskId = task.id;
        updateTask(task.id, {
            status: "generating",
            error: "",
            quality: pendingQualityReport(),
        });
        setActiveTaskId(task.id);
        let lastError: unknown;
        const repairDraftUrl = currentResultUrl;
        const activeRepairRequest = repairRequest;

        for (let attempt = 1; attempt <= 2; attempt += 1) {
            assertRunActive(run);
            setActiveAttempt(attempt);
            try {
                const references = await referencesForTask(task, run, repairDraftUrl, heroUrl);
                assertRunActive(run);
                const campaignManifest = buildCampaignManifest(run.brief, run.campaignOptions, references.distinctViewCount, run.scenePlan);
                const prompt = buildMarketingPrompt({
                    task,
                    campaignManifest,
                    sourceCount: references.distinctViewCount,
                    scenePlan: run.scenePlan,
                    referenceRoleContract: references.referenceRoleContract,
                    hasStyleReference: references.hasStyleReference,
                    repairRequest: activeRepairRequest,
                    hasRepairDraft: Boolean(repairDraftUrl),
                });
                if (!(await persistRunDraft(run))) {
                    throw Object.assign(new Error("浏览器存储空间不足，未发送付费请求；请清理本地历史后重试"), {
                        retryable: false,
                    });
                }
                const generatedUrl = await generateGotoccProductImage(connection as GotoccConnection, references.images, prompt, task.size, run.controller.signal);
                if (task.id === "hero") run.heroUpdated = true;
                if (!isRunActive(run)) {
                    updateTask(task.id, {
                        status: "completed",
                        url: generatedUrl,
                        modelUrl: generatedUrl,
                        error: "",
                        upstreamStateUnknown: false,
                        quality: pendingQualityReport(),
                    });
                    if (task.id === "hero") invalidateStyleDependentResults("品牌主视觉已更新，请重新生成以延续同一套风格");
                    await persistRunDraft(run);
                    throw new DOMException("Aborted", "AbortError");
                }
                updateTask(task.id, {
                    status: "generating",
                    url: generatedUrl,
                    modelUrl: generatedUrl,
                    error: "",
                    quality: pendingQualityReport(),
                });
                if (!(await persistRunDraft(run))) {
                    message.warning("付费原稿已保留在当前页面，但浏览器空间不足，刷新前请先下载该图");
                }
                let url = generatedUrl;
                try {
                    url = await applyMarketingCopy(generatedUrl, task, run.brief, run.resolvedBrandColor);
                } catch {
                    message.warning(`${task.label}文字排版暂未叠加，已保留模型原图`);
                }
                assertRunActive(run);
                let quality = pendingQualityReport();
                try {
                    quality = await auditMarketingImage({
                        taskId: task.id,
                        source: references.evidenceFiles[0],
                        sources: references.evidenceFiles,
                        resultUrl: url,
                        identityUrl: generatedUrl,
                        expectedSize: task.size,
                        identityPolicy: task.identityPolicy,
                        distinctViewCount: references.distinctViewCount,
                        signal: run.controller.signal,
                        previousResults: tasksRef.current
                            .filter((item) => item.id !== task.id && item.status === "completed" && item.url)
                            .map((item) => ({
                                id: item.id,
                                label: item.label,
                                url: item.url,
                                identityPolicy: item.identityPolicy,
                            })),
                    });
                } catch (error) {
                    if (error instanceof DOMException && error.name === "AbortError") throw error;
                }
                assertRunActive(run);
                const modelUrl = generatedUrl === url ? "" : generatedUrl;
                updateTask(task.id, { url, modelUrl, quality });
                await persistRunDraft(run);
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
        if (loadingExampleRef.current || generatingRef.current) return;
        if (!images.length) {
            inputRef.current?.click();
            return;
        }
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        if (!currentPlan.length) {
            message.warning("请至少选择一种生成类型");
            return;
        }

        const run = startRun("suite", currentPlan);
        const selected = new Set(run.plan.map((task) => task.id));
        const resetTasks = tasksRef.current.map((task) =>
            selected.has(task.id)
                ? {
                      ...task,
                      status: "idle" as const,
                      url: "",
                      modelUrl: "",
                      error: "",
                      upstreamStateUnknown: false,
                      quality: pendingQualityReport(),
                  }
                : task,
        );
        tasksRef.current = resetTasks;
        setTasks(resetTasks);
        let heroUrl = "";
        let completed = 0;
        let failed = 0;
        let blockedByHero = 0;
        let preservedAfterHeroFailure = false;
        let finishedCurrentRun = false;

        try {
            for (const task of run.plan) {
                if (!isRunActive(run)) break;
                try {
                    const result = await renderTask(task, heroUrl, run);
                    assertRunActive(run);
                    if (task.id === "hero") {
                        heroUrl = result.url;
                        invalidateStyleDependentResults("品牌主视觉已更新，请重新生成以延续同一套风格");
                    }
                    updateTask(task.id, {
                        status: "completed",
                        url: result.url,
                        modelUrl: result.modelUrl,
                        error: "",
                        quality: result.quality,
                    });
                    await persistRunDraft(run);
                    completed += 1;
                } catch (error) {
                    if (!isRunActive(run)) {
                        const interrupted = tasksRef.current.find((item) => item.id === task.id);
                        if (activeRunRef.current?.id === run.id) {
                            updateTask(
                                task.id,
                                interrupted?.url
                                    ? {
                                          status: "completed",
                                          error: "",
                                      }
                                    : {
                                          status: "idle",
                                          url: "",
                                          modelUrl: "",
                                          error: "",
                                          quality: pendingQualityReport(),
                                      },
                            );
                        }
                        break;
                    }
                    updateTask(task.id, {
                        status: "error",
                        error: error instanceof Error ? error.message : "生成失败",
                        upstreamStateUnknown: hasUnknownUpstreamState(error),
                    });
                    failed += 1;
                    if (task.id === "hero") {
                        const previousById = new Map(run.previousTasks.map((item) => [item.id, item]));
                        const previousHero = previousById.get("hero");
                        if (previousHero?.status === "completed" && previousHero.url) {
                            const failedHero = tasksRef.current.find((item) => item.id === "hero");
                            const next = tasksRef.current.map((item) => {
                                const previous = previousById.get(item.id);
                                if (item.id === "hero") {
                                    return failedHero?.upstreamStateUnknown
                                        ? {
                                              ...failedHero,
                                              url: previousHero.url,
                                              modelUrl: previousHero.modelUrl,
                                              quality: previousHero.quality,
                                          }
                                        : previousHero;
                                }
                                return styleDependentTaskIds.has(item.id) && previous ? previous : item;
                            });
                            tasksRef.current = next;
                            setTasks(next);
                            preservedAfterHeroFailure = true;
                            await persistRunDraft(run);
                            break;
                        }
                        const blockedIds = new Set(run.plan.filter((item) => styleDependentTaskIds.has(item.id)).map((item) => item.id));
                        const next = tasksRef.current.map((item) =>
                            blockedIds.has(item.id)
                                ? {
                                      ...item,
                                      status: "error" as const,
                                      url: "",
                                      modelUrl: "",
                                      error: "品牌主视觉生成失败；为保证整套风格统一，请先重新生成品牌主视觉",
                                      upstreamStateUnknown: false,
                                      quality: pendingQualityReport(),
                                  }
                                : item,
                        );
                        tasksRef.current = next;
                        setTasks(next);
                        blockedByHero = blockedIds.size;
                        await persistRunDraft(run);
                        break;
                    }
                }
            }
        } finally {
            finishedCurrentRun = finishRun(run);
        }

        if (!finishedCurrentRun) return;
        await archiveRun(run).catch(() => message.warning("生成结果已保留，但浏览器历史空间不足，未保存历史快照"));
        if (run.controller.signal.aborted) message.info("已停止，已完成的图片会保留");
        else if (preservedAfterHeroFailure) message.warning("新的品牌主视觉生成失败，原主视觉和原套图已保留");
        else if (blockedByHero) message.warning(`品牌主视觉生成失败，已暂停其余 ${blockedByHero} 张营销图，避免生成割裂的套图`);
        else if (failed) message.warning(`完成 ${completed} 张，${failed} 张可单独重试；其他任务未被阻断`);
        else message.success(`${run.plan.length} 张商品营销图已生成`);
    };

    const requestGenerateSuite = () => {
        if (loadingExampleRef.current || generatingRef.current) return;
        const attemptedTasks = tasksRef.current.filter((task) => task.status !== "idle" || task.url || task.error);
        if (!attemptedTasks.length) {
            void generateSuite();
            return;
        }
        const unknownUpstreamState = attemptedTasks.some((task) => task.upstreamStateUnknown);
        modal.confirm({
            title: unknownUpstreamState ? `确认 gotocc 记录后重新生成 ${currentPlan.length} 张？` : `重新生成已选 ${currentPlan.length} 张？`,
            content: `${unknownUpstreamState ? "部分上游请求状态未知，请先确认 gotocc 记录中没有仍在执行的任务。" : "现有已选结果会被替换。"}预计费用约 $${estimatedCost.toFixed(2)}；本地检查只记录技术信息，不会因为构图、风格或镜头相似自动返修。`,
            okText: unknownUpstreamState ? "已确认记录，继续付费" : "确认付费生成",
            cancelText: "取消",
            okButtonProps: { danger: unknownUpstreamState },
            onOk: () => {
                acknowledgeUnknownUpstreamState();
                return generateSuite();
            },
        });
    };

    const retryTask = async (task: MarketingTask, repairRequest = "") => {
        if (styleDependentTaskIds.has(task.id) && !tasksRef.current.some((item) => item.id === "hero" && item.status === "completed" && item.url)) {
            message.warning("请先重新生成品牌主视觉，再生成这张图");
            return;
        }
        if (!connection) {
            setConnectionOpen(true);
            return;
        }
        if (loadingExampleRef.current || !images.length || generatingRef.current) return;
        const run = startRun("retry", [task], task);
        const previousTask = task;
        const heroUrl = tasksRef.current.find((item) => item.id === "hero" && item.status === "completed")?.url || "";
        let finishedCurrentRun = false;
        try {
            const activeRepairRequest = repairRequest;
            const currentDraftUrl = activeRepairRequest ? task.modelUrl || task.url : "";
            const result = await renderTask(task, heroUrl, run, activeRepairRequest, currentDraftUrl);
            assertRunActive(run);
            updateTask(task.id, {
                status: "completed",
                url: result.url,
                modelUrl: result.modelUrl,
                error: "",
                upstreamStateUnknown: false,
                quality: result.quality,
            });
            if (task.id === "hero") invalidateStyleDependentResults("品牌主视觉已更新，请重新生成以延续同一套风格");
            await persistRunDraft(run);
            message.success(`${task.label}已重新生成`);
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
                updateTask(task.id, {
                    status: "error",
                    error: error instanceof Error ? error.message : "生成失败",
                    upstreamStateUnknown: hasUnknownUpstreamState(error),
                });
            }
        } finally {
            finishedCurrentRun = finishRun(run);
        }
        if (!finishedCurrentRun) return;
    };

    const requestRetryTask = (task: MarketingTask) => {
        if (generatingRef.current) return;
        const unknownUpstreamState = task.upstreamStateUnknown;
        modal.confirm({
            title: `重新生成“${task.label}”？`,
            content: unknownUpstreamState ? "刚才的上游请求状态未知。请先在 gotocc 记录中确认没有仍在生成的任务；继续会再次产生约 $0.08 费用。" : "本次会再次产生约 $0.08 费用。模型返回新图片后会替换现有结果；是否满意由你决定。",
            okText: unknownUpstreamState ? "已确认记录，继续付费" : "确认付费生成",
            cancelText: "取消",
            okButtonProps: { danger: unknownUpstreamState },
            onOk: () => {
                acknowledgeUnknownUpstreamState([task.id]);
                return retryTask({
                    ...task,
                    upstreamStateUnknown: false,
                });
            },
        });
    };

    const openRepair = (task: MarketingTask) => {
        if (generatingRef.current) return;
        setRepairTask(task);
        setRepairNote("");
    };

    const submitRepair = async () => {
        if (!repairTask || !repairNote.trim() || generatingRef.current) return;
        const target = {
            ...repairTask,
            upstreamStateUnknown: false,
        };
        acknowledgeUnknownUpstreamState([target.id]);
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
            const interrupted = tasksRef.current.find((item) => item.id === run.previousTask?.id);
            const receivedNewResult = Boolean(interrupted?.url && interrupted.url !== run.previousTask.url);
            updateTask(
                run.previousTask.id,
                receivedNewResult
                    ? {
                          status: "completed",
                          error: "",
                          upstreamStateUnknown: false,
                          quality: pendingQualityReport(),
                      }
                    : {
                          status: "error",
                          url: run.previousTask.url,
                          modelUrl: run.previousTask.modelUrl,
                          error: "已请求停止；上游结果状态未知。原结果已保留，请先确认 gotocc 记录后再决定是否重试",
                          upstreamStateUnknown: true,
                          quality: run.previousTask.quality,
                      },
            );
            if (run.previousTask.id === "hero" && receivedNewResult) invalidateStyleDependentResults("品牌主视觉已更新，请重新生成以延续同一套风格");
            void persistRunDraft(run);
            message.warning(receivedNewResult ? "已停止；新的付费图片已保留" : "已停止，原结果已保留；刚才的上游请求状态未知，确认 gotocc 记录后再重试");
            return;
        }
        if (run.taskId) {
            const interrupted = tasksRef.current.find((item) => item.id === run.taskId);
            updateTask(
                run.taskId,
                interrupted?.url
                    ? {
                          status: "completed",
                          error: "",
                          upstreamStateUnknown: false,
                          quality: pendingQualityReport(),
                      }
                    : {
                          status: "error",
                          url: "",
                          modelUrl: "",
                          error: "已请求停止；上游结果状态未知，为避免重复扣费请先确认 gotocc 记录后再重试",
                          upstreamStateUnknown: true,
                          quality: pendingQualityReport(),
                      },
            );
            if (run.taskId === "hero" && interrupted?.url) invalidateStyleDependentResults("品牌主视觉已更新，请重新生成以延续同一套风格");
        }
        if (!run.heroUpdated) {
            const selected = new Set(run.plan.map((task) => task.id));
            const previousById = new Map(run.previousTasks.map((task) => [task.id, task]));
            const next = tasksRef.current.map((task) => {
                if (!selected.has(task.id)) return task;
                const previous = previousById.get(task.id);
                if (!previous) return task;
                if (task.upstreamStateUnknown) {
                    return {
                        ...task,
                        url: previous.url,
                        modelUrl: previous.modelUrl,
                        quality: previous.quality,
                    };
                }
                const hasNewResult = task.status === "completed" && task.url && task.url !== previous.url;
                return hasNewResult ? task : previous;
            });
            tasksRef.current = next;
            setTasks(next);
        }
        void persistRunDraft(run);
        message.warning("已停止；已完成图片保留，当前上游请求状态未知");
    };

    const toggleTask = (id: MarketingTaskId) => {
        if (generatingRef.current) return;
        localEditRevisionRef.current += 1;
        setSelectedTaskIds((current) => {
            if (current.includes(id)) {
                if (current.length === 1) {
                    message.warning("请至少保留一种生成类型");
                    return current;
                }
                const next = normalizeMarketingSelection(current.filter((item) => item !== id));
                if (id === "hero" && next.includes("hero")) message.warning("已选择的营销图需要品牌主视觉来统一风格");
                return next;
            }
            return normalizeMarketingSelection([...current, id]);
        });
    };

    const downloadTask = async (task: MarketingTask) => {
        if (!task.url) return;
        saveAs(await (await fetch(task.url)).blob(), `${String((taskOrder.get(task.id) || 0) + 1).padStart(2, "0")}-${task.id}-${task.ratio.replace(":", "x")}.png`);
    };

    const downloadSuite = async () => {
        if (downloadingSuite) return;
        if (!suiteComplete) {
            message.warning(`完整 ZIP 仍有 ${fullSuiteBlockers.length} 张未生成或生成失败`);
            return;
        }
        setDownloadingSuite(true);
        try {
            const files: Record<string, Uint8Array> = {};
            for (const task of completedTasks) {
                const index = (taskOrder.get(task.id) || 0) + 1;
                const response = await fetch(task.url);
                if (!response.ok) throw new Error(`${task.label}下载失败（${response.status}）`);
                files[`${String(index).padStart(2, "0")}-${task.id}-${task.ratio.replace(":", "x")}.png`] = new Uint8Array(await response.arrayBuffer());
            }
            const archive = await new Promise<Uint8Array>((resolve, reject) => {
                zip(files, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data)));
            });
            saveAs(new Blob([new Uint8Array(archive)], { type: "application/zip" }), "product-marketing-suite.zip");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "整套下载失败，请稍后重试");
        } finally {
            setDownloadingSuite(false);
        }
    };

    return (
        <ConfigProvider
            theme={{
                algorithm: antdTheme.defaultAlgorithm,
                token: {
                    colorPrimary: "#6d3df5",
                    colorText: "#1f2329",
                    colorBgContainer: "#ffffff",
                    borderRadius: 4,
                },
            }}
        >
            <main className="h-full min-h-0 min-w-0 overflow-y-auto bg-[#f5f6fa] text-[#1f2329] lg:overflow-hidden">
                <header className="sticky top-0 z-30 flex h-15 min-w-0 items-center justify-between border-b border-[#e5e6eb] bg-white px-3 sm:px-5">
                    <div className="flex min-w-0 items-center gap-5">
                        <div className="flex shrink-0 items-center gap-2">
                            <span className="flex size-8 items-center justify-center rounded bg-[#6d3df5] text-white">
                                <WandSparkles className="size-4" />
                            </span>
                            <span className="text-base font-semibold">商品图</span>
                            <span className="rounded-sm bg-[#6d3df5] px-1.5 py-0.5 text-[10px] font-semibold text-white">AI</span>
                        </div>
                        <nav className="hidden h-15 items-center gap-1 md:flex">
                            <HeaderTab active={workspaceTab === "results"} onClick={() => setWorkspaceTab("results")}>
                                商品套图
                            </HeaderTab>
                            <HeaderTab active={workspaceTab === "examples"} onClick={() => setWorkspaceTab("examples")}>
                                优秀案例
                            </HeaderTab>
                            <HeaderTab active={workspaceTab === "history"} onClick={() => setWorkspaceTab("history")}>
                                生成记录
                            </HeaderTab>
                        </nav>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 md:hidden">
                            <MobileNavButton label="生成结果" icon={<Layers3 className="size-4" />} active={workspaceTab === "results"} onClick={() => showWorkspaceTab("results")} />
                            <MobileNavButton label="优秀案例" icon={<Images className="size-4" />} active={workspaceTab === "examples"} onClick={() => showWorkspaceTab("examples")} />
                            <MobileNavButton label="历史记录" icon={<History className="size-4" />} active={workspaceTab === "history"} onClick={() => showWorkspaceTab("history")} />
                        </div>
                        {suiteComplete ? (
                            <Button className="hidden sm:inline-flex" loading={downloadingSuite} icon={<Archive className="size-4" />} onClick={() => void downloadSuite()}>
                                下载整套
                            </Button>
                        ) : null}
                        <Button
                            aria-label={connection ? "gotocc 已连接" : "连接 gotocc"}
                            title={connection ? `${connection.model} 已连接` : "连接 gotocc"}
                            className="!h-11 !min-w-11 sm:!h-8 sm:!min-w-8"
                            icon={connection ? <ShieldCheck className="size-4 text-emerald-600" /> : <KeyRound className="size-4" />}
                            onClick={() => setConnectionOpen(true)}
                        >
                            <span className="hidden sm:inline">{connection ? (connection.model === "gpt-image-2-high" ? "高质模型已连接" : "gotocc 已连接") : "连接 gotocc"}</span>
                        </Button>
                    </div>
                </header>

                <div className="min-w-0 lg:grid lg:h-[calc(100vh_-_60px)] lg:grid-cols-[164px_330px_minmax(0,1fr)]">
                    <aside className="hidden min-h-0 border-r border-[#e5e6eb] bg-white lg:flex lg:flex-col">
                        <div className="px-3 py-4">
                            <RailItem active icon={<Layers3 className="size-4" />} label="商品套图" onClick={() => setWorkspaceTab("results")} />
                            <RailItem icon={<Images className="size-4" />} label="优秀案例" onClick={() => setWorkspaceTab("examples")} />
                            <RailItem icon={<History className="size-4" />} label="历史记录" onClick={() => setWorkspaceTab("history")} />
                        </div>
                        <div className="mt-auto border-t border-[#f0f0f0] px-4 py-4 text-xs leading-5 text-[#86909c]">
                            <p className="flex items-center gap-1.5">
                                <CircleHelp className="size-3.5" />
                                免费声明
                            </p>
                            <p className="mt-1">Key 仅在浏览器持久化，经本站受限代理转发</p>
                        </div>
                    </aside>

                    <aside className="min-w-0 border-b border-[#e5e6eb] bg-white lg:min-h-0 lg:overflow-y-auto lg:border-r lg:border-b-0">
                        <div className="space-y-5 p-4">
                            <section>
                                <SectionTitle title="多视角白底商品 & 实拍图" hint="最多 5 张" />
                                {previews.length ? (
                                    <div className="grid grid-cols-3 gap-2">
                                        {previews.map((preview, index) => (
                                            <div key={preview} className="group relative aspect-square overflow-hidden rounded border border-[#e5e6eb] bg-[#f7f8fa]">
                                                <img src={preview} alt={`商品参考图 ${index + 1}`} className="size-full object-contain" />
                                                <span className="absolute top-1 left-1 rounded-sm bg-black/65 px-1.5 py-0.5 text-[10px] text-white">{index === 0 ? "主图" : `角度 ${index + 1}`}</span>
                                                <button
                                                    type="button"
                                                    className="absolute top-1 right-1 flex size-10 items-center justify-center rounded-sm bg-black/65 text-white opacity-100 transition sm:size-6 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100"
                                                    aria-label={`移除商品参考图 ${index + 1}`}
                                                    title={`移除商品参考图 ${index + 1}`}
                                                    disabled={productInputDisabled}
                                                    onClick={() => removeProductImage(index)}
                                                >
                                                    <X className="size-3" />
                                                </button>
                                            </div>
                                        ))}
                                        {previews.length < 5 ? (
                                            <button
                                                type="button"
                                                disabled={productInputDisabled}
                                                className="flex aspect-square items-center justify-center rounded border border-dashed border-[#c9cdd4] text-[#86909c] transition hover:border-[#6d3df5] hover:text-[#6d3df5] disabled:cursor-not-allowed disabled:opacity-45"
                                                aria-label="继续添加商品图"
                                                title="继续添加商品图"
                                                onClick={() => addInputRef.current?.click()}
                                            >
                                                <ImagePlus className="size-5" />
                                            </button>
                                        ) : null}
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        disabled={productInputDisabled}
                                        className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 rounded-md border border-dashed border-[#c9cdd4] bg-[#fafbfc] text-[#86909c] transition hover:border-[#6d3df5] hover:text-[#6d3df5] disabled:cursor-not-allowed disabled:opacity-45"
                                        onClick={() => inputRef.current?.click()}
                                    >
                                        <span className="flex size-11 items-center justify-center rounded-md bg-[#f0ebff] text-[#6d3df5]">
                                            <Upload className="size-5" />
                                        </span>
                                        <span className="text-sm font-medium">从本地上传</span>
                                        <span className="px-5 text-center text-xs leading-5">1 张可生成，2-5 张不同角度成功率更高</span>
                                    </button>
                                )}
                                <input
                                    ref={inputRef}
                                    className="hidden"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    multiple
                                    disabled={productInputDisabled}
                                    aria-label="上传商品原图"
                                    onChange={(event) => {
                                        handleFiles(event.target.files, "replace");
                                        event.target.value = "";
                                    }}
                                />
                                <input
                                    ref={addInputRef}
                                    className="hidden"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    multiple
                                    disabled={productInputDisabled || images.length >= 5}
                                    aria-label="继续添加商品原图"
                                    onChange={(event) => {
                                        handleFiles(event.target.files, "add");
                                        event.target.value = "";
                                    }}
                                />
                                <div className="mt-2 flex gap-2">
                                    <Button block type="primary" className="!h-11 !bg-[#6d3df5] !shadow-none hover:!bg-[#5b2ee5] sm:!h-8" disabled={productInputDisabled} icon={<Upload className="size-3.5" />} onClick={() => inputRef.current?.click()}>
                                        {previews.length ? "更换全部" : "上传商品图"}
                                    </Button>
                                    {previews.length ? (
                                        <Button className="!h-11 sm:!h-8" disabled={productInputDisabled || previews.length >= 5} icon={<ImagePlus className="size-3.5" />} onClick={() => addInputRef.current?.click()}>
                                            添加角度
                                        </Button>
                                    ) : null}
                                    <Button className="!h-11 sm:!h-8" disabled={productInputDisabled} onClick={() => void loadExample(exampleCases[0])}>
                                        {loadingExample ? "载入中" : "试用示例"}
                                    </Button>
                                    {previews.length ? (
                                        <Button className="!h-11 !w-11 !min-w-11 !p-0 sm:!h-8 sm:!w-8 sm:!min-w-8" aria-label="清空商品图" title="清空商品图" disabled={productInputDisabled} icon={<X className="size-3.5" />} onClick={clearProductImages} />
                                    ) : null}
                                </div>
                            </section>

                            <section>
                                <SectionTitle title="商品信息" hint="图片可见事实优先" />
                                <Input.TextArea
                                    aria-label="商品信息"
                                    value={brief}
                                    disabled={productInputDisabled}
                                    maxLength={2500}
                                    autoSize={{ minRows: 4, maxRows: 8 }}
                                    placeholder="填写商品名称、真实卖点、使用方式和目标人群。留空时只使用图片中可见事实。"
                                    onChange={(event) => handleBriefChange(event.target.value)}
                                />
                                <div className="mt-1 text-right text-[11px] text-[#86909c]">{brief.length} / 2500</div>
                            </section>

                            <details className="group border-y border-[#f0f0f0] py-3">
                                <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                                    品牌与市场（可选）
                                    <ChevronDown className="size-4 text-[#86909c] transition group-open:rotate-180" />
                                </summary>
                                <div className="mt-3 grid gap-3">
                                    <SelectField
                                        label="销售平台"
                                        value={campaignOptions.platform}
                                        disabled={productInputDisabled}
                                        options={["Amazon", "Shopify", "TikTok Shop", "Temu", "独立站"]}
                                        onChange={(value) => updateCampaignOption("platform", value)}
                                    />
                                    <div className="grid grid-cols-2 gap-2">
                                        <SelectField label="销售地区" value={campaignOptions.market} disabled={productInputDisabled} options={["美国", "英国", "德国", "法国", "日本", "中国"]} onChange={(value) => updateCampaignOption("market", value)} />
                                        <SelectField
                                            label="图片语言"
                                            value={campaignOptions.language}
                                            disabled={productInputDisabled}
                                            options={["English", "中文", "Deutsch", "Français", "日本語"]}
                                            onChange={(value) => updateCampaignOption("language", value)}
                                        />
                                    </div>
                                    <SelectField
                                        label="视觉风格"
                                        value={campaignOptions.visualStyle}
                                        disabled={productInputDisabled}
                                        options={["自动匹配", "高端编辑", "极简科技", "自然生活", "活力社媒"]}
                                        onChange={(value) => updateCampaignOption("visualStyle", value)}
                                    />
                                    <fieldset className="grid gap-2" disabled={productInputDisabled}>
                                        <legend className="text-xs text-[#4e5969]">品牌颜色</legend>
                                        <button
                                            type="button"
                                            className={cn(
                                                "flex min-h-11 items-center gap-2 rounded border px-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                                                campaignOptions.brandColorPreset === "auto" ? "border-[#6d3df5] bg-[#f7f3ff]" : "border-[#e5e6eb] bg-white hover:border-[#b99df8]",
                                            )}
                                            onClick={() => selectBrandColor("auto", currentScenePlan.recommendedColor)}
                                        >
                                            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full border border-black/10" style={{ backgroundColor: currentScenePlan.recommendedColor }}>
                                                <Palette className="size-3.5 text-white drop-shadow-sm" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block text-xs font-medium text-[#1f2329]">智能推荐</span>
                                                <span className="block truncate text-[10px] text-[#86909c]">已按“{currentScenePlan.label}”匹配</span>
                                            </span>
                                            {campaignOptions.brandColorPreset === "auto" ? <Check className="size-4 shrink-0 text-[#6d3df5]" /> : null}
                                        </button>
                                        <div className="grid grid-cols-3 gap-1.5">
                                            {brandColorPresets.map((preset) => {
                                                const selected = campaignOptions.brandColorPreset === preset.id;
                                                return (
                                                    <button
                                                        key={preset.id}
                                                        type="button"
                                                        className={cn(
                                                            "flex min-h-11 items-center gap-1.5 rounded border px-2 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50",
                                                            selected ? "border-[#6d3df5] bg-[#f7f3ff] text-[#1f2329]" : "border-[#e5e6eb] bg-white text-[#4e5969] hover:border-[#b99df8]",
                                                        )}
                                                        onClick={() => selectBrandColor(preset.id, preset.color)}
                                                    >
                                                        <span className="size-4 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: preset.color }} />
                                                        <span className="truncate">{preset.label}</span>
                                                    </button>
                                                );
                                            })}
                                            <button
                                                type="button"
                                                className={cn(
                                                    "flex min-h-11 items-center gap-1.5 rounded border px-2 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-50",
                                                    campaignOptions.brandColorPreset === "custom" ? "border-[#6d3df5] bg-[#f7f3ff] text-[#1f2329]" : "border-[#e5e6eb] bg-white text-[#4e5969] hover:border-[#b99df8]",
                                                )}
                                                onClick={() => selectBrandColor("custom", campaignOptions.brandColor)}
                                            >
                                                <span className="size-4 shrink-0 rounded-full border border-black/10" style={{ backgroundColor: campaignOptions.brandColor }} />
                                                <span>自定义</span>
                                            </button>
                                        </div>
                                        {campaignOptions.brandColorPreset === "custom" ? (
                                            <label className="flex min-h-11 cursor-pointer items-center justify-between rounded border border-[#e5e6eb] bg-white px-2.5 text-xs text-[#4e5969]">
                                                <span>点这里挑选自己的颜色</span>
                                                <input
                                                    type="color"
                                                    className="h-7 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                                                    value={campaignOptions.brandColor}
                                                    disabled={productInputDisabled}
                                                    aria-label="自定义品牌颜色"
                                                    onChange={(event) => selectBrandColor("custom", event.target.value)}
                                                />
                                            </label>
                                        ) : null}
                                        <p className="text-[10px] leading-4 text-[#86909c]">不会选就保持“智能推荐”；颜色只作为整套图片的点缀，不会大面积覆盖商品。</p>
                                    </fieldset>
                                </div>
                            </details>

                            <section>
                                <SectionTitle title="生成类型" hint={`${currentPlan.length} 张`} />
                                <div className="divide-y divide-[#f0f0f0] rounded border border-[#e5e6eb]">
                                    {marketingPlan.map((task, index) => {
                                        const checked = currentTaskIdSet.has(task.id);
                                        return (
                                            <button
                                                key={task.id}
                                                type="button"
                                                disabled={generating}
                                                className="grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-50"
                                                onClick={() => toggleTask(task.id)}
                                            >
                                                <span className={cn("flex size-4 items-center justify-center rounded-sm border text-white", checked ? "border-[#6d3df5] bg-[#6d3df5]" : "border-[#c9cdd4] bg-white")}>
                                                    {checked ? <Check className="size-3" /> : null}
                                                </span>
                                                <span className="min-w-0">
                                                    <span className="block truncate text-xs font-medium text-[#1f2329]">
                                                        {String(index + 1).padStart(2, "0")} {task.label}
                                                    </span>
                                                    <span className="block truncate text-[11px] text-[#86909c]">{task.cameraLabel}</span>
                                                </span>
                                                <span className="text-[11px] text-[#86909c]">{task.ratio}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        </div>

                        <div className="sticky bottom-0 border-t border-[#e5e6eb] bg-white p-4">
                            <div className="mb-2 flex items-center justify-between text-xs text-[#86909c]">
                                <span>约 12-20 分钟</span>
                                <span>预计约 ${estimatedCost.toFixed(2)}</span>
                            </div>
                            {generating ? (
                                <div className="grid grid-cols-[minmax(0,1fr)_42px] gap-2">
                                    <Button block size="large" disabled className="!h-11" icon={<LoaderCircle className="size-4 animate-spin" />}>
                                        {activeTask ? `${activeTask.label}${activeAttempt > 1 ? " · 定向重试" : ""} · ${formatTime(elapsed)}` : "正在准备"}
                                    </Button>
                                    <Button danger size="large" className="!h-11 !w-10 !p-0" aria-label="停止生成" title="停止生成" icon={<StopCircle className="size-4" />} onClick={stopGeneration} />
                                </div>
                            ) : (
                                <Button
                                    block
                                    type="primary"
                                    size="large"
                                    disabled={loadingExample || !currentPlan.length}
                                    className="!h-11 !bg-[#6d3df5] !shadow-none hover:!bg-[#5b2ee5]"
                                    icon={<Sparkles className="size-4" />}
                                    onClick={requestGenerateSuite}
                                >
                                    {completedTasks.length ? `重新生成已选 ${currentPlan.length} 张` : `开始生成 ${currentPlan.length} 张`}
                                </Button>
                            )}
                            <p className="mt-2 text-[11px] leading-4 text-[#86909c]">主视觉统一整套风格；其余图片使用独立镜头。</p>
                        </div>
                    </aside>

                    <section ref={resultsPanelRef} className="min-w-0 scroll-mt-15 bg-[#f5f6fa] lg:min-h-0 lg:overflow-y-auto">
                        <div className="sticky top-15 z-10 flex min-h-12 items-center justify-between border-b border-[#e5e6eb] bg-white px-4 sm:px-5 lg:top-0">
                            <div className="flex h-12 items-center gap-5">
                                <WorkspaceTabButton active={workspaceTab === "results"} onClick={() => setWorkspaceTab("results")}>
                                    生成结果
                                </WorkspaceTabButton>
                                <WorkspaceTabButton active={workspaceTab === "examples"} onClick={() => setWorkspaceTab("examples")}>
                                    优秀案例
                                </WorkspaceTabButton>
                                <WorkspaceTabButton active={workspaceTab === "history"} onClick={() => setWorkspaceTab("history")}>
                                    历史记录
                                </WorkspaceTabButton>
                            </div>
                            <span className="text-xs tabular-nums text-[#4e5969]">
                                {completedTasks.length}/{currentPlan.length}
                            </span>
                        </div>

                        {workspaceTab === "examples" ? (
                            <ExampleGallery loading={loadingExample} onUse={(example) => void loadExample(example)} />
                        ) : workspaceTab === "history" ? (
                            <HistoryPanel items={historyItems} busy={false} onRestore={restoreHistory} />
                        ) : (
                            <div className="p-4 sm:p-5">
                                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                                    <div>
                                        <h1 className="text-base font-semibold">商品营销套图</h1>
                                        <p className="mt-1 text-xs text-[#86909c]">{statusText}</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {suiteComplete ? (
                                            <Button type="primary" loading={downloadingSuite} className="!bg-[#1f2329] !shadow-none" icon={<Archive className="size-4" />} onClick={() => void downloadSuite()}>
                                                下载整套 ZIP
                                            </Button>
                                        ) : null}
                                    </div>
                                </div>

                                <div className="mb-5 h-1 overflow-hidden rounded-full bg-[#e5e6eb]">
                                    <div className="h-full rounded-full bg-[#6d3df5] transition-[width] duration-500" style={{ width: `${progress}%` }} />
                                </div>

                                <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                                    {selectedTasks.map((task, index) => (
                                        <ResultCard
                                            key={task.id}
                                            task={task}
                                            index={index}
                                            generating={generating || loadingExample}
                                            onPreview={() => setPreviewTask(task)}
                                            onDownload={() => void downloadTask(task)}
                                            onRetry={() => requestRetryTask(task)}
                                            onRepair={() => openRepair(task)}
                                        />
                                    ))}
                                </div>

                                {completedTasks.length ? (
                                    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e5e6eb] pt-4">
                                        <p className="text-xs text-[#86909c]">{suiteComplete ? `${marketingPlan.length} 张已全部生成，可直接下载。` : `完整 ZIP 仍有 ${fullSuiteBlockers.length} 张未生成、失败或未选择。`}</p>
                                        <Button disabled={!suiteComplete} loading={downloadingSuite} icon={<Archive className="size-4" />} onClick={() => void downloadSuite()}>
                                            {suiteComplete ? "下载整套 ZIP" : `处理 ${fullSuiteBlockers.length} 项`}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        )}
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
                    okButtonProps={{
                        disabled: !connectionKey.trim() && !connection,
                    }}
                >
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 text-sm">
                            <span className={cn("size-2 rounded-full", connection ? "bg-emerald-500" : "bg-black/20")} />
                            <span>{connection ? `${connection.model} 已连接` : "粘贴一次，以后自动使用"}</span>
                        </div>
                        <Button icon={<KeyRound className="size-4" />} onClick={() => window.open("https://gotocc.xyz/keys", "_blank", "noopener,noreferrer")}>
                            打开 gotocc 密钥页
                        </Button>
                        <Input.Password
                            aria-label="gotocc Key"
                            value={connectionKey}
                            onChange={(event) => setConnectionKey(event.target.value)}
                            placeholder={connection ? "已保存，需要更换时再粘贴" : "粘贴 GPT Image 2 分组的 sk- Key"}
                            autoComplete="off"
                        />
                        <p className="text-xs leading-5 text-[#86909c]">Key 只在当前浏览器持久化；生成请求会经本站受限代理转发到 gotocc，不写入本站数据库或业务日志。若账号支持 gpt-image-2-high，将自动优先使用高质模型。</p>
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
                    okText={repairUnknownUpstreamState ? "已确认记录，继续付费" : "确认付费返修"}
                    cancelText="取消"
                    okButtonProps={{
                        disabled: !repairNote.trim() || generating,
                        danger: repairUnknownUpstreamState,
                    }}
                    confirmLoading={generating}
                    onCancel={() => {
                        setRepairTask(null);
                        setRepairNote("");
                    }}
                    onOk={() => void submitRepair()}
                >
                    <p className="mb-3 text-xs leading-5 text-[#86909c]">
                        {repairUnknownUpstreamState ? "刚才的上游请求状态未知。请先在 gotocc 记录中确认没有仍在执行的任务；继续可能产生重复费用。" : ""}
                        本次约 $0.08。原商品图始终是身份依据；当前结果只用于定位你明确写下的问题，不会因本地审美判断自动返修。
                    </p>
                    <Input.TextArea
                        aria-label="返修要求"
                        value={repairNote}
                        maxLength={300}
                        autoSize={{ minRows: 3, maxRows: 6 }}
                        placeholder="例如：镜头与主视觉太像，改成右前方低机位；同时保留原图车头贴花和红色尾部"
                        onChange={(event) => setRepairNote(event.target.value)}
                    />
                </Modal>

                <Modal title={previewTask?.label || "图片预览"} open={Boolean(previewTask)} footer={null} width={1000} onCancel={() => setPreviewTask(null)}>
                    {previewTask?.url ? <img src={previewTask.url} alt={previewTask.label} className="max-h-[75vh] w-full bg-[#f5f6fa] object-contain" /> : null}
                </Modal>
            </main>
        </ConfigProvider>
    );
}

function HeaderTab({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
    return (
        <button type="button" className={cn("relative h-15 px-3 text-sm transition", active ? "font-medium text-[#6d3df5]" : "text-[#4e5969] hover:text-[#1f2329]")} onClick={onClick}>
            {children}
            {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[#6d3df5]" /> : null}
        </button>
    );
}

function MobileNavButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active: boolean; onClick: () => void }) {
    return (
        <button type="button" className={cn("flex size-11 items-center justify-center rounded sm:size-8", active ? "bg-[#f0ebff] text-[#6d3df5]" : "text-[#4e5969]")} aria-label={label} title={label} onClick={onClick}>
            {icon}
        </button>
    );
}

function RailItem({ active = false, icon, label, onClick }: { active?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
    return (
        <button type="button" className={cn("mb-1 flex h-10 w-full items-center gap-2 rounded px-3 text-sm transition", active ? "bg-[#f0ebff] font-medium text-[#6d3df5]" : "text-[#4e5969] hover:bg-[#f7f8fa] hover:text-[#1f2329]")} onClick={onClick}>
            {icon}
            {label}
        </button>
    );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
    return (
        <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{title}</h2>
            {hint ? <span className="text-[11px] text-[#86909c]">{hint}</span> : null}
        </div>
    );
}

function SelectField({ label, value, options, disabled, onChange }: { label: string; value: string; options: string[]; disabled: boolean; onChange: (value: string) => void }) {
    return (
        <label className="grid gap-1.5 text-xs text-[#4e5969]">
            {label}
            <select
                value={value}
                disabled={disabled}
                className="h-9 min-w-0 rounded border border-[#e5e6eb] bg-white px-2 text-xs text-[#1f2329] outline-none focus:border-[#6d3df5] disabled:cursor-not-allowed disabled:bg-[#f7f8fa]"
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <option key={option} value={option}>
                        {option}
                    </option>
                ))}
            </select>
        </label>
    );
}

function WorkspaceTabButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
    return (
        <button type="button" className={cn("relative h-12 text-sm", active ? "font-medium text-[#6d3df5]" : "text-[#4e5969]")} onClick={onClick}>
            {children}
            {active ? <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#6d3df5]" /> : null}
        </button>
    );
}

function ResultCard({ task, index, generating, onPreview, onDownload, onRetry, onRepair }: { task: MarketingTask; index: number; generating: boolean; onPreview: () => void; onDownload: () => void; onRetry: () => void; onRepair: () => void }) {
    const mediaRatio = task.ratio === "3:2" ? "aspect-[3/2]" : task.ratio === "2:3" ? "aspect-[2/3] max-h-[680px]" : "aspect-square";
    return (
        <article className="min-w-0 overflow-hidden rounded-md border border-[#e5e6eb] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <div className="flex min-h-14 items-center gap-3 border-b border-[#f0f0f0] px-3">
                <span className="text-xs tabular-nums text-[#c9cdd4]">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-medium">{task.label}</h3>
                    <p className="truncate text-[11px] text-[#86909c]">
                        {task.cameraLabel} · {task.ratio}
                    </p>
                </div>
                <TaskStatusMark status={task.status} />
            </div>
            <div className={cn("relative mx-auto w-full overflow-hidden bg-[#f2f3f5]", mediaRatio)}>
                {task.url ? (
                    <button type="button" className="size-full" aria-label={`预览${task.label}`} onClick={onPreview}>
                        <img src={task.url} alt={task.label} className="size-full object-contain" />
                    </button>
                ) : (
                    <div className="flex size-full min-h-52 flex-col items-center justify-center gap-3 px-6 text-center text-[#c9cdd4]">
                        {task.status === "generating" ? <LoaderCircle className="size-7 animate-spin text-[#6d3df5]" /> : task.status === "error" ? <X className="size-7 text-red-400" /> : <Square className="size-7" />}
                        <span className="text-xs leading-5">{task.status === "generating" ? "Agent 正在执行独立镜头" : task.error || "等待生成"}</span>
                    </div>
                )}

                {task.status === "error" && task.url && task.error ? (
                    <div className="absolute inset-x-2 top-2 max-h-20 overflow-hidden rounded bg-red-950/90 px-2 py-1.5 text-[11px] leading-4 text-white" title={task.error}>
                        {task.error}
                    </div>
                ) : null}

                {task.status === "completed" ? (
                    <div className="absolute right-2 bottom-2 flex gap-1">
                        <IconAction label={`预览${task.label}`} icon={<Eye className="size-3.5" />} onClick={onPreview} />
                        <IconAction label={`下载${task.label}`} icon={<Download className="size-3.5" />} onClick={onDownload} />
                    </div>
                ) : null}

                {task.status === "error" ? (
                    <div className="absolute inset-x-3 bottom-3 grid grid-cols-2 gap-2">
                        <button type="button" className="flex h-11 items-center justify-center gap-2 rounded bg-white text-xs font-medium text-[#1f2329] shadow-sm disabled:opacity-50 sm:h-9" disabled={generating} onClick={onRetry}>
                            <RefreshCw className="size-3.5" />
                            重新生成
                        </button>
                        <button type="button" className="flex h-11 items-center justify-center gap-2 rounded bg-[#6d3df5] text-xs font-medium text-white shadow-sm disabled:opacity-50 sm:h-9" disabled={generating} onClick={onRepair}>
                            <WandSparkles className="size-3.5" />
                            定向返修
                        </button>
                    </div>
                ) : null}
            </div>
            {task.status === "completed" ? (
                <div className="flex min-h-12 items-center justify-between gap-3 px-3 py-2">
                    <span className="text-[11px] text-[#86909c]">图片已生成，不满意可直接换一张</span>
                    <button
                        type="button"
                        className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded border border-[#d9ccfb] bg-[#f7f3ff] px-3 text-xs font-medium text-[#5b2ee5] transition hover:border-[#6d3df5] hover:bg-[#f0ebff] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={generating}
                        onClick={onRetry}
                    >
                        <RefreshCw className="size-3.5" />
                        重新生成
                    </button>
                </div>
            ) : null}
        </article>
    );
}

function IconAction({ label, icon, accent = false, disabled = false, onClick }: { label: string; icon: React.ReactNode; accent?: boolean; disabled?: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            className={cn("flex size-10 items-center justify-center rounded text-white shadow-sm backdrop-blur transition disabled:opacity-45 sm:size-8", accent ? "bg-[#6d3df5] hover:bg-[#5b2ee5]" : "bg-black/70 hover:bg-black")}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
        >
            {icon}
        </button>
    );
}

function TaskStatusMark({ status }: { status: TaskStatus }) {
    if (status === "completed")
        return (
            <span title="已生成" aria-label="已生成" className="flex size-5 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <Check className="size-3.5" />
            </span>
        );
    if (status === "generating") return <LoaderCircle className="size-4 animate-spin text-[#6d3df5]" />;
    if (status === "error") return <span className="size-2 rounded-full bg-red-500" title="生成失败" />;
    return <span className="size-2 rounded-full border border-[#c9cdd4]" />;
}

function ExampleGallery({ loading, onUse }: { loading: boolean; onUse: (example: ExampleCase) => void }) {
    return (
        <div className="p-4 sm:p-5">
            <div className="mb-4">
                <h1 className="text-base font-semibold">优秀案例</h1>
                <p className="mt-1 text-xs text-[#86909c]">以下为 LinkFox 效果标杆；选择案例只会载入商品原图和示例商品信息，不会自动扣费生成。</p>
            </div>
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {exampleCases.map((example) => (
                    <article key={example.id} className="overflow-hidden rounded-md border border-[#e5e6eb] bg-white">
                        <div className="grid aspect-[3/2] grid-cols-[34%_66%] bg-[#f2f3f5]">
                            <figure className="relative border-r border-white">
                                <img src={example.source} alt={`${example.label}原图`} className="size-full object-contain" />
                                <figcaption className="absolute top-2 left-2 rounded-sm bg-black/65 px-1.5 py-0.5 text-[10px] text-white">原图</figcaption>
                            </figure>
                            <figure className="relative">
                                <img src={example.result} alt={`${example.label}案例`} className="size-full object-cover" />
                                <figcaption className="absolute top-2 left-2 rounded-sm bg-[#6d3df5] px-1.5 py-0.5 text-[10px] text-white">案例</figcaption>
                            </figure>
                        </div>
                        <div className="flex items-center justify-between gap-3 p-3">
                            <div className="min-w-0">
                                <h2 className="truncate text-sm font-medium">{example.label}</h2>
                                <p className="truncate text-xs text-[#86909c]">{example.description}</p>
                            </div>
                            <Button type="primary" size="small" loading={loading} className="!bg-[#6d3df5] !shadow-none" onClick={() => onUse(example)}>
                                做同款
                            </Button>
                        </div>
                    </article>
                ))}
            </div>
        </div>
    );
}

function HistoryPanel({ items, busy, onRestore }: { items: MarketingAgentHistoryItem[]; busy: boolean; onRestore: (item: MarketingAgentHistoryItem) => void }) {
    return (
        <div className="p-4 sm:p-5">
            <div className="mb-4">
                <h1 className="text-base font-semibold">历史记录</h1>
                <p className="mt-1 text-xs text-[#86909c]">最近 5 次整套运行保存在当前浏览器，不包含 gotocc Key。</p>
            </div>
            {items.length ? (
                <div className="grid max-w-3xl gap-3">
                    {items.map((item) => {
                        const completed = item.tasks.filter((task) => task.status === "completed").length;
                        const cover = item.tasks.find((task) => task.status === "completed" && task.url)?.url || "";
                        return (
                            <article key={item.id} className="flex min-w-0 items-center gap-4 rounded-md border border-[#e5e6eb] bg-white p-4">
                                <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded border border-[#e5e6eb] bg-[#f7f8fa] text-[#86909c]">
                                    {cover ? <img src={cover} alt="历史项目封面" className="size-full object-contain" /> : <FileImage className="size-6" />}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <h2 className="truncate text-sm font-medium">{item.brief?.split(/[；;\n]/)[0] || "商品套图项目"}</h2>
                                    <p className="mt-1 text-xs text-[#86909c]">
                                        {new Date(item.updatedAt).toLocaleString()} · {item.images.length} 张证据图 · 完成 {completed}/{item.selectedTaskIds?.length || marketingPlan.length}
                                    </p>
                                </div>
                                <Button disabled={busy} onClick={() => onRestore(item)}>
                                    恢复项目
                                </Button>
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="flex min-h-64 max-w-2xl flex-col items-center justify-center rounded-md border border-dashed border-[#c9cdd4] bg-white text-[#86909c]">
                    <History className="size-8" />
                    <p className="mt-3 text-sm">暂无本地项目记录</p>
                </div>
            )}
        </div>
    );
}

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return minutes ? `${minutes}:${String(remainder).padStart(2, "0")}` : `${remainder}s`;
}

function shouldRetry(error: unknown) {
    return Boolean(error && typeof error === "object" && "retryable" in error && error.retryable === true);
}

function hasUnknownUpstreamState(error: unknown) {
    return Boolean(error && typeof error === "object" && "upstreamStateUnknown" in error && error.upstreamStateUnknown === true);
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

async function applyMarketingCopy(dataUrl: string, task: MarketingTaskDefinition, brief: string, brandColor: string) {
    const suppliedLines = brief
        .split(/[\n；;。]+/)
        .map((line, index) => line.trim().slice(0, index === 0 ? 24 : 30))
        .filter(Boolean)
        .slice(0, 4);
    if (!suppliedLines.length || (task.id !== "feature" && task.id !== "aplus")) return dataUrl;

    const image = await loadMarketingImage(dataUrl);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0);

    const panel =
        task.id === "aplus"
            ? {
                  x: 0,
                  y: 0,
                  width: Math.round(canvas.width * 0.39),
                  height: canvas.height,
                  padding: Math.round(canvas.width * 0.045),
              }
            : {
                  x: 0,
                  y: Math.round(canvas.height * 0.7),
                  width: canvas.width,
                  height: Math.round(canvas.height * 0.3),
                  padding: Math.round(canvas.width * 0.055),
              };
    context.fillStyle = "rgba(255,255,255,0.94)";
    context.fillRect(panel.x, panel.y, panel.width, panel.height);
    context.fillStyle = brandColor;
    if (task.id === "aplus") context.fillRect(panel.x, panel.y, Math.max(8, Math.round(canvas.width * 0.008)), panel.height);
    else context.fillRect(panel.x, panel.y, panel.width, Math.max(8, Math.round(canvas.height * 0.009)));

    const titleSize = Math.max(32, Math.round(canvas.width * 0.04));
    const bodySize = Math.max(20, Math.round(canvas.width * 0.022));
    let y = panel.y + panel.padding + titleSize;
    context.fillStyle = "#1f2329";
    context.font = `600 ${titleSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    context.textBaseline = "alphabetic";
    y = drawWrappedText(context, suppliedLines[0], panel.x + panel.padding, y, panel.width - panel.padding * 2, titleSize * 1.2);
    context.font = `400 ${bodySize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    context.fillStyle = "#4e5969";
    for (const line of suppliedLines.slice(1)) {
        y += bodySize * 0.55;
        y = drawWrappedText(context, line, panel.x + panel.padding, y, panel.width - panel.padding * 2, bodySize * 1.35);
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

async function imageUrlToFile(url: string, name: string, signal?: AbortSignal) {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`图片参考读取失败（${response.status}）`);
    const blob = await response.blob();
    return new File([blob], name, {
        type: blob.type || "image/png",
    });
}

async function createReferenceContactSheet(files: File[], signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const bitmaps = await Promise.all(files.map((file) => createImageBitmap(file)));
    try {
        const canvas = document.createElement("canvas");
        canvas.width = 1536;
        canvas.height = 1024;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建多视角参考图");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const columns = 3;
        const rows = 2;
        const gap = 20;
        const cellWidth = (canvas.width - gap * (columns + 1)) / columns;
        const cellHeight = (canvas.height - gap * (rows + 1)) / rows;
        bitmaps.forEach((bitmap, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            const x = gap + column * (cellWidth + gap);
            const y = gap + row * (cellHeight + gap);
            context.fillStyle = "#f5f6f7";
            context.fillRect(x, y, cellWidth, cellHeight);
            const scale = Math.min(cellWidth / bitmap.width, cellHeight / bitmap.height);
            const width = bitmap.width * scale;
            const height = bitmap.height * scale;
            context.drawImage(bitmap, x + (cellWidth - width) / 2, y + (cellHeight - height) / 2, width, height);
        });
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("多视角参考图编码失败"))), "image/webp", 0.9);
        });
        return new File([blob], "all-product-views.webp", {
            type: "image/webp",
        });
    } finally {
        bitmaps.forEach((bitmap) => bitmap.close());
    }
}
