import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ProviderLogo } from '@/components/ui/ProviderLogo';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui';
import { RiAddLine, RiCloseLine, RiRefreshLine, RiStackLine, RiToolsLine, RiBrainAi3Line, RiFileImageLine, RiArrowDownSLine, RiCheckLine, RiSearchLine, RiInformationLine, RiEyeLine, RiEyeOffLine, RiEditLine } from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { reloadOpenCodeConfiguration } from '@/stores/useAgentsStore';
import { cn } from '@/lib/utils';
import { copyTextToClipboard } from '@/lib/clipboard';
import { openExternalUrl } from '@/lib/url';
import type { ModelMetadata } from '@/types';
import { useI18n, type I18nKey } from '@/lib/i18n';
import {
  createCustomProviderFormStateFromConfig,
  hasEditableProviderConfigSource,
  mergeCustomProviderModelRows,
  normalizeCustomProviderModelRows,
  resolveCustomProviderApiKey,
} from './customProviderForm';

const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
});

const formatTokens = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return null;
  }
  if (value === 0) {
    return '0';
  }
  const formatted = COMPACT_NUMBER_FORMATTER.format(value);
  return formatted.endsWith('.0') ? formatted.slice(0, -2) : formatted;
};

const ADD_PROVIDER_ID = '__add_provider__';

type CustomProviderApiType = 'openai-compatible' | 'openai-responses' | 'anthropic' | 'google';

interface CustomProviderApiTypeOption {
  value: CustomProviderApiType;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  defaultBaseURL: string;
  baseURLPlaceholder: string;
}

const CUSTOM_PROVIDER_API_TYPES: CustomProviderApiTypeOption[] = [
  {
    value: 'openai-compatible',
    labelKey: 'settings.providers.page.custom.type.openaiCompatible.label',
    descriptionKey: 'settings.providers.page.custom.type.openaiCompatible.description',
    defaultBaseURL: '',
    baseURLPlaceholder: 'https://api.example.com/v1',
  },
  {
    value: 'openai-responses',
    labelKey: 'settings.providers.page.custom.type.openaiResponses.label',
    descriptionKey: 'settings.providers.page.custom.type.openaiResponses.description',
    defaultBaseURL: 'https://api.openai.com/v1',
    baseURLPlaceholder: 'https://api.openai.com/v1',
  },
  {
    value: 'anthropic',
    labelKey: 'settings.providers.page.custom.type.anthropic.label',
    descriptionKey: 'settings.providers.page.custom.type.anthropic.description',
    defaultBaseURL: 'https://api.anthropic.com/v1',
    baseURLPlaceholder: 'https://api.anthropic.com/v1',
  },
  {
    value: 'google',
    labelKey: 'settings.providers.page.custom.type.google.label',
    descriptionKey: 'settings.providers.page.custom.type.google.description',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    baseURLPlaceholder: 'https://generativelanguage.googleapis.com/v1beta',
  },
];

const CUSTOM_PROVIDER_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const CUSTOM_PROVIDER_REASONING_DEFAULT_VALUE = '__default__';

const isCustomProviderApiType = (value: string): value is CustomProviderApiType =>
  CUSTOM_PROVIDER_API_TYPES.some((option) => option.value === value);

const getCustomProviderApiTypeOption = (value: CustomProviderApiType) =>
  CUSTOM_PROVIDER_API_TYPES.find((option) => option.value === value) ?? CUSTOM_PROVIDER_API_TYPES[0];

interface CustomProviderModelRow {
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
}

interface CustomProviderFormState {
  type: CustomProviderApiType;
  id: string;
  name: string;
  baseURL: string;
  models: CustomProviderModelRow[];
  apiKey: string;
  scope: 'user' | 'project' | 'custom';
}

interface CustomProviderModelImportDialogState {
  baseURL: string;
  models: CustomProviderModelRow[];
  selectedIds: string[];
}

const createEmptyCustomProviderModelRow = (): CustomProviderModelRow => ({
  id: '',
  name: '',
  context: '',
  output: '',
  attachment: false,
  tool_call: false,
  reasoning: false,
  reasoningEffort: '',
});

const createEmptyCustomProviderForm = (): CustomProviderFormState => ({
  type: 'openai-compatible',
  id: '',
  name: '',
  baseURL: '',
  models: [createEmptyCustomProviderModelRow()],
  apiKey: '',
  scope: 'user',
});

interface AuthMethod {
  type?: string;
  name?: string;
  label?: string;
  description?: string;
  help?: string;
  method?: number;
  [key: string]: unknown;
}

interface ProviderOption {
  id: string;
  name?: string;
}

interface ProviderSourceInfo {
  exists: boolean;
  path?: string | null;
}

interface ProviderSources {
  auth: ProviderSourceInfo;
  user: ProviderSourceInfo;
  project: ProviderSourceInfo;
  custom?: ProviderSourceInfo;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toTokenLimitInputValue = (value: unknown): string => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? String(Math.floor(value)) : '';
  }

  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().replace(/,/g, '');
  if (!normalized) {
    return '';
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.floor(parsed)) : '';
};

const getFetchedModelLimitInputValue = (entry: Record<string, unknown>, kind: 'context' | 'output'): string => {
  const limit = isRecord(entry.limit) ? entry.limit : {};
  const candidates = kind === 'context'
    ? [
        limit.context,
        entry.context,
        entry.contextWindow,
        entry.context_window,
        entry.contextLength,
        entry.context_length,
        entry.maxContext,
        entry.max_context,
        entry.maxContextLength,
        entry.max_context_length,
        entry.inputTokenLimit,
        entry.input_token_limit,
      ]
    : [
        limit.output,
        entry.output,
        entry.outputTokenLimit,
        entry.output_token_limit,
        entry.maxOutput,
        entry.max_output,
        entry.maxOutputTokens,
        entry.max_output_tokens,
      ];

  for (const candidate of candidates) {
    const normalized = toTokenLimitInputValue(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

const normalizeCustomProviderReasoningEffort = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value.trim().toLowerCase();
  return CUSTOM_PROVIDER_REASONING_EFFORTS.some((effort) => effort === normalized) ? normalized : '';
};

const normalizeAuthType = (method: AuthMethod) => {
  const raw = typeof method.type === 'string' ? method.type : '';
  const label = `${method.name ?? ''} ${method.label ?? ''}`.toLowerCase();
  const merged = `${raw} ${label}`.toLowerCase();
  if (merged.includes('oauth')) return 'oauth';
  if (merged.includes('api')) return 'api';
  return raw.toLowerCase();
};

const parseAuthPayload = (payload: unknown): Record<string, AuthMethod[]> => {
  if (!isRecord(payload)) {
    return {};
  }
  const result: Record<string, AuthMethod[]> = {};
  for (const [providerId, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      result[providerId] = value.filter((entry) => isRecord(entry)) as AuthMethod[];
    }
  }
  return result;
};

const normalizeProviderEntry = (entry: unknown): ProviderOption | null => {
  if (typeof entry === 'string') {
    return { id: entry };
  }
  if (!isRecord(entry)) {
    return null;
  }
  const idCandidate =
    (typeof entry.id === 'string' && entry.id) ||
    (typeof entry.providerID === 'string' && entry.providerID) ||
    (typeof entry.slug === 'string' && entry.slug) ||
    (typeof entry.name === 'string' && entry.name);
  if (!idCandidate) {
    return null;
  }
  const nameCandidate = typeof entry.name === 'string' ? entry.name : undefined;
  return { id: idCandidate, name: nameCandidate };
};

const parseProvidersPayload = (payload: unknown): ProviderOption[] => {
  let entries: unknown[] = [];

  if (Array.isArray(payload)) {
    entries = payload;
  } else if (isRecord(payload)) {
    if (Array.isArray(payload.all)) {
      entries = payload.all;
    } else if (Array.isArray(payload.providers)) {
      entries = payload.providers;
    }
  }

  const mapped = entries
    .map((entry) => normalizeProviderEntry(entry))
    .filter((entry): entry is ProviderOption => Boolean(entry));

  const seen = new Set<string>();
  return mapped.filter((entry) => {
    if (seen.has(entry.id)) {
      return false;
    }
    seen.add(entry.id);
    return true;
  });
};

const getCustomProviderModelRowId = (row: Pick<CustomProviderModelRow, 'id'>): string => row.id.trim();

const getCustomProviderModelIdSet = (rows: Array<Pick<CustomProviderModelRow, 'id'>>): Set<string> => (
  new Set(rows.map(getCustomProviderModelRowId).filter(Boolean))
);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const ProvidersPage: React.FC = () => {
  const { t } = useI18n();
  const providers = useConfigStore((state) => state.providers);
  const selectedProviderId = useConfigStore((state) => state.selectedProviderId);
  const setSelectedProvider = useConfigStore((state) => state.setSelectedProvider);
  const getModelMetadata = useConfigStore((state) => state.getModelMetadata);
  const hiddenModels = useUIStore((state) => state.hiddenModels);
  const toggleHiddenModel = useUIStore((state) => state.toggleHiddenModel);
  const hideAllModels = useUIStore((state) => state.hideAllModels);
  const showAllModels = useUIStore((state) => state.showAllModels);

  const [authMethodsByProvider, setAuthMethodsByProvider] = React.useState<Record<string, AuthMethod[]>>({});
  const [authLoading, setAuthLoading] = React.useState(false);
  const [apiKeyInputs, setApiKeyInputs] = React.useState<Record<string, string>>({});
  const [authBusyKey, setAuthBusyKey] = React.useState<string | null>(null);
  const [modelQuery, setModelQuery] = React.useState('');
  const [pendingOAuth, setPendingOAuth] = React.useState<{ providerId: string; methodIndex: number } | null>(null);
  const [oauthCodes, setOauthCodes] = React.useState<Record<string, string>>({});
  const [oauthDetails, setOauthDetails] = React.useState<Record<string, { url?: string; instructions?: string; userCode?: string }>>({});
  const [availableProviders, setAvailableProviders] = React.useState<ProviderOption[]>([]);
  const [availableLoading, setAvailableLoading] = React.useState(false);
  const [availableError, setAvailableError] = React.useState<string | null>(null);
  const [candidateProviderId, setCandidateProviderId] = React.useState('');
  const [providerSearchQuery, setProviderSearchQuery] = React.useState('');
  const [providerDropdownOpen, setProviderDropdownOpen] = React.useState(false);
  const [providerSources, setProviderSources] = React.useState<Record<string, ProviderSources>>({});
  const [showAuthPanel, setShowAuthPanel] = React.useState(false);
  const [isCustomProviderMode, setIsCustomProviderMode] = React.useState(false);
  const [customProviderForm, setCustomProviderForm] = React.useState<CustomProviderFormState>(() => createEmptyCustomProviderForm());
  const [customProviderBusy, setCustomProviderBusy] = React.useState(false);
  const [customProviderFetchingModels, setCustomProviderFetchingModels] = React.useState(false);
  const [customProviderModelImportDialog, setCustomProviderModelImportDialog] =
    React.useState<CustomProviderModelImportDialogState | null>(null);
  const [editingCustomProviderId, setEditingCustomProviderId] = React.useState<string | null>(null);
  const [customProviderEditLoading, setCustomProviderEditLoading] = React.useState(false);
  const customProviderApiKeyInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (!selectedProviderId && providers.length > 0) {
      setSelectedProvider(providers[0].id);
    }
  }, [providers, selectedProviderId, setSelectedProvider]);

  React.useEffect(() => {
    let isMounted = true;

    const loadAuthMethods = async () => {
      setAuthLoading(true);
      try {
        const response = await fetch('/api/provider/auth', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Auth methods request failed (${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        if (!isMounted) return;
        setAuthMethodsByProvider(parseAuthPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load provider auth methods:', error);
        toast.error(t('settings.providers.page.toast.authMethodsLoadFailed'));
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };

    loadAuthMethods();

    return () => {
      isMounted = false;
    };
  }, [t]);

  React.useEffect(() => {
    let isMounted = true;

    const loadAvailableProviders = async () => {
      setAvailableLoading(true);
      setAvailableError(null);
      try {
        const response = await fetch('/api/provider', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Provider list request failed (${response.status})`);
        }

        const payload = await response.json().catch(() => ({}));
        if (!isMounted) return;
        setAvailableProviders(parseProvidersPayload(payload));
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to load available providers:', error);
        setAvailableError(t('settings.providers.page.state.unableToLoadProviderList'));
      } finally {
        if (isMounted) {
          setAvailableLoading(false);
        }
      }
    };

    loadAvailableProviders();

    return () => {
      isMounted = false;
    };
  }, [t]);

  const connectedProviderIds = React.useMemo(
    () => new Set(providers.map((provider) => provider.id)),
    [providers]
  );

  const unconnectedProviders = React.useMemo(
    () =>
      availableProviders
        .filter((provider) => !connectedProviderIds.has(provider.id))
        .sort((a, b) => {
          const labelA = (a.name || a.id).toLowerCase();
          const labelB = (b.name || b.id).toLowerCase();
          return labelA.localeCompare(labelB);
        }),
    [availableProviders, connectedProviderIds]
  );

  React.useEffect(() => {
    if (selectedProviderId !== ADD_PROVIDER_ID) {
      return;
    }

    if (candidateProviderId && !unconnectedProviders.some((provider) => provider.id === candidateProviderId)) {
      setCandidateProviderId('');
    }
  }, [selectedProviderId, candidateProviderId, unconnectedProviders]);

  React.useEffect(() => {
    if (selectedProviderId === ADD_PROVIDER_ID) {
      setShowAuthPanel(true);
      return;
    }

    setShowAuthPanel(false);
    setEditingCustomProviderId(null);
  }, [selectedProviderId, t]);

  React.useEffect(() => {
    if (!selectedProviderId || selectedProviderId === ADD_PROVIDER_ID) {
      return;
    }

    let cancelled = false;

    const loadSources = async () => {
      try {
        const response = await fetch(`/api/provider/${encodeURIComponent(selectedProviderId)}/source`, {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error || t('settings.providers.page.toast.providerSourcesLoadFailed'));
        }

        const sources = (payload?.sources ?? payload?.data?.sources) as ProviderSources | undefined;
        if (!cancelled && sources) {
          setProviderSources((prev) => ({
            ...prev,
            [selectedProviderId]: sources,
          }));
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider sources:', error);
        }
      }
    };

    loadSources();

    return () => {
      cancelled = true;
    };
  }, [selectedProviderId, t]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId);
  const selectedSources = selectedProviderId ? providerSources[selectedProviderId] : undefined;
  const canEditSelectedProvider = hasEditableProviderConfigSource(selectedSources);

  const handleSaveApiKey = async (providerId: string) => {
    const apiKey = apiKeyInputs[providerId]?.trim() ?? '';
    if (!apiKey) {
      toast.error(t('settings.providers.page.toast.apiKeyRequired'));
      return;
    }

    const busyKey = `api:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(`/api/auth/${encodeURIComponent(providerId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', key: apiKey }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || t('settings.providers.page.toast.apiKeySaveFailed');
        throw new Error(message);
      }

      toast.success(t('settings.providers.page.toast.apiKeySaved'));
      setApiKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
      setSelectedProvider(providerId);
    } catch (error) {
      console.error('Failed to save API key:', error);
      toast.error(t('settings.providers.page.toast.apiKeySaveFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleOAuthStart = async (providerId: string, methodIndex: number) => {
    const busyKey = `oauth:${providerId}:${methodIndex}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/oauth/authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: methodIndex }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || t('settings.providers.page.toast.oauthStartFailed');
        throw new Error(message);
      }

      const payloadRecord = isRecord(payload) ? payload : {};
      const dataRecord = isRecord(payloadRecord.data) ? payloadRecord.data : payloadRecord;
      const urlCandidate =
        (typeof dataRecord.url === 'string' && dataRecord.url) ||
        (typeof dataRecord.verification_uri_complete === 'string' && dataRecord.verification_uri_complete) ||
        (typeof dataRecord.verification_uri === 'string' && dataRecord.verification_uri) ||
        undefined;
      const instructions =
        (typeof dataRecord.instructions === 'string' && dataRecord.instructions) ||
        (typeof dataRecord.message === 'string' && dataRecord.message) ||
        undefined;
      const userCode =
        (typeof dataRecord.user_code === 'string' && dataRecord.user_code) ||
        (typeof dataRecord.code === 'string' && dataRecord.code) ||
        (typeof dataRecord.userCode === 'string' && dataRecord.userCode) ||
        undefined;

      if (!urlCandidate && !instructions && !userCode) {
        throw new Error(t('settings.providers.page.toast.oauthDetailsMissing'));
      }

      const detailsKey = `${providerId}:${methodIndex}`;
      setOauthDetails((prev) => ({
        ...prev,
        [detailsKey]: {
          url: urlCandidate,
          instructions,
          userCode,
        },
      }));

      if (urlCandidate) {
        void openExternalUrl(urlCandidate);
      }
      setPendingOAuth({ providerId, methodIndex });
      toast.message(t('settings.providers.page.toast.completeOAuthInBrowser'));
    } catch (error) {
      console.error('Failed to start OAuth flow:', error);
      toast.error(t('settings.providers.page.toast.oauthStartFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleOAuthComplete = async (providerId: string, methodIndex: number) => {
    const codeKey = `${providerId}:${methodIndex}`;
    const code = oauthCodes[codeKey]?.trim();

    const busyKey = `oauth-complete:${providerId}:${methodIndex}`;
    setAuthBusyKey(busyKey);

    try {
      const requestBody: { method: number; code?: string } = { method: methodIndex };
      if (code) {
        requestBody.code = code;
      }

      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/oauth/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const responsePayload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = responsePayload?.error || t('settings.providers.page.toast.oauthCompleteFailed');
        throw new Error(message);
      }

      toast.success(t('settings.providers.page.toast.oauthCompleted'));
      setOauthCodes((prev) => ({ ...prev, [codeKey]: '' }));
      setPendingOAuth(null);
      await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
      setSelectedProvider(providerId);
    } catch (error) {
      console.error('Failed to complete OAuth flow:', error);
      toast.error(t('settings.providers.page.toast.oauthCompleteFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const handleCopyOAuthLink = async (url: string) => {
    const result = await copyTextToClipboard(url);
    if (result.ok) {
      toast.success(t('settings.providers.page.toast.oauthLinkCopied'));
      return;
    }
    console.error('Failed to copy OAuth link:', result.error);
    toast.error(t('settings.providers.page.toast.oauthLinkCopyFailed'));
  };

  const handleCopyOAuthCode = async (code: string) => {
    const result = await copyTextToClipboard(code);
    if (result.ok) {
      toast.success(t('settings.providers.page.toast.deviceCodeCopied'));
      return;
    }
    console.error('Failed to copy device code:', result.error);
    toast.error(t('settings.providers.page.toast.deviceCodeCopyFailed'));
  };

  const handleEditCustomProvider = async (providerId: string) => {
    setCustomProviderEditLoading(true);
    try {
      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/config`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : t('settings.providers.page.toast.customProviderLoadFailed');
        throw new Error(message);
      }

      const config = isRecord(payload) && isRecord(payload.config) ? payload.config : null;
      if (!config) {
        throw new Error(t('settings.providers.page.toast.customProviderConfigUnavailable'));
      }

      setCustomProviderForm(createCustomProviderFormStateFromConfig(config));
      setEditingCustomProviderId(providerId);
      setIsCustomProviderMode(false);
      setShowAuthPanel(false);
      setModelQuery('');
    } catch (error) {
      console.error('Failed to load custom provider config:', error);
      toast.error(error instanceof Error ? error.message : t('settings.providers.page.toast.customProviderLoadFailed'));
    } finally {
      setCustomProviderEditLoading(false);
    }
  };

  const handleDisconnectProvider = async (providerId: string) => {
    const busyKey = `disconnect:${providerId}`;
    setAuthBusyKey(busyKey);

    try {
      const response = await fetch(`/api/provider/${encodeURIComponent(providerId)}/auth?scope=all`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = payload?.error || t('settings.providers.page.toast.providerDisconnectFailed');
        throw new Error(message);
      }

      toast.success(t('settings.providers.page.toast.providerDisconnected'));
      await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
    } catch (error) {
      console.error('Failed to disconnect provider:', error);
      toast.error(t('settings.providers.page.toast.providerDisconnectFailed'));
    } finally {
      setAuthBusyKey(null);
    }
  };

  const updateCustomProviderField = <K extends keyof CustomProviderFormState>(
    key: K,
    value: CustomProviderFormState[K]
  ) => {
    setCustomProviderForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateCustomProviderType = (type: CustomProviderApiType) => {
    setCustomProviderForm((prev) => {
      const previousOption = getCustomProviderApiTypeOption(prev.type);
      const nextOption = getCustomProviderApiTypeOption(type);
      const currentBaseURL = prev.baseURL.trim();
      const shouldReplaceBaseURL =
        !currentBaseURL ||
        (previousOption.defaultBaseURL.length > 0 && currentBaseURL === previousOption.defaultBaseURL);

      return {
        ...prev,
        type,
        baseURL: shouldReplaceBaseURL ? nextOption.defaultBaseURL : prev.baseURL,
      };
    });
  };

  const updateCustomProviderModelRow = (
    index: number,
    key: keyof CustomProviderModelRow,
    value: string | boolean
  ) => {
    setCustomProviderForm((prev) => ({
      ...prev,
      models: prev.models.map((row, rowIndex) => (
        rowIndex === index ? { ...row, [key]: value } : row
      )),
    }));
  };

  const addCustomProviderModelRow = () => {
    setCustomProviderForm((prev) => ({
      ...prev,
      models: [...prev.models, createEmptyCustomProviderModelRow()],
    }));
  };

  const removeCustomProviderModelRow = (index: number) => {
    setCustomProviderForm((prev) => {
      if (prev.models.length <= 1) {
        return {
          ...prev,
          models: [createEmptyCustomProviderModelRow()],
        };
      }

      return {
        ...prev,
        models: prev.models.filter((_, rowIndex) => rowIndex !== index),
      };
    });
  };

  const handleFetchCustomProviderModels = async () => {
    const typeOption = getCustomProviderApiTypeOption(customProviderForm.type);
    const baseURL = customProviderForm.baseURL.trim() || typeOption.defaultBaseURL;
    const apiKey = resolveCustomProviderApiKey(customProviderForm.apiKey, customProviderApiKeyInputRef.current);

    if (!baseURL || !apiKey) {
      toast.error(t('settings.providers.page.toast.customProviderFetchRequired'));
      return;
    }

    setCustomProviderFetchingModels(true);
    try {
      const response = await fetch('/api/provider/custom/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          type: customProviderForm.type,
          baseURL,
          apiKey,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : t('settings.providers.page.toast.customProviderFetchFailed');
        throw new Error(message);
      }

      const fetchedModels = isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
            .map((entry) => {
              if (!isRecord(entry) || typeof entry.id !== 'string') {
                return null;
              }
              const id = entry.id.trim();
              if (!id) {
                return null;
              }
              const name = typeof entry.name === 'string' ? entry.name.trim() : id;
              const options = isRecord(entry.options) ? { ...entry.options } : undefined;
              const reasoningEffort = normalizeCustomProviderReasoningEffort(
                entry.reasoningEffort || entry.reasoning_effort || options?.reasoningEffort || options?.reasoning_effort,
              );
              const variants = isRecord(entry.variants)
                ? Object.fromEntries(
                    Object.entries(entry.variants).map(([key, value]) => [key, isRecord(value) ? { ...value } : {}]),
                  )
                : undefined;
              return {
                id,
                name: name || id,
                context: getFetchedModelLimitInputValue(entry, 'context'),
                output: getFetchedModelLimitInputValue(entry, 'output'),
                attachment: entry.attachment === true,
                tool_call: entry.tool_call === true,
                reasoning: entry.reasoning === true,
                reasoningEffort,
                ...(options ? { options } : {}),
                ...(variants ? { variants } : {}),
              };
            })
            .filter((entry): entry is CustomProviderModelRow => Boolean(entry))
        : [];

      if (fetchedModels.length === 0) {
        throw new Error(t('settings.providers.page.toast.customProviderFetchNoModels'));
      }

      const uniqueFetchedModels = Array.from(
        new Map(fetchedModels.map((model) => [getCustomProviderModelRowId(model), model])).values()
      );
      const existingModelIds = getCustomProviderModelIdSet(customProviderForm.models);
      const defaultSelectedIds = uniqueFetchedModels
        .map(getCustomProviderModelRowId)
        .filter((id) => id && !existingModelIds.has(id));
      const resolvedBaseURL = isRecord(payload) && typeof payload.baseURL === 'string'
        ? payload.baseURL
        : baseURL;

      setCustomProviderForm((prev) => ({
        ...prev,
        baseURL: resolvedBaseURL,
      }));
      setCustomProviderModelImportDialog({
        baseURL: resolvedBaseURL,
        models: uniqueFetchedModels,
        selectedIds: defaultSelectedIds,
      });
      toast.success(t('settings.providers.page.toast.customProviderModelsFetched', { count: uniqueFetchedModels.length }));
    } catch (error) {
      console.error('Failed to fetch custom provider models:', error);
      toast.error(error instanceof Error ? error.message : t('settings.providers.page.toast.customProviderFetchFailed'));
    } finally {
      setCustomProviderFetchingModels(false);
    }
  };

  const toggleCustomProviderImportModel = (modelId: string, checked: boolean) => {
    setCustomProviderModelImportDialog((prev) => {
      if (!prev) {
        return prev;
      }
      const selected = new Set(prev.selectedIds);
      if (checked) {
        selected.add(modelId);
      } else {
        selected.delete(modelId);
      }
      return { ...prev, selectedIds: Array.from(selected) };
    });
  };

  const selectAllCustomProviderImportModels = () => {
    setCustomProviderModelImportDialog((prev) => (
      prev ? { ...prev, selectedIds: prev.models.map(getCustomProviderModelRowId).filter(Boolean) } : prev
    ));
  };

  const selectNewCustomProviderImportModels = () => {
    const existingModelIds = getCustomProviderModelIdSet(customProviderForm.models);
    setCustomProviderModelImportDialog((prev) => (
      prev
        ? {
            ...prev,
            selectedIds: prev.models
              .map(getCustomProviderModelRowId)
              .filter((id) => id && !existingModelIds.has(id)),
          }
        : prev
    ));
  };

  const clearCustomProviderImportSelection = () => {
    setCustomProviderModelImportDialog((prev) => (prev ? { ...prev, selectedIds: [] } : prev));
  };

  const applyCustomProviderImportedModels = () => {
    const dialog = customProviderModelImportDialog;
    if (!dialog) {
      return;
    }

    const selectedIds = new Set(dialog.selectedIds);
    const selectedModels = dialog.models.filter((model) => selectedIds.has(getCustomProviderModelRowId(model)));
    if (selectedModels.length === 0) {
      return;
    }

    setCustomProviderForm((prev) => ({
      ...prev,
      baseURL: dialog.baseURL,
      models: mergeCustomProviderModelRows(prev.models, selectedModels),
    }));
    setCustomProviderModelImportDialog(null);
    toast.success(t('settings.providers.page.toast.customProviderModelsImported', { count: selectedModels.length }));
  };

  const handleCreateCustomProvider = async () => {
    const providerId = customProviderForm.id.trim();
    const baseURL = customProviderForm.baseURL.trim();
    const models = normalizeCustomProviderModelRows(customProviderForm.models);
    const apiKey = resolveCustomProviderApiKey(customProviderForm.apiKey, customProviderApiKeyInputRef.current);

    if (!providerId || !baseURL || models.length === 0) {
      toast.error(t('settings.providers.page.toast.customProviderRequired'));
      return;
    }

    setCustomProviderBusy(true);
    try {
      const response = await fetch('/api/provider/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          type: customProviderForm.type,
          id: providerId,
          name: customProviderForm.name.trim(),
          baseURL,
          models,
          scope: customProviderForm.scope,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : t('settings.providers.page.toast.customProviderSaveFailed');
        throw new Error(message);
      }

      const reloadDelayMs = isRecord(payload) && typeof payload.reloadDelayMs === 'number'
        ? payload.reloadDelayMs
        : 800;
      await wait(reloadDelayMs);

      if (apiKey) {
        const authResponse = await fetch(`/api/auth/${encodeURIComponent(providerId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'api', key: apiKey }),
        });
        if (!authResponse.ok) {
          throw new Error(t('settings.providers.page.toast.apiKeySaveFailed'));
        }
      }

      await reloadOpenCodeConfiguration({ scopes: ["providers"], mode: "active" });
      const savedProviderVisible = useConfigStore.getState().providers.some((provider) => provider.id === providerId);
      if (!savedProviderVisible) {
        toast.warning(t('settings.providers.page.toast.customProviderSavedButNotListed'));
        return;
      }

      setSelectedProvider(providerId);
      setCandidateProviderId('');
      setIsCustomProviderMode(false);
      setEditingCustomProviderId(null);
      setCustomProviderForm(createEmptyCustomProviderForm());
      toast.success(t('settings.providers.page.toast.customProviderSaved'));
    } catch (error) {
      console.error('Failed to save custom provider:', error);
      toast.error(error instanceof Error ? error.message : t('settings.providers.page.toast.customProviderSaveFailed'));
    } finally {
      setCustomProviderBusy(false);
    }
  };

  const isAddMode = selectedProviderId === ADD_PROVIDER_ID;
  const customProviderTypeOption = getCustomProviderApiTypeOption(customProviderForm.type);
  const isEditingCustomProvider = Boolean(editingCustomProviderId);
  const customProviderModelImportExistingIds = React.useMemo(
    () => getCustomProviderModelIdSet(customProviderForm.models),
    [customProviderForm.models]
  );
  const customProviderImportSelectedIds = React.useMemo(
    () => new Set(customProviderModelImportDialog?.selectedIds ?? []),
    [customProviderModelImportDialog?.selectedIds]
  );
  const customProviderImportNewCount = customProviderModelImportDialog
    ? customProviderModelImportDialog.models.filter((model) => !customProviderModelImportExistingIds.has(getCustomProviderModelRowId(model))).length
    : 0;
  const customProviderImportExistingCount = customProviderModelImportDialog
    ? customProviderModelImportDialog.models.length - customProviderImportNewCount
    : 0;
  const customProviderImportSelectedCount = customProviderModelImportDialog?.selectedIds.length ?? 0;
  const customProviderModelImportDialogElement = (
    <Dialog
      open={Boolean(customProviderModelImportDialog)}
      onOpenChange={(open) => {
        if (!open) {
          setCustomProviderModelImportDialog(null);
        }
      }}
    >
      <DialogContent className="flex h-[min(720px,calc(100vh-2rem))] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 py-4">
          <DialogTitle>{t('settings.providers.page.modelImport.title')}</DialogTitle>
          <DialogDescription>
            {t('settings.providers.page.modelImport.description')}
          </DialogDescription>
        </DialogHeader>

        {customProviderModelImportDialog ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-5 py-3">
              <div className="typography-meta text-muted-foreground">
                {t('settings.providers.page.modelImport.summary', {
                  total: customProviderModelImportDialog.models.length,
                  newCount: customProviderImportNewCount,
                  existingCount: customProviderImportExistingCount,
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="ghost" size="xs" onClick={selectNewCustomProviderImportModels}>
                  {t('settings.providers.page.modelImport.actions.selectNew')}
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={selectAllCustomProviderImportModels}>
                  {t('settings.providers.page.modelImport.actions.selectAll')}
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={clearCustomProviderImportSelection}>
                  {t('settings.providers.page.modelImport.actions.clear')}
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="space-y-1">
                {customProviderModelImportDialog.models.map((model) => {
                  const modelId = getCustomProviderModelRowId(model);
                  const isSelected = customProviderImportSelectedIds.has(modelId);
                  const alreadyExists = customProviderModelImportExistingIds.has(modelId);
                  const contextLabel = model.context ? formatTokens(Number(model.context)) : null;
                  const outputLabel = model.output ? formatTokens(Number(model.output)) : null;
                  return (
                    <label
                      key={modelId}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border border-border/60 px-3 py-2 transition-colors hover:bg-interactive-hover/40',
                        isSelected && 'border-primary/50 bg-primary/5'
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onChange={(checked) => toggleCustomProviderImportModel(modelId, checked)}
                        ariaLabel={model.name || modelId}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate typography-ui-label font-medium text-foreground">{model.name || modelId}</span>
                          <span className="rounded-full border border-border/60 px-1.5 py-0.5 typography-micro text-muted-foreground">
                            {alreadyExists
                              ? t('settings.providers.page.modelImport.badge.existing')
                              : t('settings.providers.page.modelImport.badge.new')}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate font-mono typography-micro text-muted-foreground">{modelId}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 typography-micro text-muted-foreground">
                          {contextLabel ? <span>{contextLabel} {t('settings.providers.page.models.tokenBadge.context')}</span> : null}
                          {outputLabel ? <span>{outputLabel} {t('settings.providers.page.models.tokenBadge.output')}</span> : null}
                          {model.attachment ? <span>{t('settings.providers.page.models.capability.imageInput')}</span> : null}
                          {model.tool_call ? <span>{t('settings.providers.page.models.capability.toolCalling')}</span> : null}
                          {model.reasoning ? <span>{t('settings.providers.page.models.capability.reasoning')}</span> : null}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="border-t border-border/60 px-5 py-4">
              <Button type="button" variant="ghost" size="xs" onClick={() => setCustomProviderModelImportDialog(null)}>
                {t('settings.providers.page.actions.cancel')}
              </Button>
              <Button
                type="button"
                size="xs"
                onClick={applyCustomProviderImportedModels}
                disabled={customProviderImportSelectedCount === 0}
              >
                {t('settings.providers.page.modelImport.actions.apply', { count: customProviderImportSelectedCount })}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
  const customProviderFormSection = (
    <div className="mb-8">
      <div className="mb-1 px-1">
        <h2 className="typography-ui-header font-medium text-foreground">
          {isEditingCustomProvider ? t('settings.providers.page.custom.editTitle') : t('settings.providers.page.custom.title')}
        </h2>
      </div>

      <section className="px-2 pb-2 pt-0 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="space-y-1.5">
            <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.id')}</span>
            <Input
              value={customProviderForm.id}
              onChange={(event) => updateCustomProviderField('id', event.target.value)}
              placeholder={t('settings.providers.page.custom.placeholder.id')}
              className="font-mono text-xs"
              disabled={isEditingCustomProvider}
            />
          </label>
          <label className="space-y-1.5">
            <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.name')}</span>
            <Input
              value={customProviderForm.name}
              onChange={(event) => updateCustomProviderField('name', event.target.value)}
              placeholder={t('settings.providers.page.custom.placeholder.name')}
            />
          </label>
        </div>

        <div className="space-y-1.5">
          <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.type')}</span>
          <Select
            value={customProviderForm.type}
            onValueChange={(value) => {
              if (isCustomProviderApiType(value)) {
                updateCustomProviderType(value);
              }
            }}
          >
            <SelectTrigger size="lg" className="w-full justify-between normal-case">
              <SelectValue>{t(customProviderTypeOption.labelKey)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="max-w-[min(28rem,calc(100vw-2rem))]">
              {CUSTOM_PROVIDER_API_TYPES.map((option) => (
                <SelectItem key={option.value} value={option.value} className="py-2">
                  <span className="flex min-w-0 flex-col items-start gap-0.5">
                    <span className="typography-ui-label text-foreground">{t(option.labelKey)}</span>
                    <span className="typography-meta whitespace-normal text-muted-foreground">{t(option.descriptionKey)}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="block space-y-1.5">
          <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.baseURL')}</span>
          <Input
            value={customProviderForm.baseURL}
            onChange={(event) => updateCustomProviderField('baseURL', event.target.value)}
            placeholder={customProviderTypeOption.baseURLPlaceholder}
            className="font-mono text-xs"
          />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 sm:items-end">
          <label className="space-y-1.5">
            <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.apiKey')}</span>
            <Input
              ref={customProviderApiKeyInputRef}
              type="password"
              value={customProviderForm.apiKey}
              onChange={(event) => updateCustomProviderField('apiKey', event.target.value)}
              placeholder={t('settings.providers.page.custom.placeholder.apiKey')}
              className="font-mono text-xs"
            />
          </label>

          <div className="space-y-1.5">
            <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.scope')}</span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="chip"
                size="xs"
                aria-pressed={customProviderForm.scope === 'user'}
                onClick={() => updateCustomProviderField('scope', 'user')}
                disabled={isEditingCustomProvider || customProviderForm.scope === 'custom'}
              >
                {t('settings.providers.page.custom.scope.user')}
              </Button>
              <Button
                type="button"
                variant="chip"
                size="xs"
                aria-pressed={customProviderForm.scope === 'project'}
                onClick={() => updateCustomProviderField('scope', 'project')}
                disabled={isEditingCustomProvider || customProviderForm.scope === 'custom'}
              >
                {t('settings.providers.page.custom.scope.project')}
              </Button>
              {customProviderForm.scope === 'custom' && (
                <Button
                  type="button"
                  variant="chip"
                  size="xs"
                  aria-pressed
                  disabled
                >
                  {t('settings.providers.page.custom.scope.custom')}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <span className="typography-ui-label text-foreground">{t('settings.providers.page.custom.field.models')}</span>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={handleFetchCustomProviderModels}
                disabled={customProviderBusy || customProviderFetchingModels}
              >
                <RiRefreshLine className={cn('h-3.5 w-3.5', customProviderFetchingModels && 'animate-spin')} />
                {customProviderFetchingModels
                  ? t('settings.providers.page.actions.fetchingModels')
                  : t('settings.providers.page.actions.fetchModels')}
              </Button>
              <Button
                type="button"
                variant="chip"
                size="xs"
                className="!font-normal"
                onClick={addCustomProviderModelRow}
              >
                <RiAddLine className="h-3.5 w-3.5" />
                {t('settings.providers.page.actions.addModel')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {customProviderForm.models.map((row, index) => (
              <div
                key={index}
                className="space-y-2 rounded-md border border-border/60 p-2"
              >
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(5.5rem,0.65fr)_minmax(5.5rem,0.65fr)_auto] sm:items-center">
                  <Input
                    value={row.id}
                    onChange={(event) => updateCustomProviderModelRow(index, 'id', event.target.value)}
                    placeholder={t('settings.providers.page.custom.placeholder.modelId')}
                    className="font-mono text-xs"
                  />
                  <Input
                    value={row.name}
                    onChange={(event) => updateCustomProviderModelRow(index, 'name', event.target.value)}
                    placeholder={t('settings.providers.page.custom.placeholder.modelName')}
                    className="font-mono text-xs"
                  />
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={row.context}
                    onChange={(event) => updateCustomProviderModelRow(index, 'context', event.target.value)}
                    placeholder={t('settings.providers.page.custom.placeholder.contextLimit')}
                    className="font-mono text-xs"
                  />
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={row.output}
                    onChange={(event) => updateCustomProviderModelRow(index, 'output', event.target.value)}
                    placeholder={t('settings.providers.page.custom.placeholder.outputLimit')}
                    className="font-mono text-xs"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-8 w-8 px-0"
                        onClick={() => removeCustomProviderModelRow(index)}
                        disabled={customProviderForm.models.length <= 1}
                        aria-label={t('settings.providers.page.actions.removeModel')}
                      >
                        <RiCloseLine className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={8}>
                      {t('settings.providers.page.actions.removeModel')}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {[
                    ['attachment', t('settings.providers.page.models.capability.imageInput')],
                    ['tool_call', t('settings.providers.page.models.capability.toolCalling')],
                    ['reasoning', t('settings.providers.page.models.capability.reasoning')],
                  ].map(([key, label]) => (
                    <label key={key} className="flex h-8 items-center gap-2 rounded-md border border-border/60 px-2 typography-micro text-muted-foreground">
                      <Checkbox
                        checked={Boolean(row[key as keyof Pick<CustomProviderModelRow, 'attachment' | 'tool_call' | 'reasoning'>])}
                        onChange={(checked) => updateCustomProviderModelRow(index, key as keyof CustomProviderModelRow, checked)}
                        ariaLabel={label}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  ))}

                  <Select
                    value={row.reasoningEffort || CUSTOM_PROVIDER_REASONING_DEFAULT_VALUE}
                    onValueChange={(value) => updateCustomProviderModelRow(
                      index,
                      'reasoningEffort',
                      value === CUSTOM_PROVIDER_REASONING_DEFAULT_VALUE ? '' : value,
                    )}
                  >
                    <SelectTrigger className="h-8 min-w-[10rem] justify-between">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CUSTOM_PROVIDER_REASONING_DEFAULT_VALUE}>
                        {t('settings.providers.page.custom.reasoningEffort.default')}
                      </SelectItem>
                      {CUSTOM_PROVIDER_REASONING_EFFORTS.map((effort) => (
                        <SelectItem key={effort} value={effort}>
                          {t(`settings.providers.page.custom.reasoningEffort.${effort}` as I18nKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          {isEditingCustomProvider && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => {
                setEditingCustomProviderId(null);
                setCustomProviderForm(createEmptyCustomProviderForm());
              }}
            >
              {t('settings.providers.page.actions.cancel')}
            </Button>
          )}
          <Button
            size="xs"
            className="!font-normal"
            onClick={handleCreateCustomProvider}
            disabled={customProviderBusy}
          >
            {customProviderBusy ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.saveProvider')}
          </Button>
        </div>
      </section>
    </div>
  );

  if (!isAddMode && providers.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiStackLine className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.providers.page.empty.noProvidersDetected')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings.providers.page.empty.checkOpenCodeConfiguration')}</p>
        </div>
      </div>
    );
  }

  if (isAddMode) {
    return (
      <ScrollableOverlay outerClassName="h-full" className="w-full">
        <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">
          <div className="mb-4">
            <h1 className="typography-ui-header font-semibold text-foreground">{t('settings.providers.page.connect.title')}</h1>
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="chip"
              size="xs"
              aria-pressed={!isCustomProviderMode}
              onClick={() => setIsCustomProviderMode(false)}
            >
              {t('settings.providers.page.connect.knownProvider')}
            </Button>
            <Button
              type="button"
              variant="chip"
              size="xs"
              aria-pressed={isCustomProviderMode}
              onClick={() => {
                setCandidateProviderId('');
                setIsCustomProviderMode(true);
              }}
            >
              {t('settings.providers.page.connect.customProvider')}
            </Button>
          </div>

          {!isCustomProviderMode && (
          <div className="mb-8">
            <div className="mb-1 px-1">
              <h2 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.connect.selectProviderTitle')}</h2>
            </div>

            <section className="px-2 pb-2 pt-0">
              <div className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="typography-ui-label text-foreground">{t('settings.providers.page.connect.providerField')}</span>
                  {availableLoading ? (
                    <p className="typography-meta text-muted-foreground">{t('settings.providers.page.state.loading')}</p>
                  ) : availableError ? (
                    <p className="typography-meta text-muted-foreground">{availableError}</p>
                  ) : unconnectedProviders.length === 0 ? (
                    <p className="typography-meta text-muted-foreground">{t('settings.providers.page.connect.allProvidersConnected')}</p>
                  ) : (
                    <DropdownMenu open={providerDropdownOpen} onOpenChange={(open) => {
                      setProviderDropdownOpen(open);
                      if (!open) setProviderSearchQuery('');
                    }}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "flex items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2 py-2 typography-ui-label whitespace-nowrap shadow-none outline-none hover:bg-interactive-hover h-6 w-fit",
                          )}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {candidateProviderId ? <ProviderLogo providerId={candidateProviderId} className="h-3.5 w-3.5 flex-shrink-0" /> : null}
                            <span className={cn("truncate typography-ui-label font-normal", candidateProviderId ? "text-foreground" : "text-muted-foreground")}>
                              {candidateProviderId
                                ? (unconnectedProviders.find(p => p.id === candidateProviderId)?.name || candidateProviderId)
                                : t('settings.providers.page.connect.selectProviderPlaceholder')}
                            </span>
                          </span>
                          <RiArrowDownSLine className="h-4 w-4 flex-shrink-0 text-muted-foreground/50" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="start"
                        className="w-[280px] p-0"
                        onCloseAutoFocus={(e) => e.preventDefault()}
                      >
                        <div
                          className="flex items-center gap-2 border-b border-[var(--surface-subtle)] px-3 py-2"
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <RiSearchLine className="h-4 w-4 text-muted-foreground" />
                          <input
                            type="text"
                            value={providerSearchQuery}
                            onChange={(e) => setProviderSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder={t('settings.providers.page.connect.searchProvidersPlaceholder')}
                            className="flex-1 bg-transparent typography-meta outline-none placeholder:text-muted-foreground"
                            autoFocus
                          />
                        </div>
                        <ScrollableOverlay outerClassName="max-h-[240px]" className="p-1">
                          {(() => {
                            const filtered = unconnectedProviders.filter(p => {
                              const query = providerSearchQuery.toLowerCase();
                              return (p.name || p.id).toLowerCase().includes(query) || p.id.toLowerCase().includes(query);
                            });
                            if (filtered.length === 0) {
                              return <p className="py-4 text-center typography-meta text-muted-foreground">{t('settings.providers.page.connect.noProvidersFound')}</p>;
                            }
                            return filtered.map((provider) => (
                              <DropdownMenuItem
                                key={provider.id}
                                onSelect={() => {
                                  setCandidateProviderId(provider.id);
                                  setProviderDropdownOpen(false);
                                  setProviderSearchQuery('');
                                }}
                                className="flex items-center justify-between"
                              >
                                <span className="flex items-center gap-2 min-w-0">
                                  <ProviderLogo providerId={provider.id} className="h-4 w-4 flex-shrink-0" />
                                  <span className="truncate">{provider.name || provider.id}</span>
                                </span>
                                {candidateProviderId === provider.id && (
                                  <RiCheckLine className="h-4 w-4 text-[var(--primary-base)]" />
                                )}
                              </DropdownMenuItem>
                            ));
                          })()}
                        </ScrollableOverlay>
                      </DropdownMenuContent>
                    </DropdownMenu>
                   )}
              </div>
            </section>
          </div>
          )}

          {isCustomProviderMode && customProviderFormSection}

          {!isCustomProviderMode && candidateProviderId && (
            <div className="mb-8">
              <div className="mb-1 px-1">
                <h2 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.auth.title')}</h2>
              </div>

              {authLoading ? (
                <p className="typography-meta text-muted-foreground px-2">{t('settings.providers.page.auth.loadingMethods')}</p>
              ) : (
                <section className="px-2 pb-2 pt-0 space-y-4">
                  <div className="py-1.5">
                    <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                      {t('settings.providers.page.auth.apiKeyLabel')}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent sideOffset={8} className="max-w-xs">
                          {t('settings.providers.page.auth.apiKeyTooltip')}
                        </TooltipContent>
                      </Tooltip>
                    </label>
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1.5">
                      <Input
                        type="password"
                        value={apiKeyInputs[candidateProviderId] ?? ''}
                        onChange={(event) =>
                          setApiKeyInputs((prev) => ({
                            ...prev,
                            [candidateProviderId]: event.target.value,
                          }))
                        }
                        placeholder={t('settings.providers.page.auth.apiKeyPlaceholder')}
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        size="xs"
                        className="!font-normal shrink-0"
                        onClick={() => handleSaveApiKey(candidateProviderId)}
                        disabled={authBusyKey === `api:${candidateProviderId}`}
                      >
                        {authBusyKey === `api:${candidateProviderId}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.saveKey')}
                      </Button>
                    </div>
                  </div>

                  {(() => {
                    const candidateAuthMethods = authMethodsByProvider[candidateProviderId] ?? [];
                    const candidateOAuthMethods = candidateAuthMethods.filter(
                      (method) => normalizeAuthType(method) === 'oauth'
                    );

                    if (candidateOAuthMethods.length === 0) {
                      return null;
                    }

                    return (
                      <div className="space-y-4 border-t border-[var(--surface-subtle)] pt-2">
                        {candidateOAuthMethods.map((method, index) => {
                          const methodLabel = method.label || method.name || t('settings.providers.page.auth.oauthMethodFallback', { index: String(index + 1) });
                          const codeKey = `${candidateProviderId}:${index}`;
                          const isPending =
                            pendingOAuth?.providerId === candidateProviderId && pendingOAuth?.methodIndex === index;

                          return (
                            <div key={`${candidateProviderId}-${methodLabel}`} className="space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div>
                                  <div className="typography-ui-label text-foreground">{methodLabel}</div>
                                  {(method.description || method.help) && (
                                    <div className="typography-meta text-muted-foreground">
                                      {String(method.description || method.help)}
                                    </div>
                                  )}
                                </div>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="!font-normal"
                                  onClick={() => handleOAuthStart(candidateProviderId, index)}
                                  disabled={authBusyKey === `oauth:${candidateProviderId}:${index}`}
                                >
                                  {t('settings.providers.page.actions.connect')}
                                </Button>
                              </div>

                              {oauthDetails[codeKey]?.instructions && (
                                <p className="typography-meta text-[var(--primary-base)] bg-[var(--primary-base)]/10 px-2 py-1.5 rounded">
                                  {oauthDetails[codeKey]?.instructions}
                                </p>
                              )}

                              {oauthDetails[codeKey]?.userCode && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input value={oauthDetails[codeKey]?.userCode} readOnly className="font-mono text-center tracking-widest" />
                                  <Button variant="outline" size="xs" className="!font-normal" onClick={() => handleCopyOAuthCode(oauthDetails[codeKey]?.userCode ?? '')}>{t('settings.providers.page.actions.copyCode')}</Button>
                                </div>
                              )}

                              {oauthDetails[codeKey]?.url && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input value={oauthDetails[codeKey]?.url} readOnly className="text-xs text-muted-foreground" />
                                  <div className="flex gap-1 shrink-0">
                                    <Button variant="outline" size="xs" className="!font-normal" onClick={() => openExternalUrl(oauthDetails[codeKey]?.url ?? '')}>{t('settings.providers.page.actions.open')}</Button>
                                    <Button variant="outline" size="xs" className="!font-normal" onClick={() => handleCopyOAuthLink(oauthDetails[codeKey]?.url ?? '')}>{t('settings.providers.page.actions.copy')}</Button>
                                  </div>
                                </div>
                              )}

                              {isPending && (
                                <div className="flex items-center gap-2 mt-2">
                                  <Input
                                    value={oauthCodes[codeKey] ?? ''}
                                    onChange={(event) =>
                                      setOauthCodes((prev) => ({
                                        ...prev,
                                        [codeKey]: event.target.value,
                                      }))
                                    }
                                    placeholder={t('settings.providers.page.auth.pasteAuthorizationCodePlaceholder')}
                                    className="font-mono text-xs"
                                  />
                                  <Button
                                    size="xs"
                                    className="!font-normal"
                                    onClick={() => handleOAuthComplete(candidateProviderId, index)}
                                    disabled={authBusyKey === `oauth-complete:${candidateProviderId}:${index}`}
                                  >
                                    {authBusyKey === `oauth-complete:${candidateProviderId}:${index}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.complete')}
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </section>
              )}
            </div>
          )}
        </div>
        {customProviderModelImportDialogElement}
      </ScrollableOverlay>
    );
  }

  if (!selectedProvider) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center text-muted-foreground">
          <RiStackLine className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p className="typography-body">{t('settings.providers.page.empty.selectProviderFromSidebar')}</p>
          <p className="typography-meta mt-1 opacity-75">{t('settings.providers.page.empty.reviewDetailsAndConfigureAuth')}</p>
        </div>
      </div>
    );
  }

  const providerModels = Array.isArray(selectedProvider.models) ? selectedProvider.models : [];
  const providerAuthMethods = authMethodsByProvider[selectedProvider.id] ?? [];
  const oauthAuthMethods = providerAuthMethods.filter((method) => normalizeAuthType(method) === 'oauth');

  const filteredModels = providerModels.filter((model) => {
    const name = typeof model?.name === 'string' ? model.name : '';
    const id = typeof model?.id === 'string' ? model.id : '';
    const query = modelQuery.trim().toLowerCase();
    if (!query) return true;
    return name.toLowerCase().includes(query) || id.toLowerCase().includes(query);
  });

  return (
    <ScrollableOverlay outerClassName="h-full" className="w-full">
      <div className="mx-auto w-full max-w-3xl p-3 sm:p-6 sm:pt-8">

        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <ProviderLogo providerId={selectedProvider.id} className="h-5 w-5 shrink-0" />
          <div className="min-w-0">
            <h2 className="typography-ui-header font-semibold text-foreground truncate">
              {selectedProvider.name || selectedProvider.id}
            </h2>
            <p className="typography-meta text-muted-foreground truncate">
              <span className="font-mono">{selectedProvider.id}</span>
            </p>
          </div>
        </div>

        {isEditingCustomProvider && customProviderFormSection}

        {/* Authentication */}
        <div className="mb-8">
          <div className="mb-1 px-1 flex items-center justify-between gap-2">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.auth.title')}</h3>
            <Button
              variant="outline"
              size="xs"
              className="!font-normal"
              onClick={() => setShowAuthPanel((prev) => !prev)}
            >
              {showAuthPanel ? t('settings.providers.page.actions.hide') : t('settings.providers.page.actions.reconnect')}
            </Button>
          </div>

          <section className="px-2 pb-2 pt-0">
            {!showAuthPanel ? (
              <div className="flex items-center gap-1.5 py-1.5">
                <RiCheckLine className="w-4 h-4 text-[var(--status-success)] shrink-0" />
                <span className="typography-ui-label text-foreground">{t('settings.providers.page.auth.connected')}</span>
                <span className="typography-meta text-muted-foreground ml-1">{t('settings.providers.page.auth.useReconnectHint')}</span>
              </div>
            ) : authLoading ? (
              <div className="py-1.5 typography-meta text-muted-foreground">{t('settings.providers.page.auth.loadingMethods')}</div>
            ) : (
              <div className="space-y-4">
                <div className="py-1.5">
                  <label className="typography-ui-label text-foreground flex items-center gap-1.5">
                    {t('settings.providers.page.auth.apiKeyLabel')}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <RiInformationLine className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent sideOffset={8} className="max-w-xs">
                        {t('settings.providers.page.auth.apiKeyTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  </label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-1.5">
                    <Input
                      type="password"
                      value={apiKeyInputs[selectedProvider.id] ?? ''}
                      onChange={(event) =>
                        setApiKeyInputs((prev) => ({
                          ...prev,
                          [selectedProvider.id]: event.target.value,
                        }))
                      }
                      placeholder={t('settings.providers.page.auth.apiKeyPlaceholder')}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      size="xs"
                      className="!font-normal shrink-0"
                      onClick={() => handleSaveApiKey(selectedProvider.id)}
                      disabled={authBusyKey === `api:${selectedProvider.id}`}
                    >
                      {authBusyKey === `api:${selectedProvider.id}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.saveKey')}
                    </Button>
                  </div>
                </div>

                {oauthAuthMethods.length > 0 && (
                  <div className="space-y-4 border-t border-[var(--surface-subtle)] pt-2">
                    {oauthAuthMethods.map((method, index) => {
                      const methodLabel = method.label || method.name || t('settings.providers.page.auth.oauthMethodFallback', { index: String(index + 1) });
                      const codeKey = `${selectedProvider.id}:${index}`;
                      const isPending =
                        pendingOAuth?.providerId === selectedProvider.id && pendingOAuth?.methodIndex === index;

                      return (
                        <div key={`${selectedProvider.id}-${methodLabel}`} className="space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="typography-ui-label text-foreground">{methodLabel}</div>
                              {(method.description || method.help) && (
                                <div className="typography-meta text-muted-foreground">
                                  {String(method.description || method.help)}
                                </div>
                              )}
                            </div>
                            <Button
                              variant="outline"
                              size="xs"
                              className="!font-normal"
                              onClick={() => handleOAuthStart(selectedProvider.id, index)}
                              disabled={authBusyKey === `oauth:${selectedProvider.id}:${index}`}
                            >
                              {t('settings.providers.page.actions.connect')}
                            </Button>
                          </div>

                          {oauthDetails[codeKey]?.instructions && (
                            <p className="typography-meta text-[var(--primary-base)] bg-[var(--primary-base)]/10 px-2 py-1.5 rounded">
                              {oauthDetails[codeKey]?.instructions}
                            </p>
                          )}

                          {oauthDetails[codeKey]?.userCode && (
                            <div className="flex items-center gap-2 mt-2">
                              <Input value={oauthDetails[codeKey]?.userCode} readOnly className="font-mono text-center tracking-widest" />
                              <Button variant="outline" size="xs" className="!font-normal" onClick={() => handleCopyOAuthCode(oauthDetails[codeKey]?.userCode ?? '')}>{t('settings.providers.page.actions.copyCode')}</Button>
                            </div>
                          )}

                          {oauthDetails[codeKey]?.url && (
                            <div className="flex items-center gap-2 mt-2">
                              <Input value={oauthDetails[codeKey]?.url} readOnly className="text-xs text-muted-foreground" />
                              <div className="flex gap-1 shrink-0">
                                <Button variant="outline" size="xs" className="!font-normal" onClick={() => openExternalUrl(oauthDetails[codeKey]?.url ?? '')}>{t('settings.providers.page.actions.open')}</Button>
                                <Button variant="outline" size="xs" className="!font-normal" onClick={() => handleCopyOAuthLink(oauthDetails[codeKey]?.url ?? '')}>{t('settings.providers.page.actions.copy')}</Button>
                              </div>
                            </div>
                          )}

                          {isPending && (
                            <div className="flex items-center gap-2 mt-2">
                              <Input
                                value={oauthCodes[codeKey] ?? ''}
                                onChange={(event) =>
                                  setOauthCodes((prev) => ({
                                    ...prev,
                                    [codeKey]: event.target.value,
                                  }))
                                }
                                placeholder={t('settings.providers.page.auth.pasteAuthorizationCodePlaceholder')}
                                className="font-mono text-xs"
                              />
                              <Button
                                size="xs"
                                className="!font-normal"
                                onClick={() => handleOAuthComplete(selectedProvider.id, index)}
                                disabled={authBusyKey === `oauth-complete:${selectedProvider.id}:${index}`}
                              >
                                {authBusyKey === `oauth-complete:${selectedProvider.id}:${index}` ? t('settings.providers.page.actions.saving') : t('settings.providers.page.actions.complete')}
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Connection Details */}
        <div className="mb-8">
          <div className="mb-1 px-1">
            <h3 className="typography-ui-header font-medium text-foreground">{t('settings.providers.page.connectionDetails.title')}</h3>
          </div>

          <section className="px-2 pb-2 pt-0">
            <div className="flex flex-col gap-2 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
              <div className="flex min-w-0 flex-col">
                {selectedSources && (selectedSources.auth.exists || selectedSources.user.exists || selectedSources.project.exists || selectedSources.custom?.exists) ? (
                  <span className="typography-meta text-muted-foreground">
                    {t('settings.providers.page.connectionDetails.configuredIn')}{' '}
                    {[
                      selectedSources.auth.exists ? t('settings.providers.page.connectionDetails.source.authCredentials') : null,
                      selectedSources.user.exists ? t('settings.providers.page.connectionDetails.source.userConfig') : null,
                      selectedSources.project.exists ? t('settings.providers.page.connectionDetails.source.projectConfig') : null,
                      selectedSources.custom?.exists ? t('settings.providers.page.connectionDetails.source.customConfig') : null,
                    ].filter(Boolean).join(', ')}
                  </span>
                ) : (
                  <span className="typography-meta text-muted-foreground">{t('settings.providers.page.connectionDetails.noActiveSource')}</span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                {canEditSelectedProvider && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="!font-normal"
                    onClick={() => handleEditCustomProvider(selectedProvider.id)}
                    disabled={customProviderEditLoading || customProviderBusy}
                  >
                    <RiEditLine className="h-3.5 w-3.5" />
                    {customProviderEditLoading ? t('settings.providers.page.state.loading') : t('settings.providers.page.actions.editProvider')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  className="!font-normal text-[var(--status-error)] hover:text-[var(--status-error)]"
                  onClick={() => handleDisconnectProvider(selectedProvider.id)}
                  disabled={authBusyKey === `disconnect:${selectedProvider.id}`}
                >
                  {authBusyKey === `disconnect:${selectedProvider.id}` ? t('settings.providers.page.actions.disconnecting') : t('settings.providers.page.actions.disconnect')}
                </Button>
              </div>
            </div>
          </section>
        </div>

        {/* Models */}
        <div className="mb-8">
          <div className="mb-1 px-1 flex items-center justify-between gap-2">
            <h3 className="typography-ui-header font-medium text-foreground">
              {t('settings.providers.page.models.title')}
              {providerModels.length > 0 && (
                <span className="ml-1.5 typography-micro text-muted-foreground font-normal">
                  ({providerModels.length})
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  const allIds = providerModels
                    .map((model) => (typeof model?.id === 'string' ? model.id : ''))
                    .filter((id) => id.length > 0);
                  hideAllModels(selectedProvider.id, allIds);
                }}
              >
                {t('settings.providers.page.actions.hideAll')}
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => showAllModels(selectedProvider.id)}
              >
                {t('settings.providers.page.actions.showAll')}
              </Button>
            </div>
          </div>

          <section className="px-2 pb-2 pt-0">
            <div className="relative mb-2">
              <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={t('settings.providers.page.models.filterPlaceholder')}
                className="h-7 pl-8 w-full"
              />
            </div>

            {filteredModels.length === 0 ? (
              <p className="typography-meta text-muted-foreground py-4 text-center">{t('settings.providers.page.models.noModelsMatchFilter')}</p>
            ) : (
              <div className="divide-y divide-[var(--surface-subtle)]">
                {filteredModels.map((model) => {
                  const modelId = typeof model?.id === 'string' ? model.id : '';
                  const modelName = typeof model?.name === 'string' ? model.name : modelId;
                  const metadata = modelId ? getModelMetadata(selectedProvider.id, modelId) as ModelMetadata | undefined : undefined;
                  const isHidden = hiddenModels.some(
                    (item) => item.providerID === selectedProvider.id && item.modelID === modelId
                  );

                  const contextTokens = formatTokens(metadata?.limit?.context);
                  const outputTokens = formatTokens(metadata?.limit?.output);

                  const capabilityIcons: Array<{ key: string; icon: typeof RiToolsLine; label: string }> = [];
                  if (metadata?.tool_call) capabilityIcons.push({ key: 'tools', icon: RiToolsLine, label: t('settings.providers.page.models.capability.toolCalling') });
                  if (metadata?.reasoning) capabilityIcons.push({ key: 'reasoning', icon: RiBrainAi3Line, label: t('settings.providers.page.models.capability.reasoning') });
                  if (metadata?.attachment) capabilityIcons.push({ key: 'image', icon: RiFileImageLine, label: t('settings.providers.page.models.capability.imageInput') });

                  return (
                    <div key={modelId} className="py-1.5">
                      <div
                        className={cn(
                          "flex items-center gap-3",
                          isHidden && 'opacity-50',
                        )}
                      >
                      <span className="typography-meta font-medium text-foreground truncate flex-1 min-w-0">
                        {modelName}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {(contextTokens || outputTokens) && (
                          <span className="typography-micro text-muted-foreground flex-shrink-0 bg-[var(--surface-muted)] px-1.5 py-0.5 rounded">
                            {contextTokens ? `${contextTokens} ${t('settings.providers.page.models.tokenBadge.context')}` : ''}
                            {contextTokens && outputTokens ? ' · ' : ''}
                            {outputTokens ? `${outputTokens} ${t('settings.providers.page.models.tokenBadge.output')}` : ''}
                          </span>
                        )}
                        {capabilityIcons.length > 0 && (
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {capabilityIcons.map(({ key, icon: Icon, label }) => (
                              <span
                                key={key}
                                className="flex h-5 w-5 rounded items-center justify-center text-muted-foreground bg-[var(--surface-muted)]"
                                title={label}
                                aria-label={label}
                              >
                                <Icon className="h-3 w-3" />
                              </span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleHiddenModel(selectedProvider.id, modelId)}
                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-[var(--interactive-hover)]/50"
                          title={isHidden ? t('settings.providers.page.models.actions.showModelInSelectors') : t('settings.providers.page.models.actions.hideModelFromSelectors')}
                          aria-label={isHidden ? t('settings.providers.page.models.actions.showModel') : t('settings.providers.page.models.actions.hideModel')}
                        >
                          {isHidden ? <RiEyeOffLine className="h-3.5 w-3.5" /> : <RiEyeLine className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      {customProviderModelImportDialogElement}
    </ScrollableOverlay>
  );
};
