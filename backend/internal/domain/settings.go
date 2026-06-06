package domain

import "time"

// DeviceSettings berisi konfigurasi threshold per device.
// Default values sesuai Blueprint Section 4.2 dan PRD Section 4.
type DeviceSettings struct {
	DeviceID     string    `json:"device_id"`
	TempNormalMin float64  `json:"temp_normal_min"` // Default: 36.1 — below this → CRITICAL
	TempWarnMax  float64   `json:"temp_warn_max"`   // Default: 37.5 — above this → WARNING
	TempCritMax  float64   `json:"temp_crit_max"`   // Default: 38.5 — above this → CRITICAL
	SpO2WarnMin  int       `json:"spo2_warn_min"`   // Default: 94  — below this → WARNING
	SpO2CritMin  int       `json:"spo2_crit_min"`   // Default: 90  — below this → CRITICAL
	BpmNormalMin int       `json:"bpm_normal_min"`  // Default: 60
	BpmNormalMax int       `json:"bpm_normal_max"`  // Default: 100
	UpdatedAt    time.Time `json:"updated_at"`
}

// DefaultSettings mengembalikan threshold default sesuai PRD.
func DefaultSettings(deviceID string) DeviceSettings {
	return DeviceSettings{
		DeviceID:      deviceID,
		TempNormalMin: 36.1,
		TempWarnMax:   37.5,
		TempCritMax:   38.5,
		SpO2WarnMin:   94,
		SpO2CritMin:   90,
		BpmNormalMin:  60,
		BpmNormalMax:  100,
	}
}
