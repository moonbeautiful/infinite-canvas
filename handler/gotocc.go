package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strconv"
	"strings"

	"github.com/tigerowo/infinite-canvas/service"
)

const (
	gotoccKeyHeader          = "X-Gotocc-API-Key"
	gotoccBodyLimit          = 1 << 20
	gotoccEditBodyLimit      = 64 << 20
	gotoccEditImageLimit     = 15 << 20
	gotoccEditMaxImageCount  = 4
	gotoccEditPromptMaxChars = 12000
)

var (
	gotoccAPIBaseURL = "https://gotocc.xyz/v1"
	gotoccHTTPClient = service.SafeProxyHTTPClient()
)

func GotoccModels(w http.ResponseWriter, r *http.Request) {
	proxyGotoccRequest(w, r, http.MethodGet, "/models", nil, "")
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
	proxyGotoccRequest(w, r, http.MethodPost, "/images/generations", body, "application/json")
}

func GotoccImageEdits(w http.ResponseWriter, r *http.Request) {
	if !validGotoccKey(strings.TrimSpace(r.Header.Get(gotoccKeyHeader))) {
		FailWithStatus(w, http.StatusUnauthorized, "gotocc Key 无效")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, gotoccEditBodyLimit)
	body, contentType, err := buildGotoccEditRequest(r)
	if err != nil {
		FailWithStatus(w, http.StatusBadRequest, err.Error())
		return
	}
	proxyGotoccRequest(w, r, http.MethodPost, "/images/edits", body, contentType)
}

func proxyGotoccRequest(w http.ResponseWriter, r *http.Request, method string, path string, body []byte, contentType string) {
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
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	response, err := gotoccHTTPClient.Do(request)
	if err != nil {
		if method == http.MethodPost {
			w.Header().Set("X-Upstream-State", "unknown")
			FailWithStatus(w, http.StatusBadGateway, "gotocc 请求状态未知，请先核对 gotocc 记录")
			return
		}
		FailWithStatus(w, http.StatusBadGateway, "gotocc 请求失败")
		return
	}
	defer response.Body.Close()

	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", firstNonEmpty(response.Header.Get("Content-Type"), "application/json"))
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, response.Body)
}

func buildGotoccEditRequest(r *http.Request) ([]byte, string, error) {
	if err := r.ParseMultipartForm(gotoccEditBodyLimit); err != nil {
		return nil, "", errors.New("商品图片过大或上传格式错误")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	modelName := strings.TrimSpace(r.FormValue("model"))
	if modelName != "gpt-image-2" && modelName != "gpt-image-2-high" {
		return nil, "", errors.New("gotocc 连接仅允许 GPT Image 2")
	}
	prompt := strings.TrimSpace(r.FormValue("prompt"))
	if prompt == "" || len([]rune(prompt)) > gotoccEditPromptMaxChars {
		return nil, "", errors.New("商品图描述不能为空且不能超过 12000 字符")
	}
	size := strings.TrimSpace(r.FormValue("size"))
	switch size {
	case "1024x1024", "1536x1024", "1024x1536":
	default:
		return nil, "", errors.New("商品图画幅不支持")
	}
	quality := strings.TrimSpace(r.FormValue("quality"))
	if quality == "" {
		quality = "medium"
	}
	if quality != "medium" && quality != "high" {
		return nil, "", errors.New("商品图质量参数不支持")
	}

	headers := append([]*multipart.FileHeader{}, r.MultipartForm.File["image"]...)
	headers = append(headers, r.MultipartForm.File["image[]"]...)
	if len(headers) == 0 || len(headers) > gotoccEditMaxImageCount {
		return nil, "", errors.New("请上传 1 至 4 张商品图片")
	}

	var buffer bytes.Buffer
	writer := multipart.NewWriter(&buffer)
	fields := map[string]string{
		"model":           modelName,
		"prompt":          prompt,
		"n":               "1",
		"size":            size,
		"quality":         quality,
		"response_format": "b64_json",
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return nil, "", errors.New("无法准备商品图请求")
		}
	}
	for index, header := range headers {
		file, err := header.Open()
		if err != nil {
			return nil, "", errors.New("无法读取商品图片")
		}
		data, readErr := io.ReadAll(io.LimitReader(file, gotoccEditImageLimit+1))
		_ = file.Close()
		if readErr != nil || len(data) == 0 {
			return nil, "", errors.New("无法读取商品图片")
		}
		if len(data) > gotoccEditImageLimit {
			return nil, "", errors.New("单张商品图片不能超过 15 MB")
		}
		mimeType := normalizeGotoccImageType(data)
		if mimeType == "" {
			return nil, "", errors.New("商品图片仅支持 JPEG、PNG 或 WebP")
		}
		filename := "product-" + strconv.Itoa(index+1) + gotoccImageExtension(mimeType)
		partHeader := make(textproto.MIMEHeader)
		partHeader.Set("Content-Disposition", `form-data; name="image"; filename="`+strings.ReplaceAll(filename, `"`, "")+`"`)
		partHeader.Set("Content-Type", mimeType)
		part, err := writer.CreatePart(partHeader)
		if err != nil {
			return nil, "", errors.New("无法准备商品图请求")
		}
		if _, err := part.Write(data); err != nil {
			return nil, "", errors.New("无法准备商品图请求")
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", errors.New("无法准备商品图请求")
	}
	return buffer.Bytes(), writer.FormDataContentType(), nil
}

func normalizeGotoccImageType(data []byte) string {
	switch http.DetectContentType(data) {
	case "image/jpeg":
		return "image/jpeg"
	case "image/png":
		return "image/png"
	case "image/webp":
		return "image/webp"
	default:
		return ""
	}
}

func gotoccImageExtension(mimeType string) string {
	switch mimeType {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".png"
	}
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
	if prompt == "" || len([]rune(prompt)) > gotoccEditPromptMaxChars {
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
