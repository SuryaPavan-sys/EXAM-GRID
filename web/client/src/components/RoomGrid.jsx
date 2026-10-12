import { useMemo, useState } from 'react';
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';

// Categorical slots in fixed order (light tints for cell fill, full colour for the edge).
const HUES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const tint = (hex) => `${hex}26`;

const key = (r, c) => `${r},${c}`;

/** Violations that a move would cause, checked in the browser for instant feedback. */
export function previewMove(seats, room, from, to) {
  const next = new Map(seats);
  const a = next.get(key(from.row, from.col));
  const b = next.get(key(to.row, to.col));
  next.delete(key(from.row, from.col));
  next.delete(key(to.row, to.col));
  next.set(key(to.row, to.col), { ...a, row: to.row, col: to.col });
  if (b) next.set(key(from.row, from.col), { ...b, row: from.row, col: from.col });
  const problems = [];
  for (const s of [next.get(key(to.row, to.col)), b && next.get(key(from.row, from.col))].filter(Boolean)) {
    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const n = next.get(key(s.row + dr, s.col + dc));
      if (n && n.subject_code === s.subject_code) problems.push(`${s.roll_no} would sit next to ${n.roll_no} (both ${s.subject_code})`);
    }
    if (room.floor !== 0 && s.needs_ground_floor) problems.push(`${s.roll_no} needs the ground floor`);
  }
  return [...new Set(problems)];
}

function Seat({ r, c, seat, color, editable, highlight, preview }) {
  const id = key(r, c);
  const drop = useDroppable({ id });
  const drag = useDraggable({ id, disabled: !seat || !editable });
  const style = drag.transform ? { transform: `translate(${drag.transform.x}px, ${drag.transform.y}px)`, zIndex: 20 } : {};
  const ring = drop.isOver && preview ? (preview.ok ? 'ring-2 ring-green-500' : 'ring-2 ring-red-500') : '';
  return (
    <div ref={drop.setNodeRef} className={`relative rounded-md ${ring}`} style={{ minHeight: 54 }}>
      <div ref={drag.setNodeRef} {...drag.listeners} {...drag.attributes} style={{
        ...style, background: seat ? tint(color) : 'transparent', borderColor: seat ? color : 'var(--border)',
      }} title={seat ? `${seat.roll_no} · ${seat.name}\n${seat.subject_code} ${seat.subject_name}` : 'Empty seat'}
        className={`h-full rounded-md border-2 p-1 text-center text-[10px] leading-tight ${seat ? (editable ? 'cursor-grab' : '') : 'border-dashed'}
          ${highlight ? 'outline outline-2 outline-red-500' : ''} ${drag.isDragging ? 'opacity-80 shadow-lg' : ''}`}>
        <div className="text-[9px] muted">{seat ? `#${seat.seat_no}` : ''}</div>
        {seat && <>
          <div className="font-semibold" style={{ color: 'var(--text)' }}>{seat.roll_no.slice(-4)}</div>
          <div className="truncate muted">{seat.subject_code.replace('B23', '')}</div>
          {seat.needs_ground_floor && <div className="mt-0.5 font-bold text-navy-500" title="Needs a ground-floor seat">GF</div>}
        </>}
      </div>
    </div>
  );
}

export default function RoomGrid({ grid, editable, onMove }) {
  const { room, seats } = grid;
  const at = useMemo(() => new Map(seats.map((s) => [key(s.row, s.col), s])), [seats]);
  const subjects = useMemo(() => [...new Set(seats.map((s) => s.subject_code))].sort(), [seats]);
  const color = Object.fromEntries(subjects.map((s, i) => [s, HUES[i % HUES.length]]));
  const bad = new Set(grid.violations.flatMap((v) => v.seats.map(([r, c]) => key(r, c))));
  const [preview, setPreview] = useState(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const parse = (id) => { const [row, col] = String(id).split(',').map(Number); return { row, col }; };
  const onDragOver = ({ active, over }) => {
    if (!over || over.id === active.id) return setPreview(null);
    const problems = previewMove(at, room, parse(active.id), parse(over.id));
    setPreview({ ok: problems.length === 0, problems });
  };
  const onDragEnd = ({ active, over }) => {
    const p = preview;
    setPreview(null);
    if (over && over.id !== active.id) onMove(parse(active.id), parse(over.id), p);
  };

  return (
    <div>
      <div className="mb-2 rounded-md py-1 text-center text-xs font-medium uppercase tracking-wider muted" style={{ background: 'var(--surface)' }}>
        Front · board &amp; invigilator desk
      </div>
      <DndContext sensors={sensors} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setPreview(null)}>
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${room.cols}, minmax(52px, 1fr))` }}>
          {Array.from({ length: room.rows }, (_, i) => i + 1).flatMap((r) =>
            Array.from({ length: room.cols }, (_, j) => j + 1).map((c) => {
              const seat = at.get(key(r, c));
              return <Seat key={key(r, c)} r={r} c={c} seat={seat} color={seat ? color[seat.subject_code] : null}
                editable={editable} highlight={bad.has(key(r, c))} preview={preview} />;
            }))}
        </div>
      </DndContext>
      <div className={`mt-3 min-h-[1.5rem] text-sm ${preview ? (preview.ok ? 'text-green-700' : 'text-red-600') : 'muted'}`}>
        {preview ? (preview.ok ? '✓ This move keeps every rule' : `✕ ${preview.problems[0]}`)
          : editable ? 'Drag a student onto another seat to move or swap them. Rules are checked as you drag.' : ''}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {subjects.map((s) => {
          const one = seats.find((x) => x.subject_code === s);
          return (
            <span key={s} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm border-2" style={{ background: tint(color[s]), borderColor: color[s] }} />
              <span className="font-mono">{s}</span><span className="muted">{one.subject_name} ({seats.filter((x) => x.subject_code === s).length})</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
