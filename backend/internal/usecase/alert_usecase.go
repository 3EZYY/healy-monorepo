package usecase

import "github.com/rafif/healy-backend/internal/domain"

// Hardcoded defaults — used only when no DeviceSettings row exists in DB
// and as fallback for the legacy EvaluatePayload function used in tests.
const (
	TempNormalMin float64 = 36.5
	TempNormalMax float64 = 37.5
	TempWarnMax   float64 = 38.5

	SpO2NormalMin int = 95
	SpO2WarnMin   int = 91

	BpmNormalMin int = 60
	BpmNormalMax int = 100
)

// EvaluateTemperature returns status based on temperature (°C).
func EvaluateTemperature(temp float64) domain.SensorStatus {
	switch {
	case temp >= TempNormalMin && temp <= TempNormalMax:
		return domain.StatusNormal
	case temp > TempNormalMax && temp <= TempWarnMax:
		return domain.StatusWarning
	default:
		return domain.StatusCritical
	}
}

// EvaluateSpO2 returns status based on blood oxygen saturation (%).
func EvaluateSpO2(spo2 int) domain.SensorStatus {
	switch {
	case spo2 >= SpO2NormalMin:
		return domain.StatusNormal
	case spo2 >= SpO2WarnMin:
		return domain.StatusWarning
	default:
		return domain.StatusCritical
	}
}

// EvaluateBPM returns status based on heart rate against configurable thresholds.
func EvaluateBPM(bpm, normalMin, normalMax int) domain.SensorStatus {
	if bpm >= normalMin && bpm <= normalMax {
		return domain.StatusNormal
	}
	return domain.StatusWarning
}

// EvaluateOverall returns the worst-case status across all three sensors.
func EvaluateOverall(tempStatus, spo2Status, bpmStatus domain.SensorStatus) domain.SensorStatus {
	if tempStatus == domain.StatusCritical || spo2Status == domain.StatusCritical {
		return domain.StatusCritical
	}
	if tempStatus == domain.StatusWarning || spo2Status == domain.StatusWarning || bpmStatus == domain.StatusWarning {
		return domain.StatusWarning
	}
	return domain.StatusNormal
}

// EvaluatePayloadWithSettings evaluates a payload using persisted device thresholds.
// This is the primary evaluation path used by the telemetry usecase.
func EvaluatePayloadWithSettings(payload domain.TelemetryPayload, settings domain.DeviceSettings) domain.TelemetryRecord {
	// Temp: uses settings.TempWarnMax (NORMAL→WARNING boundary) and settings.TempCritMax (WARNING→CRITICAL)
	var tempStatus domain.SensorStatus
	switch {
	case payload.Sensor.Temperature >= TempNormalMin && payload.Sensor.Temperature <= settings.TempWarnMax:
		tempStatus = domain.StatusNormal
	case payload.Sensor.Temperature > settings.TempWarnMax && payload.Sensor.Temperature <= settings.TempCritMax:
		tempStatus = domain.StatusWarning
	default:
		tempStatus = domain.StatusCritical
	}

	// SpO2: uses settings.SpO2WarnMin (NORMAL→WARNING) and settings.SpO2CritMin (WARNING→CRITICAL)
	var spo2Status domain.SensorStatus
	switch {
	case payload.Sensor.SpO2 >= settings.SpO2WarnMin:
		spo2Status = domain.StatusNormal
	case payload.Sensor.SpO2 >= settings.SpO2CritMin:
		spo2Status = domain.StatusWarning
	default:
		spo2Status = domain.StatusCritical
	}

	bpmStatus := EvaluateBPM(payload.Sensor.BPM, settings.BpmNormalMin, settings.BpmNormalMax)

	return domain.TelemetryRecord{
		TelemetryPayload: payload,
		Status: domain.EvaluatedStatus{
			Temperature: tempStatus,
			SpO2:        spo2Status,
			BPM:         bpmStatus,
			Overall:     EvaluateOverall(tempStatus, spo2Status, bpmStatus),
		},
	}
}

// EvaluatePayload evaluates using hardcoded defaults.
// Kept for backward compatibility with unit tests.
func EvaluatePayload(payload domain.TelemetryPayload) domain.TelemetryRecord {
	return EvaluatePayloadWithSettings(payload, domain.DeviceSettings{
		TempWarnMax:  TempNormalMax,
		TempCritMax:  TempWarnMax,
		SpO2WarnMin:  SpO2NormalMin,
		SpO2CritMin:  SpO2WarnMin,
		BpmNormalMin: BpmNormalMin,
		BpmNormalMax: BpmNormalMax,
	})
}
