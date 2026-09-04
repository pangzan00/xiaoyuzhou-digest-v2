/**
 * Transcription logic using DashScope Fun-ASR
 */

import { getSettings, createCanceledError, throwIfCanceled, sleep, notifyProgress, formatElapsed, estimateTranscribeSeconds, loadPromptSection, requestAiCompletion } from './index';
import { dashscopeTranscriptionUrl, dashscopeTaskUrl, isXiaoyuzhouObjectId } from '../shared/domain';
import { parseSentences, buildIntroDetectionSample, buildTranscript, buildTranscriptSample, speakerDisplayName } from '../shared/transcript';
import { TranscriptionResult, TranscriptionError, DiarizationConfig, TranscriptSentence } from '../types';

// ============================================================
// CONSTANTS
// ============================================================

const ASR_POLL_INTERVAL_MS = 5000;
const ASR_MAX_POLL_MS = 10 * 60 * 1000;

const XIAOYUZHOU_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';

// ============================================================
// INFLIGHT TRANSCRIPTS MAP
// ============================================================

interface InflightJob {
  controller: AbortController;
  promise: Promise<TranscriptionResult | TranscriptionError>;
}

const inflightTranscripts = new Map<string, InflightJob>();

// ============================================================
// XIAOYUZHOU PAGE PARSING
// ============================================================

interface ParsedPage {
  audioUrl: string;
  title: string;
  description: string;
  duration: number;
  podcastTitle: string;
  podcastAuthor: string;
}

async function fetchXiaoyuzhouEpisodeHtml(episodeId: string): Promise<string> {
  const url = `https://www.xiaoyuzhoufm.com/episode/${episodeId}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': XIAOYUZHOU_UA,
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`请求单集页面失败 HTTP ${response.status}`);
  }
  return response.text();
}

function parseXiaoyuzhouPage(html: string): ParsedPage {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  let episode: Record<string, unknown> | null = null;

  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      episode = data?.props?.pageProps?.episode as Record<string, unknown> || null;
    } catch (e) {
      episode = null;
    }
  }

  if (episode && typeof episode === 'object') {
    const podcast = episode.podcast as Record<string, unknown> | undefined;
    return {
      audioUrl: (episode.enclosure as any)?.url || (episode.media as any)?.source?.url || '',
      title: String(episode.title || ''),
      description: String(episode.description || ''),
      duration: Number(episode.duration) || 0,
      podcastTitle: String(podcast?.title || ''),
      podcastAuthor: String(podcast?.author || ''),
    };
  }

  const audioMatch = html.match(
    /https:\/\/media\.xyzcdn\.net\/[^"'<>\s]+\.(?:m4a|mp3)/i
  );
  const titleMatch = html.match(/"title":"([^"]{1,200})"/);

  return {
    audioUrl: audioMatch ? audioMatch[0] : '',
    title: titleMatch ? titleMatch[1] : '',
    description: '',
    duration: 0,
    podcastTitle: '',
    podcastAuthor: '',
  };
}

// ============================================================
// TRANSCRIPTION SUBMISSION & POLLING
// ============================================================

async function submitTranscription(
  audioUrl: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  diarization: DiarizationConfig,
  signal?: AbortSignal
): Promise<string> {
  throwIfCanceled(signal);
  const asrModel = settings.asrModel || 'paraformer-v2';
  const body: Record<string, unknown> = {
    model: asrModel,
    input: { file_urls: [audioUrl] },
    parameters: {},
  };

  if (diarization && diarization.enabled) {
    (body.parameters as Record<string, unknown>).diarization_enabled = true;
    (body.parameters as Record<string, unknown>).speaker_count =
      diarization.speakerCount || settings.speakerCount;
  }

  const response = await fetch(dashscopeTranscriptionUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.dashscopeApiKey}`,
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    signal,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (data as Record<string, unknown>)?.message ||
      ((data as Record<string, unknown>)?.output as Record<string, unknown>)?.message ||
      `HTTP ${response.status}`;
    const error = new Error(`转写提交失败：${message}`);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  const taskId = ((data as Record<string, unknown>)?.output as Record<string, unknown>)?.task_id;
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('DashScope 未返回 task_id。');
  }
  return taskId;
}

function findTranscriptionUrl(node: unknown): string | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (typeof obj.transcription_url === 'string' && obj.transcription_url) {
    return obj.transcription_url;
  }
  for (const value of Object.values(node)) {
    const found = findTranscriptionUrl(value);
    if (found) return found;
  }
  return null;
}

async function pollTranscription(
  taskId: string,
  settings: Awaited<ReturnType<typeof getSettings>>,
  estimatedSeconds: number,
  asrModel: string,
  episodeId: string,
  signal?: AbortSignal
): Promise<string> {
  const startedAt = Date.now();
  const deadline = Date.now() + ASR_MAX_POLL_MS;
  const modelName = asrModel || '语音';

  while (Date.now() < deadline) {
    throwIfCanceled(signal);

    const response = await fetch(dashscopeTaskUrl(taskId), {
      headers: { Authorization: `Bearer ${settings.dashscopeApiKey}` },
      signal,
    });

    if (!response.ok) {
      throw new Error(`查询转写任务失败 HTTP ${response.status}`);
    }

    const data = await response.json().catch(() => ({}));
    const output = (data as Record<string, unknown>)?.output as Record<string, unknown> || {};

    if (output.task_status === 'SUCCEEDED') {
      const transcriptionUrl = findTranscriptionUrl(output);
      if (!transcriptionUrl) {
        throw new Error('转写成功但未返回结果地址。');
      }
      return transcriptionUrl;
    }

    if (output.task_status === 'FAILED' || output.task_status === 'CANCELED') {
      throw new Error(String(output.message || `转写失败：${output.task_status}`));
    }

    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    const percent =
      estimatedSeconds > 0
        ? Math.min(85, 20 + (elapsed / estimatedSeconds) * 65)
        : 50;
    const eta = estimatedSeconds > 0 ? `（预计约 ${formatElapsed(estimatedSeconds)}）` : '';

    notifyProgress(
      episodeId,
      '正在转写音频',
      `${modelName} 语音识别中…已用时 ${formatElapsed(elapsed)}${eta}`,
      Math.round(percent)
    );

    await sleep(ASR_POLL_INTERVAL_MS, signal);
  }

  throw new Error('转写超时，请重试。');
}

async function downloadTranscriptionResult(
  transcriptionUrl: string,
  signal?: AbortSignal
): Promise<unknown> {
  throwIfCanceled(signal);
  const response = await fetch(transcriptionUrl, {
    headers: { 'User-Agent': XIAOYUZHOU_UA },
    signal,
  });
  if (!response.ok) {
    throw new Error(`下载转写结果失败 HTTP ${response.status}`);
  }
  return response.json();
}

// ============================================================
// SPEAKER IDENTIFICATION & DIARIZATION
// ============================================================

async function identifySpeakers(
  page: ParsedPage,
  sampleText: string,
  speakerIds: number[],
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<{ names: Record<number, string> | null; error?: string }> {
  if (!settings.aiApiKey) {
    return { names: null, error: '尚未配置 DeepSeek API key，无法识别说话人姓名' };
  }
  if (!speakerIds.length) {
    return { names: null, error: '正文中没有可识别的说话人' };
  }

  try {
    const knownSpeakerIds = new Set(speakerIds);

    const variables: Record<string, string> = {
      videoTitle: page.title || '未知标题',
      channelName: page.podcastTitle || page.podcastAuthor || '未知播客',
      showNotes: page.description || '暂无 Show Notes',
      speakerIds: speakerIds.join(', '),
      transcriptSample: sampleText,
    };

    const systemPrompt = await loadPromptSection('speakers.md', 'System prompt', variables);
    const userPrompt = await loadPromptSection('speakers.md', 'User prompt', variables);

    const { text } = await requestAiCompletion({
      maxTokens: 384,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const parsed = parseLooseJson(text);
    const speakers: Record<number, string> = {};

    for (const item of (parsed as any)?.speakers || []) {
      const id = Number(item?.speakerId);
      const name = String(item?.name || '').trim().slice(0, 40);
      if (Number.isInteger(id) && knownSpeakerIds.has(id) && name) {
        speakers[id] = name;
      }
    }

    if (!Object.keys(speakers).length) {
      // 便于在 service worker 控制台排查模型为何没有输出映射
      console.warn('[小宇宙 Digest v2.0] 说话人识别：AI 未返回有效映射，原始响应:', text.slice(0, 200));
    }
    return Object.keys(speakers).length ? { names: speakers } : { names: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[小宇宙 Digest v2.0] 说话人识别失败:', message);
    return { names: null, error: message };
  }
}

interface IntroBoundaryDecision {
  isIntroDetected?: unknown;
  bodyStartSeconds?: unknown;
  confidence?: unknown;
}

/**
 * Returns a conservative, sentence-aligned intro boundary. The opener remains
 * in the transcript, but speaker labels before this point are ignored so
 * mixed audio cannot consume the real speakers' identity slots.
 */
async function detectIntroEndSeconds(
  page: ParsedPage,
  sentences: TranscriptSentence[],
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<number> {
  if (!settings.aiApiKey || !sentences.length) return 0;

  const openingTranscript = buildIntroDetectionSample(sentences);
  if (!openingTranscript) return 0;

  try {
    const variables: Record<string, string> = {
      videoTitle: page.title || '未知标题',
      channelName: page.podcastTitle || page.podcastAuthor || '未知播客',
      showNotes: page.description || '暂无 Show Notes',
      openingTranscript,
    };
    const systemPrompt = await loadPromptSection('intro-boundary.md', 'System prompt', variables);
    const userPrompt = await loadPromptSection('intro-boundary.md', 'User prompt', variables);
    const { text } = await requestAiCompletion({
      maxTokens: 128,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const decision = parseLooseJson(text) as IntroBoundaryDecision;
    const requestedStart = Number(decision?.bodyStartSeconds);
    const isHighConfidence = String(decision?.confidence || '').toLowerCase() === 'high';
    if (decision?.isIntroDetected !== true || !isHighConfidence) return 0;
    if (!Number.isFinite(requestedStart) || requestedStart <= 0 || requestedStart > 300) return 0;

    // Use a real ASR sentence boundary; never create a guessed timestamp.
    return sentences.find((sentence) => sentence.start >= requestedStart && sentence.start <= 300)?.start || 0;
  } catch (error) {
    console.warn('[小宇宙 Digest v2.0] 片头识别失败:', error instanceof Error ? error.message : error);
    return 0;
  }
}

function listedSpeakerCount(description: string): number | null {
  const match = String(description || '').match(
    /(?:^|\n)[ \t]*(?:\*\*)?【(?:本期)?嘉宾】(?:\*\*)?[ \t]*\n+([\s\S]*?)(?=\n(?:\s|<br\s*\/?>|\*\*)*【|$)/i
  );
  if (!match) return null;

  const guests = match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/\*\*/g, '').trim())
    .filter((line) => line && !/^<br\s*\/?>$/i.test(line) && !/^(?:暂无|无|待定)/.test(line));

  if (guests.length >= 2) return Math.min(100, guests.length);
  if (guests.length !== 1) return null;

  const inlineGuests = guests[0]
    .split(/[、，,]/)
    .map((name) => name.trim())
    .filter(Boolean);
  return inlineGuests.length >= 2 ? Math.min(100, inlineGuests.length) : null;
}

function weaklySignalsConversation(page: ParsedPage): boolean {
  if (!page) return false;
  const haystack = `${page.title || ''} ${page.description || ''}`;
  const signals = [
    '对话', '访谈', '对谈', '嘉宾', '邀请', '圆桌', '连麦', '做客',
    '主播', '主持', '主持人', '采访', '听友', '来信', '问答',
    '俩', '两位', '二人', '几人', '几位', '三人', '×', '聊',
  ];

  if (signals.some((s) => haystack.includes(s))) return true;
  return /(主播|主持|嘉宾|对话|采访|对谈|访谈)\s*[:：]/.test(haystack);
}

async function detectConversation(
  page: ParsedPage,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<{ isConversation: boolean; speakerCount: number } | null> {
  if (!settings.aiApiKey) return null;
  try {
    const variables: Record<string, string> = {
      videoTitle: page.title || '未知标题',
      channelName: page.podcastTitle || page.podcastAuthor || '未知播客',
      showNotes: page.description || '暂无 Show Notes',
    };
    const systemPrompt = await loadPromptSection('diarization.md', 'System prompt', variables);
    const userPrompt = await loadPromptSection('diarization.md', 'User prompt', variables);
    const { text } = await requestAiCompletion({
      maxTokens: 128,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    const parsed = parseLooseJson(text) as { isConversation?: unknown; speakerCount?: unknown };
    const rawSpeakerCount = Number(parsed?.speakerCount);
    const speakerCount = Number.isFinite(rawSpeakerCount)
      ? Math.min(100, Math.max(2, Math.round(rawSpeakerCount)))
      : 2;
    return { isConversation: Boolean(parsed?.isConversation), speakerCount };
  } catch (error) {
    console.warn('[小宇宙 Digest v2.0] 说话人判断失败:', error instanceof Error ? error.message : error);
    return null;
  }
}

async function resolveDiarization(
  page: ParsedPage,
  settings: Awaited<ReturnType<typeof getSettings>>
): Promise<DiarizationConfig> {
  if (settings.diarizationMode === 'off') {
    return { enabled: false, speakerCount: 0, source: 'off' };
  }
  if (settings.diarizationMode === 'on') {
    return {
      enabled: true,
      speakerCount: settings.speakerCount,
      source: 'manual',
    };
  }

  // Show Notes 中明确列出嘉宾时，名单行数比模型猜测更可靠，尤其适用于三人及以上圆桌。
  const metadataSpeakerCount = listedSpeakerCount(page.description);
  if (metadataSpeakerCount !== null) {
    return {
      enabled: true,
      speakerCount: metadataSpeakerCount,
      source: 'auto-signal',
    };
  }

  // 播客通常是多人对谈，因此 auto 保守地保持开启；AI 只负责估计人数。
  const detected = await detectConversation(page, settings);
  const signalHit = weaklySignalsConversation(page);
  return {
    enabled: true,
    speakerCount: detected?.isConversation ? detected.speakerCount : settings.speakerCount,
    source: !detected ? 'fallback' : detected.isConversation ? 'auto' : signalHit ? 'auto-signal' : 'auto',
  };
}

// ============================================================
// MAIN TRANSCRIPTION FUNCTION
// ============================================================

export async function transcribeEpisode(
  episodeId: string,
  signal?: AbortSignal
): Promise<TranscriptionResult | TranscriptionError> {
  try {
    const settings = await getSettings();

    if (!settings.dashscopeApiKey) {
      return {
        success: false,
        error: 'NO_DASHSCOPE_KEY',
        message: '尚未配置 DashScope API key，请在小宇宙 Digest v2.0 设置中填写。',
      };
    }

    const asrModel = settings.asrModel || 'paraformer-v2';
    notifyProgress(episodeId, '正在获取音频', '从小宇宙单集页提取音频地址…', 5);

    const html = await fetchXiaoyuzhouEpisodeHtml(episodeId);
    const page = parseXiaoyuzhouPage(html);

    if (!page.audioUrl) {
      return {
        success: false,
        error: 'NO_AUDIO',
        message: '未能从单集页提取到音频地址（页面结构可能变化）。',
      };
    }

    notifyProgress(episodeId, '正在判断说话人', 'AI 正在判断是否对谈及人数…', 10);
    const diarization = await resolveDiarization(page, settings);

    notifyProgress(episodeId, '正在提交转写', `调用 ${asrModel} 离线语音识别…`, 15);
    throwIfCanceled(signal);

    const taskId = await submitTranscription(page.audioUrl, settings, diarization, signal);
    const estimatedSeconds = estimateTranscribeSeconds(page.duration);

    const transcriptionUrl = await pollTranscription(
      taskId,
      settings,
      estimatedSeconds,
      asrModel,
      episodeId,
      signal
    );

    notifyProgress(episodeId, '正在整理结果', '解析转写文字稿…', 90);
    const result = await downloadTranscriptionResult(transcriptionUrl, signal);
    let sentences = parseSentences(result as Parameters<typeof parseSentences>[0], diarization.enabled);

    notifyProgress(episodeId, '正在识别片头', '检测混剪、广告和固定口播，避免干扰正文说话人…', 91);
    const introEndSeconds = await detectIntroEndSeconds(page, sentences, settings);
    if (introEndSeconds > 0) {
      // Preserve intro text for reading, but prevent its noisy voice clusters from
      // affecting speaker validation, samples, and identity mapping downstream.
      sentences = sentences.map((sentence) => (
        sentence.start < introEndSeconds ? { ...sentence, speaker: null } : sentence
      ));
    }

    // Check if diarization actually produced multiple speakers in the正文 portion.
    const bodySentences = introEndSeconds > 0
      ? sentences.filter((sentence) => sentence.start >= introEndSeconds)
      : sentences;
    let diarizationApplied = false;
    if (diarization.enabled) {
      const distinctSpeakers = new Set(
        bodySentences
          .map((s) => s.speaker)
          .filter((v): v is number => v !== null && v !== undefined)
      );

      if (distinctSpeakers.size >= 2) {
        diarizationApplied = true;
      } else {
        sentences = sentences.map((s) => ({ ...s, speaker: null }));
      }
    }

    let speakerNames: Record<number, string> | null = null;
    let speakerIdentityStatus: 'identified' | 'empty' | 'failed' | undefined;
    let speakerIdentityError: string | undefined;
    if (diarizationApplied && bodySentences.length > 0) {
      const speakerIds = [...new Set(
        bodySentences
          .map((sentence) => sentence.speaker)
          .filter((speaker): speaker is number => speaker !== null && speaker !== undefined)
      )];
      notifyProgress(episodeId, '正在识别说话人', 'AI 正在识别说话人姓名…', 92);
      const sample = buildTranscriptSample(bodySentences);
      const { names, error } = await identifySpeakers(page, sample, speakerIds, settings);
      speakerNames = names;
      if (names) {
        speakerIdentityStatus = 'identified';
      } else {
        speakerIdentityStatus = error ? 'failed' : 'empty';
        speakerIdentityError = error;
      }
    }

    const parsed = buildTranscript(sentences, speakerNames);

    if (parsed.transcript.length === 0) {
      return {
        success: false,
        error: 'EMPTY_TRANSCRIPT',
        message: `${asrModel} 返回了空转写稿。`,
      };
    }

    return {
      success: true,
      transcript: parsed.transcript,
      turns: parsed.turns,
      transcriptText: parsed.transcriptText,
      transcriptTextTimestamped: parsed.transcriptTextTimestamped,
      language: parsed.language,
      asrModel,
      diarization: {
        ...diarization,
        enabled: diarizationApplied,
        introEndSeconds,
        speakerIdentityStatus,
        speakerIdentityError,
      },
      speakers: speakerNames,
    };
  } catch (error) {
    if (
      (signal?.aborted) ||
      (error instanceof Error && (error as Error & { code?: string }).code === 'TRANSCRIPTION_CANCELED') ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      return {
        success: false,
        error: 'TRANSCRIPTION_CANCELED',
        message: '已停止转录，原有文字稿未受影响。',
      };
    }

    console.error('Transcript fetch error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '获取转写失败',
      message: error instanceof Error ? error.message : '获取转写失败',
    };
  }
}

// ============================================================
// PUBLIC API
// ============================================================

export function handleFetchTranscript(
  episodeId: string,
  force = false
): Promise<TranscriptionResult | TranscriptionError> {
  const key = String(episodeId || '');
  const existing = inflightTranscripts.get(key);

  if (existing && !force) return existing.promise;
  if (existing && force) existing.controller.abort();

  const controller = new AbortController();
  const job: InflightJob = { controller, promise: null! };

  job.promise = transcribeEpisode(key, controller.signal).finally(() => {
    if (inflightTranscripts.get(key) === job) inflightTranscripts.delete(key);
  });

  inflightTranscripts.set(key, job);
  return job.promise;
}

export function handleCancelTranscript(episodeId: string): { success: boolean; error?: string } {
  const key = String(episodeId || '');
  const job = inflightTranscripts.get(key);

  if (!job) return { success: false, error: '没有正在进行的转录任务。' };
  job.controller.abort();
  return { success: true };
}

// ============================================================
// JSON HELPER
// ============================================================

export function parseLooseJson(text: string): unknown {
  let cleaned = (text || '').trim();

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (firstError) {
    const repaired = cleaned.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(repaired);
  }
}
