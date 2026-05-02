type ApiKeyInputLike = {
  value?: string | null;
} | null | undefined;

export interface CustomProviderModelRowInput {
  id: string;
  name?: string;
  context?: string | number;
  output?: string | number;
}

interface CustomProviderModelPayload {
  id: string;
  name?: string;
  limit?: {
    context?: number;
    output?: number;
  };
}

const trimString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const normalizePositiveInteger = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
  }

  const normalized = trimString(value).replace(/,/g, '');
  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
};

export const resolveCustomProviderApiKey = (
  controlledValue: string,
  inputElement?: ApiKeyInputLike
): string => {
  const stateValue = trimString(controlledValue);
  if (stateValue) {
    return stateValue;
  }

  return trimString(inputElement?.value);
};

export const normalizeCustomProviderModelRows = (
  rows: CustomProviderModelRowInput[]
): CustomProviderModelPayload[] => {
  const seen = new Set<string>();
  const models: CustomProviderModelPayload[] = [];

  for (const row of rows) {
    const id = trimString(row.id);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const name = trimString(row.name);
    const context = normalizePositiveInteger(row.context);
    const output = normalizePositiveInteger(row.output);
    const limit = context || output ? {
      ...(context ? { context } : {}),
      ...(output ? { output } : {}),
    } : undefined;

    models.push({
      id,
      ...(name ? { name } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  return models;
};
