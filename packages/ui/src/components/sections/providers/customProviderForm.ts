type ApiKeyInputLike = {
  value?: string | null;
} | null | undefined;

export interface CustomProviderModelRowInput {
  id: string;
  name?: string;
  context?: string | number;
  output?: string | number;
  attachment?: boolean;
  tool_call?: boolean;
  toolCall?: boolean;
  reasoning?: boolean;
  reasoningEffort?: string;
  options?: Record<string, unknown>;
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
    attachment: boolean;
    tool_call: boolean;
    reasoning: boolean;
    reasoningEffort: string;
    options?: Record<string, unknown>;
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
  attachment?: true;
  tool_call?: true;
  reasoning?: true;
  options?: Record<string, unknown>;
  limit?: {
    context?: number;
    output?: number;
  };
}

const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

const trimString = (value: unknown): string => (
  typeof value === 'string' ? value.trim() : ''
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const normalizeReasoningEffort = (value: unknown): string => {
  const normalized = trimString(value).toLowerCase();
  return REASONING_EFFORTS.has(normalized) ? normalized : '';
};

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

const buildModelLimit = (context?: number, output?: number): CustomProviderModelPayload['limit'] => {
  if (!context && !output) {
    return undefined;
  }

  return {
    ...(context ? { context } : {}),
    ...(output ? { output } : {}),
  };
};

const buildModelOptions = (
  optionsInput: unknown,
  reasoningEffortInput: unknown,
): Record<string, unknown> | undefined => {
  const options = isRecord(optionsInput) ? { ...optionsInput } : {};
  const reasoningEffort = normalizeReasoningEffort(
    reasoningEffortInput || options.reasoningEffort || options.reasoning_effort,
  );

  delete options.reasoning_effort;
  if (reasoningEffort) {
    options.reasoningEffort = reasoningEffort;
  } else {
    delete options.reasoningEffort;
  }

  return Object.keys(options).length > 0 ? options : undefined;
};

const buildPreservedEditableModelOptions = (optionsInput: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(optionsInput)) {
    return undefined;
  }

  const options = { ...optionsInput };
  delete options.reasoningEffort;
  delete options.reasoning_effort;
  return Object.keys(options).length > 0 ? options : undefined;
};

const createEmptyEditableModelRow = () => ({
  id: '',
  name: '',
  context: '',
  output: '',
  attachment: false,
  tool_call: false,
  reasoning: false,
  reasoningEffort: '',
});

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
    const limit = buildModelLimit(context, output);
    const options = buildModelOptions(row.options, row.reasoningEffort);

    models.push({
      id,
      ...(name ? { name } : {}),
      ...(row.attachment === true ? { attachment: true } : {}),
      ...(row.tool_call === true || row.toolCall === true ? { tool_call: true } : {}),
      ...(row.reasoning === true ? { reasoning: true } : {}),
      ...(options ? { options } : {}),
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
        .map((model) => {
          const options = buildPreservedEditableModelOptions(model.options);
          return {
            id: trimString(model.id),
            name: trimString(model.name),
            context: normalizePositiveIntegerInputValue(model.context),
            output: normalizePositiveIntegerInputValue(model.output),
            attachment: model.attachment === true,
            tool_call: model.tool_call === true || model.toolCall === true,
            reasoning: model.reasoning === true,
            reasoningEffort: normalizeReasoningEffort(model.reasoningEffort || model.options?.reasoningEffort || model.options?.reasoning_effort),
            ...(options ? { options } : {}),
          };
        })
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
