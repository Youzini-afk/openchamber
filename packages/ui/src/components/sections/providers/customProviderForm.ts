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
  modalities?: {
    input?: string[];
    output?: string[];
  };
  variants?: Record<string, Record<string, unknown>>;
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
    variants?: Record<string, Record<string, unknown>>;
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
  modalities?: {
    input: string[];
    output: string[];
  };
  variants?: Record<string, Record<string, unknown>>;
  limit?: {
    context?: number;
    output?: number;
  };
}

const REASONING_EFFORT_LIST = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const REASONING_EFFORTS = new Set<string>(REASONING_EFFORT_LIST);

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

const containsImageModality = (value: unknown): boolean => {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.some((item) => trimString(item).toLowerCase().includes('image'));
};

const buildModelModalities = (attachment: boolean): CustomProviderModelPayload['modalities'] | undefined => (
  attachment
    ? { input: ['text', 'image'], output: ['text'] }
    : undefined
);

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

const normalizeModelVariants = (value: unknown): Record<string, Record<string, unknown>> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const variants: Record<string, Record<string, unknown>> = {};
  for (const [key, variant] of Object.entries(value)) {
    const variantKey = trimString(key);
    if (!variantKey) {
      continue;
    }
    variants[variantKey] = isRecord(variant) ? { ...variant } : {};
  }

  return Object.keys(variants).length > 0 ? variants : undefined;
};

const hasReasoningVariantConfig = (variants: Record<string, Record<string, unknown>> | undefined): boolean => {
  if (!variants) {
    return false;
  }
  return Object.entries(variants).some(([key, variant]) => (
    REASONING_EFFORTS.has(trimString(key).toLowerCase())
    || normalizeReasoningEffort(variant.reasoningEffort || variant.reasoning_effort).length > 0
  ));
};

const buildModelVariants = (
  row: CustomProviderModelRowInput,
  options: Record<string, unknown> | undefined,
): Record<string, Record<string, unknown>> | undefined => {
  const variants = normalizeModelVariants(row.variants) || {};
  const reasoningEffort = normalizeReasoningEffort(row.reasoningEffort || options?.reasoningEffort || options?.reasoning_effort);
  const shouldExposeReasoningVariants = row.reasoning === true || reasoningEffort.length > 0 || hasReasoningVariantConfig(variants);

  if (!shouldExposeReasoningVariants) {
    return Object.keys(variants).length > 0 ? variants : undefined;
  }

  for (const effort of REASONING_EFFORT_LIST) {
    const existing = isRecord(variants[effort]) ? variants[effort] : {};
    variants[effort] = Object.prototype.hasOwnProperty.call(existing, 'reasoningEffort')
      || Object.prototype.hasOwnProperty.call(existing, 'reasoning_effort')
      ? existing
      : { ...existing, reasoningEffort: effort };
  }

  return variants;
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
    const attachment = row.attachment === true;
    const modalities = buildModelModalities(attachment);
    const variants = buildModelVariants(row, options);

    models.push({
      id,
      ...(name ? { name } : {}),
      ...(attachment ? { attachment: true } : {}),
      ...(row.tool_call === true || row.toolCall === true ? { tool_call: true } : {}),
      ...(row.reasoning === true ? { reasoning: true } : {}),
      ...(modalities ? { modalities } : {}),
      ...(options ? { options } : {}),
      ...(variants ? { variants } : {}),
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
          const variants = normalizeModelVariants(model.variants);
          return {
            id: trimString(model.id),
            name: trimString(model.name),
            context: normalizePositiveIntegerInputValue(model.context),
            output: normalizePositiveIntegerInputValue(model.output),
            attachment: model.attachment === true || containsImageModality(model.modalities?.input),
            tool_call: model.tool_call === true || model.toolCall === true,
            reasoning: model.reasoning === true,
            reasoningEffort: normalizeReasoningEffort(model.reasoningEffort || model.options?.reasoningEffort || model.options?.reasoning_effort),
            ...(options ? { options } : {}),
            ...(variants ? { variants } : {}),
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
