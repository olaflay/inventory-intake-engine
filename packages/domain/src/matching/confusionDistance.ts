import type { ConfusionPair } from "../types.js";

/**
 * Confusion-weighted edit distance
 * Substitutions matching OCR confusable pairs cost less than 1.0.
 */
export function confusionWeightedDistance(
  s1: string,
  s2: string,
  confusionPairs: ConfusionPair[] = []
): number {
  const m = s1.length;
  const n = s2.length;

  if (m === 0) return n;
  if (n === 0) return m;

  // Lookup map for confusion costs
  const pairCostMap = new Map<string, number>();
  for (const p of confusionPairs) {
    const key1 = `${p.a.toUpperCase()}:${p.b.toUpperCase()}`;
    const key2 = `${p.b.toUpperCase()}:${p.a.toUpperCase()}`;
    pairCostMap.set(key1, p.cost);
    pairCostMap.set(key2, p.cost);
  }

  // 2D DP matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const c1 = s1[i - 1].toUpperCase();
      const c2 = s2[j - 1].toUpperCase();

      if (c1 === c2) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        const pairKey = `${c1}:${c2}`;
        const subCost = pairCostMap.has(pairKey) ? pairCostMap.get(pairKey)! : 1.0;

        dp[i][j] = Math.min(
          dp[i - 1][j] + 1.0,      // Deletion
          dp[i][j - 1] + 1.0,      // Insertion
          dp[i - 1][j - 1] + subCost // Substitution
        );
      }
    }
  }

  return dp[m][n];
}
