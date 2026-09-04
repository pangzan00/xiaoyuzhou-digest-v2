const test = require("node:test");
const assert = require("node:assert/strict");

const settings = require("../settings.js");

test("DeepSeek defaults use V4 Flash and ignore provider overrides", () => {
  const normalized = settings.normalize({
    provider: "unexpected",
    aiApiKey: "  example-key  ",
    aiBaseUrl: "https://api.example.com/v1",
    aiModel: "example-model",
    dashscopeApiKey: "  dash-key  ",
  });

  assert.equal(normalized.provider, "deepseek");
  assert.equal(normalized.aiBaseUrl, "https://api.deepseek.com");
  assert.equal(normalized.aiModel, "deepseek-v4-flash");
  assert.equal(normalized.aiApiKey, "example-key");
  assert.equal(normalized.dashscopeApiKey, "dash-key");
  assert.equal(
    settings.chatCompletionsUrl(),
    "https://api.deepseek.com/chat/completions",
  );
});

test("diarization mode defaults to auto and speaker count is clamped", () => {
  const defaults = settings.normalize({});
  assert.equal(defaults.diarizationMode, "auto");
  assert.equal(defaults.speakerCount, 2);

  assert.equal(settings.normalize({ diarizationMode: "on" }).diarizationMode, "on");
  assert.equal(settings.normalize({ diarizationMode: "off" }).diarizationMode, "off");
  assert.equal(settings.normalize({ diarizationMode: "bogus" }).diarizationMode, "auto");
  // 兼容旧版布尔值 diarization
  assert.equal(settings.normalize({ diarization: false }).diarizationMode, "off");
  assert.equal(settings.normalize({ diarization: true }).diarizationMode, "on");

  assert.equal(settings.normalize({ speakerCount: 1 }).speakerCount, 2);
  assert.equal(settings.normalize({ speakerCount: 500 }).speakerCount, 100);
  assert.equal(settings.normalize({ speakerCount: "5" }).speakerCount, 5);
});

test("asr model defaults to paraformer-v2 and is validated", () => {
  assert.equal(settings.normalize({}).asrModel, "paraformer-v2");
  assert.equal(settings.normalize({ asrModel: "fun-asr" }).asrModel, "fun-asr");
  assert.equal(settings.normalize({ asrModel: "bogus" }).asrModel, "paraformer-v2");
  assert.ok(settings.ASR_MODELS.includes("paraformer-v2"));
  assert.ok(settings.ASR_MODELS.includes("fun-asr"));
});

test("DashScope URLs are fixed and validated", () => {
  assert.equal(
    settings.dashscopeTranscriptionUrl(),
    "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription",
  );
  assert.equal(
    settings.dashscopeTaskUrl("task-12345678"),
    "https://dashscope.aliyuncs.com/api/v1/tasks/task-12345678",
  );
  assert.throws(() => settings.dashscopeTaskUrl('"><script>'), /Invalid DashScope task ID/);
});

test("canonicalXiaoyuzhouUrl builds a valid episode URL and rejects garbage", () => {
  assert.equal(
    settings.canonicalXiaoyuzhouUrl("66e9a7a25ca6d0ace389af8c"),
    "https://www.xiaoyuzhoufm.com/episode/66e9a7a25ca6d0ace389af8c",
  );
  assert.throws(
    () => settings.canonicalXiaoyuzhouUrl('"><script>'),
    /Invalid Xiaoyuzhou episode ID/,
  );
  assert.throws(
    () => settings.canonicalXiaoyuzhouUrl("not-a-valid-id"),
    /Invalid Xiaoyuzhou episode ID/,
  );
});
