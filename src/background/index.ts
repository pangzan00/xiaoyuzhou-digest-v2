/**
 * BACKGROUND SERVICE WORKER
 */

import { normalize, chatCompletionsUrl } from '../shared/domain';
import { Settings, TranscriptionResult, TranscriptionError } from '../types';

const DEBUG = false;
const AI_PROVIDER_IDLE_TIMEOUT_MS = 50_000;
const AI_PROVIDER_HARD_TIMEOUT_MS = 120_000;
const AI_PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const ASR_POLL_INTERVAL_MS = 5000;
const ASR_MAX_POLL_MS = 10 * 60 * 1000;

const debugLog = (...args: unknown[]) => {
  if (DEBUG) console.log('[小宇宙 Digest v2.0 BG]', ...args);
};

chrome.storage.local
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch((error) =>
    console.warn('[小宇宙 Digest v2.0] 无法限制存储访问权限:', error)
  );

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('xyz_settings');
  return normalize(stored['xyz_settings']);
}

export function createCanceledError(): Error {
  const error = new Error('已停止转录。');
  (error as Error & { code?: string }).code = 'TRANSCRIPTION_CANCELED';
  return error;
}

export function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw createCanceledError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(createCanceledError()); return; }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); reject(createCanceledError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function notifyProgress(episodeId: string, title: string, subtitle: string, progress: number): void {
  chrome.runtime.sendMessage({ action: 'transcriptProgress', episodeId, title, subtitle, progress }).catch(() => {});
}

export function formatElapsed(totalSeconds: number | string): string {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60), sec = s % 60;
  return m > 0 ? `${m}分${sec}秒` : `${sec}秒`;
}

export function estimateTranscribeSeconds(durationSeconds: number | string): number {
  const d = Number(durationSeconds) || 0;
  if (d <= 0) return 0;
  return Math.min(480, Math.max(15, Math.round(d / 40)));
}

const promptFileCache = new Map<string, string>();

export async function loadPromptSection(fileName: string, heading: string, variables: Record<string, string> = {}): Promise<string> {
  let markdown = promptFileCache.get(fileName);
  if (!markdown) {
    const response = await fetch(chrome.runtime.getURL(`prompts/${fileName}`));
    if (!response.ok) throw new Error(`Could not load prompt file: ${fileName}`);
    markdown = await response.text();
    promptFileCache.set(fileName, markdown);
  }
  const marker = `## ${heading}`;
  const markerIndex = markdown.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Prompt section not found: ${fileName}#${heading}`);
  const sectionStart = markerIndex + marker.length;
  const nextSection = markdown.indexOf('\n## ', sectionStart);
  const section = markdown.slice(sectionStart, nextSection === -1 ? markdown.length : nextSection);
  const fenceMatch = section.match(/```(?:[A-Za-z0-9_-]+)?\n([\s\S]*?)\n```/);
  if (!fenceMatch) throw new Error(`Prompt section not found: ${fileName}#${heading}`);
  let prompt = fenceMatch[1];
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.split(`{${key}}`).join(String(value ?? ''));
  }
  return prompt;
}

async function readBoundedAiResponse(response: Response, onActivity: () => void): Promise<unknown> {
  const reader = response.body?.getReader?.();
  if (reader) {
    const decoder = new TextDecoder();
    let responseText = '';
    let responseBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      onActivity();
      const byteLength = value?.byteLength ?? 0;
      responseBytes += byteLength;
      if (responseBytes > AI_PROVIDER_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        const error = new Error('DeepSeek 响应超过 2 MiB 限制。');
        (error as Error & { code?: string }).code = 'AI_RESPONSE_TOO_LARGE';
        throw error;
      }
      responseText += decoder.decode(value, { stream: true });
    }
    responseText += decoder.decode();
    return JSON.parse(responseText.trimStart());
  }
  if (typeof response.text === 'function') {
    const responseText = await response.text();
    onActivity();
    const byteLength = new TextEncoder().encode(responseText).byteLength;
    if (byteLength > AI_PROVIDER_MAX_RESPONSE_BYTES) {
      const error = new Error('DeepSeek 响应超过 2 MiB 限制。');
      (error as Error & { code?: string }).code = 'AI_RESPONSE_TOO_LARGE';
      throw error;
    }
    return JSON.parse(responseText.trimStart());
  }
  const data = await response.json();
  onActivity();
  return data;
}

export interface AiCompletionResult { text: string; settings: Settings; }

export interface AiCompletionStreamOptions {
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
  onChunk: (content: string) => void;
}

export async function requestAiCompletionStream({
  messages,
  maxTokens,
  temperature,
  signal,
  onChunk,
}: AiCompletionStreamOptions): Promise<AiCompletionResult> {
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    const error = new Error('尚未配置 DeepSeek API key，请在小宇宙 Digest v2.0 设置中填写。');
    (error as Error & { code?: string }).code = 'NO_AI_KEY';
    throw error;
  }

  const body: Record<string, unknown> = {
    model: settings.aiModel,
    max_tokens: maxTokens,
    messages,
    stream: true,
    thinking: { type: 'disabled' },
  };
  if (typeof temperature === 'number') body.temperature = temperature;

  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let hardTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let timeoutKind = '';
  const abortForTimeout = (kind: string) => {
    if (!controller.signal.aborted) {
      timeoutKind = kind;
      controller.abort();
    }
  };
  const resetIdleTimeout = () => {
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => abortForTimeout('idle'), AI_PROVIDER_IDLE_TIMEOUT_MS);
  };

  try {
    hardTimeoutId = setTimeout(() => abortForTimeout('hard'), AI_PROVIDER_HARD_TIMEOUT_MS);
    resetIdleTimeout();
    const response = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.aiApiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => '');
      let message = `DeepSeek error: ${response.status}`;
      try {
        const parsed = JSON.parse(payload);
        message = parsed?.error?.message || parsed?.message || message;
      } catch {
        // 保留 HTTP 状态错误。
      }
      const error = new Error(message);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    if (!response.body) throw new Error('DeepSeek 未返回可读取的流式响应。');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let receivedBytes = 0;

    const consumeEvent = (event: string) => {
      const payload = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (!payload || payload === '[DONE]') return;
      try {
        const data = JSON.parse(payload);
        const content = data?.choices?.[0]?.delta?.content;
        if (typeof content === 'string' && content) {
          answer += content;
          onChunk(content);
        }
      } catch {
        // 保持对服务端心跳与非 JSON SSE 事件的兼容。
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetIdleTimeout();
      receivedBytes += value.byteLength;
      if (receivedBytes > AI_PROVIDER_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error('DeepSeek 流式响应超过 2 MiB 限制。');
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      events.forEach(consumeEvent);
    }
    buffer += decoder.decode();
    if (buffer.trim()) consumeEvent(buffer);
    if (!answer.trim()) throw new Error('DeepSeek 返回了空响应。');
    return { text: answer, settings };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeoutKind === 'idle') throw new Error('DeepSeek 请求 50 秒无响应，请重试。');
    if (timeoutKind === 'hard') throw new Error('DeepSeek 请求超过 120 秒，请重试。');
    throw error;
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
    clearTimeout(idleTimeoutId);
    clearTimeout(hardTimeoutId);
  }
}

export async function requestAiCompletion({
  messages,
  maxTokens,
  temperature,
  responseFormat,
}: {
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature?: number;
  responseFormat?: { type: string };
}): Promise<AiCompletionResult> {
  const settings = await getSettings();
  if (!settings.aiApiKey) {
    const error = new Error('尚未配置 DeepSeek API key，请在小宇宙 Digest v2.0 设置中填写。');
    (error as Error & { code?: string }).code = 'NO_AI_KEY';
    throw error;
  }
  const body: Record<string, unknown> = { model: settings.aiModel, max_tokens: maxTokens, messages };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (responseFormat) body.response_format = responseFormat;
  (body as Record<string, unknown>).thinking = { type: 'disabled' };
  const controller = new AbortController();
  let timeoutKind = '';
  let idleTimeoutId: ReturnType<typeof setTimeout> | undefined;
  let hardTimeoutId: ReturnType<typeof setTimeout>;
  const abortForTimeout = (kind: string) => { if (controller.signal.aborted) return; timeoutKind = kind; controller.abort(); };
  const resetIdleTimeout = () => { clearTimeout(idleTimeoutId); idleTimeoutId = setTimeout(() => abortForTimeout('idle'), AI_PROVIDER_IDLE_TIMEOUT_MS); };
  hardTimeoutId = setTimeout(() => abortForTimeout('hard'), AI_PROVIDER_HARD_TIMEOUT_MS);
  resetIdleTimeout();
  try {
    const response = await fetch(chatCompletionsUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.aiApiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    resetIdleTimeout();
    const data = await readBoundedAiResponse(response, resetIdleTimeout);
    if (!response.ok) {
      const errorData = data && typeof data === 'object' ? data : {};
      const error = new Error(
        ((errorData as any)?.error?.message || (errorData as any)?.message || `DeepSeek error: ${response.status}`)
      );
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    // Use 'any' to avoid TypeScript issues with optional chaining on unknown type
    const responseData: any = data;
    const text = (responseData && responseData.choices && responseData.choices[0] && responseData.choices[0].message) ? responseData.choices[0].message.content : '';
    if (!text.trim()) {
      const error = new Error('DeepSeek 返回了空响应。');
      (error as Error & { code?: string }).code = 'EMPTY_AI_RESPONSE';
      throw error;
    }
    return { text, settings };
  } catch (error) {
    if (timeoutKind === 'idle') {
      const timeoutError = new Error('DeepSeek 请求 50 秒无响应，请重试。');
      (timeoutError as Error & { code?: string }).code = 'AI_IDLE_TIMEOUT'; throw timeoutError;
    }
    if (timeoutKind === 'hard') {
      const timeoutError = new Error('DEepSeek 请求超过 120 秒，请重试。');
      (timeoutError as Error & { code?: string }).code = 'AI_HARD_TIMEOUT'; throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(idleTimeoutId);
    clearTimeout(hardTimeoutId);
  }
}

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
  try { return JSON.parse(cleaned); }
  catch (_firstError) {
    const repaired = cleaned.replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(repaired);
  }
}

// Import sub-modules
import './sidepanel-setup';
import './message-handling';
import './transcription';
import './analysis';
import './notes';
import './episode-chat';
import './podcast-parser';
