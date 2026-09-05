export type ModelRef = { provider: string; id: string };
export type AvailableModel = ModelRef & { name: string };
export type ModelCatalog = { available: boolean; models: AvailableModel[] };

export function isModelRef(value: unknown): value is ModelRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return Object.keys(model).length === 2 && typeof model.provider === 'string' && !!model.provider.trim()
    && typeof model.id === 'string' && !!model.id.trim();
}
