// src/components/features/TemperatureChart.tsx
'use client'

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer
} from 'recharts'
import { TelemetryChartPoint } from '@/types/telemetry'

interface TemperatureChartProps {
  data: TelemetryChartPoint[]
  loading?: boolean
}

// Custom Dot untuk render warna berdasarkan status individual point
const StatusDot = (props: { cx?: number; cy?: number; payload?: { status: string } }) => {
  const { cx, cy, payload } = props
  if (!cx || !cy) return null

  let fill = '#4CAF82' // NORMAL (healy-sage)
  if (payload?.status === 'WARNING') fill = '#F5A623'
  else if (payload?.status === 'CRITICAL') fill = '#E05252'

  return (
    <circle cx={cx} cy={cy} r={4} fill={fill} stroke="white" strokeWidth={1} />
  )
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-healy-surface border border-healy-border rounded-lg px-3 py-2 shadow-card text-xs">
      <p className="font-mono text-healy-slate mb-1">{label}</p>
      <p className="font-mono font-semibold text-healy-graphite">
        {payload[0].value}°C
      </p>
    </div>
  )
}

export function TemperatureChart({ data, loading }: TemperatureChartProps) {
  if (loading) return <div className="h-48 bg-healy-bg-alt rounded-card animate-pulse" />

  return (
    <div className="bg-healy-surface border border-healy-border rounded-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-display font-semibold text-sm text-healy-graphite">
          Temperature Trend
        </h4>
        <span className="text-xs font-mono text-healy-slate">°C</span>
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
            domain={[35, 40]}
            tick={{ fontSize: 10, fontFamily: 'JetBrains Mono', fill: 'var(--color-slate)' }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />

          {/* Threshold reference lines */}
          <ReferenceLine y={37.5} stroke="#F5A623" strokeDasharray="4 4" strokeWidth={1} />
          <ReferenceLine y={38.5} stroke="#E05252" strokeDasharray="4 4" strokeWidth={1} />

          <Line
            type="monotone"
            dataKey="value"
            stroke="#4CAF82"
            strokeWidth={2}
            dot={<StatusDot />}
            activeDot={{ r: 6 }}
            animationDuration={800}
            animationEasing="ease-in-out"
          />
        </LineChart>
      </ResponsiveContainer>

      <div className="flex gap-4 mt-2">
        <span className="flex items-center gap-1 text-xs text-healy-slate">
          <span className="w-4 border-t border-dashed border-healy-warning" />
          Demam &gt;37.5°C
        </span>
        <span className="flex items-center gap-1 text-xs text-healy-slate">
          <span className="w-4 border-t border-dashed border-healy-critical" />
          Kritis &gt;38.5°C
        </span>
      </div>
    </div>
  )
}
