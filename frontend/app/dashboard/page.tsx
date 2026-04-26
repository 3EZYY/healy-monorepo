'use client'

import { motion } from 'framer-motion'
import SensorCard from '@/components/features/SensorCard'
import StatusChip from '@/components/features/StatusChip'
import { Activity, Clock, Wifi, WifiOff } from 'lucide-react'
import type { SensorStatus } from '@/types/telemetry'

// Mock data for Phase 4 scaffold (will be replaced by WebSocket in Phase 5)
const MOCK_TELEMETRY = {
  device_id: 'HEALY-001',
  timestamp: new Date().toISOString(),
  sensor: {
    temperature: 36.8,
    bpm: 78,
    spo2: 98,
  },
  status: {
    temperature: 'NORMAL' as SensorStatus,
    spo2: 'NORMAL' as SensorStatus,
    overall: 'NORMAL' as SensorStatus,
  },
}

const stagger = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06 } },
} as const

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
}

export default function DashboardPage() {
  const data = MOCK_TELEMETRY
  const isConnected = true // Will come from WebSocket hook in Phase 5

  return (
    <motion.div
      variants={stagger}
      initial="hidden"
      animate="visible"
      className="max-w-5xl mx-auto"
    >
      {/* ─── Header ─── */}
      <motion.div variants={fadeUp} className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-display font-bold text-healy-graphite">
            Live Monitoring
          </h1>
          <p className="text-sm font-body text-healy-slate mt-1">
            Real-time telemetry from {data.device_id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusChip status={data.status.overall} label={`Overall: ${data.status.overall}`} />
          <div className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-body font-medium
            ${isConnected
              ? 'bg-healy-sage/10 text-healy-sage-dark'
              : 'bg-healy-critical/10 text-healy-critical'
            }
          `}>
            {isConnected ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </motion.div>

      {/* ─── Sensor Cards Grid ─── */}
      <motion.div variants={fadeUp} className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <SensorCard
          title="Body Temperature"
          value={data.sensor.temperature}
          unit="°C"
          status={data.status.temperature}
          icon="temperature"
          trend="stable"
        />
        <SensorCard
          title="Heart Rate"
          value={data.sensor.bpm}
          unit="BPM"
          status="NORMAL"
          icon="bpm"
          trend="stable"
        />
        <SensorCard
          title="Blood Oxygen"
          value={data.sensor.spo2}
          unit="%"
          status={data.status.spo2}
          icon="spo2"
          trend="stable"
        />
      </motion.div>

      {/* ─── Device Info Panel ─── */}
      <motion.div variants={fadeUp} className="glass-card p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-healy-sage" />
          <h2 className="text-lg font-display font-semibold text-healy-graphite">
            Device Information
          </h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: 'Device ID',     value: data.device_id },
            { label: 'Firmware',      value: 'v1.0.0' },
            { label: 'Connection',    value: 'WebSocket' },
            { label: 'Last Update',   value: new Date(data.timestamp).toLocaleTimeString() },
          ].map((info) => (
            <div key={info.label}>
              <span className="text-xs font-body text-healy-slate block mb-1">{info.label}</span>
              <span className="text-sm font-mono text-healy-graphite">{info.value}</span>
            </div>
          ))}
        </div>
      </motion.div>

      {/* ─── Activity Feed Placeholder ─── */}
      <motion.div variants={fadeUp} className="glass-card p-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <Clock className="w-5 h-5 text-healy-sage" />
          <h2 className="text-lg font-display font-semibold text-healy-graphite">
            Recent Activity
          </h2>
        </div>
        <div className="space-y-3">
          {[
            { time: '14:32:15', event: 'Telemetry received — All vitals normal', status: 'NORMAL' as SensorStatus },
            { time: '14:32:10', event: 'Connection established with HEALY-001', status: 'NORMAL' as SensorStatus },
            { time: '14:31:58', event: 'Dashboard session started', status: 'NORMAL' as SensorStatus },
          ].map((activity, i) => (
            <div
              key={i}
              className="flex items-center gap-4 p-3 rounded-xl bg-healy-bg-alt/50 border border-healy-border/30"
            >
              <span className="text-xs font-mono text-healy-slate w-16 shrink-0">{activity.time}</span>
              <span className="text-sm font-body text-healy-graphite flex-1">{activity.event}</span>
              <StatusChip status={activity.status} size="sm" />
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
