// src/components/features/HeartRateChart.tsx
'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { TelemetryChartPoint } from '@/types/telemetry'

interface HeartRateChartProps {
  data: TelemetryChartPoint[]
  loading?: boolean
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-healy-surface border border-healy-border rounded-lg px-3 py-2 shadow-card text-xs">
      <p className="font-mono text-healy-slate mb-1">{label}</p>
      <p className="font-mono font-semibold text-healy-graphite">
        {payload[0].value} bpm
      </p>
    </div>
  )
}

export function HeartRateChart({ data, loading }: HeartRateChartProps) {
  if (loading) return <div className="h-48 bg-healy-bg-alt rounded-card animate-pulse" />

  return (
    <div className="bg-healy-surface border border-healy-border rounded-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-semibold text-sm text-healy-graphite">
          Heart Rate Trend
        </h4>
        <span className="text-xs font-mono text-healy-slate">bpm</span>
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            opacity={0.5}
          />
          <XAxis
            dataKey="timestamp"
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'var(--color-slate)' }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            domain={[40, 180]}
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'var(--color-slate)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Normal range reference band */}
          <ReferenceLine y={60}  stroke="#4CAF82" strokeDasharray="3 3" strokeWidth={1} opacity={0.5} />
          <ReferenceLine y={100} stroke="#4CAF82" strokeDasharray="3 3" strokeWidth={1} opacity={0.5} />

          <Line
            type="monotone"
            dataKey="value"
            stroke="#F5A623"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: '#F5A623' }}
            animationDuration={800}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-4 mt-2">
        <span className="flex items-center gap-1 text-xs text-healy-slate">
          <span className="w-4 border-t border-dashed border-healy-sage" />
          Normal 60–100 bpm
        </span>
      </div>
    </div>
  )
}
