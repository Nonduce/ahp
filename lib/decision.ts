import { calculatePriority, type Matrix, type PriorityResult, rankAlternatives } from "@/lib/ahp";

export type DecisionItem = { id: string; label: string };

export type DecisionModel = {
  schemaVersion: 1;
  title: string;
  criteria: DecisionItem[];
  alternatives: DecisionItem[];
  judgments: Record<string, number>;
};

export type ComparisonScope = {
  id: string;
  label: string;
  shortLabel: string;
  items: DecisionItem[];
  kind: "criteria" | "alternatives";
};

export type ScopeCalculation = {
  scope: ComparisonScope;
  matrix: Matrix | null;
  missing: Array<[DecisionItem, DecisionItem]>;
  result: PriorityResult | null;
};

export type DecisionCalculation = {
  scopes: ScopeCalculation[];
  completeCount: number;
  totalCount: number;
  allComplete: boolean;
  criteriaWeights: number[] | null;
  localPriorities: number[][] | null;
  ranking: ReturnType<typeof rankAlternatives> | null;
};

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export function pairKey(scopeId: string, leftId: string, rightId: string) {
  const [first, second] = [leftId, rightId].sort();
  return `${scopeId}::${first}::${second}`;
}

export function getJudgment(model: DecisionModel, scopeId: string, leftId: string, rightId: string) {
  if (leftId === rightId) return 1;
  const [first] = [leftId, rightId].sort();
  const stored = model.judgments[pairKey(scopeId, leftId, rightId)];
  if (stored === undefined) return undefined;
  return leftId === first ? stored : 1 / stored;
}

export function withJudgment(model: DecisionModel, scopeId: string, leftId: string, rightId: string, ratio: number): DecisionModel {
  const [first] = [leftId, rightId].sort();
  const canonicalRatio = leftId === first ? ratio : 1 / ratio;
  return {
    ...model,
    judgments: { ...model.judgments, [pairKey(scopeId, leftId, rightId)]: canonicalRatio },
  };
}

function addJudgment(
  judgments: Record<string, number>,
  scopeId: string,
  leftId: string,
  rightId: string,
  ratio: number,
) {
  const [first] = [leftId, rightId].sort();
  judgments[pairKey(scopeId, leftId, rightId)] = leftId === first ? ratio : 1 / ratio;
}

export function createExampleDecision(): DecisionModel {
  const criteria = [
    { id: "criterion_cost", label: "通勤成本" },
    { id: "criterion_time", label: "通勤时间" },
    { id: "criterion_stability", label: "准时稳定" },
    { id: "criterion_comfort", label: "舒适程度" },
  ];
  const alternatives = [
    { id: "alternative_metro", label: "地铁" },
    { id: "alternative_bike", label: "骑行" },
    { id: "alternative_car", label: "驾车" },
  ];
  const judgments: Record<string, number> = {};

  addJudgment(judgments, "criteria", criteria[0].id, criteria[1].id, 1);
  addJudgment(judgments, "criteria", criteria[0].id, criteria[2].id, 2);
  addJudgment(judgments, "criteria", criteria[0].id, criteria[3].id, 3);
  addJudgment(judgments, "criteria", criteria[1].id, criteria[2].id, 2);
  addJudgment(judgments, "criteria", criteria[1].id, criteria[3].id, 2);
  addJudgment(judgments, "criteria", criteria[2].id, criteria[3].id, 2);

  const [metro, bike, car] = alternatives;
  addJudgment(judgments, `alternatives:${criteria[0].id}`, metro.id, bike.id, 1 / 2);
  addJudgment(judgments, `alternatives:${criteria[0].id}`, metro.id, car.id, 3);
  addJudgment(judgments, `alternatives:${criteria[0].id}`, bike.id, car.id, 5);

  addJudgment(judgments, `alternatives:${criteria[1].id}`, metro.id, bike.id, 2);
  addJudgment(judgments, `alternatives:${criteria[1].id}`, metro.id, car.id, 1 / 2);
  addJudgment(judgments, `alternatives:${criteria[1].id}`, bike.id, car.id, 1 / 3);

  addJudgment(judgments, `alternatives:${criteria[2].id}`, metro.id, bike.id, 3);
  addJudgment(judgments, `alternatives:${criteria[2].id}`, metro.id, car.id, 2);
  addJudgment(judgments, `alternatives:${criteria[2].id}`, bike.id, car.id, 1 / 2);

  addJudgment(judgments, `alternatives:${criteria[3].id}`, metro.id, bike.id, 3);
  addJudgment(judgments, `alternatives:${criteria[3].id}`, metro.id, car.id, 1 / 2);
  addJudgment(judgments, `alternatives:${criteria[3].id}`, bike.id, car.id, 1 / 5);

  return { schemaVersion: 1, title: "选择日常通勤方式", criteria, alternatives, judgments };
}

export function createBlankDecision(): DecisionModel {
  return {
    schemaVersion: 1,
    title: "我的新决策",
    criteria: [
      { id: uid("criterion"), label: "准则 A" },
      { id: uid("criterion"), label: "准则 B" },
    ],
    alternatives: [
      { id: uid("alternative"), label: "方案 A" },
      { id: uid("alternative"), label: "方案 B" },
    ],
    judgments: {},
  };
}

export function getScopes(model: DecisionModel): ComparisonScope[] {
  return [
    { id: "criteria", label: "目标下的准则比较", shortLabel: "准则权重", items: model.criteria, kind: "criteria" },
    ...model.criteria.map((criterion) => ({
      id: `alternatives:${criterion.id}`,
      label: `“${criterion.label}”下的方案比较`,
      shortLabel: criterion.label,
      items: model.alternatives,
      kind: "alternatives" as const,
    })),
  ];
}

export function calculateDecision(model: DecisionModel): DecisionCalculation {
  const scopes = getScopes(model).map((scope): ScopeCalculation => {
    const matrix: Matrix = scope.items.map((rowItem) =>
      scope.items.map((columnItem) => getJudgment(model, scope.id, rowItem.id, columnItem.id) ?? Number.NaN),
    );
    const missing: Array<[DecisionItem, DecisionItem]> = [];
    for (let row = 0; row < scope.items.length; row += 1) {
      for (let column = row + 1; column < scope.items.length; column += 1) {
        if (!Number.isFinite(matrix[row][column])) missing.push([scope.items[row], scope.items[column]]);
      }
    }
    if (missing.length > 0) return { scope, matrix: null, missing, result: null };
    return { scope, matrix, missing, result: calculatePriority(matrix) };
  });

  const totalCount = scopes.reduce((total, scope) => total + (scope.scope.items.length * (scope.scope.items.length - 1)) / 2, 0);
  const missingCount = scopes.reduce((total, scope) => total + scope.missing.length, 0);
  const completeCount = totalCount - missingCount;
  const allComplete = missingCount === 0;

  if (!allComplete) {
    return { scopes, completeCount, totalCount, allComplete, criteriaWeights: null, localPriorities: null, ranking: null };
  }

  const criteriaWeights = scopes[0].result?.weights ?? null;
  const localPriorities = scopes.slice(1).map((scope) => scope.result?.weights ?? []);
  const ranking = criteriaWeights
    ? rankAlternatives(model.alternatives.map((item) => item.id), criteriaWeights, localPriorities)
    : null;

  return { scopes, completeCount, totalCount, allComplete, criteriaWeights, localPriorities, ranking };
}

export function isDecisionModel(value: unknown): value is DecisionModel {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<DecisionModel>;
  if (model.schemaVersion !== 1 || typeof model.title !== "string") return false;
  if (!Array.isArray(model.criteria) || !Array.isArray(model.alternatives)) return false;
  if (model.criteria.length < 2 || model.alternatives.length < 2 || model.criteria.length > 7 || model.alternatives.length > 7) return false;
  const validItems = [...model.criteria, ...model.alternatives].every(
    (item) => item && typeof item.id === "string" && typeof item.label === "string" && item.label.trim().length > 0,
  );
  if (!validItems || !model.judgments || typeof model.judgments !== "object") return false;
  return Object.values(model.judgments).every((ratio) => typeof ratio === "number" && Number.isFinite(ratio) && ratio > 0);
}
