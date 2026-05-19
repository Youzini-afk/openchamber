import React from 'react';
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiInformationLine,
  RiRefreshLine,
  RiSaveLine,
  RiStethoscopeLine,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NumberInput } from '@/components/ui/number-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { toast } from '@/components/ui';
import { useRuntimeAPI } from '@/hooks/useRuntimeAPIs';
import { cn } from '@/lib/utils';
import type {
  SmartSearchConfigResponse,
  SmartSearchConfigValue,
  SmartSearchDoctorResponse,
  SmartSearchStatusResponse,
} from '@/lib/api/types';

const SECRET_PLACEHOLDER = '••••••••••••';

type FieldType = 'text' | 'secret' | 'select' | 'boolean' | 'number' | 'tools';

type FieldDefinition = {
  key: string;
  label: string;
  description?: string;
  type: FieldType;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
};

const MAIN_FIELDS: FieldDefinition[] = [
  { key: 'XAI_API_URL', label: 'xAI API URL', type: 'text', placeholder: 'https://api.x.ai/v1' },
  { key: 'XAI_API_KEY', label: 'xAI API Key', type: 'secret' },
  { key: 'XAI_MODEL', label: 'xAI Model', type: 'text', placeholder: 'grok-4-fast' },
  { key: 'XAI_TOOLS', label: 'xAI Tools', type: 'tools', description: 'Responses API tools used for live search.' },
  { key: 'OPENAI_COMPATIBLE_API_URL', label: 'OpenAI-compatible API URL', type: 'text', placeholder: 'https://openrouter.ai/api/v1' },
  { key: 'OPENAI_COMPATIBLE_API_KEY', label: 'OpenAI-compatible API Key', type: 'secret' },
  { key: 'OPENAI_COMPATIBLE_MODEL', label: 'OpenAI-compatible Model', type: 'text', placeholder: 'openai/gpt-4o-search-preview' },
];

const DOC_FIELDS: FieldDefinition[] = [
  { key: 'EXA_API_KEY', label: 'Exa API Key', type: 'secret' },
  { key: 'EXA_BASE_URL', label: 'Exa Base URL', type: 'text', placeholder: 'https://api.exa.ai' },
  { key: 'EXA_TIMEOUT_SECONDS', label: 'Exa Timeout', type: 'number' },
  { key: 'CONTEXT7_API_KEY', label: 'Context7 API Key', type: 'secret' },
  { key: 'CONTEXT7_BASE_URL', label: 'Context7 Base URL', type: 'text', placeholder: 'https://context7.com' },
  { key: 'CONTEXT7_TIMEOUT_SECONDS', label: 'Context7 Timeout', type: 'number' },
];

const CHINA_FIELDS: FieldDefinition[] = [
  { key: 'ZHIPU_API_KEY', label: 'Zhipu API Key', type: 'secret' },
  { key: 'ZHIPU_API_URL', label: 'Zhipu API URL', type: 'text', placeholder: 'https://open.bigmodel.cn/api' },
  {
    key: 'ZHIPU_SEARCH_ENGINE',
    label: 'Zhipu Search Engine',
    type: 'select',
    options: [
      { value: 'search_std', label: 'search_std' },
      { value: 'search_pro', label: 'search_pro' },
      { value: 'search_pro_sogou', label: 'search_pro_sogou' },
      { value: 'search_pro_quark', label: 'search_pro_quark' },
    ],
  },
  { key: 'ZHIPU_TIMEOUT_SECONDS', label: 'Zhipu Timeout', type: 'number' },
];

const CRAWL_FIELDS: FieldDefinition[] = [
  { key: 'TAVILY_ENABLED', label: 'Enable Tavily', type: 'boolean' },
  { key: 'TAVILY_API_KEY', label: 'Tavily API Key', type: 'secret' },
  { key: 'TAVILY_API_URL', label: 'Tavily API URL', type: 'text', placeholder: 'https://api.tavily.com' },
  { key: 'TAVILY_TIMEOUT_SECONDS', label: 'Tavily Timeout', type: 'number' },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl API Key', type: 'secret' },
  { key: 'FIRECRAWL_API_URL', label: 'Firecrawl API URL', type: 'text', placeholder: 'https://api.firecrawl.dev/v2' },
];

const STRATEGY_FIELDS: FieldDefinition[] = [
  {
    key: 'SMART_SEARCH_VALIDATION_LEVEL',
    label: 'Validation Level',
    type: 'select',
    options: [
      { value: 'fast', label: 'fast' },
      { value: 'balanced', label: 'balanced' },
      { value: 'strict', label: 'strict' },
    ],
  },
  {
    key: 'SMART_SEARCH_FALLBACK_MODE',
    label: 'Fallback Mode',
    type: 'select',
    options: [
      { value: 'auto', label: 'auto' },
      { value: 'off', label: 'off' },
    ],
  },
  {
    key: 'SMART_SEARCH_MINIMUM_PROFILE',
    label: 'Minimum Profile',
    type: 'select',
    options: [
      { value: 'standard', label: 'standard' },
      { value: 'off', label: 'off' },
    ],
  },
  { key: 'SMART_SEARCH_RETRY_MAX_ATTEMPTS', label: 'Retry Attempts', type: 'number' },
  { key: 'SMART_SEARCH_RETRY_MULTIPLIER', label: 'Retry Multiplier', type: 'number' },
  { key: 'SMART_SEARCH_RETRY_MAX_WAIT', label: 'Retry Max Wait', type: 'number' },
  { key: 'SSL_VERIFY', label: 'Verify SSL Certificates', type: 'boolean' },
];

const LOG_FIELDS: FieldDefinition[] = [
  { key: 'SMART_SEARCH_DEBUG', label: 'Debug Mode', type: 'boolean' },
  {
    key: 'SMART_SEARCH_LOG_LEVEL',
    label: 'Log Level',
    type: 'select',
    options: ['DEBUG', 'INFO', 'WARNING', 'ERROR'].map((value) => ({ value, label: value })),
  },
  { key: 'SMART_SEARCH_LOG_DIR', label: 'Log Directory', type: 'text', placeholder: 'logs' },
  { key: 'SMART_SEARCH_LOG_TO_FILE', label: 'Log to File', type: 'boolean' },
  { key: 'SMART_SEARCH_OUTPUT_CLEANUP', label: 'Output Cleanup', type: 'boolean' },
];

const ALL_FIELDS = [...MAIN_FIELDS, ...DOC_FIELDS, ...CHINA_FIELDS, ...CRAWL_FIELDS, ...STRATEGY_FIELDS, ...LOG_FIELDS];
const FIELD_KEYS = ALL_FIELDS.map((field) => field.key);

const normalizeBool = (value: string | undefined, fallback = false) => {
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const getConfigText = (entry: SmartSearchConfigValue | undefined): string => {
  if (!entry) return '';
  return typeof entry.value === 'string' ? entry.value : '';
};

const getDisplaySource = (entry: SmartSearchConfigValue | undefined): string => {
  if (!entry) return 'default';
  if (entry.source === 'environment') return 'env override';
  if (entry.source === 'config_file') return 'config file';
  return 'default';
};

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? RiCheckboxCircleLine : RiCloseCircleLine;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-1 typography-micro',
      ok
        ? 'border-[var(--status-success-border)] bg-[var(--status-success-background)] text-[var(--status-success)]'
        : 'border-[var(--status-error-border)] bg-[var(--status-error-background)] text-[var(--status-error)]'
    )}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function SmartSearchField({
  field,
  entry,
  draft,
  onChange,
  onUnset,
}: {
  field: FieldDefinition;
  entry?: SmartSearchConfigValue;
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onUnset: (key: string) => void;
}) {
  const editable = entry?.editable !== false;
  const current = draft[field.key] ?? getConfigText(entry);
  const isDirty = Object.prototype.hasOwnProperty.call(draft, field.key);
  const showEnvWarning = entry?.source === 'environment';

  const renderControl = () => {
    if (field.type === 'secret') {
      return (
        <Input
          type="password"
          value={current}
          placeholder={entry?.isSet ? `${SECRET_PLACEHOLDER} (${entry.maskedValue ?? 'set'})` : 'Not configured'}
          onChange={(event) => onChange(field.key, event.target.value)}
          disabled={!editable}
          className="font-mono"
        />
      );
    }

    if (field.type === 'select') {
      const value = current || field.options?.[0]?.value || '';
      return (
        <Select value={value} onValueChange={(next) => onChange(field.key, next)} disabled={!editable}>
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    if (field.type === 'boolean') {
      const checked = normalizeBool(current, field.key === 'TAVILY_ENABLED' || field.key === 'SSL_VERIFY' || field.key === 'SMART_SEARCH_OUTPUT_CLEANUP');
      return (
        <label className="flex items-center gap-2 rounded-md border border-border bg-[var(--surface-elevated)] px-3 py-2">
          <Checkbox checked={checked} onChange={(next) => onChange(field.key, next ? 'true' : 'false')} disabled={!editable} />
          <span className="typography-ui text-foreground">{checked ? 'Enabled' : 'Disabled'}</span>
        </label>
      );
    }

    if (field.type === 'number') {
      return (
        <NumberInput
          value={Number(current || 0)}
          onValueChange={(next) => onChange(field.key, String(next))}
          disabled={!editable}
          min={0}
          className="h-9"
        />
      );
    }

    if (field.type === 'tools') {
      const selected = new Set((current || 'web_search,x_search').split(',').map((item) => item.trim()).filter(Boolean));
      const toggleTool = (tool: string, checked: boolean) => {
        const next = new Set(selected);
        if (checked) next.add(tool); else next.delete(tool);
        onChange(field.key, Array.from(next).join(','));
      };
      return (
        <div className="flex flex-wrap gap-2">
          {['web_search', 'x_search'].map((tool) => (
            <label key={tool} className="flex items-center gap-2 rounded-md border border-border bg-[var(--surface-elevated)] px-3 py-2">
              <Checkbox checked={selected.has(tool)} onChange={(next) => toggleTool(tool, next)} disabled={!editable} />
              <span className="typography-ui font-mono text-foreground">{tool}</span>
            </label>
          ))}
        </div>
      );
    }

    return (
      <Input
        value={current}
        placeholder={field.placeholder}
        onChange={(event) => onChange(field.key, event.target.value)}
        disabled={!editable}
        className="font-mono"
      />
    );
  };

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-[var(--surface-elevated)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="typography-ui-label text-foreground">{field.label}</div>
          <div className="typography-micro text-muted-foreground">
            <span className="font-mono">{field.key}</span> · {getDisplaySource(entry)}
            {entry?.secret && entry.isSet && entry.maskedValue ? ` · ${entry.maskedValue}` : ''}
            {!entry?.isSet && current ? ` · default ${current}` : ''}
          </div>
          {field.description && <div className="typography-micro text-muted-foreground/80">{field.description}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isDirty && <span className="typography-micro text-[var(--status-warning)]">modified</span>}
          {entry?.isSet && editable && (
            <Button variant="ghost" size="xs" type="button" onClick={() => onUnset(field.key)}>
              Unset
            </Button>
          )}
        </div>
      </div>
      {renderControl()}
      {showEnvWarning && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] px-3 py-2 typography-micro text-[var(--status-warning)]">
          <RiInformationLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This value is controlled by an environment variable. Editing the config file would not affect runtime behavior.
        </div>
      )}
    </div>
  );
}

function FieldGroup({
  title,
  description,
  fields,
  config,
  draft,
  onChange,
  onUnset,
  divider,
}: {
  title: string;
  description: string;
  fields: FieldDefinition[];
  config: SmartSearchConfigResponse | null;
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onUnset: (key: string) => void;
  divider?: boolean;
}) {
  return (
    <SettingsSection title={title} description={description} divider={divider}>
      <div className="grid gap-3">
        {fields.map((field) => (
          <SmartSearchField
            key={field.key}
            field={field}
            entry={config?.values[field.key]}
            draft={draft}
            onChange={onChange}
            onUnset={onUnset}
          />
        ))}
      </div>
    </SettingsSection>
  );
}

export const SmartSearchPage: React.FC = () => {
  const api = useRuntimeAPI((apis) => apis.smartSearch);
  const [status, setStatus] = React.useState<SmartSearchStatusResponse | null>(null);
  const [config, setConfig] = React.useState<SmartSearchConfigResponse | null>(null);
  const [doctor, setDoctor] = React.useState<SmartSearchDoctorResponse | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [unsetKeys, setUnsetKeys] = React.useState<Set<string>>(() => new Set());
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [doctorRunning, setDoctorRunning] = React.useState(false);

  const dirty = Object.keys(draft).length > 0 || unsetKeys.size > 0;

  const refresh = React.useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const [nextStatus, nextConfig] = await Promise.all([api.status(), api.loadConfig()]);
      setStatus(nextStatus);
      setConfig(nextConfig);
      setDraft({});
      setUnsetKeys(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load Smart Search configuration');
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateDraft = React.useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setUnsetKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const unsetField = React.useCallback((key: string) => {
    setDraft((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setUnsetKeys((prev) => new Set(prev).add(key));
  }, []);

  const save = React.useCallback(async () => {
    if (!api) return;
    setSaving(true);
    try {
      const set: Record<string, string> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (!FIELD_KEYS.includes(key)) continue;
        set[key] = value;
      }
      const response = await api.saveConfig({ set, unset: Array.from(unsetKeys) });
      setConfig(response);
      setDraft({});
      setUnsetKeys(new Set());
      toast.success('Smart Search configuration saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save Smart Search configuration');
    } finally {
      setSaving(false);
    }
  }, [api, draft, unsetKeys]);

  const runDoctor = React.useCallback(async () => {
    if (!api || doctorRunning) return;
    setDoctorRunning(true);
    try {
      const result = await api.doctor();
      setDoctor(result);
      if (result.ok) {
        toast.success('Smart Search doctor passed');
      } else {
        toast.error('Smart Search doctor reported issues');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to run Smart Search doctor');
    } finally {
      setDoctorRunning(false);
    }
  }, [api, doctorRunning]);

  if (!api) {
    return (
      <SettingsPageLayout>
        <SettingsSection title="Smart Search" description="This runtime does not expose Smart Search configuration APIs.">
          <div className="rounded-lg border border-border bg-[var(--surface-elevated)] p-4 text-muted-foreground">
            Smart Search settings are available in the Web runtime.
          </div>
        </SettingsSection>
      </SettingsPageLayout>
    );
  }

  return (
    <SettingsPageLayout className="max-w-4xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="typography-title text-foreground">Smart Search</h1>
          <p className="typography-ui text-muted-foreground">
            Configure the local smart-search CLI used for web research, source discovery, docs lookup, and fetch/map tools.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => void refresh()} disabled={loading || saving}>
            <RiRefreshLine className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => void save()} disabled={!dirty || saving}>
            <RiSaveLine className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <SettingsSection title="Status" description="CLI availability, active config path, and live provider diagnostics.">
        <div className="grid gap-3 rounded-lg border border-border bg-[var(--surface-elevated)] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill ok={Boolean(status?.available)} label={status?.available ? 'CLI available' : 'CLI unavailable'} />
            {dirty && <span className="typography-micro text-[var(--status-warning)]">Unsaved changes</span>}
          </div>
          <div className="grid gap-1 typography-micro text-muted-foreground">
            <div>Binary: <span className="font-mono text-foreground">{status?.binary ?? 'smart-search'}</span></div>
            <div>Version: <span className="font-mono text-foreground">{status?.version || 'unknown'}</span></div>
            <div>Config: <span className="font-mono text-foreground break-all">{config?.path?.config_file ?? status?.path?.config_file ?? 'unknown'}</span></div>
            <div>Source: <span className="font-mono text-foreground">{config?.path?.config_dir_source ?? status?.path?.config_dir_source ?? 'unknown'}</span></div>
            {status?.error && <div className="text-[var(--status-error)]">{status.error}</div>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => void runDoctor()} disabled={doctorRunning || !status?.available}>
              <RiStethoscopeLine className="h-4 w-4" />
              {doctorRunning ? 'Running doctor…' : 'Run doctor'}
            </Button>
            {doctor && <StatusPill ok={doctor.ok} label={doctor.ok ? 'Doctor passed' : 'Doctor issues'} />}
          </div>
          {doctor?.result && (
            <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 typography-micro text-foreground">
              {JSON.stringify(doctor.result, null, 2)}
            </pre>
          )}
          {doctor?.stderr && (
            <pre className="max-h-32 overflow-auto rounded-md border border-[var(--status-warning-border)] bg-[var(--status-warning-background)] p-3 typography-micro text-[var(--status-warning)]">
              {doctor.stderr}
            </pre>
          )}
        </div>
      </SettingsSection>

      <FieldGroup title="Main search" description="Primary providers for direct web research answers." fields={MAIN_FIELDS} config={config} draft={draft} onChange={updateDraft} onUnset={unsetField} divider />
      <FieldGroup title="Docs and source discovery" description="Supplemental providers for source-first search and documentation lookup." fields={DOC_FIELDS} config={config} draft={draft} onChange={updateDraft} onUnset={unsetField} divider />
      <FieldGroup title="Chinese and current web search" description="Zhipu Web Search settings for Chinese/current information routes." fields={CHINA_FIELDS} config={config} draft={draft} onChange={updateDraft} onUnset={unsetField} divider />
      <FieldGroup title="Fetch and site map" description="Tavily and Firecrawl are used for page extraction, search fallback, and site maps." fields={CRAWL_FIELDS} config={config} draft={draft} onChange={updateDraft} onUnset={unsetField} divider />
      <FieldGroup title="Strategy" description="Validation, fallback, retry, and TLS behavior." fields={STRATEGY_FIELDS} config={config} draft={draft} onChange={updateDraft} onUnset={unsetField} divider />
      <FieldGroup title="Diagnostics and logs" description="Debug logging and output cleanup controls." fields={LOG_FIELDS} config={config} draft={draft} onChange={updateDraft} onUnset={unsetField} divider />
    </SettingsPageLayout>
  );
};
