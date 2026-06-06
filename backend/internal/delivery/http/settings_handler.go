package http

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/rafif/healy-backend/internal/domain"
	"github.com/rafif/healy-backend/internal/repository/interfaces"
)

// ThresholdSettingsDTO is the JSON shape the frontend expects.
//
//	Frontend Field      ←  DB Column / Derivation
//	─────────────────────────────────────────────
//	temp_normal_min     ←  36.1 (physiological constant)
//	temp_normal_max     ←  temp_warn_max  (upper bound of NORMAL)
//	temp_warn_max       ←  temp_crit_max  (upper bound of WARNING)
//	spo2_normal_min     ←  spo2_warn_min  (lower bound of NORMAL)
//	spo2_warn_min       ←  spo2_crit_min  (lower bound of WARNING)
//	bpm_normal_min      ←  bpm_normal_min (stored directly)
//	bpm_normal_max      ←  bpm_normal_max (stored directly)
type ThresholdSettingsDTO struct {
	TempNormalMin float64 `json:"temp_normal_min"`
	TempNormalMax float64 `json:"temp_normal_max"`
	TempWarnMax   float64 `json:"temp_warn_max"`
	SpO2NormalMin int     `json:"spo2_normal_min"`
	SpO2WarnMin   int     `json:"spo2_warn_min"`
	BpmNormalMin  int     `json:"bpm_normal_min"`
	BpmNormalMax  int     `json:"bpm_normal_max"`
}

const tempNormalMinConst = 36.1

func toDTO(s domain.DeviceSettings) ThresholdSettingsDTO {
	return ThresholdSettingsDTO{
		TempNormalMin: tempNormalMinConst,
		TempNormalMax: s.TempWarnMax,
		TempWarnMax:   s.TempCritMax,
		SpO2NormalMin: s.SpO2WarnMin,
		SpO2WarnMin:   s.SpO2CritMin,
		BpmNormalMin:  s.BpmNormalMin,
		BpmNormalMax:  s.BpmNormalMax,
	}
}

func fromDTO(dto ThresholdSettingsDTO, deviceID string) domain.DeviceSettings {
	return domain.DeviceSettings{
		DeviceID:     deviceID,
		TempWarnMax:  dto.TempNormalMax,
		TempCritMax:  dto.TempWarnMax,
		SpO2WarnMin:  dto.SpO2NormalMin,
		SpO2CritMin:  dto.SpO2WarnMin,
		BpmNormalMin: dto.BpmNormalMin,
		BpmNormalMax: dto.BpmNormalMax,
	}
}

// SettingsHandler handles GET and PUT for /api/settings/threshold.
type SettingsHandler struct {
	repo interfaces.SettingsRepository
}

func NewSettingsHandler(repo interfaces.SettingsRepository) *SettingsHandler {
	return &SettingsHandler{repo: repo}
}

// GetThreshold handles GET /api/settings/threshold
func (h *SettingsHandler) GetThreshold(c *gin.Context) {
	deviceID := c.DefaultQuery("device_id", "healy-esp32")

	settings, err := h.repo.GetByDeviceID(c.Request.Context(), deviceID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toDTO(settings))
}

// UpdateThreshold handles PUT /api/settings/threshold
func (h *SettingsHandler) UpdateThreshold(c *gin.Context) {
	var dto ThresholdSettingsDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	deviceID := c.DefaultQuery("device_id", "healy-esp32")
	domainSettings := fromDTO(dto, deviceID)

	saved, err := h.repo.Upsert(c.Request.Context(), domainSettings)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toDTO(saved))
}
