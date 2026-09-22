import type { ProductionRecipe } from '../types.ts';

/**
 * Refinery recipes. Inputs are consumed from station storage when a job starts,
 * outputs are dropped into storage when it finishes.
 */
export const RECIPES: ProductionRecipe[] = [
  {
    id: 'smeltMetal',
    name: 'Плавить руду → металл',
    input: { ore: 24 },
    output: { metal: 8 },
    seconds: 20,
    refineryLevel: 1,
  },
  {
    id: 'crackGas',
    name: 'Крекинг газа → топливо',
    input: { gas: 20 },
    output: { fuel: 13 },
    seconds: 18,
    refineryLevel: 1,
  },
  {
    id: 'refineRare',
    name: 'Очистка редкой руды → электроника',
    input: { rareOre: 8, fuel: 6 },
    output: { electronics: 5 },
    seconds: 28,
    refineryLevel: 2,
  },
  {
    id: 'packFood',
    name: 'Упаковка рационов',
    input: { food: 12, metal: 3 },
    output: { medicine: 4 },
    seconds: 24,
    refineryLevel: 2,
  },
  {
    id: 'assembleArtifacts',
    name: 'Сборка артефактов',
    input: { electronics: 3, medicine: 2 },
    output: { artifacts: 2 },
    seconds: 44,
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
