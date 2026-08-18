package handler

import (
	"strings"
	"testing"
)

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
