// Centralized REST API client for HEALY backend.
// Reads NEXT_PUBLIC_API_URL and attaches JWT from localStorage.
// In mock mode (NEXT_PUBLIC_USE_MOCK_DATA=true), returns realistic mock responses.

import type { TelemetryPayload, SensorStatus } from '@/types/telemetry'
import { generateMockPayload } from '@/lib/mock-telemetry'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api'
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true'

// ─── Auth Header Helper ───
function authHeaders(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('healy_token') : null
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// ─── Auth Types (mirrors Go domain.LoginRequest/LoginResponse) ───

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  token: string
  expires_at: number  // Unix timestamp
}

/**
 * POST /api/auth/login
 * Authenticates and returns a JWT token.
 */
export async function login(req: LoginRequest): Promise<LoginResponse> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 500))
    return {
      token: 'mock-jwt-token-healy-001',
      expires_at: Math.floor(Date.now() / 1000) + 86400, // 24h from now
    }
  }

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || `Login failed: ${res.status}`)
  }
  return res.json()
}

// ─── Types for API Responses ───

// TelemetryRecord mirrors Go's domain.TelemetryRecord JSON output.
// Go embeds TelemetryPayload (device_id, timestamp, sensor) and adds status + created_at.
// This matches the exact shape from json.Marshal(domain.TelemetryRecord{}).
export interface TelemetryRecord {
  device_id: string
  timestamp: string          // ISO 8601 — Go json:"timestamp"
  sensor: {
    temperature: number
    bpm: number
    spo2: number
  }
  status: {
    temperature: SensorStatus
    spo2: SensorStatus
    overall: SensorStatus
  }
  created_at?: string        // ISO 8601 — Go json:"created_at"
}

// Helper: extract flat values from a nested TelemetryRecord for charts/tables
export function flattenRecord(r: TelemetryRecord) {
  return {
    device_id: r.device_id,
    timestamp: r.timestamp,
    temperature: r.sensor.temperature,
    bpm: r.sensor.bpm,
    spo2: r.sensor.spo2,
    temp_status: r.status.temperature,
    spo2_status: r.status.spo2,
    overall_status: r.status.overall,
  }
}

export interface ThresholdSettings {
  temp_normal_min: number
  temp_normal_max: number
  temp_warn_max: number
  spo2_normal_min: number
  spo2_warn_min: number
  bpm_normal_min: number
  bpm_normal_max: number
}

// BPM thresholds are frontend-only (backend doesn't store them) — persisted in localStorage.
function loadBpmThresholds(): { bpm_normal_min: number; bpm_normal_max: number } {
  if (typeof window === 'undefined') return { bpm_normal_min: 60, bpm_normal_max: 100 }
  return {
    bpm_normal_min: parseInt(localStorage.getItem('healy_bpm_normal_min') ?? '60', 10),
    bpm_normal_max: parseInt(localStorage.getItem('healy_bpm_normal_max') ?? '100', 10),
  }
}

function saveBpmThresholds(min: number, max: number): void {
  if (typeof window === 'undefined') return
  localStorage.setItem('healy_bpm_normal_min', min.toString())
  localStorage.setItem('healy_bpm_normal_max', max.toString())
}

export interface DeviceStatus {
  device_id: string
  is_online: boolean
  last_seen: string
}

// ─── Mock Data Generators ───

function generateMockHistory(range: string): TelemetryRecord[] {
  const counts: Record<string, number> = { '1h': 30, '6h': 90, '24h': 200, '7d': 500 }
  const count = counts[range] || 60
  const now = Date.now()
  const rangeMs: Record<string, number> = {
    '1h': 3600000,
    '6h': 21600000,
    '24h': 86400000,
    '7d': 604800000,
  }
  const totalMs = rangeMs[range] || 3600000
  const step = totalMs / count

  return Array.from({ length: count }, (_, i) => {
    const payload = generateMockPayload()
    const ts = new Date(now - (count - i) * step).toISOString()
    return {
      device_id: payload.device_id,
      timestamp: ts,
      sensor: payload.sensor,
      status: payload.status,
      created_at: ts,
    }
  })
}

// ─── API Functions ───

/**
 * GET /api/telemetry/history?range=1h|6h|24h|7d
 * Returns historical telemetry records, ordered by recorded_at DESC.
 */
export async function fetchTelemetryHistory(range: string = '1h', deviceId: string = 'healy-esp32'): Promise<TelemetryRecord[]> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 600)) // Simulate network latency
    return generateMockHistory(range)
  }

  const res = await fetch(`${API_URL}/telemetry/history?range=${range}&device_id=${deviceId}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`History fetch failed: ${res.status}`)
  return res.json()
}

/**
 * GET /api/telemetry/latest
 * Returns the most recent telemetry payload.
 */
export async function fetchLatestTelemetry(deviceId: string = 'healy-esp32'): Promise<TelemetryPayload> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 300))
    return generateMockPayload()
  }

  const res = await fetch(`${API_URL}/telemetry/latest?device_id=${deviceId}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Latest fetch failed: ${res.status}`)
  return res.json()
}

/**
 * GET /api/settings/threshold
 * Returns current threshold configuration.
 */
export async function fetchThresholds(): Promise<ThresholdSettings> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 400))
    return {
      temp_normal_min: 36.5,
      temp_normal_max: 37.5,
      temp_warn_max: 38.5,
      spo2_normal_min: 95,
      spo2_warn_min: 91,
      ...loadBpmThresholds(),
    }
  }

  const res = await fetch(`${API_URL}/settings/threshold`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Threshold fetch failed: ${res.status}`)
  const data = await res.json()
  return { ...data, ...loadBpmThresholds() }
}

/**
 * PUT /api/settings/threshold
 * Updates threshold configuration.
 */
export async function updateThresholds(settings: ThresholdSettings): Promise<ThresholdSettings> {
  // BPM fields are frontend-only — persist locally before calling the API.
  saveBpmThresholds(settings.bpm_normal_min, settings.bpm_normal_max)

  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 500))
    return settings // Echo back
  }

  const res = await fetch(`${API_URL}/settings/threshold`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify(settings), // backend ignores unknown bpm_* fields
  })
  if (!res.ok) throw new Error(`Threshold update failed: ${res.status}`)
  const data = await res.json()
  return { ...data, bpm_normal_min: settings.bpm_normal_min, bpm_normal_max: settings.bpm_normal_max }
}

/**
 * GET /api/device/status
 * Returns ESP32 device connection status.
 */
export async function fetchDeviceStatus(deviceId: string = 'healy-esp32'): Promise<DeviceStatus> {
  if (USE_MOCK) {
    await new Promise(r => setTimeout(r, 300))
    return {
      device_id: 'healy-esp32',
      is_online: true,
      last_seen: new Date().toISOString(),
    }
  }

  const res = await fetch(`${API_URL}/device/status?device_id=${deviceId}`, {
    headers: authHeaders(),
  })
  if (!res.ok) throw new Error(`Device status fetch failed: ${res.status}`)
  return res.json()
}
