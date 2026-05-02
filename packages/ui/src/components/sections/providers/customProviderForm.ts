type ApiKeyInputLike = {
  value?: string | null;
} | null | undefined;

export interface CustomProviderModelRowInput {
  id: string;
  name?: string;
  context?: string | number;
  output?: string | number;
}

export type CustomProviderApiTypeValue = 'openai-compatible' | 'openai-responses' | 'anthropic' | 'google';

export interface CustomProviderEditableFormState {
  type: CustomProviderApiTypeValue;
  id: string;
  name: string;
  baseURL: string;
  models: Array<{
    id: string;
    name: string;
    context: string;
    output: string;
  }>;
  apiKey: string;
  scope: 'user' | 'project' | 'custom';
}

export interface CustomProviderConfigInput {
  id?: string;
  providerId?: string;
  providerID?: string;
  type?: string;
  name?: string;
  baseURL?: string;
  baseUrl?: string;
  scope?: string;
  models?: CustomProviderModelRowInput[];
}

interface ProviderConfigSourceInput {
  exists?: boolean;
}

export interface ProviderSourcesInput {
  auth?: ProviderConfigSourceInput;
  user?: ProviderConfigSourceInput;
  project?: ProviderConfigSourceInput;
  custom?: ProviderConfigSourceInput;
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

const normalizeEditableApiType = (value: unknown): CustomProviderApiTypeValue => {
  const normalized = trimString(value);
  return normalized === 'openai-responses'
    || normalized === 'anthropic'
    || normalized === 'google'
    || normalized === 'openai-compatible'
    ? normalized
    : 'openai-compatible';
};

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

const normalizePositiveIntegerInputValue = (value: unknown): string => {
  const normalized = normalizePositiveInteger(value);
  return normalized ? String(normalized) : '';
};

const createEmptyEditableModelRow = () => ({ id: '', name: '', context: '', output: '' });

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

export const createCustomProviderFormStateFromConfig = (
  config: CustomProviderConfigInput
): CustomProviderEditableFormState => {
  const models = Array.isArray(config.models)
    ? config.models
        .map((model) => ({
          id: trimString(model.id),
          name: trimString(model.name),
          context: normalizePositiveIntegerInputValue(model.context),
          output: normalizePositiveIntegerInputValue(model.output),
        }))
        .filter((model) => model.id.length > 0)
    : [];

  return {
    type: normalizeEditableApiType(config.type),
    id: trimString(config.providerId ?? config.providerID ?? config.id),
    name: trimString(config.name),
    baseURL: trimString(config.baseURL ?? config.baseUrl),
    models: models.length > 0 ? models : [createEmptyEditableModelRow()],
    apiKey: '',
    scope: config.scope === 'custom' ? 'custom' : config.scope === 'project' ? 'project' : 'user',
  };
};

export const hasEditableProviderConfigSource = (sources?: ProviderSourcesInput): boolean => (
  Boolean(sources?.user?.exists || sources?.project?.exists || sources?.custom?.exists)
);
