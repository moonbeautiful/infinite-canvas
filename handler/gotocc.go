package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

const (
	gotoccKeyHeader = "X-Gotocc-API-Key"
	gotoccBodyLimit = 1 << 20
)

var (
	gotoccAPIBaseURL = "https://gotocc.xyz/v1"
	gotoccHTTPClient = service.SafeProxyHTTPClient()
)

func GotoccModels(w http.ResponseWriter, r *http.Request) {
	proxyGotoccRequest(w, r, http.MethodGet, "/models", nil)
}

func GotoccImageGenerations(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, gotoccBodyLimit)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, "生图请求过大")
		return
	}
	if err := validateGotoccImageRequest(body); err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	proxyGotoccRequest(w, r, http.MethodPost, "/images/generations", body)
}

func proxyGotoccRequest(w http.ResponseWriter, r *http.Request, method string, path string, body []byte) {
	key := strings.TrimSpace(r.Header.Get(gotoccKeyHeader))
	if !validGotoccKey(key) {
		FailWithStatus(w, http.StatusUnauthorized, "gotocc Key 无效")
		return
	}

	request, err := http.NewRequestWithContext(r.Context(), method, gotoccAPIBaseURL+path, bytes.NewReader(body))
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "无法连接 gotocc")
		return
	}
	request.Header.Set("Authorization", "Bearer "+key)
	if len(body) > 0 {
		request.Header.Set("Content-Type", "application/json")
	}

	response, err := gotoccHTTPClient.Do(request)
	if err != nil {
		FailWithStatus(w, http.StatusBadGateway, "gotocc 请求失败")
		return
	}
	defer response.Body.Close()

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", firstNonEmpty(response.Header.Get("Content-Type"), "application/json"))
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func validGotoccKey(value string) bool {
	return strings.HasPrefix(value, "sk-") && len(value) >= 16 && len(value) <= 256 &&
		!strings.ContainsAny(value, " \t\r\n")
}

func validateGotoccImageRequest(body []byte) error {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return errors.New("生图请求格式错误")
	}
	modelName := strings.TrimSpace(toStringSafe(payload["model"]))
	if modelName != "gpt-image-2" && modelName != "gpt-image-2-high" {
		return errors.New("gotocc 连接仅允许 GPT Image 2")
	}
	prompt := strings.TrimSpace(toStringSafe(payload["prompt"]))
	if prompt == "" || len(prompt) > 12000 {
		return errors.New("背景描述不能为空且不能超过 12000 字符")
	}
	if containsGotoccMedia(payload) {
		return errors.New("gotocc 背景请求不能包含商品或参考图片")
	}
	return nil
}

func containsGotoccMedia(value any) bool {
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			switch strings.ToLower(strings.TrimSpace(key)) {
			case "image", "images", "image_url", "image_urls", "input_image", "mask", "reference", "references":
				return true
			}
			if containsGotoccMedia(item) {
				return true
			}
		}
	case []any:
		for _, item := range typed {
			if containsGotoccMedia(item) {
				return true
			}
		}
	case string:
		text := strings.TrimSpace(strings.ToLower(typed))
		return strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "blob:")
	}
	return false
}
