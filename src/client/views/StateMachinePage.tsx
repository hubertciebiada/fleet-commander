import { useState, useEffect, useCallback } from 'react';
import { useApi } from '../hooks/useApi';

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

const STATE_WIDTH = 120;
const STATE_HEIGHT = 48;

// Positions within the SVG canvas (designed for ~780x460 viewport)
const STATE_POSITIONS: Record<string, { x: number; y: number }> = {
  queued:    { x: 100, y: 60 },
  launching: { x: 320, y: 60 },
  running:   { x: 540, y: 60 },
  idle:      { x: 440, y: 200 },
  done:      { x: 680, y: 200 },
  stuck:     { x: 440, y: 340 },
  failed:    { x: 580, y: 340 },
};

// Trigger icons
const TRIGGER_ICONS: Record<string, string> = {
  hook: '\uD83D\uDD0C',
  timer: '\u23F1',
  poller: '\uD83D\uDD04',
  pm_action: '\uD83D\uDC64',
  system: '\u2699\uFE0F',
};

const TRIGGER_LABELS: Record<string, string> = {
  hook: 'Hook event',
  timer: 'Timer (stuck detector)',
  poller: 'Poller (GitHub)',
  pm_action: 'PM action (API call)',
  system: 'System (queue, recovery)',
};

// ---------------------------------------------------------------------------
// SVG Arrow path helpers
// ---------------------------------------------------------------------------

/** Compute a path from one state box edge to another, with an offset for parallel arrows */
function computeArrowPath(
  fromId: string,
  toId: string,
  allTransitions: Transition[],
  transitionId: string,
): string {
  const from = STATE_POSITIONS[fromId];
  const to = STATE_POSITIONS[toId];
  if (!from || !to) return '';

  // Find how many transitions share the same from/to pair (in either direction) to offset
  const siblings = allTransitions.filter(
    (t) =>
      (t.from === fromId && t.to === toId) ||
      (t.from === toId && t.to === fromId),
  );
  const myIndex = siblings.findIndex((t) => t.id === transitionId);
  const offset = siblings.length > 1 ? (myIndex - (siblings.length - 1) / 2) * 20 : 0;

  // Direction vector
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return '';

  // Unit direction
  const ux = dx / dist;
  const uy = dy / dist;

  // Perpendicular for offset
  const px = -uy;
  const py = ux;

  // Start/end points on box edges
  const startX = from.x + ux * (STATE_WIDTH / 2 + 4) + px * offset;
  const startY = from.y + uy * (STATE_HEIGHT / 2 + 4) + py * offset;
  const endX = to.x - ux * (STATE_WIDTH / 2 + 4) + px * offset;
  const endY = to.y - uy * (STATE_HEIGHT / 2 + 4) + py * offset;

  // Curved path with control point
  const midX = (startX + endX) / 2 + px * 20;
  const midY = (startY + endY) / 2 + py * 20;

  return `M ${startX} ${startY} Q ${midX} ${midY} ${endX} ${endY}`;
}

/** Get the midpoint of a quadratic bezier for label placement */
function getPathMidpoint(
  fromId: string,
  toId: string,
  allTransitions: Transition[],
  transitionId: string,
): { x: number; y: number } {
  const from = STATE_POSITIONS[fromId];
  const to = STATE_POSITIONS[toId];
  if (!from || !to) return { x: 0, y: 0 };

  const siblings = allTransitions.filter(
    (t) =>
      (t.from === fromId && t.to === toId) ||
      (t.from === toId && t.to === fromId),
  );
  const myIndex = siblings.findIndex((t) => t.id === transitionId);
  const offset = siblings.length > 1 ? (myIndex - (siblings.length - 1) / 2) * 20 : 0;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return from;

  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy;
  const py = ux;

  const startX = from.x + ux * (STATE_WIDTH / 2 + 4) + px * offset;
  const startY = from.y + uy * (STATE_HEIGHT / 2 + 4) + py * offset;
  const endX = to.x - ux * (STATE_WIDTH / 2 + 4) + px * offset;
  const endY = to.y - uy * (STATE_HEIGHT / 2 + 4) + py * offset;

  const midCtrlX = (startX + endX) / 2 + px * 20;
  const midCtrlY = (startY + endY) / 2 + py * 20;

  // Quadratic bezier midpoint at t=0.5
  const mx = 0.25 * startX + 0.5 * midCtrlX + 0.25 * endX;
  const my = 0.25 * startY + 0.5 * midCtrlY + 0.25 * endY;

  return { x: mx, y: my };
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
              <span key={key} className="flex items-center gap-1">
                <span className="text-sm">{TRIGGER_ICONS[key]}</span>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main content — two panels */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel — State diagram (60%) */}
        <div className="w-[60%] min-w-0 p-4 overflow-auto border-r border-dark-border">
          <svg
            viewBox="0 0 800 420"
            className="w-full h-auto"
            style={{ minHeight: 380 }}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#8B949E" />
              </marker>
              <marker
                id="arrowhead-selected"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#58A6FF" />
              </marker>
            </defs>

            {/* Transition arrows */}
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
                    strokeDasharray={isSelected ? 'none' : 'none'}
                    markerEnd={isSelected ? 'url(#arrowhead-selected)' : 'url(#arrowhead)'}
                    opacity={selectedTransition && !isSelected ? 0.3 : 1}
                  />
                  {/* Trigger icon at midpoint */}
                  <text
                    x={mid.x}
                    y={mid.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="11"
                    fill={isSelected ? '#58A6FF' : '#8B949E'}
                    opacity={selectedTransition && !isSelected ? 0.3 : 1}
                    className="pointer-events-none select-none"
                  >
                    {TRIGGER_ICONS[t.trigger]}
                  </text>
                </g>
              );
            })}

            {/* State boxes */}
            {data.states.map((state) => {
              const pos = STATE_POSITIONS[state.id];
              if (!pos) return null;

              return (
                <g key={state.id}>
                  <rect
                    x={pos.x - STATE_WIDTH / 2}
                    y={pos.y - STATE_HEIGHT / 2}
                    width={STATE_WIDTH}
                    height={STATE_HEIGHT}
                    rx="8"
                    ry="8"
                    fill="#161B22"
                    stroke={state.color}
                    strokeWidth="2"
                  />
                  <text
                    x={pos.x}
                    y={pos.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize="13"
                    fontWeight="600"
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
                  <span>{TRIGGER_ICONS[selected.trigger]}</span>
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
