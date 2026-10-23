package main

import (
	"encoding/json"
	"testing"
)

func thinkOf(t *testing.T, b []byte) (any, bool) {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("bad json %s: %v", b, err)
	}
	v, ok := m["think"]
	return v, ok
}

func TestApplyNoThink(t *testing.T) {
	models := parseModelList(" concord-utility-2b:latest , qwen3.5:2b ")
	cases := []struct {
		name, path, body string
		forced           bool
		want             any // value of "think" after, or nil = absent
	}{
		{"listed model chat gets think:false", "/api/chat", `{"model":"concord-utility-2b:latest","messages":[]}`, true, false},
		{"listed model generate gets think:false", "/api/generate", `{"model":"qwen3.5:2b","prompt":"x"}`, true, false},
		{"explicit think:true from caller wins", "/api/chat", `{"model":"qwen3.5:2b","think":true}`, false, true},
		{"explicit think:false untouched", "/api/chat", `{"model":"qwen3.5:2b","think":false}`, false, false},
		{"unlisted model untouched", "/api/chat", `{"model":"other:7b"}`, false, nil},
		{"embeddings path untouched", "/api/embeddings", `{"model":"qwen3.5:2b"}`, false, nil},
		{"openai path untouched", "/v1/chat/completions", `{"model":"qwen3.5:2b"}`, false, nil},
	}
	for _, c := range cases {
		out, forced := applyNoThink(c.path, []byte(c.body), models)
		if forced != c.forced {
			t.Errorf("%s: forced=%v want %v", c.name, forced, c.forced)
		}
		v, has := thinkOf(t, out)
		if c.want == nil {
			if has {
				t.Errorf("%s: think should be absent, got %v", c.name, v)
			}
		} else if !has || v != c.want {
			t.Errorf("%s: think=%v (present=%v) want %v", c.name, v, has, c.want)
		}
	}
}

func TestApplyNoThinkWildcardAndOff(t *testing.T) {
	if _, forced := applyNoThink("/api/chat", []byte(`{"model":"any"}`), parseModelList("*")); !forced {
		t.Error("* should match every model")
	}
	if _, forced := applyNoThink("/api/chat", []byte(`{"model":"any"}`), parseModelList("")); forced {
		t.Error("empty list must leave requests unchanged")
	}
	if out, forced := applyNoThink("/api/chat", []byte(`not json`), parseModelList("*")); forced || string(out) != "not json" {
		t.Error("unparseable body must pass through unchanged")
	}
}
