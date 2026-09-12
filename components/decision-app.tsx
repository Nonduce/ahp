"use client";

import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Ellipsis,
  Download,
  FileSpreadsheet,
  GitCompareArrows,
  HardDrive,
  Info,
  Layers3,
  Plus,
  RefreshCw,
  Scale,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { assertReciprocalMatrix, formatRatio, parseRatio, rankAlternatives, reweightCriterion, worstTriad } from "@/lib/ahp";
import {
  calculateDecision,
  createBlankDecision,
  createExampleDecision,
  getJudgment,
  getScopes,
  isDecisionModel,
  withJudgment,
  type ComparisonScope,
  type DecisionCalculation,
  type DecisionItem,
  type DecisionModel,
  type ScopeCalculation,
} from "@/lib/decision";

type WorkflowStep = "model" | "compare" | "consistency" | "result";
type InputMode = "guide" | "matrix";
type ItemKind = "criteria" | "alternatives";

const STORAGE_KEY = "ahp-decision-workbench:v1";
const chartColors = ["#007aff", "#248a3d", "#d97800", "#af52de", "#e04f78", "#008299", "#a67c00"];
const strengthOptions = [
  { value: 1, label: "同等" },
  { value: 3, label: "稍微" },
  { value: 5, label: "明显" },
  { value: 7, label: "强烈" },
  { value: 9, label: "极端" },
];

const workflow = [
  { id: "model" as const, number: "01", label: "建立模型", icon: Layers3 },
  { id: "compare" as const, number: "02", label: "成对比较", icon: GitCompareArrows },
  { id: "consistency" as const, number: "03", label: "一致性", icon: Sparkles },
  { id: "result" as const, number: "04", label: "查看结果", icon: BarChart3 },
];

function pairsFor(items: DecisionItem[]) {
  const pairs: Array<[DecisionItem, DecisionItem]> = [];
  for (let left = 0; left < items.length - 1; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) pairs.push([items[left], items[right]]);
  }
  return pairs;
}

function strengthLabel(value: number) {
  if (value <= 1) return "同等重要";
  if (value <= 2) return "略微重要";
  if (value <= 4) return "稍微重要";
  if (value <= 6) return "明显重要";
  if (value <= 8) return "强烈重要";
  return "极端重要";
}

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function lookupLabel(items: DecisionItem[], id: string) {
  return items.find((item) => item.id === id)?.label ?? id;
}

function modelNamesAreValid(model: DecisionModel) {
  const validGroup = (items: DecisionItem[]) => {
    const names = items.map((item) => item.label.trim());
    return names.every(Boolean) && new Set(names).size === names.length;
  };
  return validGroup(model.criteria) && validGroup(model.alternatives);
}

type ModelContextLike = {
  registerTool: (
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean };
      execute: (input: unknown) => unknown | Promise<unknown>;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

export function DecisionApp() {
  const [model, setModel] = useState<DecisionModel>(createExampleDecision);
  const [step, setStep] = useState<WorkflowStep>("compare");
  const [inputMode, setInputMode] = useState<InputMode>("guide");
  const [scopeId, setScopeId] = useState("criteria");
  const [pairIndex, setPairIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const [pendingDelete, setPendingDelete] = useState<{ kind: ItemKind; item: DecisionItem } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const calculation = useMemo(() => calculateDecision(model), [model]);
  const scopes = useMemo(() => getScopes(model), [model]);
  const modelRef = useRef(model);
  const calculationRef = useRef(calculation);

  useEffect(() => {
    modelRef.current = model;
    calculationRef.current = calculation;
  }, [model, calculation]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as {
          model?: unknown;
          step?: WorkflowStep;
          inputMode?: InputMode;
          scopeId?: string;
        };
        if (isDecisionModel(parsed.model)) {
          setModel(parsed.model);
          if (workflow.some((item) => item.id === parsed.step)) setStep(parsed.step!);
          if (parsed.inputMode === "guide" || parsed.inputMode === "matrix") setInputMode(parsed.inputMode);
          if (typeof parsed.scopeId === "string") setScopeId(parsed.scopeId);
        }
      }
    } catch {
      toast.error("本地记录无法读取，已载入安全示例");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ model, step, inputMode, scopeId }));
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hydrated, model, step, inputMode, scopeId]);

  useEffect(() => {
    if (!scopes.some((scope) => scope.id === scopeId)) setScopeId("criteria");
  }, [scopes, scopeId]);

  useEffect(() => {
    setPairIndex(0);
  }, [scopeId]);

  useEffect(() => {
    if (!hydrated) return;
    const context = (document as Document & { modelContext?: ModelContextLike }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();

    const report = () => undefined;
    const registrations = [
      context.registerTool(
        {
          name: "set_ahp_judgment",
          title: "填写一项 AHP 判断",
          description: "在当前决策的指定比较矩阵中，填写或更新一项两两比较判断；ratio 表示 leftId 相对 rightId 的重要程度。",
          inputSchema: {
            type: "object",
            properties: {
              scopeId: { type: "string", minLength: 1 },
              leftId: { type: "string", minLength: 1 },
              rightId: { type: "string", minLength: 1 },
              ratio: { type: "number", minimum: 0.1111111111111111, maximum: 9 },
            },
            required: ["scopeId", "leftId", "rightId", "ratio"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: false },
          async execute(input) {
            const candidate = input as { scopeId?: unknown; leftId?: unknown; rightId?: unknown; ratio?: unknown };
            if (typeof candidate.scopeId !== "string" || typeof candidate.leftId !== "string" || typeof candidate.rightId !== "string") {
              throw new Error("scopeId、leftId 和 rightId 必须是字符串");
            }
            if (candidate.leftId === candidate.rightId) throw new Error("不能将一个项目与自身比较");
            if (typeof candidate.ratio !== "number" || !Number.isFinite(candidate.ratio) || candidate.ratio < 1 / 9 || candidate.ratio > 9) {
              throw new Error("ratio 必须在 1/9 到 9 之间");
            }
            const activeScopeId = candidate.scopeId;
            const leftId = candidate.leftId;
            const rightId = candidate.rightId;
            const ratio = candidate.ratio;
            const current = modelRef.current;
            const activeScope = getScopes(current).find((item) => item.id === activeScopeId);
            if (!activeScope) throw new Error("找不到指定的比较矩阵");
            const ids = new Set(activeScope.items.map((item) => item.id));
            if (!ids.has(leftId) || !ids.has(rightId)) throw new Error("比较项目不属于这个矩阵");
            setModel((latest) => withJudgment(latest, activeScopeId, leftId, rightId, ratio));
            setScopeId(activeScopeId);
            setStep("compare");
            await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return {
              status: "saved",
              scopeId: activeScopeId,
              left: lookupLabel(activeScope.items, leftId),
              right: lookupLabel(activeScope.items, rightId),
              ratio,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
      context.registerTool(
        {
          name: "read_ahp_decision_summary",
          title: "读取 AHP 决策摘要",
          description: "读取当前决策的目标、准则、方案、填写进度和可用排名，不修改数据。",
          inputSchema: { type: "object", properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: false },
          execute() {
            const current = modelRef.current;
            const currentCalculation = calculationRef.current;
            return {
              title: current.title,
              criteria: current.criteria.map((item) => ({ id: item.id, label: item.label })),
              alternatives: current.alternatives.map((item) => ({ id: item.id, label: item.label })),
              scopes: getScopes(current).map((scope) => ({
                id: scope.id,
                label: scope.label,
                itemIds: scope.items.map((item) => item.id),
              })),
              progress: { completed: currentCalculation.completeCount, total: currentCalculation.totalCount },
              ranking: currentCalculation.ranking?.map((entry) => ({
                alternative: lookupLabel(current.alternatives, entry.alternativeId),
                score: Number(entry.score.toFixed(6)),
              })) ?? null,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ];
    registrations.forEach((registration) => Promise.resolve(registration).catch(report));
    return () => lifecycle.abort();
  }, [hydrated]);

  const updateJudgment = useCallback((activeScopeId: string, leftId: string, rightId: string, ratio: number) => {
    setModel((current) => withJudgment(current, activeScopeId, leftId, rightId, ratio));
  }, []);

  const chooseScope = useCallback((nextScopeId: string) => {
    setScopeId(nextScopeId);
    setPairIndex(0);
  }, []);

  const exportDecision = () => {
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${model.title.replace(/[\\/:*?"<>|]/g, "-") || "AHP决策"}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("决策备份已导出");
  };

  const importDecision = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const candidate = isDecisionModel(parsed) ? parsed : isDecisionModel((parsed as { model?: unknown })?.model) ? (parsed as { model: DecisionModel }).model : null;
      if (!candidate) throw new Error("文件不是有效的 AHP 决策备份");
      setModel(candidate);
      setStep("model");
      setScopeId("criteria");
      toast.success("决策备份已导入");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法导入这个文件");
    }
  };

  const requestDelete = (kind: ItemKind, item: DecisionItem) => setPendingDelete({ kind, item });

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const { kind, item } = pendingDelete;
    setModel((current) => {
      const criteria = kind === "criteria" ? current.criteria.filter((entry) => entry.id !== item.id) : current.criteria;
      const alternatives = kind === "alternatives" ? current.alternatives.filter((entry) => entry.id !== item.id) : current.alternatives;
      const judgments = Object.fromEntries(
        Object.entries(current.judgments).filter(([key]) => !key.includes(item.id)),
      );
      return { ...current, criteria, alternatives, judgments };
    });
    setPendingDelete(null);
    setPairIndex(0);
  };

  const setItemLabel = (kind: ItemKind, id: string, label: string) => {
    setModel((current) => ({
      ...current,
      [kind]: current[kind].map((item) => (item.id === id ? { ...item, label } : item)),
    }));
  };

  const addItem = (kind: ItemKind, label: string) => {
    const cleaned = label.trim();
    if (!cleaned) return;
    if (model[kind].some((item) => item.label.trim() === cleaned)) {
      toast.error("名称不能重复");
      return;
    }
    if (model[kind].length >= 7) {
      toast.error("每组最多支持 7 项，建议拆分层级");
      return;
    }
    const prefix = kind === "criteria" ? "criterion" : "alternative";
    setModel((current) => ({ ...current, [kind]: [...current[kind], { id: newId(prefix), label: cleaned }] }));
  };

  const loadBlankDecision = () => {
    setModel(createBlankDecision());
    setStep("model");
    setScopeId("criteria");
    setInputMode("guide");
    setPairIndex(0);
  };

  const stepIndex = workflow.findIndex((item) => item.id === step);
  const canViewResult = calculation.ranking !== null;
  const saveLabel = saveStatus === "saving" ? "正在保存" : saveStatus === "error" ? "保存失败" : "已保存到本机";

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.getElementById("decision-workspace")?.focus({ preventScroll: true });
  }, [step]);

  return (
    <main className="min-h-screen text-foreground">
      <Toaster position="top-center" richColors />
      <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={importDecision} />

      <header className="ios-header sticky top-0 z-30 mb-4">
      <div className="mx-auto grid min-h-[88px] w-full max-w-[1320px] grid-cols-[1fr_auto] items-center gap-3 px-4 py-4 sm:px-8 lg:grid-cols-[1fr_auto_1fr]">
        <button type="button" className="ios-brand flex items-center justify-self-start gap-2 text-left" onClick={() => setStep("model")} aria-label="返回决策模型">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-white">
            <Scale className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-lg font-semibold tracking-tight">权衡</span>
            <span className="hidden text-[13px] text-muted-foreground min-[400px]:block">AHP 决策助手</span>
          </span>
        </button>

        <WorkflowNav step={step} canViewResult={canViewResult} onStepChange={setStep} />

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" aria-label="导入决策" className="ios-utility hidden h-11 px-3 text-primary sm:flex" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" />
            <span className="hidden xl:inline">导入</span>
          </Button>
          <Button variant="ghost" aria-label="导出备份" className="ios-utility hidden h-11 px-3 text-primary sm:flex" onClick={exportDecision}>
            <Download className="size-4" />
            <span className="hidden xl:inline">导出</span>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button aria-label="新建决策" className="h-11 px-4 text-white">
                <Plus className="size-4" />
                <span>新建</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent className="ios-group border-[#e5e5ea] bg-card">
              <AlertDialogHeader>
                <AlertDialogTitle>新建一个空白决策？</AlertDialogTitle>
                <AlertDialogDescription>当前内容会被新的空白模型替换。你可以先导出 JSON 备份。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="rounded-xl">取消</AlertDialogCancel>
                <AlertDialogAction className="rounded-xl bg-primary" onClick={loadBlankDecision}>新建决策</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="更多操作" variant="ghost" size="icon" className="ios-utility size-11 text-primary"><Ellipsis className="size-5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 rounded-xl bg-white p-1.5">
              <DropdownMenuItem className="min-h-11 text-base" onSelect={() => fileInputRef.current?.click()}><Upload />导入决策</DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 text-base" onSelect={exportDecision}><Download />导出 JSON 备份</DropdownMenuItem>
              <DropdownMenuSeparator />
              <div className="px-2 py-2 text-[13px] text-muted-foreground" aria-live="polite">{saveLabel} · 不会云同步</div>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      </header>

      {saveStatus === "error" && (
        <div className="mx-auto mb-5 w-full max-w-[1320px] px-4 sm:px-8" role="alert">
          <div className="flex flex-col gap-3 rounded-2xl border border-[#efd0d1] bg-[#fff0f0] p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm text-destructive"><CircleAlert className="mt-0.5 size-4 shrink-0" />本机保存失败，请导出备份后再关闭页面。</p>
            <Button variant="ghost" onClick={exportDecision}><Download className="size-4" />导出备份</Button>
          </div>
        </div>
      )}

      <div className="mx-auto grid w-full max-w-[1320px] gap-7 px-4 pb-[calc(120px+env(safe-area-inset-bottom))] sm:px-8 lg:pb-12 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section id="decision-workspace" tabIndex={-1} aria-label={workflow[stepIndex].label} className="min-w-0 outline-none">
          <MobileWorkflow step={step} canViewResult={canViewResult} onStepChange={setStep} />
          {step === "model" && (
            <ModelWorkspace
              model={model}
              valid={modelNamesAreValid(model)}
              onTitleChange={(title) => setModel((current) => ({ ...current, title }))}
              onItemLabelChange={setItemLabel}
              onAddItem={addItem}
              onRequestDelete={requestDelete}
              onContinue={() => {
                setScopeId("criteria");
                setStep("compare");
              }}
            />
          )}
          {step === "compare" && (
            <ComparisonWorkspace
              model={model}
              calculation={calculation}
              scopes={scopes}
              scopeId={scopeId}
              inputMode={inputMode}
              pairIndex={pairIndex}
              onScopeChange={chooseScope}
              onInputModeChange={setInputMode}
              onPairIndexChange={setPairIndex}
              onJudgmentChange={updateJudgment}
              onMatrixPaste={(activeScope, matrix) => {
                setModel((current) => {
                  let next = current;
                  for (let row = 0; row < activeScope.items.length - 1; row += 1) {
                    for (let column = row + 1; column < activeScope.items.length; column += 1) {
                      next = withJudgment(next, activeScope.id, activeScope.items[row].id, activeScope.items[column].id, matrix[row][column]);
                    }
                  }
                  return next;
                });
              }}
              onContinueToCheck={() => setStep("consistency")}
            />
          )}
          {step === "consistency" && (
            <ConsistencyWorkspace
              calculation={calculation}
              onReview={(reviewScopeId) => {
                setScopeId(reviewScopeId);
                setPairIndex(0);
                setStep("compare");
              }}
              onResult={() => setStep("result")}
            />
          )}
          {step === "result" && (
            <ResultWorkspace model={model} calculation={calculation} onCompare={() => setStep("compare")} />
          )}
        </section>

        <SummaryPanel model={model} calculation={calculation} onResult={() => setStep("result")} />
      </div>

      <AlertDialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent className="ios-group border-[#e5e5ea] bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle>删除“{pendingDelete?.item.label}”？</AlertDialogTitle>
            <AlertDialogDescription>
              与这一项有关的比较判断也会一并删除，此操作无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" className="rounded-xl" onClick={confirmDelete}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function WorkflowNav({
  step,
  canViewResult,
  onStepChange,
}: {
  step: WorkflowStep;
  canViewResult: boolean;
  onStepChange: (step: WorkflowStep) => void;
}) {
  return (
    <nav className="ios-floating-nav hidden grid-cols-4 gap-1 p-1.5 lg:grid" aria-label="决策步骤">
        {workflow.map((item) => {
          const active = item.id === step;
          return (
            <button
              key={item.id}
              type="button"
              disabled={item.id === "result" && !canViewResult}
              aria-current={active ? "step" : undefined}
              onClick={() => onStepChange(item.id)}
              className={`ios-nav-item min-h-11 min-w-[96px] px-3 py-2 text-[15px] disabled:cursor-not-allowed disabled:opacity-45 ${active ? "is-active" : ""}`}
            >
              {item.label}
            </button>
          );
        })}
    </nav>
  );
}

function MobileWorkflow({ step, canViewResult, onStepChange }: { step: WorkflowStep; canViewResult: boolean; onStepChange: (step: WorkflowStep) => void }) {
  return (
    <nav className="ios-tabbar fixed z-40 grid grid-cols-4 gap-1 lg:hidden" aria-label="决策步骤">
      {workflow.map((item) => {
        const Icon = item.icon;
        const active = item.id === step;
        return (
          <button
            key={item.id}
            type="button"
            disabled={item.id === "result" && !canViewResult}
            aria-current={active ? "step" : undefined}
            onClick={() => onStepChange(item.id)}
            className={`ios-nav-item flex min-h-[62px] flex-col items-center justify-center gap-1 px-1 py-2 text-sm font-medium disabled:opacity-40 ${active ? "is-active" : ""}`}
          >
            <Icon className="size-5" strokeWidth={active ? 2.2 : 1.7} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function ModelWorkspace({
  model,
  valid,
  onTitleChange,
  onItemLabelChange,
  onAddItem,
  onRequestDelete,
  onContinue,
}: {
  model: DecisionModel;
  valid: boolean;
  onTitleChange: (title: string) => void;
  onItemLabelChange: (kind: ItemKind, id: string, label: string) => void;
  onAddItem: (kind: ItemKind, label: string) => void;
  onRequestDelete: (kind: ItemKind, item: DecisionItem) => void;
  onContinue: () => void;
}) {
  const totalComparisons = (model.criteria.length * (model.criteria.length - 1)) / 2
    + model.criteria.length * ((model.alternatives.length * (model.alternatives.length - 1)) / 2);

  return (
    <div>
      <WorkspaceHeading eyebrow="第 1 步" title="先把问题拆清楚" description="方案是你最终要选择的对象，准则是用来评价方案的角度。" />
      <div className="ios-group rounded-2xl p-5 sm:p-7">
        <label className="block text-sm font-bold text-[#566681]" htmlFor="decision-title">我要在什么事情上做选择？</label>
        <Input
          id="decision-title"
          value={model.title}
          onChange={(event) => onTitleChange(event.target.value)}
          className="ios-secondary-group mt-3 h-14 rounded-2xl border-[#e5e5ea] bg-transparent px-5 text-lg font-bold shadow-none focus-visible:border-ring"
          placeholder="例如：选择一台适合我的笔记本"
        />

        <div className="mt-7 grid gap-6 lg:grid-cols-2">
          <EditableList
            kind="alternatives"
            title="备选方案"
            description="你最终要从中选择什么？"
            placeholder="添加一个方案"
            items={model.alternatives}
            onLabelChange={onItemLabelChange}
            onAdd={onAddItem}
            onRequestDelete={onRequestDelete}
          />
          <EditableList
            kind="criteria"
            title="评价准则"
            description="你会从哪些方面衡量？"
            placeholder="添加一个准则"
            items={model.criteria}
            onLabelChange={onItemLabelChange}
            onAdd={onAddItem}
            onRequestDelete={onRequestDelete}
          />
        </div>

        <div className="mt-7 flex flex-col gap-4 rounded-2xl border border-[#e5e5ea] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <Info className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-bold">预计需要 {totalComparisons} 次两两比较</p>
              <p className="mt-1 text-sm text-[#6d7a92]">每组控制在 3–7 项更容易保持判断一致。</p>
            </div>
          </div>
          <Button
            disabled={!valid || !model.title.trim()}
            onClick={onContinue}
            className="h-11 rounded-2xl bg-primary px-6 text-white shadow-none hover:bg-[#005bbf]"
          >
            开始两两比较
            <ChevronRight className="size-4" />
          </Button>
        </div>
        {!valid && <p className="mt-3 text-sm font-semibold text-[#a34f5a]">名称不能为空或重复，请先修正。</p>}
      </div>
    </div>
  );
}

function EditableList({
  kind,
  title,
  description,
  placeholder,
  items,
  onLabelChange,
  onAdd,
  onRequestDelete,
}: {
  kind: ItemKind;
  title: string;
  description: string;
  placeholder: string;
  items: DecisionItem[];
  onLabelChange: (kind: ItemKind, id: string, label: string) => void;
  onAdd: (kind: ItemKind, label: string) => void;
  onRequestDelete: (kind: ItemKind, item: DecisionItem) => void;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    if (!draft.trim()) return;
    onAdd(kind, draft);
    setDraft("");
  };

  return (
    <section className="ios-editable-list overflow-hidden rounded-xl">
      <div className="border-b border-[#e5e5ea] bg-[#f9f9fb] px-4 py-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="px-3">
        {items.map((item, index) => (
          <div key={item.id} className="ios-editable-row group flex min-h-14 items-center gap-2 py-1.5">
            <span className="grid size-6 shrink-0 place-items-center text-[13px] text-muted-foreground">{index + 1}</span>
            <Input
              value={item.label}
              aria-label={`${title} ${index + 1}`}
              onChange={(event) => onLabelChange(kind, item.id, event.target.value)}
              className="h-11 rounded-xl border-[#e5e5ea] bg-white shadow-none focus-visible:border-ring"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={items.length <= 2}
              title={items.length <= 2 ? "至少保留两项" : `删除${item.label}`}
              aria-label={`删除${item.label}`}
              onClick={() => onRequestDelete(kind, item)}
              className="size-11 rounded-xl text-destructive hover:bg-[#fff0ee]"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-[#e5e5ea] bg-[#f9f9fb] p-3">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          disabled={items.length >= 7}
          placeholder={items.length >= 7 ? "已达到 7 项上限" : placeholder}
          className="h-11 rounded-xl border-[#e5e5ea] bg-white shadow-none"
        />
        <Button type="button" variant="secondary" size="icon" disabled={!draft.trim() || items.length >= 7} onClick={commit} className="ios-control size-11 rounded-xl bg-transparent text-primary">
          <Plus className="size-4" />
          <span className="sr-only">添加</span>
        </Button>
      </div>
    </section>
  );
}

function ComparisonWorkspace({
  model,
  calculation,
  scopes,
  scopeId,
  inputMode,
  pairIndex,
  onScopeChange,
  onInputModeChange,
  onPairIndexChange,
  onJudgmentChange,
  onMatrixPaste,
  onContinueToCheck,
}: {
  model: DecisionModel;
  calculation: DecisionCalculation;
  scopes: ComparisonScope[];
  scopeId: string;
  inputMode: InputMode;
  pairIndex: number;
  onScopeChange: (scopeId: string) => void;
  onInputModeChange: (mode: InputMode) => void;
  onPairIndexChange: (index: number) => void;
  onJudgmentChange: (scopeId: string, leftId: string, rightId: string, ratio: number) => void;
  onMatrixPaste: (scope: ComparisonScope, matrix: number[][]) => void;
  onContinueToCheck: () => void;
}) {
  const scope = scopes.find((item) => item.id === scopeId) ?? scopes[0];
  const scopeCalculation = calculation.scopes.find((item) => item.scope.id === scope.id)!;
  const pairs = pairsFor(scope.items);
  const safePairIndex = Math.min(pairIndex, Math.max(0, pairs.length - 1));
  const pair = pairs[safePairIndex];
  const scopePosition = scopes.findIndex((item) => item.id === scope.id);
  const progress = calculation.totalCount ? (calculation.completeCount / calculation.totalCount) * 100 : 0;

  const goNext = () => {
    if (safePairIndex < pairs.length - 1) {
      onPairIndexChange(safePairIndex + 1);
    } else if (scopePosition < scopes.length - 1) {
      onScopeChange(scopes[scopePosition + 1].id);
    } else {
      onContinueToCheck();
    }
  };

  const goPrevious = () => {
    if (safePairIndex > 0) {
      onPairIndexChange(safePairIndex - 1);
    } else if (scopePosition > 0) {
      const previousScope = scopes[scopePosition - 1];
      onScopeChange(previousScope.id);
    }
  };

  const pairValue = pair ? getJudgment(model, scope.id, pair[0].id, pair[1].id) : undefined;

  return (
    <div>
      <div className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="mb-1 text-sm font-bold text-muted-foreground">第 2 步 · 成对比较</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{model.title}</h1>
        </div>
        <div className="min-w-[190px]">
          <div className="mb-2 flex justify-between text-sm font-semibold text-muted-foreground">
            <span>总进度</span>
            <span>{calculation.completeCount} / {calculation.totalCount}</span>
          </div>
          <Progress value={progress} className="h-2.5 bg-[#e5e5ea] [&_[data-slot=progress-indicator]]:bg-primary" />
        </div>
      </div>

      <div className="ios-group rounded-2xl p-4 sm:p-7">
        <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          <div className="min-w-0 flex-1">
            <label htmlFor="scope-select" className="mb-2 block text-sm font-bold text-muted-foreground">当前比较矩阵</label>
            <Select value={scope.id} onValueChange={onScopeChange}>
              <SelectTrigger id="scope-select" className="ios-secondary-group h-11 w-full max-w-md rounded-xl border-[#e5e5ea] bg-transparent shadow-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-[#e5e5ea] bg-popover">
                {scopes.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Tabs value={inputMode} onValueChange={(value) => onInputModeChange(value as InputMode)}>
            <TabsList className="ios-segmented h-11 w-full rounded-lg p-1">
              <TabsTrigger value="guide" className="rounded-md px-4">逐题判断</TabsTrigger>
              <TabsTrigger value="matrix" className="rounded-md px-4">完整矩阵</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {inputMode === "guide" && pair && (
          <GuideComparison
            decisionTitle={model.title}
            scope={scope}
            pair={pair}
            pairIndex={safePairIndex}
            pairCount={pairs.length}
            value={pairValue}
            onChange={(ratio) => onJudgmentChange(scope.id, pair[0].id, pair[1].id, ratio)}
          />
        )}

        {inputMode === "matrix" && (
          <MatrixComparison
            model={model}
            scope={scope}
            calculation={scopeCalculation}
            onChange={(leftId, rightId, ratio) => onJudgmentChange(scope.id, leftId, rightId, ratio)}
            onPaste={(matrix) => onMatrixPaste(scope, matrix)}
          />
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button variant="ghost" disabled={scopePosition === 0 && safePairIndex === 0} onClick={goPrevious} className="h-11 rounded-xl text-muted-foreground">
            <ChevronLeft className="size-4" />
            上一项
          </Button>
          <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <Button variant="ghost" onClick={onContinueToCheck} className="h-11 rounded-xl text-muted-foreground">检查一致性</Button>
            <Button
              disabled={inputMode === "guide" && pairValue === undefined}
              onClick={goNext}
              className="h-11 rounded-2xl bg-primary px-6 text-white shadow-none hover:bg-[#005bbf]"
            >
              {scopePosition === scopes.length - 1 && safePairIndex === pairs.length - 1 ? "完成比较" : "保存并继续"}
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuideComparison({
  decisionTitle,
  scope,
  pair,
  pairIndex,
  pairCount,
  value,
  onChange,
}: {
  decisionTitle: string;
  scope: ComparisonScope;
  pair: [DecisionItem, DecisionItem];
  pairIndex: number;
  pairCount: number;
  value: number | undefined;
  onChange: (ratio: number) => void;
}) {
  const [left, right] = pair;
  const strengthGroupId = useId();
  const selected = value === undefined || Math.abs(value - 1) < 1e-10 ? null : value > 1 ? left.id : right.id;
  const strength = value === undefined ? undefined : value >= 1 ? value : 1 / value;

  const chooseWinner = (winnerId: string) => {
    const nextStrength = strength && strength > 1 ? strength : 3;
    onChange(winnerId === left.id ? nextStrength : 1 / nextStrength);
  };

  const chooseStrength = (nextStrength: number) => {
    if (nextStrength === 1) {
      onChange(1);
      return;
    }
    onChange(selected === right.id ? 1 / nextStrength : nextStrength);
  };

  const summary = value === undefined
    ? "先选更重要的一项，再选择重要程度。"
    : Math.abs(value - 1) < 1e-10
      ? `你认为“${left.label}”和“${right.label}”同等重要。`
      : value > 1
        ? `你认为“${left.label}”比“${right.label}”${strengthLabel(value)}（${formatRatio(value)} 倍）。`
        : `你认为“${right.label}”比“${left.label}”${strengthLabel(1 / value)}（${formatRatio(1 / value)} 倍）。`;

  return (
    <div className="rounded-xl bg-[#f2f2f7] p-4 sm:p-6">
      <div className="text-center">
        <p className="text-sm font-bold text-muted-foreground">本组第 {pairIndex + 1} 项，共 {pairCount} 项</p>
        <h2 className="mx-auto mt-3 max-w-2xl text-lg font-semibold leading-7 sm:text-xl">
          在“{decisionTitle}”时，哪一项更重要？
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{scope.kind === "criteria" ? "比较两个评价准则" : `在${scope.shortLabel}这一准则下比较两个方案`}</p>
      </div>

      <div className="mt-5 grid items-stretch gap-3 sm:grid-cols-2">
        {[left, right].map((item, index) => {
          const active = selected === item.id;
          return (
            <div key={item.id} className="contents">
              <button
                type="button"
                aria-pressed={active}
                onClick={() => chooseWinner(item.id)}
                className={`choice-card relative flex min-h-20 items-center gap-3 rounded-xl border-2 px-4 py-4 text-left sm:min-h-[150px] sm:flex-col sm:justify-center sm:text-center ${active ? "border-primary bg-[#eaf3ff] text-primary" : "border-[#d1d1d6] bg-white"}`}
              >
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg text-base font-semibold ${index === 0 ? "bg-[#eaf3ff] text-primary" : "bg-[#e7f4ea] text-[#248a3d]"}`}>{item.label.slice(0, 1)}</span>
                <span className="min-w-0 flex-1 sm:flex-none">
                  <strong className="block break-words text-lg">{item.label}</strong>
                  <span className="mt-1 block text-[13px] text-muted-foreground">{active ? "已选择为更重要的一项" : "点按选择"}</span>
                </span>
                <CheckCircle2 className={`size-5 shrink-0 sm:absolute sm:right-3 sm:top-3 ${active ? "text-primary" : "text-[#c7c7cc]"}`} />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mx-auto mt-6 max-w-2xl">
        <p className="mb-4 text-center text-sm font-bold text-muted-foreground">重要到什么程度？</p>
        <fieldset className="grid grid-cols-5 gap-2">
          <legend className="sr-only">重要程度</legend>
          {strengthOptions.map((option) => {
            const active = strength !== undefined && Math.abs(strength - option.value) < 1e-8;
            return (
              <label key={option.value} className="relative">
                <input type="radio" name={strengthGroupId} value={option.value} checked={active} disabled={option.value > 1 && selected === null} onChange={() => chooseStrength(option.value)} className="peer sr-only" />
                <span className={`ios-strength-option block min-h-16 px-1 py-2 text-center transition peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#007aff] peer-disabled:opacity-45 ${active ? "is-active" : ""}`}>
                  <span className="block text-base font-semibold">{option.value}</span>
                  <span className="block text-xs">{option.label}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <output className="mt-5 block min-h-12 rounded-2xl border border-[#e5e5ea] bg-white px-4 py-3 text-center text-sm font-semibold leading-6 text-muted-foreground" aria-live="polite">
          {summary}
        </output>
      </div>
    </div>
  );
}

function MatrixComparison({
  model,
  scope,
  calculation,
  onChange,
  onPaste,
}: {
  model: DecisionModel;
  scope: ComparisonScope;
  calculation: ScopeCalculation;
  onChange: (leftId: string, rightId: string, ratio: number) => void;
  onPaste: (matrix: number[][]) => void;
}) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState("");

  useEffect(() => {
    setShowPaste(false);
    setPasteText("");
    setPasteError("");
  }, [scope.id]);

  const applyPastedMatrix = () => {
    try {
      const rows = pasteText.trim().split(/\r?\n/).filter(Boolean).map((row) => row.trim().split(/[\t,，;；\s]+/).filter(Boolean));
      const n = scope.items.length;
      if (rows.length !== n || rows.some((row) => row.length !== n)) throw new Error(`需要粘贴 ${n} × ${n} 的完整方阵`);
      const matrix = rows.map((row) => row.map(parseRatio));
      if (matrix.some((row) => row.some((value) => value < 1 / 9 - 1e-9 || value > 9 + 1e-9))) throw new Error("标准 AHP 判断值须在 1/9 到 9 之间");
      assertReciprocalMatrix(matrix);
      onPaste(matrix);
      setPasteError("");
      setShowPaste(false);
      setPasteText("");
      toast.success("完整矩阵已应用");
    } catch (error) {
      setPasteError(error instanceof Error ? error.message : "无法解析矩阵");
    }
  };

  return (
    <div className="ios-secondary-group rounded-2xl p-4 sm:p-6">
      <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-semibold">填写完整判断矩阵</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">单元格表示“行项目”相对于“列项目”的重要程度。只需编辑上三角，另一半会自动填写倒数。</p>
        </div>
        <Button variant="ghost" onClick={() => setShowPaste((open) => !open)} className="h-10 rounded-xl text-muted-foreground">
          <FileSpreadsheet className="size-4" />
          {showPaste ? "收起粘贴区" : "粘贴矩阵"}
        </Button>
      </div>

      {showPaste && (
        <div className="mb-5 rounded-2xl border border-[#e5e5ea] bg-white p-4">
          <label htmlFor="matrix-paste" className="text-sm font-bold">从 Excel、CSV 或制表符文本粘贴</label>
          <Textarea
            id="matrix-paste"
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={`例如：\n1\t3\t5\n1/3\t1\t2\n1/5\t1/2\t1`}
            className="mt-3 min-h-32 rounded-xl border-[#e5e5ea] bg-white font-mono text-sm shadow-none"
          />
          {pasteError && <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-[#a34f5a]"><CircleAlert className="size-4" />{pasteError}</p>}
          <div className="mt-3 flex justify-end">
            <Button disabled={!pasteText.trim()} onClick={applyPastedMatrix} className="rounded-xl bg-primary text-white">校验并应用</Button>
          </div>
        </div>
      )}

      <div className="matrix-scroll rounded-2xl border border-[#e5e5ea] bg-white">
        <Table className="min-w-[620px] border-separate border-spacing-0">
          <TableCaption className="px-4 pb-4 text-left">左右滑动查看完整矩阵。可输入 1/9～9、分数或小数；空白表示尚未判断。</TableCaption>
          <TableHeader>
            <TableRow className="border-[#e5e5ea] hover:bg-transparent">
              <TableHead scope="col" className="sticky left-0 z-20 min-w-32 bg-[#f2f2f7] px-4 font-semibold">行 \ 列</TableHead>
              {scope.items.map((item) => <TableHead scope="col" key={item.id} className="min-w-28 text-center font-semibold">{item.label}</TableHead>)}
              <TableHead scope="col" className="min-w-24 text-center font-semibold">权重</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {scope.items.map((rowItem, row) => (
              <TableRow key={rowItem.id} className="border-[#e5e5ea] hover:bg-white">
                <TableHead scope="row" className="sticky left-0 z-10 bg-[#f2f2f7] px-4 font-semibold">{rowItem.label}</TableHead>
                {scope.items.map((columnItem, column) => {
                  const ratio = getJudgment(model, scope.id, rowItem.id, columnItem.id);
                  if (row === column) {
                    return <TableCell key={columnItem.id} className="text-center"><span className="ios-secondary-group inline-grid size-10 place-items-center rounded-xl font-bold text-muted-foreground">1</span></TableCell>;
                  }
                  if (row < column) {
                    return (
                      <TableCell key={columnItem.id} className="text-center">
                        <MatrixCell
                          value={ratio}
                          ariaLabel={`${rowItem.label}相对${columnItem.label}的重要程度`}
                          onCommit={(next) => onChange(rowItem.id, columnItem.id, next)}
                        />
                      </TableCell>
                    );
                  }
                  return <TableCell key={columnItem.id} className="text-center font-mono font-semibold text-muted-foreground">{ratio === undefined ? "—" : formatRatio(ratio)}</TableCell>;
                })}
                <TableCell className="text-center font-semibold text-primary">
                  {calculation.result ? `${(calculation.result.weights[row] * 100).toFixed(1)}%` : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-[#e5e5ea] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-semibold text-muted-foreground">两种填写方式共用同一数据，可以随时切换。</p>
        <ConsistencyBadge calculation={calculation} />
      </div>
    </div>
  );
}

function MatrixCell({ value, ariaLabel, onCommit }: { value: number | undefined; ariaLabel: string; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(formatRatio(value));
  const [error, setError] = useState("");
  const errorId = useId();

  useEffect(() => setDraft(formatRatio(value)), [value]);

  const commit = () => {
    if (!draft.trim() && value === undefined) {
      setError("");
      return;
    }
    try {
      const parsed = parseRatio(draft);
      if (parsed < 1 / 9 - 1e-9 || parsed > 9 + 1e-9) throw new Error("请输入 1/9 到 9 之间的值");
      onCommit(parsed);
      setDraft(formatRatio(parsed));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "输入无效");
    }
  };

  return (
    <div className="relative mx-auto w-20">
      <Input
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError("");
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          }
        }}
        aria-label={ariaLabel}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        title={error || ariaLabel}
        placeholder="—"
        className="h-11 rounded-lg border-[#d1d1d6] bg-white text-center font-mono font-semibold shadow-none focus-visible:border-ring aria-invalid:border-destructive"
      />
      {error && <span id={errorId} className="mt-1 block text-xs leading-4 text-destructive" role="alert">{error}</span>}
    </div>
  );
}

function ConsistencyBadge({ calculation }: { calculation: ScopeCalculation }) {
  if (calculation.missing.length > 0) {
    return <Badge className="border border-[#e4bd7c] bg-[#f8e8c9] px-3 py-1 text-[#8b641f]">还差 {calculation.missing.length} 项</Badge>;
  }
  if (calculation.result?.cr === null) {
    return <Badge className="border border-[#aecfc5] bg-[#dceee9] px-3 py-1 text-[#397d69]">无需一致性检验</Badge>;
  }
  if (calculation.result?.acceptable) {
    return <Badge className="border border-[#aecfc5] bg-[#dceee9] px-3 py-1 text-[#397d69]">通过 · CR {calculation.result.cr?.toFixed(3)}</Badge>;
  }
  return <Badge className="border border-[#e6b7bd] bg-[#f4dfe2] px-3 py-1 text-[#9d4a56]">建议复核 · CR {calculation.result?.cr?.toFixed(3)}</Badge>;
}

function ConsistencyWorkspace({
  calculation,
  onReview,
  onResult,
}: {
  calculation: DecisionCalculation;
  onReview: (scopeId: string) => void;
  onResult: () => void;
}) {
  const inconsistent = calculation.scopes.filter((scope) => scope.result && !scope.result.acceptable);
  const incomplete = calculation.scopes.filter((scope) => scope.missing.length > 0);
  const heading = incomplete.length > 0
    ? `还有 ${calculation.totalCount - calculation.completeCount} 项判断未完成`
    : inconsistent.length > 0
      ? `有 ${inconsistent.length} 组判断值得复核`
      : "判断整体保持一致";

  return (
    <div>
      <WorkspaceHeading eyebrow="第 3 步" title="检查判断的一致性" description="一致性不是考试分数；它帮助你发现前后矛盾，但不会自动替你修改偏好。" />
      <section className="ios-group rounded-2xl p-5 sm:p-7">
        <div className={`rounded-2xl border p-5 sm:p-6 ${incomplete.length > 0 ? "border-[#e8c98f] bg-[#f5ead4]" : inconsistent.length > 0 ? "border-[#e6b7bd] bg-[#f4e2e4]" : "border-[#b8d8ce] bg-[#dfeeea]"}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              {incomplete.length > 0 || inconsistent.length > 0 ? <CircleAlert className="mt-0.5 size-6 shrink-0 text-[#9a6d24]" /> : <CircleCheck className="mt-0.5 size-6 shrink-0 text-[#3f876f]" />}
              <div>
                <h1 className="text-xl font-semibold">{heading}</h1>
                <p className="mt-1 text-sm leading-6 text-[#5f6f87]">
                  {incomplete.length > 0 ? "先补全空白比较，系统才能生成完整排名。" : inconsistent.length > 0 ? "你仍然可以查看结果，但排名可能对少量判断变化较敏感。" : "所有已填写矩阵均达到默认 CR < 0.10 的参考标准。"}
                </p>
              </div>
            </div>
            <Button disabled={!calculation.allComplete} onClick={onResult} className="h-11 rounded-2xl bg-primary px-6 text-white">查看排序结果</Button>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {calculation.scopes.map((scopeCalculation) => {
            const triad = scopeCalculation.matrix && scopeCalculation.result && !scopeCalculation.result.acceptable
              ? worstTriad(scopeCalculation.matrix)
              : null;
            const triadNames = triad?.map((index) => scopeCalculation.scope.items[index].label);
            return (
              <article key={scopeCalculation.scope.id} className="ios-secondary-group rounded-xl p-4 sm:p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{scopeCalculation.scope.label}</h2>
                      <ConsistencyBadge calculation={scopeCalculation} />
                    </div>
                    {triadNames && (
                      <p className="mt-2 text-sm leading-6 text-[#8d4d58]">重点复核：{triadNames.join(" → ")} 之间的判断关系。</p>
                    )}
                    {scopeCalculation.missing.length > 0 && (
                      <p className="mt-2 text-sm text-[#7a6745]">下一项：{scopeCalculation.missing[0][0].label} 与 {scopeCalculation.missing[0][1].label}</p>
                    )}
                    {scopeCalculation.result && (
                      <p className="mt-2 text-xs font-semibold text-muted-foreground">λmax {scopeCalculation.result.lambdaMax.toFixed(3)} · CI {scopeCalculation.result.ci.toFixed(3)}</p>
                    )}
                  </div>
                  <Button variant="ghost" onClick={() => onReview(scopeCalculation.scope.id)} className="rounded-xl text-muted-foreground">返回复核</Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ResultWorkspace({ model, calculation, onCompare }: { model: DecisionModel; calculation: DecisionCalculation; onCompare: () => void }) {
  const baseWeights = calculation.criteriaWeights;
  const localPriorities = calculation.localPriorities;
  const [criterionId, setCriterionId] = useState(model.criteria[0]?.id ?? "");
  const criterionIndex = Math.max(0, model.criteria.findIndex((item) => item.id === criterionId));
  const baseTarget = baseWeights?.[criterionIndex] ?? 0;
  const [targetWeight, setTargetWeight] = useState(baseTarget);

  useEffect(() => {
    if (!model.criteria.some((item) => item.id === criterionId)) setCriterionId(model.criteria[0]?.id ?? "");
  }, [model.criteria, criterionId]);

  useEffect(() => setTargetWeight(baseTarget), [criterionId, baseTarget]);

  if (!baseWeights || !localPriorities || !calculation.ranking) {
    return (
      <section className="ios-group rounded-2xl p-8 text-center">
        <CircleAlert className="mx-auto size-9 text-[#b07b29]" />
        <h1 className="mt-4 text-xl font-semibold">还不能生成完整结果</h1>
        <p className="mt-2 text-muted-foreground">请先补全所有比较判断。</p>
        <Button onClick={onCompare} className="mt-5 rounded-xl bg-primary text-white">继续比较</Button>
      </section>
    );
  }

  const adjustedWeights = reweightCriterion(baseWeights, criterionIndex, targetWeight);
  const adjustedRanking = rankAlternatives(model.alternatives.map((item) => item.id), adjustedWeights, localPriorities);
  const winner = adjustedRanking[0];
  const originalWinner = calculation.ranking[0];
  const winnerChanged = winner.alternativeId !== originalWinner.alternativeId;
  const strongestContributionIndex = winner.contributions.reduce((best, value, index, values) => value > values[best] ? index : best, 0);
  const topScore = adjustedRanking[0]?.score || 1;

  return (
    <div>
      <WorkspaceHeading eyebrow="第 4 步" title="你的决策结果" description="分数是当前准则和判断下的相对优先度，不是成功概率或绝对评分。" />

      <section className="ios-group rounded-2xl p-5 sm:p-7">
        <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="ios-secondary-group rounded-2xl p-5 sm:p-6">
            <div className="mb-6 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-muted-foreground">综合排序</p>
                <h2 className="mt-1 text-xl font-semibold">{winnerChanged ? "敏感性试算排名" : "当前首选方案"}</h2>
              </div>
              {winnerChanged && <Badge className="bg-[#f6e3c4] text-[#8c641f]">排名已变化</Badge>}
            </div>

            <div className="space-y-4">
              {adjustedRanking.map((entry, index) => {
                const label = lookupLabel(model.alternatives, entry.alternativeId);
                return (
                  <div key={entry.alternativeId} className={`rounded-2xl border p-4 ${index === 0 ? "border-[#007aff] bg-[#eaf3ff]" : "border-[#e5e5ea] bg-white"}`}>
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className={`grid size-9 place-items-center rounded-xl font-semibold ${index === 0 ? "bg-primary text-white" : "bg-white text-muted-foreground"}`}>{index + 1}</span>
                        <strong className="text-lg">{label}</strong>
                      </div>
                      <span className="text-lg font-semibold">{(entry.score * 100).toFixed(1)}%</span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-[#e5e5ea]">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(entry.score / topScore) * 100}%`, backgroundColor: chartColors[index % chartColors.length] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-[#e5e5ea] bg-white p-5">
              <p className="text-sm font-bold text-muted-foreground">为什么它排第一？</p>
              <p className="mt-3 text-lg font-semibold leading-8">
                “{lookupLabel(model.alternatives, winner.alternativeId)}”的最大优势来自“{model.criteria[strongestContributionIndex]?.label}”。
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">这一项贡献了总优先度的 {(winner.contributions[strongestContributionIndex] * 100).toFixed(1)} 个百分点。</p>
            </section>

            <section className="rounded-2xl border border-[#e5e5ea] bg-white p-5">
              <p className="mb-4 text-sm font-bold text-muted-foreground">准则权重</p>
              <div className="space-y-3">
                {model.criteria.map((criterion, index) => (
                  <div key={criterion.id}>
                    <div className="mb-1.5 flex justify-between text-sm font-semibold"><span>{criterion.label}</span><span>{(adjustedWeights[index] * 100).toFixed(1)}%</span></div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#e5e5ea]"><div className="h-full rounded-full" style={{ width: `${adjustedWeights[index] * 100}%`, backgroundColor: chartColors[index % chartColors.length] }} /></div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <section className="mt-6 ios-secondary-group rounded-2xl p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-sm font-bold text-muted-foreground">敏感性分析</p>
              <h2 className="mt-1 text-lg font-semibold">调整一个准则，观察排名是否稳定</h2>
            </div>
            <Button variant="ghost" onClick={() => setTargetWeight(baseTarget)} className="rounded-xl text-muted-foreground"><RefreshCw className="size-4" />恢复原权重</Button>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-[230px_1fr_90px] lg:items-center">
            <Select value={model.criteria[criterionIndex]?.id} onValueChange={setCriterionId}>
              <SelectTrigger className="h-11 w-full rounded-xl border-[#e5e5ea] bg-white shadow-none"><SelectValue /></SelectTrigger>
              <SelectContent className="border-[#e5e5ea] bg-popover">
                {model.criteria.map((criterion) => <SelectItem key={criterion.id} value={criterion.id}>{criterion.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Slider
              value={[Math.round(targetWeight * 100)]}
              min={0}
              max={100}
              step={1}
              aria-label={`${model.criteria[criterionIndex]?.label}试算权重`}
              onValueChange={(value) => setTargetWeight(value[0] / 100)}
              className="[&_[data-slot=slider-track]]:h-3 [&_[data-slot=slider-track]]:bg-[#e5e5ea] [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:size-6 [&_[data-slot=slider-thumb]]:border-2"
            />
            <output className="ios-control rounded-xl px-3 py-2 text-center font-semibold text-primary">{Math.round(targetWeight * 100)}%</output>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            原始权重为 {(baseTarget * 100).toFixed(1)}%。其余准则会按原有比例自动缩放；{winnerChanged ? `当前第一名已变为“${lookupLabel(model.alternatives, winner.alternativeId)}”。` : "当前第一名保持不变。"}
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-[#e5e5ea] bg-white p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold">首选方案的贡献明细</h2>
            <Button variant="ghost" onClick={onCompare} className="rounded-xl text-muted-foreground">返回修改判断</Button>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>准则</TableHead><TableHead className="text-right">全局权重</TableHead><TableHead className="text-right">局部优先度</TableHead><TableHead className="text-right">贡献</TableHead></TableRow></TableHeader>
            <TableBody>
              {model.criteria.map((criterion, index) => {
                const alternativeIndex = model.alternatives.findIndex((item) => item.id === winner.alternativeId);
                return (
                  <TableRow key={criterion.id}>
                    <TableCell className="font-semibold">{criterion.label}</TableCell>
                    <TableCell className="text-right">{(adjustedWeights[index] * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{(localPriorities[index][alternativeIndex] * 100).toFixed(1)}%</TableCell>
                    <TableCell className="text-right font-bold text-primary">{(winner.contributions[index] * 100).toFixed(1)}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      </section>
    </div>
  );
}

function SummaryPanel({ model, calculation, onResult }: { model: DecisionModel; calculation: DecisionCalculation; onResult: () => void }) {
  const progress = calculation.totalCount ? (calculation.completeCount / calculation.totalCount) * 100 : 0;
  const worstCr = calculation.scopes.reduce<number | null>((largest, scope) => {
    const cr = scope.result?.cr;
    if (cr === null || cr === undefined) return largest;
    return largest === null ? cr : Math.max(largest, cr);
  }, null);

  return (
    <aside className="hidden space-y-5 xl:block">
      <section className="ios-group rounded-2xl p-5 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-muted-foreground">即时预览</p>
            <h2 className="mt-1 text-lg font-semibold">当前状态</h2>
          </div>
          {worstCr !== null && <Badge className={`${worstCr < 0.1 ? "bg-[#dceee9] text-[#397d69]" : "bg-[#f4dfe2] text-[#9d4a56]"}`}>CR {worstCr.toFixed(2)}</Badge>}
        </div>

        {calculation.ranking ? (
          <div className="space-y-5">
            {calculation.ranking.slice(0, 4).map((entry, index) => (
              <div key={entry.alternativeId}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-bold"><span className="mr-2 text-muted-foreground">{index + 1}</span>{lookupLabel(model.alternatives, entry.alternativeId)}</span>
                  <span className="font-semibold">{(entry.score * 100).toFixed(1)}%</span>
                </div>
                <div className="ios-secondary-group h-2.5 overflow-hidden rounded-full"><div className="h-full rounded-full" style={{ width: `${entry.score * 100}%`, backgroundColor: chartColors[index % chartColors.length] }} /></div>
              </div>
            ))}
            <Button variant="ghost" className="w-full rounded-xl text-muted-foreground" onClick={onResult}>查看完整结果<ChevronRight className="size-4" /></Button>
          </div>
        ) : (
          <div>
            <div className="mb-3 flex justify-between text-sm font-semibold text-muted-foreground"><span>填写进度</span><span>{calculation.completeCount}/{calculation.totalCount}</span></div>
            <Progress value={progress} className="h-2.5 bg-[#e5e5ea] [&_[data-slot=progress-indicator]]:bg-primary" />
            <p className="mt-4 text-sm leading-6 text-muted-foreground">补全所有比较后，这里会出现方案排名。</p>
          </div>
        )}
      </section>

      <section className="ios-group rounded-2xl p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <HardDrive className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <p className="font-semibold">只保存在当前浏览器</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">不会自动同步到其他设备。重要决策建议导出 JSON 备份。</p>
          </div>
        </div>
      </section>
    </aside>
  );
}

function WorkspaceHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mb-5">
      <p className="mb-1 text-sm font-bold text-muted-foreground">{eyebrow}</p>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight sm:text-[32px]">{title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">{description}</p>
    </div>
  );
}
