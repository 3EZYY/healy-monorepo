package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rafif/healy-backend/internal/domain"
	"github.com/rafif/healy-backend/internal/repository/interfaces"
)

type TelemetryUsecase interface {
	ProcessIncoming(ctx context.Context, payload domain.TelemetryPayload) error
}

type telemetryUsecase struct {
	repo          interfaces.TelemetryRepository
	settingsRepo  interfaces.SettingsRepository
	broadcastChan chan<- []byte
}

func NewTelemetryUsecase(
	repo interfaces.TelemetryRepository,
	settingsRepo interfaces.SettingsRepository,
	broadcastChan chan<- []byte,
) TelemetryUsecase {
	return &telemetryUsecase{
		repo:          repo,
		settingsRepo:  settingsRepo,
		broadcastChan: broadcastChan,
	}
}

func (u *telemetryUsecase) ProcessIncoming(ctx context.Context, payload domain.TelemetryPayload) error {
	// 1. Fetch persisted thresholds for this device — backend is single source of truth.
	//    Falls back to domain.DefaultSettings if no row exists.
	settings, err := u.settingsRepo.GetByDeviceID(ctx, payload.DeviceID)
	if err != nil {
		// Non-fatal: fall back to hardcoded defaults so telemetry keeps flowing.
		settings = domain.DefaultSettings(payload.DeviceID)
	}

	// 2. Evaluate payload against the persisted thresholds
	record := EvaluatePayloadWithSettings(payload, settings)

	if record.Timestamp.IsZero() {
		record.Timestamp = time.Now()
	}
	record.CreatedAt = time.Now()

	// 3. Save to database
	if err := u.repo.Save(ctx, record); err != nil {
		return fmt.Errorf("failed to save telemetry record: %w", err)
	}

	// 4. Broadcast evaluated record to all viewer WebSocket clients
	recordJSON, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("failed to marshal telemetry record: %w", err)
	}
	u.broadcastChan <- recordJSON

	// 5. Persist critical alert if triggered
	if record.Status.Overall == domain.StatusCritical {
		alert := domain.Alert{
			DeviceID:    record.DeviceID,
			Status:      record.Status.Overall,
			TriggeredAt: time.Now(),
		}

		if record.Status.Temperature == domain.StatusCritical {
			alert.AlertType = domain.AlertTempCritical
			alert.Value = record.Sensor.Temperature
		} else if record.Status.SpO2 == domain.StatusCritical {
			alert.AlertType = domain.AlertSpO2Critical
			alert.Value = float64(record.Sensor.SpO2)
		}

		if err := u.repo.SaveAlert(ctx, alert); err != nil {
			return fmt.Errorf("failed to save critical alert: %w", err)
		}
	}

	return nil
}
