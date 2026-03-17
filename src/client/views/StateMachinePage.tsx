import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useApi } from '../hooks/useApi';
import { ZapIcon, SettingsIcon, RefreshCwIcon, UserIcon, ClockIcon } from '../components/Icons';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StateNode {
  id: string;
  label: string;
  color: string;
}

interface MessageTemplate {
  id: string;
  template: string;
  enabled: boolean;
  placeholders: string[];
}

interface Transition {
  id: string;
  from: string;
  to: string;
  trigger: 'hook' | 'timer' | 'poller' | 'pm_action' | 'system';
  triggerLabel: string;
  description: string;
  condition: string;
  hookEvent: string | null;
  messageTemplate: MessageTemplate | null;
}

interface StateMachineResponse {
  states: StateNode[];
  transitions: Transition[];
}

// ---------------------------------------------------------------------------
// Constants — layout positions for each state (x, y center of box)
// ---------------------------------------------------------------------------

const STATE_WIDTH = 130;
const STATE_HEIGHT = 50;

// Main-line states on a single horizontal row; terminal states below
const STATE_POSITIONS: Record<string, { x: number; y: number }> = {
  queued:    { x: 80,  y: 200 },
  launching: { x: 240, y: 200 },
  running:   { x: 400, y: 200 },
  idle:      { x: 560, y: 200 },
  stuck:     { x: 720, y: 200 },
  done:      { x: 480, y: 350 },
  failed:    { x: 720, y: 350 },
};

// Trigger icon components — Lucide-style SVGs replacing emoji
function TriggerIcon({ trigger, size = 14, className }: { trigger: string; size?: number; className?: string }) {
  switch (trigger) {
    case 'hook':
      return <ZapIcon size={size} className={className} />;
    case 'timer':
      return <ClockIcon size={size} className={className} />;
    case 'poller':
      return <RefreshCwIcon size={size} className={className} />;
    case 'pm_action':
      return <UserIcon size={size} className={className} />;
    case 'system':
      return <SettingsIcon size={size} className={className} />;
    default:
      return null;
  }
}

// Inline SVG paths for rendering trigger icons directly inside the diagram SVG context.
// Each entry returns raw SVG elements (not React components) scaled to fit the given size.
function triggerIconSvgPaths(trigger: string, x: number, y: number, size: number, color: string, opacity: number): ReactNode {
  // Translate and scale: Lucide icons use a 24x24 viewBox — scale to target size
  const scale = size / 24;
  const tx = x - size / 2;
  const ty = y - size / 2;
  const commonProps = {
    fill: 'none',
    stroke: color,
    strokeWidth: 2 / scale,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    opacity,
  };

  switch (trigger) {
    case 'hook': // Zap
      return (
        <g transform={`translate(${tx},${ty}) scale(${scale})`} {...commonProps}>
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </g>
      );
    case 'timer': // Clock
      return (
        <g transform={`translate(${tx},${ty}) scale(${scale})`} {...commonProps}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </g>
      );
    case 'poller': // RefreshCw
      return (
        <g transform={`translate(${tx},${ty}) scale(${scale})`} {...commonProps}>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </g>
      );
    case 'pm_action': // User
      return (
        <g transform={`translate(${tx},${ty}) scale(${scale})`} {...commonProps}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </g>
      );
    case 'system': // Settings/Gear
      return (
        <g transform={`translate(${tx},${ty}) scale(${scale})`} {...commonProps}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </g>
      );
    default:
      return null;
  }
}

const TRIGGER_LABELS: Record<string, string> = {
  hook: 'Hook event',
  timer: 'Timer (stuck detector)',
  poller: 'Poller (GitHub)',
  pm_action: 'PM action (API call)',
  system: 'System (queue, recovery)',
};

// ---------------------------------------------------------------------------
// Main-line state ordering (left to right) for arrow classification
// ---------------------------------------------------------------------------
const MAIN_LINE_STATES = ['queued', 'launching', 'running', 'idle', 'stuck'];
const TERMINAL_STATES = ['done', 'failed'];

// ---------------------------------------------------------------------------
// SVG Arrow path helpers — clean polyline routing
// ---------------------------------------------------------------------------

type ArrowKind = 'forward' | 'down' | 'recovery' | 'self';

function classifyArrow(fromId: string, toId: string): ArrowKind {
  if (fromId === toId) return 'self';
  if (TERMINAL_STATES.includes(toId)) return 'down';
  const fi = MAIN_LINE_STATES.indexOf(fromId);
  const ti = MAIN_LINE_STATES.indexOf(toId);
  if (fi >= 0 && ti >= 0 && ti < fi) return 'recovery';
  return 'forward';
}

/** Sibling index for transitions sharing the same (from, to) pair */
function siblingOffset(
  fromId: string,
  toId: string,
  allTransitions: Transition[],
  transitionId: string,
): number {
  const siblings = allTransitions.filter(
    (t) => t.from === fromId && t.to === toId,
  );
  const idx = siblings.findIndex((t) => t.id === transitionId);
  return siblings.length > 1 ? (idx - (siblings.length - 1) / 2) * 14 : 0;
}

/** Compute a polyline / arc path from one state to another */
function computeArrowPath(
  fromId: string,
  toId: string,
  allTransitions: Transition[],
  transitionId: string,
): string {
  const from = STATE_POSITIONS[fromId];
  const to = STATE_POSITIONS[toId];
  if (!from || !to) return '';

  const kind = classifyArrow(fromId, toId);
  const sOff = siblingOffset(fromId, toId, allTransitions, transitionId);

  const halfW = STATE_WIDTH / 2 + 4;
  const halfH = STATE_HEIGHT / 2 + 4;

  switch (kind) {
    case 'forward': {
      // Straight horizontal arrow from right edge to left edge
      const y = from.y + sOff;
      const x1 = from.x + halfW;
      const x2 = to.x - halfW;
      return `M ${x1} ${y} L ${x2} ${y}`;
    }
    case 'down': {
      // Vertical drop then horizontal jog to terminal state
      const x1 = from.x + sOff;
      const y1 = from.y + halfH;
      const x2 = to.x;
      const y2 = to.y - halfH;
      if (Math.abs(x1 - x2) < 2) {
        // Straight down
        return `M ${x1} ${y1} L ${x2} ${y2}`;
      }
      // 90-degree corner: go down then across
      const midY = (y1 + y2) / 2;
      return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }
    case 'recovery': {
      // Arc above the main line going left (from right state back to left state)
      const x1 = from.x;
      const y1 = from.y - halfH;
      const x2 = to.x;
      const y2 = to.y - halfH;
      // Height of arc above main line — farther states get higher arcs
      const span = Math.abs(x1 - x2);
      const arcY = from.y - halfH - 30 - span * 0.15 + sOff;
      return `M ${x1} ${y1} L ${x1} ${arcY} L ${x2} ${arcY} L ${x2} ${y2}`;
    }
    case 'self': {
      // Small loop above the state
      const cx = from.x + sOff;
      const topY = from.y - halfH;
      const loopH = 30;
      const loopW = 20;
      return `M ${cx - loopW} ${topY} C ${cx - loopW} ${topY - loopH}, ${cx + loopW} ${topY - loopH}, ${cx + loopW} ${topY}`;
    }
    default:
      return '';
  }
}

/** Get the label position for an arrow */
function getPathMidpoint(
  fromId: string,
  toId: string,
  allTransitions: Transition[],
  transitionId: string,
): { x: number; y: number } {
  const from = STATE_POSITIONS[fromId];
  const to = STATE_POSITIONS[toId];
  if (!from || !to) return { x: 0, y: 0 };

  const kind = classifyArrow(fromId, toId);
  const sOff = siblingOffset(fromId, toId, allTransitions, transitionId);
  const halfW = STATE_WIDTH / 2 + 4;
  const halfH = STATE_HEIGHT / 2 + 4;

  switch (kind) {
    case 'forward': {
      const y = from.y + sOff - 10;
      const x = (from.x + halfW + to.x - halfW) / 2;
      return { x, y };
    }
    case 'down': {
      const x1 = from.x + sOff;
      const x2 = to.x;
      const y1 = from.y + halfH;
      const y2 = to.y - halfH;
      return { x: (x1 + x2) / 2 + 10, y: (y1 + y2) / 2 };
    }
    case 'recovery': {
      const x1 = from.x;
      const x2 = to.x;
      const span = Math.abs(x1 - x2);
      const arcY = from.y - halfH - 30 - span * 0.15 + sOff;
      return { x: (x1 + x2) / 2, y: arcY - 8 };
    }
    case 'self': {
      const topY = from.y - halfH - 30;
      return { x: from.x + sOff, y: topY - 4 };
    }
    default:
      return { x: 0, y: 0 };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StateMachinePage() {
  const api = useApi();
  const [data, setData] = useState<StateMachineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<string | null>(null);

  // Message template editing state
  const [editTemplate, setEditTemplate] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const result = await api.get<StateMachineResponse>('state-machine');
      setData(result);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // When a transition is selected, populate editing state
  useEffect(() => {
    if (!data || !selectedTransition) return;
    const t = data.transitions.find((tr) => tr.id === selectedTransition);
    if (t?.messageTemplate) {
      setEditTemplate(t.messageTemplate.template);
      setEditEnabled(t.messageTemplate.enabled);
    }
    setSaveMessage(null);
  }, [selectedTransition, data]);

  const handleSave = useCallback(async () => {
    if (!data || !selectedTransition) return;
    const t = data.transitions.find((tr) => tr.id === selectedTransition);
    if (!t?.messageTemplate) return;

    setSaving(true);
    setSaveMessage(null);
    try {
      await api.put(`message-templates/${t.messageTemplate.id}`, {
        template: editTemplate,
        enabled: editEnabled,
      });
      // Refresh data
      await fetchData();
      setSaveMessage('Saved successfully');
    } catch (err: unknown) {
      setSaveMessage(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [api, data, selectedTransition, editTemplate, editEnabled, fetchData]);

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-muted text-sm">Loading state machine...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-[#F85149] text-sm mb-2">Failed to load state machine</p>
          <p className="text-dark-muted text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const selected = selectedTransition
    ? data.transitions.find((t) => t.id === selectedTransition) ?? null
    : null;

  const stateColorMap: Record<string, string> = {};
  for (const s of data.states) {
    stateColorMap[s.id] = s.color;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-dark-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-dark-text">State Machine</h1>
            <p className="text-dark-muted text-sm mt-1">
              Team lifecycle transitions and message templates
            </p>
          </div>
          {/* Legend */}
          <div className="flex items-center gap-4 text-xs text-dark-muted">
            {Object.entries(TRIGGER_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center gap-1.5">
                <TriggerIcon trigger={key} size={14} className="text-[#8B949E]" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main content — two panels */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel — State diagram (60%) */}
        <div className="w-[60%] min-w-0 p-4 overflow-auto border-r border-dark-border">
          <svg
            viewBox="0 0 850 440"
            className="w-full h-auto"
            style={{ minHeight: 400 }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="10"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#8B949E" />
              </marker>
              <marker
                id="arrowhead-selected"
                markerWidth="10"
                markerHeight="7"
                refX="10"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#58A6FF" />
              </marker>
            </defs>

            {/* Transition arrows (rendered first so states draw on top) */}
            {data.transitions.map((t) => {
              const isSelected = t.id === selectedTransition;
              const pathD = computeArrowPath(t.from, t.to, data.transitions, t.id);
              const mid = getPathMidpoint(t.from, t.to, data.transitions, t.id);

              return (
                <g
                  key={t.id}
                  className="cursor-pointer"
                  onClick={() => setSelectedTransition(t.id)}
                >
                  {/* Wider invisible hit area */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                  />
                  {/* Visible arrow */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isSelected ? '#58A6FF' : '#8B949E'}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    markerEnd={isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)'}
                    opacity={selectedTransition && !isSelected ? 0.3 : 1}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {/* Trigger icon near midpoint */}
                  {triggerIconSvgPaths(
                    t.trigger,
                    mid.x,
                    mid.y,
                    14,
                    isSelected ? '#58A6FF' : '#8B949E',
                    selectedTransition && !isSelected ? 0.3 : 1,
                  )}
                </g>
              );
            })}

            {/* State boxes */}
            {data.states.map((state) => {
              const pos = STATE_POSITIONS[state.id];
              if (!pos) return null;

              // Tinted background: base #0D1117 blended with ~10% of the status color
              const tintBg = `${state.color}18`;

              return (
                <g key={state.id}>
                  {/* Box fill (tinted dark) */}
                  <rect
                    x={pos.x - STATE_WIDTH / 2}
                    y={pos.y - STATE_HEIGHT / 2}
                    width={STATE_WIDTH}
                    height={STATE_HEIGHT}
                    rx="8"
                    ry="8"
                    fill="#0D1117"
                  />
                  {/* Tint overlay */}
                  <rect
                    x={pos.x - STATE_WIDTH / 2}
                    y={pos.y - STATE_HEIGHT / 2}
                    width={STATE_WIDTH}
                    height={STATE_HEIGHT}
                    rx="8"
                    ry="8"
                    fill={tintBg}
                  />
                  {/* Border */}
                  <rect
                    x={pos.x - STATE_WIDTH / 2}
                    y={pos.y - STATE_HEIGHT / 2}
                    width={STATE_WIDTH}
                    height={STATE_HEIGHT}
                    rx="8"
                    ry="8"
                    fill="none"
                    stroke={state.color}
                    strokeWidth="2"
                  />
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="14"
                    fontWeight="700"
                    fill={state.color}
                    className="select-none"
                  >
                    {state.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Right panel — Transition detail (40%) */}
        <div className="w-[40%] min-w-0 p-4 overflow-auto">
          {!selected ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-dark-muted text-sm text-center">
                Click an arrow in the diagram to view transition details
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              {/* From / To badges */}
              <div className="flex items-center gap-3">
                <span
                  className="px-3 py-1 rounded-full text-sm font-semibold"
                  style={{
                    backgroundColor: `${stateColorMap[selected.from]}20`,
                    color: stateColorMap[selected.from],
                    border: `1px solid ${stateColorMap[selected.from]}40`,
                  }}
                >
                  {selected.from}
                </span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B949E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14"/>
                  <path d="m12 5 7 7-7 7"/>
                </svg>
                <span
                  className="px-3 py-1 rounded-full text-sm font-semibold"
                  style={{
                    backgroundColor: `${stateColorMap[selected.to]}20`,
                    color: stateColorMap[selected.to],
                    border: `1px solid ${stateColorMap[selected.to]}40`,
                  }}
                >
                  {selected.to}
                </span>
              </div>

              {/* Trigger */}
              <div>
                <label className="text-xs font-medium text-dark-muted uppercase tracking-wider">
                  Trigger
                </label>
                <div className="mt-1 flex items-center gap-2 text-sm text-dark-text">
                  <TriggerIcon trigger={selected.trigger} size={16} className="text-[#8B949E]" />
                  <span>{selected.triggerLabel}</span>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-xs font-medium text-dark-muted uppercase tracking-wider">
                  Description
                </label>
                <p className="mt-1 text-sm text-dark-text">{selected.description}</p>
              </div>

              {/* Condition */}
              <div>
                <label className="text-xs font-medium text-dark-muted uppercase tracking-wider">
                  Condition
                </label>
                <p className="mt-1 text-sm text-dark-muted font-mono text-xs bg-dark-base/50 px-2 py-1 rounded">
                  {selected.condition}
                </p>
              </div>

              {/* Hook event */}
              {selected.hookEvent && (
                <div>
                  <label className="text-xs font-medium text-dark-muted uppercase tracking-wider">
                    Hook Event
                  </label>
                  <p className="mt-1">
                    <code className="text-dark-accent font-mono text-xs bg-dark-base/50 px-1.5 py-0.5 rounded">
                      {selected.hookEvent}
                    </code>
                  </p>
                </div>
              )}

              {/* Divider */}
              <hr className="border-dark-border" />

              {/* Message template */}
              {!selected.messageTemplate ? (
                <div className="bg-dark-base/50 rounded-lg p-4 text-center">
                  <p className="text-dark-muted text-sm">
                    No message template for this transition
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-dark-muted uppercase tracking-wider">
                      Message Template
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditEnabled(!editEnabled)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        editEnabled ? 'bg-[#3FB950]' : 'bg-dark-border'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                          editEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`}
                      />
                    </button>
                  </div>

                  <textarea
                    value={editTemplate}
                    onChange={(e) => setEditTemplate(e.target.value)}
                    rows={4}
                    className={`w-full text-sm font-mono rounded-lg px-3 py-2 resize-y bg-dark-base border ${
                      editEnabled
                        ? 'border-[#3FB950]/50 text-dark-text'
                        : 'border-dark-border text-dark-muted'
                    } focus:outline-none focus:ring-1 ${
                      editEnabled ? 'focus:ring-[#3FB950]/50' : 'focus:ring-dark-border'
                    }`}
                  />

                  {/* Placeholders */}
                  <div>
                    <label className="text-xs font-medium text-dark-muted uppercase tracking-wider">
                      Available Placeholders
                    </label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selected.messageTemplate.placeholders.map((p) => (
                        <code
                          key={p}
                          className="text-xs font-mono px-1.5 py-0.5 rounded bg-dark-accent/10 text-dark-accent border border-dark-accent/20"
                        >
                          {`{{${p}}}`}
                        </code>
                      ))}
                    </div>
                  </div>

                  {/* Save button */}
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-1.5 text-sm font-medium rounded-md bg-dark-accent text-white hover:bg-dark-accent/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    {saveMessage && (
                      <span
                        className={`text-xs ${
                          saveMessage.includes('success')
                            ? 'text-[#3FB950]'
                            : 'text-[#F85149]'
                        }`}
                      >
                        {saveMessage}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
