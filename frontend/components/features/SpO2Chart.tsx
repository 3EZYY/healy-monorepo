// src/components/features/SpO2Chart.tsx
'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { TelemetryChartPoint } from '@/types/telemetry'

interface SpO2ChartProps {
  data: TelemetryChartPoint[]
  loading?: boolean
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-healy-surface border border-healy-border rounded-lg px-3 py-2 shadow-card text-xs">
      <p className="font-mono text-healy-slate mb-1">{label}</p>
      <p className="font-mono font-semibold text-healy-graphite">
        {payload[0].value}%
      </p>
    </div>
  )
}

export function SpO2Chart({ data, loading }: SpO2ChartProps) {
  if (loading) return <div className="h-48 bg-healy-bg-alt rounded-card animate-pulse" />

  return (
    <div className="bg-healy-surface border border-healy-border rounded-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-semibold text-sm text-healy-graphite">
          SpO2 Trend
        </h4>
        <span className="text-xs font-mono text-healy-slate">%</span>
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
            domain={[80, 100]}
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'var(--color-slate)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Threshold reference lines */}
          <ReferenceLine y={95} stroke="#F5A623" strokeDasharray="4 4" strokeWidth={1} />
          <ReferenceLine y={91} stroke="#E05252" strokeDasharray="4 4" strokeWidth={1} />

          <Line
            type="monotone"
            dataKey="value"
            stroke="#0D9488"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, fill: '#0D9488' }}
            animationDuration={800}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-4 mt-2">
        <span className="flex items-center gap-1 text-xs text-healy-slate">
          <span className="w-4 border-t border-dashed border-healy-warning" />
          Waspada &lt;95%
        </span>
        <span className="flex items-center gap-1 text-xs text-healy-slate">
          <span className="w-4 border-t border-dashed border-healy-critical" />
          Kritis &lt;91%
        </span>
      </div>
    </div>
  )
}
