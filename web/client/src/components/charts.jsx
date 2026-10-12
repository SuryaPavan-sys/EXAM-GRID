// Chart building blocks: validated categorical slots (fixed order), recessive grid,
// 4px rounded data-ends, hover tooltips, legends for >= 2 series.
import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

// SVG presentation attributes cannot read CSS variables, so resolve the theme tokens in JS
// (and again whenever the OS switches light/dark).
const TOKENS = ['--series-1', '--series-2', '--series-3', '--series-4', '--grid', '--text-2', '--card'];
function useTheme() {
  const read = () => Object.fromEntries(TOKENS.map((t) =>
    [t, getComputedStyle(document.documentElement).getPropertyValue(t).trim()]));
  const [theme, setTheme] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(read());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme;
}

function Tip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="mb-1 font-semibold" style={{ color: 'var(--text)' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2" style={{ color: 'var(--text-2)' }}>
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold tabular-nums" style={{ color: 'var(--text)' }}>
            {typeof p.value === 'number' ? p.value.toLocaleString('en-IN') : p.value}{unit}</span>
        </div>
      ))}
    </div>
  );
}

/** Vertical bars; `series` = [[dataKey, name], ...]. Stacked when `stack` is true. */
export function Bars({ data, x, series, stack = false, height = 260, reference, unit, layout = 'horizontal' }) {
  const t = useTheme();
  const SERIES = [t['--series-1'], t['--series-2'], t['--series-3'], t['--series-4']];
  const axis = { stroke: t['--grid'], tick: { fill: t['--text-2'], fontSize: 11 }, tickLine: false };
  const legend = <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: t['--text-2'] }} />;
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} barGap={2} margin={{ top: 8, right: 12, left: vertical ? 40 : 0, bottom: 0 }}>
        <CartesianGrid stroke={t['--grid']} vertical={vertical} horizontal={!vertical} />
        {vertical ? <><XAxis type="number" {...axis} /><YAxis type="category" dataKey={x} width={150} {...axis} /></>
          : <><XAxis dataKey={x} {...axis} interval="preserveStartEnd" /><YAxis {...axis} width={48} /></>}
        <Tooltip content={<Tip unit={unit} />} cursor={{ fill: t['--grid'], opacity: 0.5 }} />
        {series.length > 1 && legend}
        {reference && (vertical
          ? <ReferenceLine x={reference.value} stroke={t['--text-2']} strokeDasharray="4 3" />
          : <ReferenceLine y={reference.value} stroke={t['--text-2']} strokeDasharray="4 3" ifOverflow="extendDomain"
            label={{ value: reference.label, position: 'insideTopRight', fill: t['--text-2'], fontSize: 11 }} />)}
        {series.map(([key, name], i) => {
          const last = !stack || i === series.length - 1;
          return (
            <Bar key={key} dataKey={key} name={name} fill={SERIES[i]} stackId={stack ? 's' : undefined}
              radius={last ? (vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]) : 0}
              stroke={t['--card']} strokeWidth={stack ? 2 : 0} maxBarSize={40} isAnimationActive={false} />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
}
