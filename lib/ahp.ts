export type Matrix = number[][];

export type PriorityResult = {
  weights: number[];
  lambdaMax: number;
  ci: number;
  cr: number | null;
  acceptable: boolean;
  converged: boolean;
};

export type RankedAlternative = {
  alternativeId: string;
  score: number;
  contributions: number[];
};

const RANDOM_INDEX = [0, 0, 0, 0.58, 0.9, 1.12, 1.24, 1.32, 1.41, 1.45, 1.49];

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

export function parseRatio(input: string | number): number {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input <= 0) throw new Error("请输入大于 0 的有限数值");
    return input;
  }

  const value = input.trim().replace("：", ":");
  if (!value) throw new Error("请输入判断值");

  const fraction = value.split("/");
  const colon = value.split(":");
  let parsed: number;

  if (fraction.length === 2) {
    const numerator = Number(fraction[0]);
    const denominator = Number(fraction[1]);
    parsed = numerator / denominator;
  } else if (colon.length === 2) {
    const numerator = Number(colon[0]);
    const denominator = Number(colon[1]);
    parsed = numerator / denominator;
  } else if (fraction.length === 1 && colon.length === 1) {
    parsed = Number(value);
  } else {
    throw new Error("请输入数字、小数或分数，例如 3、0.5、1/3");
  }

  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("判断值必须大于 0");
  return parsed;
}

export function formatRatio(value: number | undefined): string {
  if (value === undefined) return "";
  if (Math.abs(value - 1) < 1e-10) return "1";
  for (let denominator = 2; denominator <= 9; denominator += 1) {
    if (Math.abs(value - 1 / denominator) < 1e-8) return `1/${denominator}`;
  }
  if (Math.abs(value - Math.round(value)) < 1e-8) return String(Math.round(value));
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function assertReciprocalMatrix(matrix: Matrix, tolerance = 1e-7) {
  const n = matrix.length;
  if (n === 0 || matrix.some((row) => row.length !== n)) throw new Error("矩阵必须是非空方阵");

  matrix.forEach((row, i) => {
    row.forEach((value, j) => {
      if (!Number.isFinite(value) || value <= 0) throw new Error(`第 ${i + 1} 行第 ${j + 1} 列必须为正数`);
      if (i === j && Math.abs(value - 1) > tolerance) throw new Error(`第 ${i + 1} 行对角线必须为 1`);
      if (i < j && Math.abs(value * matrix[j][i] - 1) > tolerance) {
        throw new Error(`第 ${i + 1} 行第 ${j + 1} 列与其对称位置不互为倒数`);
      }
    });
  });
}

export function calculatePriority(matrix: Matrix): PriorityResult {
  assertReciprocalMatrix(matrix);
  const n = matrix.length;
  if (n === 1) return { weights: [1], lambdaMax: 1, ci: 0, cr: null, acceptable: true, converged: true };

  let weights = Array(n).fill(1 / n) as number[];
  let converged = false;

  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    const multiplied = matrix.map((row) => row.reduce((total, value, index) => total + value * weights[index], 0));
    const total = sum(multiplied);
    const next = multiplied.map((value) => value / total);
    const delta = next.reduce((distance, value, index) => distance + Math.abs(value - weights[index]), 0);
    weights = next;
    if (delta < 1e-12) {
      converged = true;
      break;
    }
  }

  const multiplied = matrix.map((row) => row.reduce((total, value, index) => total + value * weights[index], 0));
  const lambdaMax = multiplied.reduce((total, value, index) => total + value / weights[index], 0) / n;
  const ci = n <= 2 ? 0 : Math.max(0, (lambdaMax - n) / (n - 1));
  const ri = RANDOM_INDEX[n] ?? (1.98 * (n - 2)) / n;
  const cr = n <= 2 ? null : ci / ri;

  return { weights, lambdaMax, ci, cr, acceptable: cr === null || cr < 0.1, converged };
}

export function rankAlternatives(
  alternativeIds: string[],
  criteriaWeights: number[],
  localPriorities: number[][],
): RankedAlternative[] {
  return alternativeIds
    .map((alternativeId, alternativeIndex) => {
      const contributions = criteriaWeights.map(
        (criterionWeight, criterionIndex) => criterionWeight * localPriorities[criterionIndex][alternativeIndex],
      );
      return { alternativeId, score: sum(contributions), contributions };
    })
    .sort((left, right) => right.score - left.score);
}

export function reweightCriterion(weights: number[], criterionIndex: number, targetWeight: number): number[] {
  if (weights.length === 1) return [1];
  const next = Array(weights.length).fill(0) as number[];
  const otherTotal = 1 - weights[criterionIndex];
  next[criterionIndex] = targetWeight;

  weights.forEach((weight, index) => {
    if (index === criterionIndex) return;
    next[index] = otherTotal > 1e-12 ? (1 - targetWeight) * (weight / otherTotal) : (1 - targetWeight) / (weights.length - 1);
  });

  return next;
}

export function worstTriad(matrix: Matrix): [number, number, number] | null {
  if (matrix.length < 3) return null;
  let result: [number, number, number] | null = null;
  let largestGap = -1;

  for (let i = 0; i < matrix.length - 2; i += 1) {
    for (let j = i + 1; j < matrix.length - 1; j += 1) {
      for (let k = j + 1; k < matrix.length; k += 1) {
        const gap = Math.abs(Math.log((matrix[i][j] * matrix[j][k]) / matrix[i][k]));
        if (gap > largestGap) {
          largestGap = gap;
          result = [i, j, k];
        }
      }
    }
  }

  return result;
}
