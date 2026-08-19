package handler

import (
	"bytes"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type gotoccRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn gotoccRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestValidGotoccKey(t *testing.T) {
	if !validGotoccKey("sk-1234567890abcdef") {
		t.Fatal("expected key to be valid")
	}
	for _, value := range []string{"", "token-1234567890abcdef", "sk-short", "sk-has whitespace value"} {
		if validGotoccKey(value) {
			t.Fatalf("expected key to be rejected: %q", value)
		}
	}
}

func TestProxyGotoccPostTransportErrorMarksUnknown(t *testing.T) {
	previousClient := gotoccHTTPClient
	gotoccHTTPClient = &http.Client{
		Transport: gotoccRoundTripFunc(func(*http.Request) (*http.Response, error) {
			return nil, errors.New("connection reset")
		}),
	}
	t.Cleanup(func() {
		gotoccHTTPClient = previousClient
	})

	request := httptest.NewRequest(http.MethodPost, "/api/gotocc/images/edits", strings.NewReader("body"))
	request.Header.Set(gotoccKeyHeader, "sk-1234567890abcdef")
	recorder := httptest.NewRecorder()

	proxyGotoccRequest(recorder, request, http.MethodPost, "/images/edits", []byte("body"), "application/json")

	if recorder.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("X-Upstream-State"); got != "unknown" {
		t.Fatalf("expected unknown upstream state, got %q", got)
	}
	if !strings.Contains(recorder.Body.String(), "状态未知") {
		t.Fatalf("expected unknown-state response, got %s", recorder.Body.String())
	}
}

func TestValidateGotoccImageRequest(t *testing.T) {
	valid := []byte(`{"model":"gpt-image-2","prompt":"empty studio background","size":"1024x1024","n":1}`)
	if err := validateGotoccImageRequest(valid); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		body string
		want string
	}{
		{name: "model", body: `{"model":"other","prompt":"background"}`, want: "GPT Image 2"},
		{name: "prompt", body: `{"model":"gpt-image-2","prompt":""}`, want: "背景描述"},
		{name: "image", body: `{"model":"gpt-image-2","prompt":"background","image":"data:image/png;base64,AAAA"}`, want: "不能包含商品"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateGotoccImageRequest([]byte(test.body))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}

func TestBuildGotoccEditRequest(t *testing.T) {
	var requestBody bytes.Buffer
	writer := multipart.NewWriter(&requestBody)
	_ = writer.WriteField("model", "gpt-image-2")
	_ = writer.WriteField("prompt", "preserve the exact product")
	_ = writer.WriteField("size", "1024x1024")
	_ = writer.WriteField("quality", "medium")
	_ = writer.WriteField("n", "4")
	_ = writer.WriteField("unexpected", "do-not-forward")
	part, err := writer.CreateFormFile("image", "product.png")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00})
	_ = writer.Close()

	request := httptest.NewRequest("POST", "/api/gotocc/images/edits", &requestBody)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	body, contentType, err := buildGotoccEditRequest(request)
	if err != nil {
		t.Fatal(err)
	}
	rebuilt := httptest.NewRequest("POST", "/", bytes.NewReader(body))
	rebuilt.Header.Set("Content-Type", contentType)
	if err := rebuilt.ParseMultipartForm(gotoccEditBodyLimit); err != nil {
		t.Fatal(err)
	}
	if got := rebuilt.FormValue("n"); got != "1" {
		t.Fatalf("expected n to be forced to 1, got %q", got)
	}
	if got := rebuilt.FormValue("response_format"); got != "b64_json" {
		t.Fatalf("expected b64_json response, got %q", got)
	}
	if got := rebuilt.FormValue("unexpected"); got != "" {
		t.Fatalf("unexpected field was forwarded: %q", got)
	}
	file, _, err := rebuilt.FormFile("image")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	data, _ := io.ReadAll(file)
	if len(data) != 9 {
		t.Fatalf("unexpected image bytes: %d", len(data))
	}
}

func TestBuildGotoccEditRequestRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name     string
		model    string
		prompt   string
		size     string
		image    []byte
		wantText string
	}{
		{name: "model", model: "other", prompt: "scene", size: "1024x1024", image: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, wantText: "GPT Image 2"},
		{name: "prompt", model: "gpt-image-2", prompt: "", size: "1024x1024", image: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, wantText: "描述"},
		{name: "size", model: "gpt-image-2", prompt: "scene", size: "2048x2048", image: []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}, wantText: "画幅"},
		{name: "type", model: "gpt-image-2", prompt: "scene", size: "1024x1024", image: []byte("not-an-image"), wantText: "JPEG"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var requestBody bytes.Buffer
			writer := multipart.NewWriter(&requestBody)
			_ = writer.WriteField("model", test.model)
			_ = writer.WriteField("prompt", test.prompt)
			_ = writer.WriteField("size", test.size)
			part, _ := writer.CreateFormFile("image", "product.png")
			_, _ = part.Write(test.image)
			_ = writer.Close()
			request := httptest.NewRequest("POST", "/", &requestBody)
			request.Header.Set("Content-Type", writer.FormDataContentType())
			_, _, err := buildGotoccEditRequest(request)
			if err == nil || !strings.Contains(err.Error(), test.wantText) {
				t.Fatalf("unexpected error: %v", err)
			}
		})
	}
}
