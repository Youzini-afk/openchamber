import React from 'react';
import {
  RiArrowDownSLine,
  RiCodeLine,
  RiDownloadCloud2Line,
  RiRefreshLine,
  RiRestartLine,
  RiSaveLine,
  RiSparklingLine,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { ModelSelector } from '@/components/sections/agents/ModelSelector';
import { OpenAgentPage } from '@/components/sections/openagent/OpenAgentPage';
import { useConfigStore } from '@/stores/useConfigStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useAgentOrchestrationStore } from '@/stores/useAgentOrchestrationStore';
import { useOpenAgentConfigStore } from '@/stores/useOpenAgentConfigStore';
import { useSlimConfigStore } from '@/stores/useSlimConfigStore';
import { cn } from '@/lib/utils';
import {
  buildSlimSavePayload,
  countFallbackChains,
  getActivePreset,
  getModelString,
  getPresetAgent,
  hasSlimDraftChanges,
  joinModelRef,
  normalizeMultiplexerLayout,
  normalizeMultiplexerType,
  normalizeNumberInput,
  normalizeVariant,
  parseModelRef,
  SLIM_AGENT_DEFINITIONS,
  type SlimAgentItem,
  type SlimMode,
  type SlimRawConfig,
} from './slimConfig';

const INHERIT_VALUE = '__inherit__';
const VARIANT_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MULTIPLEXER_TYPES = ['none', 'auto', 'tmux', 'zellij'];
const MULTIPLEXER_LAYOUTS = ['main-vertical', 'main-horizontal', 'tiled', 'even-horizontal', 'even-vertical'];

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded px-1.5 typography-micro font-medium', className)}>
      {children}
    </span>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="typography-ui-label text-foreground">{label}</span>
      {children}
      {hint ? <span className="typography-micro text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function Section({
  title,
  description,
  defaultOpen,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(Boolean(defaultOpen));
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <section className="overflow-hidden rounded-lg border border-border/70 bg-background">
        <CollapsibleTrigger className="rounded-none border-b border-border/60 px-3 py-2">
          <div className="min-w-0 text-left">
            <h3 className="typography-ui-label font-semibold text-foreground">{title}</h3>
            {description ? <p className="typography-micro text-muted-foreground">{description}</p> : null}
          </div>
          <RiArrowDownSLine className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3">{children}</div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function CompactModelEditor({
  model,
  onChange,
}: {
  model: string;
  onChange: (model: string) => void;
}) {
  const parsed = parseModelRef(model);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <ModelSelector
        providerId={parsed.providerId}
        modelId={parsed.modelId}
        onChange={(providerId, modelId) => onChange(joinModelRef(providerId, modelId))}
        placeholder="继承默认"
        className="h-7 min-w-[130px] max-w-[230px] flex-1"
      />
      <Input
        value={model}
        onChange={(event) => onChange(event.target.value)}
        placeholder="provider/model"
        className="h-7 min-w-[160px] flex-1 font-mono typography-meta"
      />
    </div>
  );
}

function parseCommaList(value: string): string[] | undefined {
  const entries = value.split(',').map((item) => item.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function stringifyJson(value: unknown): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('请输入 JSON object');
  }
  return parsed as Record<string, unknown>;
}

function ModeButton({
  mode,
  current,
  title,
  description,
  disabled,
  onSelect,
}: {
  mode: Exclude<SlimMode, 'conflict'>;
  current: SlimMode;
  title: string;
  description: string;
  disabled: boolean;
  onSelect: (mode: Exclude<SlimMode, 'conflict'>) => void;
}) {
  const selected = current === mode;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(mode)}
      className={cn(
        'min-h-[72px] rounded-lg border px-3 py-2 text-left transition-colors',
        selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border/70 bg-background hover:bg-[var(--interactive-hover)]',
        disabled && 'opacity-60',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="typography-ui-label font-semibold">{title}</span>
        {selected ? <Badge className="bg-primary text-primary-foreground">当前</Badge> : null}
      </div>
      <div className="mt-1 typography-micro text-muted-foreground">{description}</div>
    </button>
  );
}

function JsonPreviewDialog({
  open,
  onOpenChange,
  draft,
  expectedMtimeMs,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: SlimRawConfig;
  expectedMtimeMs: number | null;
}) {
  const preview = React.useMemo(() => JSON.stringify(buildSlimSavePayload(expectedMtimeMs, draft), null, 2), [draft, expectedMtimeMs]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Slim JSON 预览</DialogTitle>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border/70 bg-[var(--surface-elevated)] p-3 font-mono typography-meta text-foreground">
          {preview}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

function AgentAdvancedDialog({
  agentId,
  onClose,
}: {
  agentId: string | null;
  onClose: () => void;
}) {
  const draft = useSlimConfigStore((state) => state.draft);
  const updatePresetAgent = useSlimConfigStore((state) => state.updatePresetAgent);
  const agent = agentId ? getPresetAgent(draft, agentId) : {};
  const [optionsText, setOptionsText] = React.useState('');

  React.useEffect(() => {
    setOptionsText(stringifyJson(agent.options));
  }, [agentId, agent.options]);

  const handleSaveOptions = () => {
    if (!agentId) return;
    try {
      updatePresetAgent(agentId, { options: parseJsonObject(optionsText) });
      toast.success('options 已更新');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'JSON 解析失败');
    }
  };

  return (
    <Dialog open={Boolean(agentId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{agentId} 高级设置</DialogTitle>
        </DialogHeader>
        {agentId ? (
          <div className="grid gap-3">
            <Field label="Display Name">
              <Input
                value={typeof agent.displayName === 'string' ? agent.displayName : ''}
                onChange={(event) => updatePresetAgent(agentId, { displayName: event.target.value || undefined })}
                placeholder="继承"
              />
            </Field>
            <Field label="自定义 prompt">
              <Textarea
                value={typeof agent.prompt === 'string' ? agent.prompt : ''}
                onChange={(event) => updatePresetAgent(agentId, { prompt: event.target.value || undefined })}
                placeholder="仅 custom agent 建议使用"
                className="min-h-[88px]"
              />
            </Field>
            <Field label="Orchestrator Prompt">
              <Textarea
                value={typeof agent.orchestratorPrompt === 'string' ? agent.orchestratorPrompt : ''}
                onChange={(event) => updatePresetAgent(agentId, { orchestratorPrompt: event.target.value || undefined })}
                placeholder="@agent-name ..."
                className="min-h-[88px]"
              />
            </Field>
            <Field label="options JSON">
              <Textarea
                value={optionsText}
                onChange={(event) => setOptionsText(event.target.value)}
                placeholder='{ "textVerbosity": "high" }'
                className="min-h-[140px] font-mono typography-meta"
              />
            </Field>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>关闭</Button>
          <Button type="button" onClick={handleSaveOptions} disabled={!agentId}>保存 options</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlimAgentRow({
  item,
  onAdvanced,
}: {
  item: SlimAgentItem;
  onAdvanced: (agentId: string) => void;
}) {
  const draft = useSlimConfigStore((state) => state.draft);
  const updatePresetAgent = useSlimConfigStore((state) => state.updatePresetAgent);
  const setAgentDisabled = useSlimConfigStore((state) => state.setAgentDisabled);
  const agent = getPresetAgent(draft, item.id);
  const model = getModelString(agent.model);
  const fallbackCount = countFallbackChains(draft.fallback, item.id);
  const disabledIds = new Set(Array.isArray(draft.disabled_agents) ? draft.disabled_agents : ['observer']);
  const disabled = disabledIds.has(item.id);

  return (
    <div className="grid min-h-[70px] grid-cols-1 gap-2 border-t border-border/50 px-3 py-2 first:border-t-0 xl:grid-cols-[minmax(220px,0.8fr)_minmax(360px,1.2fr)_minmax(320px,1fr)] xl:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate typography-ui-label font-medium text-foreground">{item.label}</span>
          {disabled ? <Badge className="bg-muted text-muted-foreground">禁用</Badge> : null}
          {model ? <Badge className="bg-primary/10 text-primary">已覆盖</Badge> : null}
          {item.projectOverride ? <Badge className="bg-[var(--status-warning)]/10 text-[var(--status-warning)]">项目覆盖</Badge> : null}
        </div>
        <div className="typography-micro text-muted-foreground">{item.description}</div>
        <div className="truncate font-mono typography-micro text-muted-foreground/80">
          默认：{item.defaultModel ? `${item.defaultModel}${item.defaultVariant ? ` · ${item.defaultVariant}` : ''}` : '插件默认'}
        </div>
      </div>
      <CompactModelEditor model={model} onChange={(nextModel) => updatePresetAgent(item.id, { model: nextModel || undefined })} />
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Select
          value={typeof agent.variant === 'string' && agent.variant ? agent.variant : INHERIT_VALUE}
          onValueChange={(value) => updatePresetAgent(item.id, { variant: value === INHERIT_VALUE ? undefined : normalizeVariant(value) })}
        >
          <SelectTrigger className="h-7 w-[112px]" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INHERIT_VALUE}>继承</SelectItem>
            {VARIANT_OPTIONS.map((variant) => <SelectItem key={variant} value={variant}>{variant}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          value={agent.temperature == null ? '' : String(agent.temperature)}
          onChange={(event) => updatePresetAgent(item.id, { temperature: normalizeNumberInput(event.target.value, 'temperature') })}
          placeholder="temp"
          className="h-7 w-[70px]"
        />
        <Input
          value={Array.isArray(agent.skills) ? agent.skills.join(', ') : ''}
          onChange={(event) => updatePresetAgent(item.id, { skills: parseCommaList(event.target.value) })}
          placeholder="skills"
          className="h-7 min-w-[100px] flex-1"
        />
        <Input
          value={Array.isArray(agent.mcps) ? agent.mcps.join(', ') : ''}
          onChange={(event) => updatePresetAgent(item.id, { mcps: parseCommaList(event.target.value) })}
          placeholder="mcps"
          className="h-7 min-w-[100px] flex-1"
        />
        {fallbackCount > 0 ? <Badge className="bg-muted text-muted-foreground">fallback {fallbackCount}</Badge> : null}
        <label className="flex h-7 items-center gap-1.5 rounded border border-border/70 px-2 typography-micro">
          <Checkbox checked={disabled} onChange={(checked) => setAgentDisabled(item.id, checked)} disabled={item.id === 'orchestrator'} />
          禁用
        </label>
        <Button type="button" size="xs" variant="outline" onClick={() => onAdvanced(item.id)}>高级</Button>
      </div>
    </div>
  );
}

function SlimAgentsSection() {
  const config = useSlimConfigStore((state) => state.config);
  const draft = useSlimConfigStore((state) => state.draft);
  const [advancedAgent, setAdvancedAgent] = React.useState<string | null>(null);
  const knownIds = new Set(SLIM_AGENT_DEFINITIONS.map((agent) => agent.id));
  const items = config?.agents?.length ? config.agents : SLIM_AGENT_DEFINITIONS.map((agent) => ({
    id: agent.id,
    label: agent.label,
    description: agent.description,
    group: agent.group,
    defaultModel: agent.defaultModel ?? null,
    defaultVariant: agent.defaultVariant ?? null,
    disabled: Array.isArray(draft.disabled_agents) && draft.disabled_agents.includes(agent.id),
    projectDisabled: false,
    override: getPresetAgent(draft, agent.id),
    projectOverride: false,
  }));
  const itemIds = new Set(items.map((item) => item.id));
  const rawPreset = draft.presets?.[getActivePreset(draft)] ?? {};
  const customItems: SlimAgentItem[] = Object.keys(rawPreset)
    .filter((id) => !knownIds.has(id) && !itemIds.has(id))
    .sort()
    .map((id) => ({
      id,
      label: id,
      description: 'Custom / Unknown',
      group: 'custom',
      defaultModel: null,
      defaultVariant: null,
      disabled: Array.isArray(draft.disabled_agents) && draft.disabled_agents.includes(id),
      projectDisabled: false,
      override: getPresetAgent(draft, id),
      projectOverride: false,
    }));
  const allItems = [...items.filter((item) => item.group !== 'custom'), ...items.filter((item) => item.group === 'custom'), ...customItems];

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="border-b border-border/70 px-3 py-2">
        <h3 className="typography-ui-label font-semibold text-foreground">Agent 路由</h3>
        <p className="typography-micro text-muted-foreground">常用模型、强度、skills/mcps 和启停。</p>
      </div>
      {allItems.map((item) => <SlimAgentRow key={item.id} item={item} onAdvanced={setAdvancedAgent} />)}
      <AgentAdvancedDialog agentId={advancedAgent} onClose={() => setAdvancedAgent(null)} />
    </section>
  );
}

function FallbackSection() {
  const draft = useSlimConfigStore((state) => state.draft);
  const updateDraftPath = useSlimConfigStore((state) => state.updateDraftPath);
  const fallback = (draft.fallback ?? {}) as Record<string, unknown>;
  const chains = (fallback.chains && typeof fallback.chains === 'object' && !Array.isArray(fallback.chains) ? fallback.chains : {}) as Record<string, unknown>;

  return (
    <Section title="Fallback" description="模型失败、空响应或超时时的兜底链。">
      <div className="grid gap-3 lg:grid-cols-4">
        <label className="flex h-9 items-center gap-2 rounded-md border border-border/70 px-2">
          <Checkbox checked={fallback.enabled !== false} onChange={(checked) => updateDraftPath(['fallback', 'enabled'], checked)} />
          <span className="typography-ui">启用 fallback</span>
        </label>
        <Field label="Timeout ms">
          <Input value={fallback.timeoutMs == null ? '' : String(fallback.timeoutMs)} onChange={(event) => updateDraftPath(['fallback', 'timeoutMs'], normalizeNumberInput(event.target.value))} placeholder="15000" />
        </Field>
        <Field label="Retry delay ms">
          <Input value={fallback.retryDelayMs == null ? '' : String(fallback.retryDelayMs)} onChange={(event) => updateDraftPath(['fallback', 'retryDelayMs'], normalizeNumberInput(event.target.value))} placeholder="500" />
        </Field>
        <label className="flex h-9 items-center gap-2 rounded-md border border-border/70 px-2">
          <Checkbox checked={fallback.retry_on_empty !== false} onChange={(checked) => updateDraftPath(['fallback', 'retry_on_empty'], checked)} />
          <span className="typography-ui">空响应重试</span>
        </label>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {SLIM_AGENT_DEFINITIONS.slice(0, 6).map((agent) => (
          <Field key={agent.id} label={`${agent.label} chain`}>
            <Input
              value={Array.isArray(chains[agent.id]) ? (chains[agent.id] as string[]).join(', ') : ''}
              onChange={(event) => updateDraftPath(['fallback', 'chains', agent.id], parseCommaList(event.target.value))}
              placeholder="provider/model, provider/fallback"
              className="font-mono typography-meta"
            />
          </Field>
        ))}
      </div>
    </Section>
  );
}

function RuntimeAdvancedSection() {
  const draft = useSlimConfigStore((state) => state.draft);
  const updateDraftPath = useSlimConfigStore((state) => state.updateDraftPath);
  const multiplexer = (draft.multiplexer ?? {}) as Record<string, unknown>;

  return (
    <Section title="运行时高级" description="Multiplexer、自动更新、MCP 禁用和会话续跑。">
      <div className="grid gap-3 lg:grid-cols-4">
        <label className="flex h-9 items-center gap-2 rounded-md border border-border/70 px-2">
          <Checkbox checked={draft.autoUpdate === true} onChange={(checked) => updateDraftPath(['autoUpdate'], checked)} />
          <span className="typography-ui">autoUpdate</span>
        </label>
        <Field label="Multiplexer">
          <Select value={typeof multiplexer.type === 'string' ? multiplexer.type : 'none'} onValueChange={(value) => updateDraftPath(['multiplexer', 'type'], normalizeMultiplexerType(value))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MULTIPLEXER_TYPES.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Layout">
          <Select value={typeof multiplexer.layout === 'string' ? multiplexer.layout : 'main-vertical'} onValueChange={(value) => updateDraftPath(['multiplexer', 'layout'], normalizeMultiplexerLayout(value))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {MULTIPLEXER_LAYOUTS.map((layout) => <SelectItem key={layout} value={layout}>{layout}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Main pane %">
          <Input value={multiplexer.main_pane_size == null ? '' : String(multiplexer.main_pane_size)} onChange={(event) => updateDraftPath(['multiplexer', 'main_pane_size'], normalizeNumberInput(event.target.value, 'mainPane'))} placeholder="60" />
        </Field>
        <Field label="disabled_mcps">
          <Input value={Array.isArray(draft.disabled_mcps) ? draft.disabled_mcps.join(', ') : ''} onChange={(event) => updateDraftPath(['disabled_mcps'], parseCommaList(event.target.value))} placeholder="context7, websearch" />
        </Field>
        <JsonObjectField label="sessionManager" path={['sessionManager']} value={draft.sessionManager} />
        <JsonObjectField label="todoContinuation" path={['todoContinuation']} value={draft.todoContinuation} />
      </div>
    </Section>
  );
}

function JsonObjectField({ label, value, path }: { label: string; value: unknown; path: Array<string | number> }) {
  const updateDraftPath = useSlimConfigStore((state) => state.updateDraftPath);
  const [text, setText] = React.useState(stringifyJson(value));
  React.useEffect(() => setText(stringifyJson(value)), [value]);
  return (
    <Field label={label}>
      <div className="grid gap-1">
        <Textarea value={text} onChange={(event) => setText(event.target.value)} className="min-h-[88px] font-mono typography-meta" placeholder="{}" />
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => {
            try {
              updateDraftPath(path, parseJsonObject(text));
              toast.success(`${label} 已更新`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'JSON 解析失败');
            }
          }}
        >
          应用 JSON
        </Button>
      </div>
    </Field>
  );
}

function FeatureAdvancedSection() {
  const draft = useSlimConfigStore((state) => state.draft);
  return (
    <Section title="Council / Divoom / Interview" description="低频能力收在这里，按需展开编辑。">
      <div className="grid gap-3 lg:grid-cols-3">
        <JsonObjectField label="council" path={['council']} value={draft.council} />
        <JsonObjectField label="divoom" path={['divoom']} value={draft.divoom} />
        <JsonObjectField label="interview" path={['interview']} value={draft.interview} />
      </div>
    </Section>
  );
}

function SlimPanel() {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const config = useSlimConfigStore((state) => state.config);
  const draft = useSlimConfigStore((state) => state.draft);
  const initialDraft = useSlimConfigStore((state) => state.initialDraft);
  const isLoading = useSlimConfigStore((state) => state.isLoading);
  const isSaving = useSlimConfigStore((state) => state.isSaving);
  const error = useSlimConfigStore((state) => state.error);
  const loadConfig = useSlimConfigStore((state) => state.loadConfig);
  const saveChanges = useSlimConfigStore((state) => state.saveChanges);
  const discardChanges = useSlimConfigStore((state) => state.discardChanges);
  const updateDraftPath = useSlimConfigStore((state) => state.updateDraftPath);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  React.useEffect(() => {
    void loadConfig({ force: true });
    void useConfigStore.getState().loadProviders();
  }, [activeProjectId, loadConfig]);

  const hasChanges = hasSlimDraftChanges(initialDraft, draft);
  const preset = getActivePreset(draft);
  const presetNames = Array.from(new Set([...(config?.presets ?? []), ...Object.keys(draft.presets ?? {}), preset])).filter(Boolean);

  const handleSave = async () => {
    const result = await saveChanges();
    if (!result.ok) {
      toast.error(result.conflict ? '配置已被外部修改，请重新加载后再保存' : result.message || 'Slim 配置保存失败');
      return;
    }
    toast.success('Slim 配置已保存');
  };

  const handleReload = async () => {
    if (hasChanges && typeof window !== 'undefined' && !window.confirm('重新加载会丢弃未保存的更改，继续吗？')) return;
    const ok = await loadConfig({ force: true });
    if (ok) {
      toast.success('Slim 配置已重新加载');
    } else {
      toast.error('Slim 配置加载失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/70 bg-[var(--surface-elevated)] px-3 py-2">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={config?.plugin.enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                {config?.plugin.enabled ? 'Slim 已启用' : 'Slim 未启用'}
              </Badge>
              {config?.project.exists ? <Badge className="bg-[var(--status-warning)]/10 text-[var(--status-warning)]">项目覆盖</Badge> : null}
              {hasChanges ? <Badge className="bg-primary/10 text-primary">有未保存更改</Badge> : null}
            </div>
            <div className="break-all font-mono typography-micro text-muted-foreground">{config?.target.path ?? '正在读取配置路径...'}</div>
            {config?.project.exists ? <div className="break-all typography-micro text-[var(--status-warning)]">当前项目存在覆盖：{config.project.path}</div> : null}
            {error ? <div className="typography-micro text-[var(--status-error)]">{error}</div> : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={handleReload} disabled={isLoading || isSaving}>
              <RiRefreshLine className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              重新加载
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => setPreviewOpen(true)}>
              <RiCodeLine className="h-3.5 w-3.5" />
              JSON 预览
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={discardChanges} disabled={!hasChanges || isSaving}>放弃更改</Button>
            <Button type="button" size="xs" onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? <RiRefreshLine className="h-3.5 w-3.5 animate-spin" /> : <RiSaveLine className="h-3.5 w-3.5" />}
              {isSaving ? '保存中' : '保存更改'}
            </Button>
          </div>
        </div>
      </div>

      <section className="rounded-lg border border-border/70 bg-background p-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(180px,260px)_1fr] lg:items-end">
          <Field label="Active preset">
            <Select value={preset} onValueChange={(value) => updateDraftPath(['preset'], value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {presetNames.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="新 preset 名称">
            <Input
              placeholder="输入后回车创建/切换"
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                const value = event.currentTarget.value.trim();
                if (!value) return;
                updateDraftPath(['preset'], value);
                updateDraftPath(['presets', value], {});
                event.currentTarget.value = '';
              }}
            />
          </Field>
        </div>
      </section>

      <SlimAgentsSection />
      <FallbackSection />
      <RuntimeAdvancedSection />
      <FeatureAdvancedSection />
      <JsonPreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} draft={draft} expectedMtimeMs={config?.target.mtimeMs ?? null} />
    </div>
  );
}

function PackageActions({ plugin }: { plugin: 'slim' | 'omo' }) {
  const config = useAgentOrchestrationStore((state) => state.config);
  const isRunning = useAgentOrchestrationStore((state) => state.isPackageActionRunning);
  const runPackageAction = useAgentOrchestrationStore((state) => state.runPackageAction);
  const status = plugin === 'slim' ? config?.packages.slim : config?.packages.omo;
  const label = plugin === 'slim' ? 'Slim' : 'OMO';

  const run = async (action: 'install' | 'update' | 'uninstall') => {
    const result = await runPackageAction(plugin, action, {
      clearCache: action === 'update',
      deleteConfig: false,
    });
    if (!result.ok) {
      toast.error(result.message || `${label} ${action} 失败`);
      return;
    }
    toast.success(`${label} ${action} 已完成`);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge className={status?.installed ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
        {status?.installed ? `${status.version ?? 'installed'}` : '等待 OpenCode 安装'}
      </Badge>
      <Button type="button" size="xs" variant="outline" onClick={() => void run('install')} disabled={isRunning}>
        <RiDownloadCloud2Line className="h-3.5 w-3.5" />
        安装/启用
      </Button>
      <Button type="button" size="xs" variant="outline" onClick={() => void run('update')} disabled={isRunning}>
        <RiRestartLine className="h-3.5 w-3.5" />
        更新
      </Button>
      <Button type="button" size="xs" variant="outline" onClick={() => void run('uninstall')} disabled={isRunning}>
        卸载
      </Button>
    </div>
  );
}

export const AgentOrchestrationPage: React.FC = () => {
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const config = useAgentOrchestrationStore((state) => state.config);
  const isLoading = useAgentOrchestrationStore((state) => state.isLoading);
  const isSavingMode = useAgentOrchestrationStore((state) => state.isSavingMode);
  const error = useAgentOrchestrationStore((state) => state.error);
  const loadConfig = useAgentOrchestrationStore((state) => state.loadConfig);
  const setMode = useAgentOrchestrationStore((state) => state.setMode);
  const effectiveMode = config?.mode.effective ?? 'native';

  React.useEffect(() => {
    void loadConfig({ force: true });
  }, [activeProjectId, loadConfig]);

  React.useEffect(() => {
    if (effectiveMode === 'slim') void useSlimConfigStore.getState().loadConfig({ force: true });
    if (effectiveMode === 'omo') void useOpenAgentConfigStore.getState().loadConfig({ force: true });
  }, [effectiveMode]);

  const handleModeSelect = async (mode: Exclude<SlimMode, 'conflict'>) => {
    if (mode === effectiveMode) return;
    const result = await setMode(mode);
    if (!result.ok) {
      toast.error(result.conflict ? 'OpenCode 配置已被外部修改，请重新加载' : result.message || '模式切换失败');
      return;
    }
    toast.success('Agent 编排模式已更新');
  };

  return (
    <SettingsPageLayout className="max-w-6xl space-y-4">
      <div className="space-y-1">
        <h2 className="typography-ui-header font-semibold text-foreground">Agent 编排</h2>
        <p className="typography-ui text-muted-foreground">在原版 OpenCode、轻量 Slim 和重型 OMO 之间切换。</p>
      </div>

      <div className="rounded-lg border border-border/70 bg-[var(--surface-elevated)] p-3">
        <div className="grid gap-2 lg:grid-cols-3">
          <ModeButton mode="native" current={effectiveMode} title="原版 OpenCode" description="不加载额外编排插件。" disabled={isSavingMode} onSelect={handleModeSelect} />
          <ModeButton mode="slim" current={effectiveMode} title="Oh My OpenCode Slim" description="少量 specialist，适合日常任务。" disabled={isSavingMode} onSelect={handleModeSelect} />
          <ModeButton mode="omo" current={effectiveMode} title="Oh My OpenAgent / OMO" description="完整多 agent 编排，适合复杂任务。" disabled={isSavingMode} onSelect={handleModeSelect} />
        </div>
        <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={effectiveMode === 'conflict' ? 'bg-[var(--status-error)]/10 text-[var(--status-error)]' : 'bg-primary/10 text-primary'}>
                当前：{effectiveMode}
              </Badge>
              {isLoading ? <Badge className="bg-muted text-muted-foreground">加载中</Badge> : null}
            </div>
            <div className="break-all font-mono typography-micro text-muted-foreground">
              OpenCode 配置：{config?.mode.configPaths.join(' | ') || '未读取'}
            </div>
            {config?.mode.tuiConfigPath ? (
              <div className="break-all font-mono typography-micro text-muted-foreground">TUI 配置：{config.mode.tuiConfigPath}</div>
            ) : null}
            {config?.mode.conflicts.map((conflict) => (
              <div key={conflict} className="typography-micro text-[var(--status-error)]">{conflict}</div>
            ))}
            {error ? <div className="typography-micro text-[var(--status-error)]">{error}</div> : null}
          </div>
          <div className="grid gap-2">
            <PackageActions plugin="slim" />
            <PackageActions plugin="omo" />
          </div>
        </div>
      </div>

      {effectiveMode === 'native' ? (
        <div className="rounded-lg border border-border/70 bg-background px-4 py-10 text-center">
          <RiSparklingLine className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <div className="typography-ui-label font-semibold text-foreground">正在使用原版 OpenCode</div>
          <p className="mt-1 typography-ui text-muted-foreground">默认 agents 会由 OpenCode 自己提供；Slim/OMO 配置文件会保留，方便以后切回。</p>
        </div>
      ) : null}

      {effectiveMode === 'slim' ? <SlimPanel /> : null}
      {effectiveMode === 'omo' ? <OpenAgentPage embedded /> : null}
      {effectiveMode === 'conflict' ? (
        <div className="rounded-lg border border-[var(--status-error)]/40 bg-[var(--status-error)]/5 px-4 py-8 text-center typography-ui text-[var(--status-error)]">
          当前同时检测到 Slim 和 OMO。请选择一个模式，OpenChamber 会清理另一个插件条目。
        </div>
      ) : null}
    </SettingsPageLayout>
  );
};
