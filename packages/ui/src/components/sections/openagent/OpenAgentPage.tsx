import React from 'react';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiCodeLine,
  RiDeleteBinLine,
  RiEditLine,
  RiRefreshLine,
  RiRestartLine,
  RiSaveLine,
} from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useConfigStore } from '@/stores/useConfigStore';
import { useOpenAgentConfigStore, type OpenAgentConfigItem } from '@/stores/useOpenAgentConfigStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import {
  OPEN_AGENT_AGENT_DEFINITIONS,
  OPEN_AGENT_CATEGORY_DEFINITIONS,
  buildOpenAgentSavePayload,
  countFallbackModels,
  fallbackModelsToRows,
  fallbackRowsToConfig,
  hasOpenAgentDraftChanges,
  joinModelRef,
  normalizeOpenAgentRecord,
  parseModelRef,
  type OpenAgentDraft,
  type OpenAgentFallbackRow,
  type OpenAgentKind,
  type OpenAgentOverride,
} from './openAgentConfig';

const INHERIT_VALUE = '__inherit__';
const REASONING_OPTIONS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const TEXT_VERBOSITY_OPTIONS = ['low', 'medium', 'high'];
const THINKING_OPTIONS = ['enabled', 'disabled'];

type OpenAgentGroup = 'main' | 'sub' | 'category' | 'custom';

type OpenAgentDisplayItem = {
  id: string;
  label: string;
  description: string;
  group: OpenAgentGroup;
  defaultModel?: string | null;
  defaultVariant?: string | null;
};

type EditingTarget = {
  kind: OpenAgentKind;
  id: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const asString = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : String(value);
};

const getDraftRecord = (draft: OpenAgentDraft, kind: OpenAgentKind) => (
  kind === 'agent' ? draft.agents : draft.categories
);

const toDisplayItems = (items: OpenAgentConfigItem[] | undefined, kind: OpenAgentKind): OpenAgentDisplayItem[] => {
  if (items && items.length > 0) {
    return items.map((item) => ({
      id: item.id,
      label: item.label,
      description: item.description,
      group: item.group,
      defaultModel: item.defaultModel,
      defaultVariant: item.defaultVariant,
    }));
  }

  const source = kind === 'agent' ? OPEN_AGENT_AGENT_DEFINITIONS : OPEN_AGENT_CATEGORY_DEFINITIONS;
  return source.map((item) => ({
    id: item.id,
    label: item.label,
    description: item.description,
    group: item.group,
    defaultModel: item.defaultModel ?? null,
    defaultVariant: item.defaultVariant ?? null,
  }));
};

const buildDisplayItems = (
  configItems: OpenAgentConfigItem[] | undefined,
  kind: OpenAgentKind,
  draft: OpenAgentDraft,
  projectOverrides: string[],
): OpenAgentDisplayItem[] => {
  const base = toDisplayItems(configItems, kind);
  const knownIds = new Set(base.map((item) => item.id));
  const record = getDraftRecord(draft, kind);
  const customIds = Array.from(new Set([
    ...Object.keys(record),
    ...projectOverrides,
  ]))
    .filter((id) => id.trim() && !knownIds.has(id))
    .sort();

  return [
    ...base,
    ...customIds.map((id) => ({
      id,
      label: id,
      description: 'Custom / Unknown',
      group: 'custom' as const,
      defaultModel: null,
      defaultVariant: null,
    })),
  ];
};

const formatDefaultModel = (item: OpenAgentDisplayItem): string => {
  if (!item.defaultModel) return '按插件默认';
  return item.defaultVariant ? `${item.defaultModel} · ${item.defaultVariant}` : item.defaultModel;
};

const getEntry = (draft: OpenAgentDraft, kind: OpenAgentKind, id: string): OpenAgentOverride => (
  getDraftRecord(draft, kind)[id] ?? {}
);

const getItemStatus = (
  entry: OpenAgentOverride,
  hasUserOverride: boolean,
  hasProjectOverride: boolean,
): { label: string; className: string } => {
  if (entry.disable === true) {
    return { label: '已禁用', className: 'bg-[var(--status-error)]/10 text-[var(--status-error)]' };
  }
  if (hasUserOverride) {
    return { label: '已覆盖', className: 'bg-primary/10 text-primary' };
  }
  if (hasProjectOverride) {
    return { label: '项目覆盖', className: 'bg-[var(--status-warning)]/10 text-[var(--status-warning)]' };
  }
  return { label: '继承默认', className: 'bg-muted text-muted-foreground' };
};

const normalizeCustomId = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '-');

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center rounded px-1.5 typography-micro font-medium', className)}>
      {children}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5">
      <span className="typography-ui-label text-foreground">{label}</span>
      {children}
      {hint ? <span className="typography-micro text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

function CompactModelEditor({
  model,
  onChange,
  placeholder = '继承默认',
}: {
  model: string;
  onChange: (model: string) => void;
  placeholder?: string;
}) {
  const parsed = parseModelRef(model);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ModelSelector
        providerId={parsed.providerId}
        modelId={parsed.modelId}
        onChange={(providerId, modelId) => onChange(joinModelRef(providerId, modelId))}
        placeholder={placeholder}
        className="h-7 max-w-[210px]"
      />
      <Input
        value={model}
        onChange={(event) => onChange(event.target.value)}
        placeholder="provider/model"
        className="h-7 min-w-[150px] font-mono typography-meta"
      />
    </div>
  );
}

function JsonTextareaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: unknown;
  onChange: (value: unknown) => void;
  placeholder?: string;
}) {
  const [text, setText] = React.useState(() => (
    value === undefined || value === null ? '' : JSON.stringify(value, null, 2)
  ));
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setText(value === undefined || value === null ? '' : JSON.stringify(value, null, 2));
    setError(null);
  }, [value]);

  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError(null);
      onChange(undefined);
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (!isRecord(parsed)) {
        setError('需要 JSON object');
        return;
      }
      setError(null);
      onChange(parsed);
    } catch {
      setError('JSON 格式不正确');
    }
  };

  return (
    <Field label={label} hint={error ?? placeholder}>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        rows={4}
        outerClassName={cn('min-h-[112px]', error && 'ring-[var(--status-error)]')}
        className="font-mono typography-meta"
        placeholder="{ }"
      />
    </Field>
  );
}

function AddCustomControl({
  kind,
  onAdd,
}: {
  kind: OpenAgentKind;
  onAdd: (kind: OpenAgentKind, id: string) => void;
}) {
  const [value, setValue] = React.useState('');

  const handleAdd = () => {
    const id = normalizeCustomId(value);
    if (!id) return;
    onAdd(kind, id);
    setValue('');
  };

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            handleAdd();
          }
        }}
        placeholder={kind === 'agent' ? 'custom-agent-id' : 'custom-category-id'}
        className="h-7 w-44 typography-meta"
      />
      <Button type="button" size="xs" variant="outline" onClick={handleAdd} disabled={!value.trim()}>
        <RiAddLine className="h-3.5 w-3.5" />
        添加
      </Button>
    </div>
  );
}

function OpenAgentRow({
  kind,
  item,
  draft,
  projectOverride,
  onEdit,
}: {
  kind: OpenAgentKind;
  item: OpenAgentDisplayItem;
  draft: OpenAgentDraft;
  projectOverride: boolean;
  onEdit: (target: EditingTarget) => void;
}) {
  const updateDraftItem = useOpenAgentConfigStore((state) => state.updateDraftItem);
  const resetItem = useOpenAgentConfigStore((state) => state.resetItem);
  const entry = getEntry(draft, kind, item.id);
  const normalizedRecord = normalizeOpenAgentRecord(kind, getDraftRecord(draft, kind));
  const normalizedEntry = normalizedRecord[item.id];
  const model = asString(entry.model);
  const fallbackCount = countFallbackModels(entry.fallback_models);
  const status = getItemStatus(entry, Boolean(normalizedEntry), projectOverride);

  return (
    <div className="grid min-h-[58px] grid-cols-1 gap-2 border-t border-border/50 px-3 py-2 first:border-t-0 lg:grid-cols-[minmax(190px,1.15fr)_minmax(160px,0.9fr)_minmax(260px,1.2fr)_90px_104px_86px] lg:items-center">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate typography-ui-label font-medium text-foreground">{item.label}</span>
          {projectOverride ? (
            <Badge className="bg-[var(--status-warning)]/10 text-[var(--status-warning)]">项目覆盖</Badge>
          ) : null}
        </div>
        <div className="truncate typography-micro text-muted-foreground">{item.description}</div>
      </div>

      <div className="min-w-0">
        <div className="typography-micro text-muted-foreground lg:hidden">默认模型</div>
        <div className="truncate font-mono typography-meta text-muted-foreground">{formatDefaultModel(item)}</div>
      </div>

      <div className="min-w-0">
        <div className="typography-micro text-muted-foreground lg:hidden">覆盖模型</div>
        <CompactModelEditor
          model={model}
          onChange={(nextModel) => updateDraftItem(kind, item.id, { model: nextModel })}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="typography-micro text-muted-foreground lg:hidden">fallback</span>
        <span className="typography-ui-label text-foreground">{fallbackCount}</span>
      </div>

      <div>
        <Badge className={status.className}>{status.label}</Badge>
      </div>

      <div className="flex items-center gap-1.5 lg:justify-end">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => onEdit({ kind, id: item.id })}
          aria-label={`编辑 ${item.label}`}
          title="编辑高级参数"
        >
          <RiEditLine className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => resetItem(kind, item.id)}
          disabled={!normalizedEntry}
          aria-label={`重置 ${item.label}`}
          title="重置为继承默认"
        >
          <RiRestartLine className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function OpenAgentGroupSection({
  title,
  kind,
  items,
  draft,
  projectOverrides,
  onEdit,
  onAdd,
}: {
  title: string;
  kind: OpenAgentKind;
  items: OpenAgentDisplayItem[];
  draft: OpenAgentDraft;
  projectOverrides: Set<string>;
  onEdit: (target: EditingTarget) => void;
  onAdd?: (kind: OpenAgentKind, id: string) => void;
}) {
  if (items.length === 0 && !onAdd) return null;

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex flex-col gap-2 border-b border-border/70 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="typography-ui-label font-semibold text-foreground">{title}</h3>
          <p className="typography-micro text-muted-foreground">模型为空表示继承插件默认；保存时不会写入空字段。</p>
        </div>
        {onAdd ? <AddCustomControl kind={kind} onAdd={onAdd} /> : null}
      </div>
      <div className="hidden grid-cols-[minmax(190px,1.15fr)_minmax(160px,0.9fr)_minmax(260px,1.2fr)_90px_104px_86px] gap-2 border-b border-border/50 px-3 py-1.5 typography-micro font-medium text-muted-foreground lg:grid">
        <div>名称</div>
        <div>默认模型</div>
        <div>当前覆盖模型</div>
        <div>fallback</div>
        <div>状态</div>
        <div className="text-right">操作</div>
      </div>
      {items.map((item) => (
        <OpenAgentRow
          key={`${kind}-${item.id}`}
          kind={kind}
          item={item}
          draft={draft}
          projectOverride={projectOverrides.has(item.id)}
          onEdit={onEdit}
        />
      ))}
      {items.length === 0 ? (
        <div className="border-t border-border/50 px-3 py-5 text-center typography-meta text-muted-foreground">
          暂无自定义项。
        </div>
      ) : null}
    </section>
  );
}

function FallbackEditor({
  rows,
  onChange,
}: {
  rows: OpenAgentFallbackRow[];
  onChange: (rows: OpenAgentFallbackRow[]) => void;
}) {
  const updateRow = (id: string, patch: Partial<OpenAgentFallbackRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const moveRow = (index: number, delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= rows.length) return;
    const next = rows.slice();
    const [row] = next.splice(index, 1);
    next.splice(nextIndex, 0, row);
    onChange(next);
  };

  const addRow = () => {
    onChange([
      ...rows,
      {
        id: `fallback-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        model: '',
        variant: '',
        maxTokens: '',
        reasoningEffort: '',
        originalType: 'string',
      },
    ]);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="typography-ui-label text-foreground">fallback_models</div>
          <div className="typography-micro text-muted-foreground">按顺序尝试；清空列表会删除这个字段。</div>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={addRow}>
          <RiAddLine className="h-3.5 w-3.5" />
          添加
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center typography-meta text-muted-foreground">
          还没有 fallback 模型。
        </div>
      ) : null}

      {rows.map((row, index) => {
        const parsed = parseModelRef(row.model);
        return (
          <div key={row.id} className="rounded-md border border-border/70 p-2">
            <div className="grid gap-2 xl:grid-cols-[minmax(240px,1fr)_110px_96px_96px_120px_80px] xl:items-center">
              <div className="min-w-0 space-y-1.5">
                <ModelSelector
                  providerId={parsed.providerId}
                  modelId={parsed.modelId}
                  onChange={(providerId, modelId) => updateRow(row.id, {
                    model: joinModelRef(providerId, modelId),
                    originalType: row.originalType,
                  })}
                  placeholder="选择 fallback"
                  className="h-7 max-w-full"
                />
                <Input
                  value={row.model}
                  onChange={(event) => updateRow(row.id, { model: event.target.value })}
                  placeholder="provider/model"
                  className="h-7 font-mono typography-meta"
                />
              </div>
              <Input
                value={row.variant}
                onChange={(event) => updateRow(row.id, { variant: event.target.value, originalType: 'object' })}
                placeholder="variant"
                className="h-7 typography-meta"
              />
              <Input
                value={row.maxTokens}
                onChange={(event) => updateRow(row.id, { maxTokens: event.target.value, originalType: 'object' })}
                placeholder="maxTokens"
                className="h-7 typography-meta"
              />
              <Input
                value={row.temperature ?? ''}
                onChange={(event) => updateRow(row.id, { temperature: event.target.value, originalType: 'object' })}
                placeholder="temp"
                className="h-7 typography-meta"
              />
              <Select
                value={row.reasoningEffort || INHERIT_VALUE}
                onValueChange={(value) => updateRow(row.id, {
                  reasoningEffort: value === INHERIT_VALUE ? '' : value,
                  originalType: 'object',
                })}
              >
                <SelectTrigger className="h-7 w-full" size="sm">
                  <SelectValue>{(value) => value === INHERIT_VALUE ? 'reasoning' : value}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT_VALUE}>继承</SelectItem>
                  {REASONING_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-end gap-1">
                <Button type="button" size="icon" variant="ghost" onClick={() => moveRow(index, -1)} disabled={index === 0}>
                  <RiArrowUpSLine className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={() => moveRow(index, 1)} disabled={index === rows.length - 1}>
                  <RiArrowDownSLine className="h-4 w-4" />
                </Button>
                <Button type="button" size="icon" variant="ghost" onClick={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}>
                  <RiDeleteBinLine className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Input
                value={row.top_p ?? ''}
                onChange={(event) => updateRow(row.id, { top_p: event.target.value, originalType: 'object' })}
                placeholder="top_p"
                className="h-7 typography-meta"
              />
              <Select
                value={row.thinkingType || INHERIT_VALUE}
                onValueChange={(value) => updateRow(row.id, {
                  thinkingType: value === INHERIT_VALUE ? '' : value,
                  originalType: 'object',
                })}
              >
                <SelectTrigger className="h-7 w-full" size="sm">
                  <SelectValue>{(value) => value === INHERIT_VALUE ? 'thinking' : value}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={INHERIT_VALUE}>继承</SelectItem>
                  {THINKING_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={row.thinkingBudgetTokens ?? ''}
                onChange={(event) => updateRow(row.id, { thinkingBudgetTokens: event.target.value, originalType: 'object' })}
                placeholder="thinking budget"
                className="h-7 typography-meta"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdvancedDialog({
  target,
  onClose,
}: {
  target: EditingTarget | null;
  onClose: () => void;
}) {
  const draft = useOpenAgentConfigStore((state) => state.draft);
  const updateDraftItem = useOpenAgentConfigStore((state) => state.updateDraftItem);
  const resetItem = useOpenAgentConfigStore((state) => state.resetItem);
  const [fallbackRows, setFallbackRows] = React.useState<OpenAgentFallbackRow[]>([]);

  const entry = target ? getEntry(draft, target.kind, target.id) : {};
  const kind = target?.kind ?? 'agent';
  const id = target?.id ?? '';
  const label = target ? (target.kind === 'agent' ? 'Agent' : 'Category') : '';

  React.useEffect(() => {
    if (!target) {
      setFallbackRows([]);
      return;
    }
    const nextEntry = getEntry(draft, target.kind, target.id);
    setFallbackRows(fallbackModelsToRows(nextEntry.fallback_models));
    // Intentionally keyed to target only; row edits keep local incomplete rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.kind, target?.id]);

  const update = React.useCallback((patch: Record<string, unknown>) => {
    if (!target) return;
    updateDraftItem(target.kind, target.id, patch);
  }, [target, updateDraftItem]);

  const commitFallbackRows = (rows: OpenAgentFallbackRow[]) => {
    setFallbackRows(rows);
    update({ fallback_models: fallbackRowsToConfig(rows) });
  };

  const thinking: Record<string, unknown> = isRecord(entry.thinking) ? entry.thinking : {};
  const updateThinking = (patch: Record<string, unknown>) => {
    const next = { ...thinking, ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined || value === '') {
        delete next[key];
      }
    }
    update({ thinking: Object.keys(next).length > 0 ? next : undefined });
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="h-[calc(100dvh-2rem)] max-w-3xl gap-0 overflow-hidden p-0 sm:ml-auto sm:mr-0 sm:rounded-l-xl sm:rounded-r-none">
        <DialogHeader className="border-b border-border/70 px-5 py-4">
          <DialogTitle>{label}: {id}</DialogTitle>
          <DialogDescription>
            空字段保存时会删除 override，回到插件默认或不传字段。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-5">
            <section className="grid gap-3 md:grid-cols-2">
              <Field label="model" hint="统一保存为 provider/model，也可以手动输入旧模型。">
                <CompactModelEditor
                  model={asString(entry.model)}
                  onChange={(model) => update({ model })}
                />
              </Field>

              <Field label="variant">
                <Input
                  value={asString(entry.variant)}
                  onChange={(event) => update({ variant: event.target.value })}
                  placeholder="high / max / custom"
                  className="h-8"
                />
              </Field>

              {kind === 'agent' ? (
                <Field label="category">
                  <Input
                    value={asString(entry.category)}
                    onChange={(event) => update({ category: event.target.value })}
                    placeholder="deep / quick / visual-engineering"
                    className="h-8"
                  />
                </Field>
              ) : null}

              <Field label="maxTokens" hint="留空表示不写入输出上限。">
                <Input
                  value={asString(entry.maxTokens)}
                  onChange={(event) => update({ maxTokens: event.target.value })}
                  placeholder="不限制 / 不传"
                  className="h-8"
                />
              </Field>

              <Field label="temperature">
                <Input
                  value={asString(entry.temperature)}
                  onChange={(event) => update({ temperature: event.target.value })}
                  placeholder="0..2"
                  className="h-8"
                />
              </Field>

              <Field label="top_p">
                <Input
                  value={asString(entry.top_p)}
                  onChange={(event) => update({ top_p: event.target.value })}
                  placeholder="0..1"
                  className="h-8"
                />
              </Field>

              <Field label="reasoningEffort">
                <Select
                  value={asString(entry.reasoningEffort) || INHERIT_VALUE}
                  onValueChange={(value) => update({ reasoningEffort: value === INHERIT_VALUE ? undefined : value })}
                >
                  <SelectTrigger className="h-8 w-full" size="lg">
                    <SelectValue>{(value) => value === INHERIT_VALUE ? '继承' : value}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_VALUE}>继承</SelectItem>
                    {REASONING_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="textVerbosity">
                <Select
                  value={asString(entry.textVerbosity) || INHERIT_VALUE}
                  onValueChange={(value) => update({ textVerbosity: value === INHERIT_VALUE ? undefined : value })}
                >
                  <SelectTrigger className="h-8 w-full" size="lg">
                    <SelectValue>{(value) => value === INHERIT_VALUE ? '继承' : value}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_VALUE}>继承</SelectItem>
                    {TEXT_VERBOSITY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="thinking.type">
                <Select
                  value={asString(thinking.type) || INHERIT_VALUE}
                  onValueChange={(value) => updateThinking({ type: value === INHERIT_VALUE ? undefined : value })}
                >
                  <SelectTrigger className="h-8 w-full" size="lg">
                    <SelectValue>{(value) => value === INHERIT_VALUE ? '继承' : value}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_VALUE}>继承</SelectItem>
                    {THINKING_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="thinking.budgetTokens">
                <Input
                  value={asString(thinking.budgetTokens)}
                  onChange={(event) => updateThinking({ budgetTokens: event.target.value })}
                  placeholder="positive integer"
                  className="h-8"
                />
              </Field>

              {kind === 'category' ? (
                <>
                  <Field label="max_prompt_tokens">
                    <Input
                      value={asString(entry.max_prompt_tokens)}
                      onChange={(event) => update({ max_prompt_tokens: event.target.value })}
                      placeholder="positive integer"
                      className="h-8"
                    />
                  </Field>
                  <label className="flex items-center gap-2 self-end pb-2 typography-ui-label text-foreground">
                    <Checkbox
                      checked={entry.is_unstable_agent === true}
                      onChange={(checked) => update({ is_unstable_agent: checked ? true : undefined })}
                      ariaLabel="is unstable agent"
                    />
                    is_unstable_agent
                  </label>
                </>
              ) : null}

              <label className="flex items-center gap-2 self-end pb-2 typography-ui-label text-foreground">
                <Checkbox
                  checked={entry.disable === true}
                  onChange={(checked) => update({ disable: checked ? true : undefined })}
                  ariaLabel="disable"
                />
                disable
              </label>
            </section>

            <FallbackEditor rows={fallbackRows} onChange={commitFallbackRows} />

            <section className="grid gap-3">
              <Field label="prompt_append">
                <Textarea
                  value={asString(entry.prompt_append)}
                  onChange={(event) => update({ prompt_append: event.target.value })}
                  rows={4}
                  outerClassName="min-h-[112px]"
                  className="font-mono typography-meta"
                  placeholder="追加到 prompt 的内容"
                />
              </Field>

              <JsonTextareaField
                label="tools"
                value={entry.tools}
                onChange={(value) => update({ tools: value })}
                placeholder={'JSON object，形如 { "bash": true }。'}
              />

              {kind === 'agent' ? (
                <JsonTextareaField
                  label="providerOptions"
                  value={entry.providerOptions}
                  onChange={(value) => update({ providerOptions: value })}
                  placeholder="providerOptions 会原样作为 JSON object 保存。"
                />
              ) : null}
            </section>
          </div>
        </div>

        <DialogFooter className="border-t border-border/70 px-5 py-3">
          <Button type="button" variant="outline" onClick={() => target && resetItem(target.kind, target.id)}>
            <RiRestartLine className="h-3.5 w-3.5" />
            重置此项
          </Button>
          <Button type="button" onClick={onClose}>完成</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  draft: OpenAgentDraft;
  expectedMtimeMs: number | null;
}) {
  const preview = React.useMemo(() => {
    const payload = buildOpenAgentSavePayload(expectedMtimeMs, draft);
    return JSON.stringify({
      agents: payload.agents,
      categories: payload.categories,
    }, null, 2);
  }, [draft, expectedMtimeMs]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>即将写入的 JSON</DialogTitle>
          <DialogDescription>只展示 OpenChamber 会更新的 agents / categories 片段。</DialogDescription>
        </DialogHeader>
        <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border/70 bg-[var(--surface-elevated)] p-3 font-mono typography-meta text-foreground">
          {preview}
        </pre>
      </DialogContent>
    </Dialog>
  );
}

export const OpenAgentPage: React.FC = () => {
  const { t } = useI18n();
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const config = useOpenAgentConfigStore((state) => state.config);
  const draft = useOpenAgentConfigStore((state) => state.draft);
  const initialDraft = useOpenAgentConfigStore((state) => state.initialDraft);
  const isLoading = useOpenAgentConfigStore((state) => state.isLoading);
  const isSaving = useOpenAgentConfigStore((state) => state.isSaving);
  const error = useOpenAgentConfigStore((state) => state.error);
  const loadConfig = useOpenAgentConfigStore((state) => state.loadConfig);
  const saveChanges = useOpenAgentConfigStore((state) => state.saveChanges);
  const discardChanges = useOpenAgentConfigStore((state) => state.discardChanges);
  const updateDraftItem = useOpenAgentConfigStore((state) => state.updateDraftItem);

  const [editingTarget, setEditingTarget] = React.useState<EditingTarget | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

  React.useEffect(() => {
    void loadConfig({ force: true });
    void useConfigStore.getState().loadProviders();
  }, [activeProjectId, loadConfig]);

  const hasChanges = hasOpenAgentDraftChanges(initialDraft, draft);
  const projectAgentOverrides = React.useMemo(() => new Set(config?.project.overriddenAgents ?? []), [config]);
  const projectCategoryOverrides = React.useMemo(() => new Set(config?.project.overriddenCategories ?? []), [config]);

  const agentItems = React.useMemo(() => buildDisplayItems(
    config?.agents,
    'agent',
    draft,
    config?.project.overriddenAgents ?? [],
  ), [config, draft]);

  const categoryItems = React.useMemo(() => buildDisplayItems(
    config?.categories,
    'category',
    draft,
    config?.project.overriddenCategories ?? [],
  ), [config, draft]);

  const mainAgents = agentItems.filter((item) => item.group === 'main');
  const subAgents = agentItems.filter((item) => item.group === 'sub');
  const customAgents = agentItems.filter((item) => item.group === 'custom');
  const knownCategories = categoryItems.filter((item) => item.group !== 'custom');
  const customCategories = categoryItems.filter((item) => item.group === 'custom');

  const projectOverrideCount = (config?.project.overriddenAgents.length ?? 0) + (config?.project.overriddenCategories.length ?? 0);

  const handleReload = async () => {
    if (hasChanges && typeof window !== 'undefined' && !window.confirm('重新加载会丢弃未保存的更改，继续吗？')) {
      return;
    }
    const ok = await loadConfig({ force: true });
    if (!ok) {
      toast.error('Oh My OpenAgent 配置加载失败');
      return;
    }
    toast.success('Oh My OpenAgent 配置已重新加载');
  };

  const handleSave = async () => {
    const result = await saveChanges();
    if (!result.ok) {
      if (result.conflict) {
        toast.error('配置已被外部修改，请重新加载后再保存');
      } else {
        toast.error(result.message || 'Oh My OpenAgent 配置保存失败');
      }
      return;
    }
    toast.success('Oh My OpenAgent 配置已保存');
  };

  const handleAddCustom = (kind: OpenAgentKind, id: string) => {
    const existingRecord = getDraftRecord(draft, kind);
    if (existingRecord[id]) {
      toast.error('这个 ID 已经存在');
      return;
    }
    updateDraftItem(kind, id, { model: '' });
    setEditingTarget({ kind, id });
  };

  return (
    <SettingsPageLayout className="max-w-6xl space-y-4">
      <div className="space-y-1">
        <h2 className="typography-ui-header font-semibold text-foreground">
          {t('settings.page.openagent.title')}
        </h2>
        <p className="typography-ui text-muted-foreground">
          配置 oh-my-openagent 的 agents / categories 模型路由；当前版本写入服务进程用户的全局配置。
        </p>
      </div>

      <div className="rounded-lg border border-border/70 bg-[var(--surface-elevated)] px-3 py-2">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge className={config?.plugin.detected ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}>
                {config?.plugin.detected ? '插件已检测' : '未检测到插件'}
              </Badge>
              {config?.target.isLegacy ? (
                <Badge className="bg-[var(--status-warning)]/10 text-[var(--status-warning)]">legacy 配置</Badge>
              ) : null}
              {projectOverrideCount > 0 ? (
                <Badge className="bg-[var(--status-warning)]/10 text-[var(--status-warning)]">
                  项目覆盖 {projectOverrideCount}
                </Badge>
              ) : null}
              {hasChanges ? (
                <Badge className="bg-primary/10 text-primary">有未保存更改</Badge>
              ) : null}
            </div>
            <div className="break-all font-mono typography-micro text-muted-foreground">
              {config?.target.path ?? '正在读取配置路径...'}
            </div>
            {config?.project.exists ? (
              <div className="break-all typography-micro text-[var(--status-warning)]">
                当前项目存在覆盖：{config.project.path}
              </div>
            ) : null}
            {error ? <div className="typography-micro text-[var(--status-error)]">{error}</div> : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={handleReload} disabled={isLoading || isSaving}>
              <RiRefreshLine className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
              重新加载
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={() => setIsPreviewOpen(true)}>
              <RiCodeLine className="h-3.5 w-3.5" />
              JSON 预览
            </Button>
            <Button type="button" size="xs" variant="outline" onClick={discardChanges} disabled={!hasChanges || isSaving}>
              放弃更改
            </Button>
            <Button type="button" size="xs" onClick={handleSave} disabled={!hasChanges || isSaving}>
              {isSaving ? <RiRefreshLine className="h-3.5 w-3.5 animate-spin" /> : <RiSaveLine className="h-3.5 w-3.5" />}
              {isSaving ? '保存中' : '保存更改'}
            </Button>
          </div>
        </div>
      </div>

      <OpenAgentGroupSection
        title="主 Agent"
        kind="agent"
        items={mainAgents}
        draft={draft}
        projectOverrides={projectAgentOverrides}
        onEdit={setEditingTarget}
      />

      <OpenAgentGroupSection
        title="子 Agent"
        kind="agent"
        items={subAgents}
        draft={draft}
        projectOverrides={projectAgentOverrides}
        onEdit={setEditingTarget}
      />

      <OpenAgentGroupSection
        title="Categories"
        kind="category"
        items={knownCategories}
        draft={draft}
        projectOverrides={projectCategoryOverrides}
        onEdit={setEditingTarget}
      />

      <OpenAgentGroupSection
        title="Custom / Unknown"
        kind="agent"
        items={customAgents}
        draft={draft}
        projectOverrides={projectAgentOverrides}
        onEdit={setEditingTarget}
        onAdd={handleAddCustom}
      />

      <OpenAgentGroupSection
        title="Custom Categories"
        kind="category"
        items={customCategories}
        draft={draft}
        projectOverrides={projectCategoryOverrides}
        onEdit={setEditingTarget}
        onAdd={handleAddCustom}
      />

      {!isLoading && agentItems.length === 0 && categoryItems.length === 0 ? (
        <div className="rounded-lg border border-border/70 px-4 py-10 text-center typography-ui text-muted-foreground">
          没有读取到 Oh My OpenAgent 配置项。
        </div>
      ) : null}

      <AdvancedDialog target={editingTarget} onClose={() => setEditingTarget(null)} />
      <JsonPreviewDialog
        open={isPreviewOpen}
        onOpenChange={setIsPreviewOpen}
        draft={draft}
        expectedMtimeMs={config?.target.mtimeMs ?? null}
      />
    </SettingsPageLayout>
  );
};
