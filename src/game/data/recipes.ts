import type { Amounts, ProductionRecipe } from '../types.ts';

/**
 * Refinery recipes. Inputs are consumed from station storage when a job starts,
 * outputs are dropped into storage when it finishes.
 */
export const RECIPES: ProductionRecipe[] = [
  {
    id: 'smeltMetal',
    name: 'Плавить руду → металл',
    input: { ore: 20 },
    output: { metal: 10 },
    seconds: 24,
    refineryLevel: 1,
  },
  {
    id: 'crackGas',
    name: 'Крекинг газа → топливо',
    input: { gas: 18 },
    output: { fuel: 12 },
    seconds: 22,
    refineryLevel: 1,
  },
  {
    id: 'refineRare',
    name: 'Очистка редкой руды → электроника',
    input: { rareOre: 10, fuel: 6 },
    output: { electronics: 5 },
    seconds: 30,
    refineryLevel: 2,
  },
  {
    id: 'packFood',
    name: 'Упаковка рационов',
    input: { food: 12, metal: 4 },
    output: { medicine: 3 },
    seconds: 26,
    refineryLevel: 2,
  },
  {
    id: 'buildElectronics',
    name: 'Сборка артефактов',
    input: { electronics: 8, medicine: 4 },
    output: { artifacts: 2 },
    seconds: 40,
    refineryLevel: 3,
  },
];


const RECIPE_MAP: Record<string, ProductionRecipe> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
);

export function recipe(id: string): ProductionRecipe | undefined {
  return RECIPE_MAP[id];
}

export function recipesForLevel(refineryLevel: number): ProductionRecipe[] {
  return RECIPES.filter((r) => r.refineryLevel <= refineryLevel);
}

/** Rough value of a recipe run, used for sorting in the UI. */
export function recipeValue(recipeEntry: ProductionRecipe, prices: Record<string, number>): number {
  let value = 0;
  for (const [id, qty] of Object.entries(recipeEntry.output) as [string, number][]) {
    value += (prices[id] ?? 0) * qty;
  }
  for (const [id, qty] of Object.entries(recipeEntry.input) as [string, number][]) {
    value -= (prices[id] ?? 0) * qty;
  }
  return Math.round(value);
}

export function scaleAmounts(amounts: Amounts, factor: number): Amounts {
  const result: Amounts = {};
  for (const [id, qty] of Object.entries(amounts) as [keyof Amounts, number][]) {
    if (!qty) continue;
    result[id] = Math.max(0, Math.round(qty * factor));
  }
  return result;
}
