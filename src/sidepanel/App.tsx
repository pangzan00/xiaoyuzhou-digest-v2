/**
 * Main App Component for Side Panel
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  AppState,
  TabName,
  TranscriptSentence,
  AnalysisResult,
  Note,
  Chapter,
  Challenge,
  CounterIntuitiveItem,
  DiarizationConfig,
  EpisodeInfo,
  HistoryEntry,
  SuggestedQuestion,
  EpisodeChatMode,
  ACTIONS,
  STORAGE_KEYS,
} from '../types';
import { Header } from './components/Header';
import { WelcomeState } from './components/WelcomeState';
import { LoadingState } from './components/LoadingState';
import { ErrorState } from './components/ErrorState';
import { TranscriptPanel } from './components/TranscriptPanel';
import { OverviewPanel } from './components/OverviewPanel';
import { ChatPanel } from './components/ChatPanel';
import { NotesPanel } from './components/NotesPanel';
import { CACHE_SCHEMA_VERSION } from '../shared/domain';

// ============================================================
// TYPES
// ============================================================

interface AppProps {}

interface CachedDigest {
  transcript?: TranscriptSentence[];
  turns?: TranscriptSentence[];
  transcriptText?: string;
  transcriptTimestamped?: string;
  transcriptTextTimestamped?: string;
  transcriptLanguage?: string;
  diarization?: DiarizationConfig;
  asrModel?: string;
  videoTitle?: string;
  channelName?: string;
  videoDescription?: string;
  videoDuration?: number;
  coverImage?: string;
  chapters?: Chapter[] | null;
  coreChallenges?: Challenge[] | null;
  counterIntuitive?: CounterIntuitiveItem[] | null;
  schemaVersion?: number;
  timestamp?: number;
}

const DIGEST_CACHE_PREFIX = 'digest_';
const HISTORY_STORAGE_KEY = 'xyz_history';
const HISTORY_LIMIT = 200;

function digestCacheKey(videoId: string): string {
  return `${DIGEST_CACHE_PREFIX}${videoId}`;
}

function hasCachedTranscript(cached?: CachedDigest): boolean {
  return Boolean(
    cached &&
      (Array.isArray(cached.transcript) && cached.transcript.length ||
        Array.isArray(cached.turns) && cached.turns.length)
  );
}

function isCompatibleCachedDigest(cached?: CachedDigest): boolean {
  return hasCachedTranscript(cached) && cached?.schemaVersion === CACHE_SCHEMA_VERSION;
}

function episodeUrl(videoId: string): string {
  return `https://www.xiaoyuzhoufm.com/episode/${videoId}`;
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function buildTimestampedTranscript(turns: TranscriptSentence[] | null | undefined): string {
  if (!turns?.length) return '';
  return turns
    .map((turn) => {
      const text = String(turn.text || turn.rawText || '').trim();
      return text ? `[${formatTimestamp(turn.start)}] ${text}` : '';
    })
    .filter(Boolean)
    .join('\n');
}

function hasTimestampedTranscript(value: Pick<AppStateData, 'currentTranscriptTimestamped'>): boolean {
  return /\[\d+:\d{2}\]/.test(value.currentTranscriptTimestamped || '');
}

interface AppStateData {
  currentVideoId: string | null;
  currentVideoUrl: string | null;
  currentAnalysis: AnalysisResult | null;
  currentTranscript: TranscriptSentence[] | null;
  currentTurns: TranscriptSentence[] | null;
  currentTranscriptText: string | null;
  currentTranscriptTimestamped: string | null;
  currentTranscriptLanguage: string | null;
  currentVideoTitle: string;
  currentChannelName: string;
  currentVideoDescription: string;
  currentVideoDuration: number;
  currentVideoImage: string;
  currentDiarization: DiarizationConfig | null;
  currentAsrModel: string | null;
  configuredAsrModel: string;
  transcriptLoadedFromCache: boolean;
  xiaoyuzhouTabId: number | null;
  currentPodcastId: string;
  activePodcastPid: string | null;
  browsedPodcasts: string[];
}

// ============================================================
// INITIAL STATE
// ============================================================

const initialState: AppStateData = {
  currentVideoId: null,
  currentVideoUrl: null,
  currentAnalysis: null,
  currentTranscript: null,
  currentTurns: null,
  currentTranscriptText: null,
  currentTranscriptTimestamped: null,
  currentTranscriptLanguage: null,
  currentVideoTitle: '',
  currentChannelName: '',
  currentVideoDescription: '',
  currentVideoDuration: 0,
  currentVideoImage: '',
  currentDiarization: null,
  currentAsrModel: null,
  configuredAsrModel: 'paraformer-v2',
  transcriptLoadedFromCache: false,
  xiaoyuzhouTabId: null,
  currentPodcastId: '',
  activePodcastPid: null,
  browsedPodcasts: [],
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export const App: React.FC<AppProps> = () => {
  const [appState, setAppState] = useState<AppState>('welcome');
  const [stateData, setStateData] = useState<AppStateData>(initialState);
  const [activeTab, setActiveTab] = useState<TabName>('transcript');
  const [errorInfo, setErrorInfo] = useState<{ title: string; message: string } | null>(null);
const [seekDiagnostics, setSeekDiagnostics] = useState<string[] | null>(null);
  const [loadingInfo, setLoadingInfo] = useState<{ title: string; subtitle: string; progress: number }>({
    title: '正在转写音频',
    subtitle: '正在通过 paraformer-v2 转写音频，长节目可能需要几分钟…',
    progress: 0,
  });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState<Record<string, boolean>>({
    chapters: false,
    challenges: false,
    counter: false,
  });
  const [overviewErrors, setOverviewErrors] = useState<Record<string, string | null>>({
    chapters: null,
    challenges: null,
    counter: null,
  });
  const [notes, setNotes] = useState<Note[]>([]);
  const [notesFilterAll, setNotesFilterAll] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
  }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
const [chatMode, setChatMode] = useState<EpisodeChatMode>('strict');
const [suggestedQuestions, setSuggestedQuestions] = useState<SuggestedQuestion[]>([]);
const [suggestionsLoading, setSuggestionsLoading] = useState(false);
const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [cardNotes, setCardNotes] = useState<Map<string, string>>(new Map());

  // Refs keep asynchronous handlers on the latest completed transcript instead
  // of the render that originally started the request.
const abortControllerRef = useRef<AbortController | null>(null);
const stateDataRef = useRef<AppStateData>(initialState);
const episodeSyncRequestRef = useRef(0);
// 笔记跳转：短暂标记目标单集，让标签页同步在跳转期间保持当前视图（如笔记列表）。
const noteJumpRef = useRef<{ videoId: string; expiresAt: number } | null>(null);

  // ============================================================
  // STATE HELPERS
  // ============================================================

  const updateStateData = useCallback((patch: Partial<AppStateData>) => {
    const next = { ...stateDataRef.current, ...patch };
    stateDataRef.current = next;
    setStateData(next);
    return next;
  }, []);

  const showWelcome = useCallback(() => {
    setAppState('welcome');
    setErrorInfo(null);
  }, []);

  const showLoading = useCallback((title?: string, subtitle?: string, progress?: number) => {
    setAppState('loading');
    if (title || subtitle || progress !== undefined) {
      setLoadingInfo((previous) => ({
        title: title || previous.title,
        subtitle: subtitle || previous.subtitle,
        progress: progress ?? previous.progress,
      }));
    }
  }, []);

  const showError = useCallback((title: string, message: string) => {
    setAppState('error');
    setErrorInfo({ title, message });
  }, []);

  const showResults = useCallback(() => {
    setAppState('results');
  }, []);

  const normalizeHistory = useCallback((value: unknown): HistoryEntry[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
      .map((entry) => ({
        videoId: String(entry.videoId || '').trim(),
        title: String(entry.title || entry.videoTitle || entry.episodeTitle || '').trim(),
        channel: String(entry.channel || entry.channelName || entry.podcastTitle || '').trim(),
        image: String(entry.image || entry.coverImage || '').trim(),
        timestamp: Number(entry.timestamp || entry.createdAt) || 0,
      }))
      .filter((entry) => /^[0-9a-fA-F]{24}$/.test(entry.videoId) && !seen.has(entry.videoId) && !!seen.add(entry.videoId))
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, HISTORY_LIMIT);
  }, []);

  const fetchCurrentEpisodeInfo = useCallback(async (tabId?: number | null): Promise<Partial<EpisodeInfo>> => {
    try {
      const info = await chrome.runtime.sendMessage({
        action: ACTIONS.GET_EPISODE_INFO,
        tabId: typeof tabId === 'number' ? tabId : undefined,
      });
      return {
        title: String(info?.title || '').trim(),
        channelName: String(info?.channelName || '').trim(),
        podcastId: String(info?.podcastId || '').trim(),
        description: String(info?.description || '').trim(),
        duration: Number(info?.duration) || 0,
        image: String(info?.image || '').trim(),
      };
    } catch {
      return {};
    }
  }, []);

  /**
   * 标题获取是异步的：侧边栏刚打开时，小宇宙 SPA 可能仍在替换单集数据。
   * 保留已有字段，并在首次响应没有 title 时单独补一次，避免 Header 因空 title 被隐藏。
   */
  const applyEpisodeInfo = useCallback((pageInfo: Partial<EpisodeInfo>) => {
    const current = stateDataRef.current;
    return updateStateData({
      currentVideoTitle: pageInfo.title || current.currentVideoTitle || '',
      currentChannelName: pageInfo.channelName || current.currentChannelName || '',
      currentVideoDescription: pageInfo.description || current.currentVideoDescription || '',
      currentVideoDuration: pageInfo.duration || current.currentVideoDuration || 0,
      currentVideoImage: pageInfo.image || current.currentVideoImage || '',
      currentPodcastId: pageInfo.podcastId || current.currentPodcastId || '',
    });
  }, [updateStateData]);

  const loadHistory = useCallback(async (): Promise<HistoryEntry[]> => {
    const allData = await chrome.storage.local.get(null);
    const storedEntries = normalizeHistory(allData[HISTORY_STORAGE_KEY]);
    const knownIds = new Set(storedEntries.map((entry) => entry.videoId));
    const recoveredEntries = Object.entries(allData)
      .filter(([key]) => /^digest_[0-9a-fA-F]{24}$/.test(key))
      .map(([key, value]) => {
        const cached = (value || {}) as CachedDigest;
        return {
          videoId: key.slice(DIGEST_CACHE_PREFIX.length),
          title: String(cached.videoTitle || '').trim(),
          channel: String(cached.channelName || '').trim(),
          image: String(cached.coverImage || '').trim(),
          timestamp: Number(cached.timestamp) || 0,
        };
      })
      .filter((entry) => entry.title && !knownIds.has(entry.videoId));
    const entries = [...storedEntries, ...recoveredEntries]
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, HISTORY_LIMIT);

    // 用缓存里的完整元信息修补旧历史中的空标题/空播客名，兼容早期只写入占位符的记录。
    const mergedEntries = entries.map((entry) => {
      const cached = allData[digestCacheKey(entry.videoId)] as CachedDigest | undefined;
      if (!cached) return entry;
      return {
        ...entry,
        title: entry.title || String(cached.videoTitle || '').trim(),
        channel: entry.channel || String(cached.channelName || '').trim(),
        image: entry.image || String(cached.coverImage || '').trim(),
        timestamp: entry.timestamp || Number(cached.timestamp) || 0,
      };
    });
    const historyChanged = mergedEntries.some((entry, index) => {
      const original = entries[index];
      return !original || entry.title !== original.title || entry.channel !== original.channel || entry.image !== original.image || entry.timestamp !== original.timestamp;
    });
    if (recoveredEntries.length || historyChanged) {
      await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: mergedEntries });
    }
    setHistory(mergedEntries);
    return mergedEntries;
  }, [normalizeHistory]);

  const saveHistoryEntry = useCallback(async (videoId: string, data: AppStateData): Promise<void> => {
    if (!videoId) return;
    const historyResult = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
    const previousHistory = normalizeHistory(historyResult[HISTORY_STORAGE_KEY]);
    const nextHistory = [
      {
        videoId,
        title: data.currentVideoTitle || '未命名单集',
        channel: data.currentChannelName || '',
        image: data.currentVideoImage || '',
        timestamp: Date.now(),
      },
      ...previousHistory.filter((entry) => entry.videoId !== videoId),
    ].slice(0, HISTORY_LIMIT);
    await chrome.storage.local.set({ [HISTORY_STORAGE_KEY]: nextHistory });
    setHistory(nextHistory);
  }, [normalizeHistory]);

  const saveCachedDigest = useCallback(async (videoId: string, data: AppStateData) => {
    if (!videoId || (!data.currentTranscript?.length && !data.currentTurns?.length)) return;

    const cached: CachedDigest = {
      transcript: data.currentTranscript,
      turns: data.currentTurns || data.currentTranscript,
      transcriptText: data.currentTranscriptText || '',
      transcriptTimestamped: data.currentTranscriptTimestamped || '',
      transcriptLanguage: data.currentTranscriptLanguage || '',
      diarization: data.currentDiarization || undefined,
      asrModel: data.currentAsrModel || '',
      videoTitle: data.currentVideoTitle || '',
      channelName: data.currentChannelName || '',
      videoDescription: data.currentVideoDescription || '',
      videoDuration: data.currentVideoDuration || 0,
      coverImage: data.currentVideoImage || '',
      chapters: data.currentAnalysis?.chapters || null,
      coreChallenges: data.currentAnalysis?.coreChallenges || null,
      counterIntuitive: data.currentAnalysis?.counterIntuitive || null,
      schemaVersion: CACHE_SCHEMA_VERSION,
      timestamp: Date.now(),
    };
    const historyResult = await chrome.storage.local.get(HISTORY_STORAGE_KEY);
    const previousHistory = normalizeHistory(historyResult[HISTORY_STORAGE_KEY]);
    const existingEntry = previousHistory.find((entry) => entry.videoId === videoId);
    const nextHistory = [
      {
        videoId,
        title: cached.videoTitle || existingEntry?.title || '未命名单集',
        channel: cached.channelName || existingEntry?.channel || '',
        image: cached.coverImage || existingEntry?.image || '',
        timestamp: cached.timestamp || Date.now(),
      },
      ...previousHistory.filter((entry) => entry.videoId !== videoId),
    ].slice(0, HISTORY_LIMIT);

    await chrome.storage.local.set({
      [digestCacheKey(videoId)]: cached,
      [HISTORY_STORAGE_KEY]: nextHistory,
    });
    setHistory(nextHistory);
  }, [normalizeHistory]);

  const restoreCachedDigest = useCallback((
    videoId: string,
    cached?: CachedDigest,
    videoUrl?: string,
    tabId?: number | null,
    pageInfo?: Partial<EpisodeInfo>,
    options?: { keepActiveTab?: boolean }
  ) => {
    if (!hasCachedTranscript(cached)) return false;
    if (!isCompatibleCachedDigest(cached)) {
      // v2 早期缓存可能缺少完整的说话人分离/命名结果；不再恢复，以免错误持续展示。
      void chrome.storage.local.remove(digestCacheKey(videoId)).catch(() => {});
      return false;
    }

    const transcript = Array.isArray(cached?.transcript) ? cached.transcript : [];
    const turns = Array.isArray(cached?.turns) && cached.turns.length ? cached.turns : transcript;
    const restoredTranscript = transcript.length ? transcript : turns;
    const restoredTimestamped =
      cached?.transcriptTimestamped ||
      cached?.transcriptTextTimestamped ||
      buildTimestampedTranscript(turns.length ? turns : restoredTranscript);
    const restoredText =
      String(cached?.transcriptText || '').trim() ||
      restoredTranscript.map((entry) => entry.text || entry.rawText || '').filter(Boolean).join('\n');

    updateStateData({
      currentVideoId: videoId,
      currentVideoUrl: videoUrl || episodeUrl(videoId),
      xiaoyuzhouTabId: typeof tabId === 'number' ? tabId : stateDataRef.current.xiaoyuzhouTabId,
      currentAnalysis: {
        chapters: Array.isArray(cached?.chapters) ? cached.chapters : null,
        coreChallenges: Array.isArray(cached?.coreChallenges) ? cached.coreChallenges : null,
        counterIntuitive: Array.isArray(cached?.counterIntuitive) ? cached.counterIntuitive : null,
      },
      currentTranscript: restoredTranscript,
      currentTurns: turns,
      currentTranscriptText: restoredText,
      currentTranscriptTimestamped: restoredTimestamped,
      currentTranscriptLanguage: cached?.transcriptLanguage || null,
      currentVideoTitle: pageInfo?.title || cached?.videoTitle || '',
      currentChannelName: pageInfo?.channelName || cached?.channelName || '',
      currentVideoDescription: pageInfo?.description || cached?.videoDescription || '',
      currentVideoDuration: pageInfo?.duration || cached?.videoDuration || 0,
      currentPodcastId: pageInfo?.podcastId || stateDataRef.current.currentPodcastId || '',
      currentVideoImage: pageInfo?.image || cached?.coverImage || '',
      currentDiarization: cached?.diarization || null,
      currentAsrModel: cached?.asrModel || null,
      transcriptLoadedFromCache: true,
    });
    if (!options?.keepActiveTab) {
      setActiveTab('transcript');
    }
    setChatMessages([]);
    setOverviewErrors({ chapters: null, challenges: null, counter: null });
    showResults();
    return true;
  }, [showResults, updateStateData]);

  /**
   * 已缓存的转写稿会先恢复到界面，不能因为旧缓存缺元信息而让标题一直为空。
   * 在后台完成页面信息读取后再补齐 Header，并把补齐后的信息写回缓存。
   */
  const hydrateCachedEpisodeInfo = useCallback(async (
    videoId: string,
    tabId?: number | null
  ): Promise<void> => {
    const pageInfo = await fetchCurrentEpisodeInfo(tabId);
    if (stateDataRef.current.currentVideoId !== videoId) return;

    const nextState = applyEpisodeInfo(pageInfo);
    if (pageInfo.title || pageInfo.channelName) {
      await saveCachedDigest(videoId, nextState);
    }
  }, [applyEpisodeInfo, fetchCurrentEpisodeInfo, saveCachedDigest]);

  // ============================================================
  // CONFIG CHECK
  // ============================================================

  const checkConfig = useCallback(async (): Promise<boolean> => {
    try {
      const status = await chrome.runtime.sendMessage({ action: ACTIONS.CHECK_CONFIG });
      if (status?.success && status.hasDashscopeKey && status.hasAiKey) {
        updateStateData({ configuredAsrModel: status.asrModel || 'paraformer-v2' });
        return true;
      }

      if (status?.success) {
        const missing = [];
        if (!status.hasDashscopeKey) missing.push('DashScope');
        if (!status.hasAiKey) missing.push('DeepSeek');
        showError(
          '缺少 API Key',
          `请在小宇宙 Digest v2.0 设置中填写 ${missing.join(' 和 ')} API key。`
        );
        return false;
      }

      showError('无法读取设置', '暂时无法验证 API Key，请稍后重试。');
      return false;
    } catch (error) {
      showError(
        '无法读取设置',
        `暂时无法验证 API Key，请稍后重试。${error instanceof Error ? ` ${error.message}` : ''}`
      );
      return false;
    }
  }, [showError]);

  // ============================================================
  // TRANSCRIPTION
  // ============================================================

  const startDigest = useCallback(async (videoId?: string, videoUrl?: string) => {
    let targetVideoId = videoId;
    let targetVideoUrl = videoUrl;

    // If no video ID provided, check current tab
    if (!targetVideoId) {
      try {
        const tab = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab[0]?.url) {
          const urlMatch = tab[0].url.match(/\/episode\/([0-9a-fA-F]{24})/);
          if (urlMatch) {
            targetVideoId = urlMatch[1];
            targetVideoUrl = tab[0].url;
          }
        }
      } catch (e) {
        // Ignore
      }
    }

    if (!targetVideoId) {
      showError('错误', '无法获取当前单集 ID，请确保你在小宇宙单集页面上。');
      return;
    }

    let targetTabId = stateDataRef.current.xiaoyuzhouTabId;
    if (targetTabId === null) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      targetTabId = activeTab?.id ?? null;
    }

    try {
      const stored = await chrome.storage.local.get(digestCacheKey(targetVideoId));
      const cached = stored[digestCacheKey(targetVideoId)] as CachedDigest | undefined;
      if (restoreCachedDigest(targetVideoId, cached, targetVideoUrl, targetTabId)) {
        void hydrateCachedEpisodeInfo(targetVideoId, targetTabId);
        return;
      }
    } catch (error) {
      console.warn('[小宇宙 Digest v2.0] Failed to read cached digest:', error);
    }

    // Create new abort controller for this transcription
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    updateStateData({
      currentVideoId: targetVideoId,
      currentVideoUrl: targetVideoUrl || null,
      xiaoyuzhouTabId: targetTabId,
      currentAnalysis: null,
      transcriptLoadedFromCache: false,
    });
    setChatMessages([]);
    setOverviewErrors({ chapters: null, challenges: null, counter: null });

    showLoading('正在获取音频', '从小宇宙单集页提取音频地址…', 5);

    try {
      // Get the page metadata from the Xiaoyuzhou tab, not from a stale panel render.
      const videoInfo = await fetchCurrentEpisodeInfo(targetTabId);

      applyEpisodeInfo(videoInfo);

      showLoading('正在转写音频', '正在通过语音识别转写音频…', 10);

      // Start transcription
      const result = await chrome.runtime.sendMessage({
        action: ACTIONS.FETCH_TRANSCRIPT,
        videoId: targetVideoId,
      });

      if (!result.success) {
        showError('转写失败', result.message || '未知错误');
        return;
      }

      const completedState: AppStateData = {
        ...stateDataRef.current,
        currentVideoId: targetVideoId,
        currentVideoUrl: targetVideoUrl || null,
        currentAnalysis: null,
        currentTranscript: result.transcript,
        currentTurns: result.turns,
        currentTranscriptText: result.transcriptText,
        currentTranscriptTimestamped: result.transcriptTextTimestamped,
        currentTranscriptLanguage: result.language,
        currentVideoTitle: videoInfo.title || stateDataRef.current.currentVideoTitle || '',
        currentChannelName: videoInfo.channelName || stateDataRef.current.currentChannelName || '',
        currentVideoDescription: videoInfo.description || stateDataRef.current.currentVideoDescription || '',
        currentVideoDuration: videoInfo.duration || stateDataRef.current.currentVideoDuration || 0,
        currentVideoImage: videoInfo.image || stateDataRef.current.currentVideoImage || '',
        currentPodcastId: videoInfo.podcastId || stateDataRef.current.currentPodcastId || '',
        currentAsrModel: result.asrModel,
        currentDiarization: result.diarization,
        transcriptLoadedFromCache: false,
      };
      updateStateData(completedState);
      await saveCachedDigest(targetVideoId, completedState);

      showResults();
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        showWelcome();
        return;
      }
      showError('错误', error instanceof Error ? error.message : '转写过程中发生错误');
    }
  }, [applyEpisodeInfo, fetchCurrentEpisodeInfo, hydrateCachedEpisodeInfo, restoreCachedDigest, saveCachedDigest, showError, showLoading, showResults, showWelcome]);

  const stopTranscription = useCallback(() => {
    abortControllerRef.current?.abort();
    void chrome.runtime.sendMessage({
      action: ACTIONS.CANCEL_TRANSCRIPT,
      videoId: stateDataRef.current.currentVideoId,
    });
    showWelcome();
  }, [showWelcome]);

  const retranscribe = useCallback(async () => {
    const currentState = stateDataRef.current;
    if (!currentState.currentVideoId) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    showLoading('正在重新识别', '按当前设置重新识别音频…', 0);

    try {
      const result = await chrome.runtime.sendMessage({
        action: ACTIONS.FETCH_TRANSCRIPT,
        videoId: currentState.currentVideoId,
        force: true,
      });

      if (!result.success) {
        showError('重新识别失败', result.message || '未知错误');
        return;
      }

      const completedState: AppStateData = {
        ...stateDataRef.current,
        currentAnalysis: null,
        currentTranscript: result.transcript,
        currentTurns: result.turns,
        currentTranscriptText: result.transcriptText,
        currentTranscriptTimestamped: result.transcriptTextTimestamped,
        currentTranscriptLanguage: result.language,
        currentAsrModel: result.asrModel,
        currentDiarization: result.diarization,
        transcriptLoadedFromCache: false,
      };
      updateStateData(completedState);
      setChatMessages([]);
      setOverviewErrors({ chapters: null, challenges: null, counter: null });
      await saveCachedDigest(currentState.currentVideoId, completedState);

      showResults();
    } catch (error) {
      showError('错误', error instanceof Error ? error.message : '重新识别失败');
    }
  }, [saveCachedDigest, showError, showLoading, showResults]);

  // ============================================================
  // ANALYSIS (Overview modules)
  // ============================================================

  const generateOverviewModule = useCallback(
    async (key: 'chapters' | 'challenges' | 'counter') => {
      if (overviewLoading[key]) return;

      const requestState = stateDataRef.current;
      if (!hasTimestampedTranscript(requestState)) {
        setOverviewErrors((previous) => ({
          ...previous,
          [key]: '当前文字稿缺少带时间戳的内容，请重新识别后再试。',
        }));
        return;
      }

      const requestVideoId = requestState.currentVideoId;
      const requestTranscript = requestState.currentTranscriptTimestamped;
      setOverviewLoading((previous) => ({ ...previous, [key]: true }));
      setOverviewErrors((previous) => ({ ...previous, [key]: null }));

      try {
        const result = await chrome.runtime.sendMessage({
          action: ACTIONS.ANALYZE_TRANSCRIPT,
          module: key,
          transcriptText: requestTranscript,
          videoTitle: requestState.currentVideoTitle,
          channelName: requestState.currentChannelName,
          videoDescription: requestState.currentVideoDescription,
          videoDuration: requestState.currentVideoDuration,
        });

        if (!result?.success) {
          setOverviewErrors((previous) => ({
            ...previous,
            [key]: result?.message || result?.error || '分析服务未返回有效结果。',
          }));
          return;
        }

        const currentState = stateDataRef.current;
        if (
          currentState.currentVideoId !== requestVideoId ||
          currentState.currentTranscriptTimestamped !== requestTranscript
        ) {
          return;
        }

        const analysis: AnalysisResult = {
          chapters: currentState.currentAnalysis?.chapters || null,
          coreChallenges: currentState.currentAnalysis?.coreChallenges || null,
          counterIntuitive: currentState.currentAnalysis?.counterIntuitive || null,
        };

        if (key === 'chapters') analysis.chapters = result.items as Chapter[];
        if (key === 'challenges') analysis.coreChallenges = result.items as Challenge[];
        if (key === 'counter') analysis.counterIntuitive = result.items as CounterIntuitiveItem[];

        const completedState = updateStateData({ currentAnalysis: analysis });
        if (completedState.currentVideoId) {
          await saveCachedDigest(completedState.currentVideoId, completedState);
        }
      } catch (error) {
        console.error(`Analysis ${key} error:`, error);
        setOverviewErrors((previous) => ({
          ...previous,
          [key]: error instanceof Error ? error.message : '分析转写稿失败。',
        }));
      } finally {
        setOverviewLoading((previous) => ({ ...previous, [key]: false }));
      }
    },
    [overviewLoading, saveCachedDigest, updateStateData]
  );

  // ============================================================
  // NOTES
  // ============================================================

  const loadNotes = useCallback(
    async (videoId?: string) => {
      try {
        const result = await chrome.runtime.sendMessage({
          action: ACTIONS.GET_NOTES,
          videoId: notesFilterAll ? undefined : videoId || stateData.currentVideoId || undefined,
        });

        if (result.success) {
          setNotes(result.notes || []);
        }
      } catch (error) {
        console.error('Failed to load notes:', error);
      }
    },
    [notesFilterAll, stateData.currentVideoId]
  );

  const cardNoteKey = useCallback((text: string, timestampSeconds: number) => {
    return `${stateDataRef.current.currentVideoId || ''}::${Math.floor(Number(timestampSeconds) || 0)}::${text}`;
  }, []);

  const refreshCardNotes = useCallback(async (videoId?: string | null) => {
    const targetVideoId = videoId ?? stateDataRef.current.currentVideoId;
    if (!targetVideoId) {
      setCardNotes(new Map());
      return;
    }
    try {
      const result = await chrome.runtime.sendMessage({ action: ACTIONS.GET_NOTES, videoId: targetVideoId });
      const next = new Map<string, string>();
      if (result?.success) {
        for (const note of result.notes || []) {
          next.set(`${targetVideoId}::${Math.floor(Number(note.timestampSeconds) || 0)}::${note.text || ''}`, note.id);
        }
      }
      setCardNotes(next);
    } catch (error) {
      console.warn('[小宇宙 Digest v2.0] Failed to refresh card notes:', error);
    }
  }, []);

  const deleteNote = useCallback(
    async (noteId: string) => {
      try {
        const result = await chrome.runtime.sendMessage({
          action: ACTIONS.DELETE_NOTE,
          noteId,
        });
        if (result?.success) {
          await Promise.all([loadNotes(), refreshCardNotes()]);
        }
      } catch (error) {
        console.error('Failed to delete note:', error);
      }
    },
    [loadNotes, refreshCardNotes]
  );

  const toggleCardNote = useCallback(async (text: string, timestampSeconds: number) => {
    const currentState = stateDataRef.current;
    const videoId = currentState.currentVideoId;
    if (!videoId) return;
    const key = cardNoteKey(text, timestampSeconds);
    const savedNoteId = cardNotes.get(key);
    try {
      if (savedNoteId) {
        const result = await chrome.runtime.sendMessage({ action: ACTIONS.DELETE_NOTE, noteId: savedNoteId });
        if (result?.success) {
          await Promise.all([loadNotes(), refreshCardNotes(videoId)]);
        }
        return;
      }
      const result = await chrome.runtime.sendMessage({
        action: ACTIONS.SAVE_CARD_NOTE,
        videoId,
        timestampSeconds,
        videoTitle: currentState.currentVideoTitle,
        channelName: currentState.currentChannelName,
        text,
      });
      if (result?.success) {
        await Promise.all([loadNotes(), refreshCardNotes(videoId)]);
      }
    } catch (error) {
      console.error('Failed to toggle card note:', error);
    }
  }, [cardNoteKey, cardNotes, loadNotes, refreshCardNotes]);

  /** 从笔记里解析出秒数；旧版笔记可能只有 "12:34" 格式的 timestamp 字符串。 */
  const noteSeconds = (note: Note): number => {
    const direct = Number(note.timestampSeconds);
    if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);
    const parts = String(note.timestamp || '').trim().split(':').map((part) => Number(part));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) return parts[0] * 60 + parts[1];
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return NaN;
  };

  const focusXiaoyuzhouTab = useCallback(async (tabId: number) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (typeof tab.windowId === 'number') {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      // 标签页可能已关闭，忽略。
    }
  }, []);

  const seekTo = useCallback(async (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return;

    // —— 跳转诊断：记录每一步，失败时在面板上展示，便于定位断点 ——
    const steps: string[] = [];
    const finish = (ok: boolean) => {
      const report = `[跳转诊断] ${steps.join(' ｜ ')}`;
      if (ok) console.log(`[小宇宙 Digest v2.0] ${report}`);
      else {
        console.warn(`[小宇宙 Digest v2.0] ${report}`);
        setSeekDiagnostics([...steps]);
      }
    };
    steps.push(`尝试跳转到 ${Math.floor(seconds)}s`);

    const payload = { action: ACTIONS.SEEK_TO, seconds: Number(seconds) };
    const tabId = stateDataRef.current.xiaoyuzhouTabId;
    steps.push(`当前记录的小宇宙标签页: ${typeof tabId === 'number' ? `#${tabId}` : '无'}`);

    try {
      if (typeof tabId === 'number') {
        // 原版的稳定路径：直接向记录的目标标签页发送 seekTo。
        const response = await chrome.tabs.sendMessage(tabId, payload);
        steps.push(`直发到页面结果: ${JSON.stringify(response) ?? 'undefined'}`);
        if (response?.success && response.audioFound !== false) {
          // 把小宇宙页面带到前台，用户能立刻看到播放进度。
          await focusXiaoyuzhouTab(tabId);
          finish(true);
          return;
        }
      }
    } catch (error) {
      steps.push(`直发到页面失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    // content script 未注入时，绕过消息通道，直接在目标页面控制 audio。
    // 这是原版「直接 seekTo」语义的页面上下文兜底，不依赖 onMessage 接收器。
    try {
      if (typeof tabId === 'number') {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          args: [Number(seconds)],
          func: (targetSeconds: number) => {
            const audio = document.querySelector('audio') as HTMLAudioElement | null;
            if (!audio) return { success: false, audioFound: false };
            try {
              audio.currentTime = targetSeconds;
              if (audio.paused) audio.play().catch(() => {});
              return {
                success: true,
                audioFound: true,
                readyState: audio.readyState,
                currentTime: audio.currentTime,
              };
            } catch (error) {
              return {
                success: false,
                audioFound: true,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
        });
        const pageSeek = result?.result as
          | { success?: boolean; audioFound?: boolean; currentTime?: number; error?: string }
          | undefined;
        steps.push(`页面直接执行结果: ${JSON.stringify(pageSeek) ?? 'undefined'}`);
        if (pageSeek?.success) {
          await focusXiaoyuzhouTab(tabId);
          finish(true);
          return;
        }
      }
    } catch (error) {
      steps.push(`页面直接执行失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const relayed = await chrome.runtime.sendMessage({
        action: ACTIONS.RELAY_TO_CONTENT,
        payload,
        targetTabId: typeof tabId === 'number' ? tabId : undefined,
      });
      steps.push(`后台转发结果: ${JSON.stringify(relayed) ?? 'undefined'}`);
      if (relayed?.success) {
        if (typeof relayed.tabId === 'number') {
          steps.push(`后台实际发送到标签页: #${relayed.tabId}${relayed.injected ? '（已强制注入）' : ''}`);
          await focusXiaoyuzhouTab(relayed.tabId);
        }
        finish(relayed.response?.audioFound !== false);
        return;
      }
    } catch (error) {
      steps.push(`后台转发失败: ${error instanceof Error ? error.message : String(error)}`);
    }

    // 兜底：小宇宙页面没开或 content script 失联。打开/复用单集页并带上时间戳
    // hash，页面加载（或检测到 hash 变化）后由 content script 自动定位并播放。
    const currentState = stateDataRef.current;
    const baseUrl =
      currentState.currentVideoUrl ||
      (currentState.currentVideoId ? episodeUrl(currentState.currentVideoId) : '');
    if (!baseUrl) {
      steps.push('兜底失败: 未记录单集 URL，无法打开页面');
      finish(false);
      return;
    }

    const url = `${baseUrl}#xyz-note-t=${Math.floor(seconds)}`;
    steps.push(`兜底: 打开单集页并附带时间戳 hash`);
    if (currentState.currentVideoId) {
      noteJumpRef.current = { videoId: currentState.currentVideoId, expiresAt: Date.now() + 15000 };
    }

    void (async () => {
      try {
        const fallbackTabId = stateDataRef.current.xiaoyuzhouTabId;
        if (typeof fallbackTabId === 'number') {
          await chrome.tabs.update(fallbackTabId, { url, active: true });
          await focusXiaoyuzhouTab(fallbackTabId);
          finish(false);
          return;
        }
      } catch {
        steps.push('复用旧标签页失败，改为新建');
      }
      try {
        const created = await chrome.tabs.create({ url, active: true });
        if (created.id != null) {
          updateStateData({ xiaoyuzhouTabId: created.id });
          await focusXiaoyuzhouTab(created.id);
        }
      } catch (error) {
        steps.push(`新建标签页失败: ${error instanceof Error ? error.message : String(error)}`);
        finish(false);
      }
    })();
  }, [focusXiaoyuzhouTab, updateStateData]);

  const playNote = useCallback((note: Note) => {
    const seconds = noteSeconds(note);
    const hasSeconds = Number.isFinite(seconds) && seconds >= 0;

    if (
      hasSeconds &&
      note.videoId &&
      note.videoId === stateDataRef.current.currentVideoId
    ) {
      void seekTo(seconds);
      return;
    }
    if (!note.timestampedUrl) return;

    // 通过 hash 把时间点带给 content script，页面加载后自动 seek 并播放。
    const url = hasSeconds
      ? `${note.timestampedUrl}#xyz-note-t=${Math.floor(seconds)}`
      : note.timestampedUrl;

    // 标记笔记跳转：同步期间保持当前面板视图，不打回欢迎页/文字稿页。
    if (note.videoId) {
      noteJumpRef.current = { videoId: note.videoId, expiresAt: Date.now() + 15000 };
    }

    // 优先复用当前的小宇宙标签页，避免新开一堆页签。
    void (async () => {
      let targetTabId: number | null = null;
      try {
        const tabId = stateDataRef.current.xiaoyuzhouTabId;
        if (typeof tabId === 'number') {
          await chrome.tabs.update(tabId, { url, active: true });
          targetTabId = tabId;
        }
      } catch (error) {
        console.warn('[小宇宙 Digest v2.0] Failed to reuse episode tab for note jump:', error);
      }
      if (targetTabId === null) {
        try {
          const created = await chrome.tabs.create({ url, active: true });
          targetTabId = created.id ?? null;
          if (targetTabId !== null) updateStateData({ xiaoyuzhouTabId: targetTabId });
        } catch (error) {
          console.error('[小宇宙 Digest v2.0] Failed to open episode for note jump:', error);
          noteJumpRef.current = null;
          return;
        }
      }
      if (targetTabId !== null) await focusXiaoyuzhouTab(targetTabId);
    })();
  }, [focusXiaoyuzhouTab, seekTo, updateStateData]);

  const explainSelection = useCallback(async (selectedText: string) => {
    const transcriptText = stateDataRef.current.currentTranscriptText || '';
    const index = transcriptText.indexOf(selectedText);
    const transcriptContext = index === -1
      ? ''
      : transcriptText.slice(Math.max(0, index - 200), Math.min(transcriptText.length, index + selectedText.length + 200));
    try {
      return await chrome.runtime.sendMessage({
        action: ACTIONS.EXPLAIN_SELECTION,
        selectedText,
        transcriptContext,
        videoTitle: stateDataRef.current.currentVideoTitle,
      });
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : '讲解失败，请稍后重试。' };
    }
  }, []);

  // ============================================================
  // CHAT
  // ============================================================

  const sendChatMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || chatLoading) return;

      const currentState = stateDataRef.current;
      if (!hasTimestampedTranscript(currentState)) {
        setChatMessages((previous) => [
          ...previous,
          { role: 'assistant', content: '⚠️ 当前单集还没有可用于问答的带时间戳文字稿，请重新识别后再试。' },
        ]);
        return;
      }

      const userMessage = { role: 'user' as const, content: question.trim() };
      setChatMessages((prev) => [...prev, userMessage]);
      setChatLoading(true);

      try {
        // Use long-lived port for streaming
        const port = chrome.runtime.connect({ name: 'episodeChatStream' });

        port.onMessage.addListener((msg) => {
          if (msg.type === 'chunk') {
            setChatMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];

              if (lastMessage && lastMessage.role === 'assistant' && msg.content) {
                newMessages[newMessages.length - 1] = {
                  ...lastMessage,
                  content: lastMessage.content + msg.content,
                };
              } else if (msg.content) {
                newMessages.push({ role: 'assistant', content: msg.content });
              }

              return newMessages;
            });
          }

          if (msg.type === 'done' || msg.type === 'error') {
            if (msg.type === 'error') {
              setChatMessages((prev) => [
                ...prev,
                { role: 'assistant', content: `⚠️ ${msg.error}` },
              ]);
            }
            setChatLoading(false);
            port.disconnect();
          }
        });

        port.postMessage({
          action: ACTIONS.ASK_EPISODE_QUESTION,
          question: question.trim(),
          transcriptText: currentState.currentTranscriptTimestamped || '',
          videoTitle: currentState.currentVideoTitle,
          channelName: currentState.currentChannelName,
          videoDescription: currentState.currentVideoDescription,
conversation: chatMessages,
chatMode,
});

      } catch (error) {
        console.error('Chat error:', error);
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '⚠️ 问答失败，请稍后重试。' },
        ]);
        setChatLoading(false);
      }
    },
[chatLoading, chatMessages, chatMode]
);

const changeChatMode = useCallback((mode: EpisodeChatMode) => {
setChatMode(mode);
void chrome.storage.local.set({ [STORAGE_KEYS.CHAT_MODE]: mode });
}, []);

const clearChat = useCallback(() => {

  setChatMessages([]);
}, []);

const suggestedQuestionsCacheRef = useRef<Map<string, SuggestedQuestion[]>>(new Map());
const suggestionsAttemptedRef = useRef<Set<string>>(new Set());

const generateSuggestedQuestions = useCallback(
  async (options?: { force?: boolean }) => {
    const currentState = stateDataRef.current;
    const videoId = currentState.currentVideoId;
    if (!videoId || suggestionsLoading) return;
    if (!hasTimestampedTranscript(currentState)) return;

    const cached = suggestedQuestionsCacheRef.current.get(videoId);
    if (!options?.force && cached) {
      setSuggestedQuestions(cached);
      setSuggestionsError(null);
      return;
    }

    // 手动换一批时先清空旧问题，展示加载骨架屏；失败时也能显示错误提示。
    if (options?.force) setSuggestedQuestions([]);

    setSuggestionsLoading(true);
    setSuggestionsError(null);
    try {
      const response = await chrome.runtime.sendMessage({
        action: ACTIONS.GENERATE_SUGGESTED_QUESTIONS,
        transcriptText: currentState.currentTranscriptTimestamped || '',
        videoTitle: currentState.currentVideoTitle,
        channelName: currentState.currentChannelName,
        videoDescription: currentState.currentVideoDescription,
      });

      if (response?.success && Array.isArray(response.questions) && response.questions.length) {
        const questions: SuggestedQuestion[] = response.questions;
        suggestedQuestionsCacheRef.current.set(videoId, questions);
        setSuggestedQuestions(questions);
      } else {
        throw new Error(response?.error || '生成推荐问题失败，请重试。');
      }
    } catch (error) {
      console.error('Suggested questions error:', error);
      setSuggestionsError(error instanceof Error ? error.message : '生成推荐问题失败，请重试。');
    } finally {
      setSuggestionsLoading(false);
    }
  },
  [suggestionsLoading]
);

const regenerateSuggestedQuestions = useCallback(() => {
  void generateSuggestedQuestions({ force: true });
}, [generateSuggestedQuestions]);

  // ============================================================
  // EPISODE / HISTORY SYNCHRONIZATION
  // ============================================================

  const syncEpisodeFromTab = useCallback(async (tab: { id?: number; url?: string; pendingUrl?: string }) => {
    const tabUrl = tab.url || tab.pendingUrl || '';
    const episodeMatch = tabUrl.match(/\/episode\/([0-9a-fA-F]{24})/);
    const requestId = ++episodeSyncRequestRef.current;

    if (!episodeMatch) {
      abortControllerRef.current?.abort();
      setChatMessages([]);
      setOverviewErrors({ chapters: null, challenges: null, counter: null });
      updateStateData({
        ...initialState,
        configuredAsrModel: stateDataRef.current.configuredAsrModel,
      });
      showWelcome();
      return;
    }

    const videoId = episodeMatch[1];
    const videoUrl = tabUrl || episodeUrl(videoId);
    const tabId = typeof tab.id === 'number' ? tab.id : null;
    const previousState = stateDataRef.current;
    if (
      previousState.currentVideoId === videoId &&
      (previousState.currentTranscript?.length || previousState.currentTurns?.length || appState === 'loading')
    ) {
      updateStateData({ currentVideoUrl: videoUrl, xiaoyuzhouTabId: tabId });
      return;
    }

    // 笔记跳转导致的导航：保持当前视图（如笔记列表），只切换绑定的单集数据。
    const noteJump = noteJumpRef.current;
    if (noteJump && noteJump.videoId === videoId && Date.now() <= noteJump.expiresAt) {
      abortControllerRef.current?.abort();
      setChatMessages([]);
      setOverviewErrors({ chapters: null, challenges: null, counter: null });
      updateStateData({
        currentVideoId: videoId,
        currentVideoUrl: videoUrl,
        xiaoyuzhouTabId: tabId,
        currentAnalysis: null,
        currentTranscript: null,
        currentTurns: null,
        currentTranscriptText: null,
        currentTranscriptTimestamped: null,
        currentTranscriptLanguage: null,
        currentVideoTitle: '',
        currentChannelName: '',
        currentVideoDescription: '',
        currentVideoDuration: 0,
        currentVideoImage: '',
        currentDiarization: null,
        currentAsrModel: null,
        currentPodcastId: '',
        transcriptLoadedFromCache: false,
      });

      try {
        const stored = await chrome.storage.local.get(digestCacheKey(videoId));
        if (requestId !== episodeSyncRequestRef.current) return;
        const cached = stored[digestCacheKey(videoId)] as CachedDigest | undefined;
        if (restoreCachedDigest(videoId, cached, videoUrl, tabId, undefined, { keepActiveTab: true })) {
          void hydrateCachedEpisodeInfo(videoId, tabId);
          return;
        }
      } catch (error) {
        console.warn('[小宇宙 Digest v2.0] Failed to restore cached episode during note jump:', error);
      }

      // 没有缓存也不打回欢迎页：停留在当前标签（笔记列表仍然可用）。
      if (requestId === episodeSyncRequestRef.current) showResults();
      return;
    }

    abortControllerRef.current?.abort();
    setChatMessages([]);
    setOverviewErrors({ chapters: null, challenges: null, counter: null });
    updateStateData({
      currentVideoId: videoId,
      currentVideoUrl: videoUrl,
      xiaoyuzhouTabId: tabId,
      currentAnalysis: null,
      currentTranscript: null,
      currentTurns: null,
      currentTranscriptText: null,
      currentTranscriptTimestamped: null,
      currentTranscriptLanguage: null,
      currentVideoTitle: '',
      currentChannelName: '',
      currentVideoDescription: '',
      currentVideoDuration: 0,
      currentVideoImage: '',
      currentDiarization: null,
      currentAsrModel: null,
      currentPodcastId: '',
      transcriptLoadedFromCache: false,
    });

    try {
      const stored = await chrome.storage.local.get(digestCacheKey(videoId));
      if (requestId !== episodeSyncRequestRef.current) return;
      const cached = stored[digestCacheKey(videoId)] as CachedDigest | undefined;
      if (restoreCachedDigest(videoId, cached, videoUrl, tabId)) {
        void hydrateCachedEpisodeInfo(videoId, tabId);
        return;
      }
    } catch (error) {
      console.warn('[小宇宙 Digest v2.0] Failed to restore cached episode:', error);
    }

    if (requestId === episodeSyncRequestRef.current) {
      const pageInfo = await fetchCurrentEpisodeInfo(tabId);
      if (requestId !== episodeSyncRequestRef.current) return;
      const nextState = applyEpisodeInfo(pageInfo);
      if (pageInfo.title || pageInfo.channelName) {
        await saveHistoryEntry(videoId, nextState);
      }
      showWelcome();
    }
  }, [appState, applyEpisodeInfo, fetchCurrentEpisodeInfo, hydrateCachedEpisodeInfo, restoreCachedDigest, saveHistoryEntry, showResults, showWelcome, updateStateData]);

  const exportHistory = useCallback(async () => {
    try {
      const allData = await chrome.storage.local.get(null);
      const entries = normalizeHistory(allData[HISTORY_STORAGE_KEY]);
      if (!entries.length) return;

      const lines = [
        '# 小宇宙 Digest 历史导出',
        '',
        `导出时间: ${new Date().toLocaleString()}`,
        `共 ${entries.length} 集`,
        '',
        '='.repeat(60),
        '',
      ];

      entries.forEach((entry, index) => {
        lines.push(`## ${index + 1}. ${entry.title || '未命名单集'}`, '');
        if (entry.channel) lines.push(`- 播客: ${entry.channel}`);
        lines.push(`- 链接: ${episodeUrl(entry.videoId)}`);
        if (entry.timestamp) lines.push(`- 保存时间: ${new Date(entry.timestamp).toLocaleString()}`);
        lines.push('');

        const cached = allData[digestCacheKey(entry.videoId)] as CachedDigest | undefined;
        const transcriptText = cached?.transcriptTimestamped || cached?.transcriptText || '';
        if (transcriptText) lines.push('### 文字稿', '', transcriptText, '');

        if (cached?.chapters?.length || cached?.coreChallenges?.length || cached?.counterIntuitive?.length) {
          lines.push('### 概览', '');
        }
        if (cached?.chapters?.length) {
          lines.push('#### 章节', '');
          cached.chapters.forEach((chapter) => lines.push(`- [${chapter.timestamp}] ${chapter.title}${chapter.summary ? `：${chapter.summary}` : ''}`));
          lines.push('');
        }
        if (cached?.coreChallenges?.length) {
          lines.push('#### 核心挑战', '');
          cached.coreChallenges.forEach((challenge) => lines.push(`- 挑战${challenge.topic ? `（${challenge.topic}）` : ''}: ${challenge.challenge}${challenge.solution ? `\n  - 解决: ${challenge.solution}` : ''}`));
          lines.push('');
        }
        if (cached?.counterIntuitive?.length) {
          lines.push('#### 反常识', '');
          cached.counterIntuitive.forEach((item) => lines.push(`- ${item.claim}${item.explanation ? `\n  ${item.explanation}` : ''}`));
          lines.push('');
        }
        lines.push('-'.repeat(60), '');
      });

      const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `xiaoyuzhou-history-${new Date().toISOString().slice(0, 10)}.md`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[小宇宙 Digest v2.0] Failed to export history:', error);
    }
  }, [normalizeHistory]);

  const openEpisode = useCallback(async (episodeId: string) => {
    if (!/^[0-9a-fA-F]{24}$/.test(episodeId)) return;
    const url = episodeUrl(episodeId);
    try {
      const tabId = stateDataRef.current.xiaoyuzhouTabId;
      if (typeof tabId === 'number') {
        await chrome.tabs.update(tabId, { url, active: true });
        return;
      }
      await chrome.tabs.create({ url, active: true });
    } catch (error) {
      console.warn('[小宇宙 Digest v2.0] Failed to open episode in existing tab:', error);
      await chrome.tabs.create({ url, active: true });
    }
  }, []);

  const openHistoryEpisode = useCallback(async (videoId: string) => {
    if (!videoId) return;
    const targetUrl = episodeUrl(videoId);
    let targetTabId = stateDataRef.current.xiaoyuzhouTabId;

    try {
      const stored = await chrome.storage.local.get(digestCacheKey(videoId));
      const activeTabId = typeof targetTabId === 'number' ? targetTabId : undefined;
      const restored = restoreCachedDigest(
        videoId,
        stored[digestCacheKey(videoId)] as CachedDigest | undefined,
        targetUrl,
        activeTabId
      );
      if (!restored) {
        showError('无法恢复历史单集', '该历史记录的本地文字稿已不存在。');
        return;
      }

      try {
        if (typeof targetTabId === 'number') {
          await chrome.tabs.update(targetTabId, { url: targetUrl, active: true });
          return;
        }
      } catch (error) {
        console.warn('[小宇宙 Digest v2.0] Failed to reuse the previous episode tab:', error);
      }

      const createdTab = await chrome.tabs.create({ url: targetUrl, active: true });
      targetTabId = createdTab.id ?? null;
      updateStateData({ xiaoyuzhouTabId: targetTabId });
    } catch (error) {
      showError('无法打开历史单集', error instanceof Error ? error.message : '读取本地缓存或打开单集页面失败。');
    } finally {
      setHistoryOpen(false);
    }
  }, [restoreCachedDigest, showError, updateStateData]);

  // ============================================================
  // INITIALIZATION AND TAB TRACKING
  // ============================================================

useEffect(() => {
void loadHistory();
void chrome.storage.local.get(STORAGE_KEYS.CHAT_MODE).then((stored) => {
const storedMode = stored[STORAGE_KEYS.CHAT_MODE];
if (storedMode === 'strict' || storedMode === 'open') setChatMode(storedMode);
});

const syncActiveTab = async () => {

      try {
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab) await syncEpisodeFromTab(activeTab);
      } catch (error) {
        console.warn('[小宇宙 Digest v2.0] Failed to inspect the active tab:', error);
      }
    };

    void syncActiveTab();

    const handleTabUpdated = (tabId: number, changeInfo: { status?: string; url?: string }, tab: { active?: boolean; id?: number; url?: string; pendingUrl?: string }) => {
      if (!tab.active || (!changeInfo.url && changeInfo.status !== 'complete')) return;
      void syncEpisodeFromTab({ id: tabId, url: tab.url || changeInfo.url, pendingUrl: tab.pendingUrl });
    };
    const handleTabActivated = async ({ tabId }: { tabId: number }) => {
      try {
        const tab = await chrome.tabs.get(tabId);
        await syncEpisodeFromTab(tab);
      } catch (error) {
        console.warn('[小宇宙 Digest v2.0] Failed to inspect the activated tab:', error);
      }
    };

    chrome.tabs.onUpdated.addListener(handleTabUpdated);
    chrome.tabs.onActivated.addListener(handleTabActivated);
    return () => {
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
      chrome.tabs.onActivated.removeListener(handleTabActivated);
    };
  }, [loadHistory, syncEpisodeFromTab]);

  // Listen for messages from background
  useEffect(() => {
    const handleMessage = (
      message: { action: string; [key: string]: unknown },
      _sender: any,
      sendResponse: (response?: object) => void
    ) => {
      switch (message.action) {
        case ACTIONS.TRANSCRIPT_PROGRESS:
          setLoadingInfo({
            title: message.title as string,
            subtitle: message.subtitle as string,
            progress: message.progress as number,
          });
          break;

        case ACTIONS.NOTE_SAVED:
          void loadNotes();
          void refreshCardNotes();
          break;

        case 'startDigestFromButton':
          startDigest();
          break;
      }

      sendResponse({ success: true });
      return false;
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [loadNotes, refreshCardNotes, startDigest]);

  // Load notes when showing results
  useEffect(() => {
    if (appState === 'results') {
      void loadNotes();
      void refreshCardNotes();
    }
  }, [appState, activeTab, loadNotes, refreshCardNotes]);

  // 切换单集时清空上一集的推荐问题，让新单集重新触发生成。
  useEffect(() => {
    setSuggestedQuestions([]);
    setSuggestionsError(null);
  }, [stateData.currentVideoId]);

  // Generate AI-suggested questions ("你可能想问") when the chat tab is opened.
  useEffect(() => {
    if (activeTab !== 'chat' || appState !== 'results') return;

    const videoId = stateData.currentVideoId;
    if (!videoId) return;

    if (!hasTimestampedTranscript(stateData)) {
      setSuggestedQuestions([]);
      setSuggestionsError(null);
      return;
    }

    // 正在生成、已有结果或已显示错误时不自动触发，避免覆盖用户正在进行的刷新。
    if (suggestionsLoading || suggestedQuestions.length > 0 || suggestionsError) return;

    // 只为每个单集自动尝试一次，失败后由用户手动重试，避免死循环。
    if (!suggestionsAttemptedRef.current.has(videoId)) {
      suggestionsAttemptedRef.current.add(videoId);
      void generateSuggestedQuestions();
    }
  }, [
    activeTab,
    appState,
    stateData,
    suggestionsLoading,
    suggestedQuestions.length,
    suggestionsError,
    generateSuggestedQuestions,
  ]);

  // Auto-generate overview only when its timestamped transcript is available.
  useEffect(() => {
    if (activeTab !== 'overview' || appState !== 'results') return;

    if (!hasTimestampedTranscript(stateData)) {
      setOverviewErrors((previous) => {
        if (previous.challenges && previous.counter) return previous;
        return {
          ...previous,
          chapters: previous.chapters || '当前文字稿缺少带时间戳的内容，请重新识别后再试。',
          challenges: previous.challenges || '当前文字稿缺少带时间戳的内容，请重新识别后再试。',
          counter: previous.counter || '当前文字稿缺少带时间戳的内容，请重新识别后再试。',
        };
      });
      return;
    }

    if (
      !stateData.currentAnalysis?.coreChallenges &&
      !overviewLoading.challenges &&
      !overviewErrors.challenges
    ) {
      void generateOverviewModule('challenges');
    }
    if (
      !stateData.currentAnalysis?.counterIntuitive &&
      !overviewLoading.counter &&
      !overviewErrors.counter
    ) {
      void generateOverviewModule('counter');
    }
  }, [
    activeTab,
    appState,
    stateData,
    overviewLoading.challenges,
    overviewLoading.counter,
    overviewErrors.challenges,
    overviewErrors.counter,
    generateOverviewModule,
  ]);

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="sidepanel">
      <Header
        videoTitle={stateData.currentVideoTitle}
        channelName={stateData.currentChannelName}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabsVisible={appState === 'results'}
        onOpenSettings={() => chrome.runtime.sendMessage({ action: ACTIONS.OPEN_OPTIONS })}
        history={history}
        currentVideoId={stateData.currentVideoId}
        historyOpen={historyOpen}
        onToggleHistory={() => {
          if (!historyOpen) void loadHistory();
          setHistoryOpen((open) => !open);
        }}
        onCloseHistory={() => setHistoryOpen(false)}
        onOpenHistoryEpisode={(videoId) => void openHistoryEpisode(videoId)}
        onExportHistory={() => void exportHistory()}
        currentPodcastId={stateData.currentPodcastId}
        onFetchPodcastEpisodes={async (episodeId, podcastId) =>
          chrome.runtime.sendMessage({
            action: ACTIONS.FETCH_PODCAST_EPISODES,
            episodeId,
            podcastId,
          })
        }
        onOpenEpisode={(episodeId) => void openEpisode(episodeId)}
        onOpenPodcast={(podcastId) => {
          if (podcastId) void chrome.tabs.create({ url: `https://www.xiaoyuzhoufm.com/podcast/${podcastId}` });
        }}
      />

      <div className={`content${activeTab === 'chat' && appState === 'results' ? ' chat-active' : ''}${appState === 'welcome' ? ' content--welcome' : ''}`}>
        {appState === 'welcome' && (
          <WelcomeState
            onStart={() => startDigest()}
            startAvailable={!!stateData.currentVideoId}
          />
        )}

        {appState === 'loading' && (
          <LoadingState
            title={loadingInfo.title}
            subtitle={loadingInfo.subtitle}
            progress={loadingInfo.progress}
            onStop={stopTranscription}
          />
        )}

        {appState === 'error' && errorInfo && (
          <ErrorState
            title={errorInfo.title}
            message={errorInfo.message}
            onRetry={() => startDigest(stateData.currentVideoId!, stateData.currentVideoUrl!)}
          />
        )}

        {appState === 'results' && (
          <>
            {activeTab === 'transcript' && (
              <TranscriptPanel
                transcript={stateData.currentTranscript}
                turns={stateData.currentTurns}
                chapters={stateData.currentAnalysis?.chapters || null}
                chaptersLoading={overviewLoading.chapters}
                chaptersError={overviewErrors.chapters}
                asrModel={stateData.currentAsrModel}
                diarization={stateData.currentDiarization}
                loadedFromCache={stateData.transcriptLoadedFromCache}
                onGenerateChapters={() => void generateOverviewModule('chapters')}
                onCopy={() => {
                  if (stateData.currentTranscriptText) void navigator.clipboard.writeText(stateData.currentTranscriptText);
                }}
                onExport={() => {
                  if (!stateData.currentTranscriptTimestamped) return;
                  const blob = new Blob([stateData.currentTranscriptTimestamped], { type: 'text/plain;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${stateData.currentVideoTitle || 'xiaoyuzhou-transcript'}.txt`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
                onRetranscribe={retranscribe}
                onSeek={(seconds) => void seekTo(seconds)}
                onExplain={explainSelection}
              />
            )}

            {activeTab === 'overview' && (
              <OverviewPanel
                chapters={stateData.currentAnalysis?.chapters || null}
                challenges={stateData.currentAnalysis?.coreChallenges || null}
                counterIntuitive={stateData.currentAnalysis?.counterIntuitive || null}
                onReanalyze={(key) => void generateOverviewModule(key)}
                onSeek={(seconds) => void seekTo(seconds)}
                onToggleCardNote={(text, timestampSeconds) => void toggleCardNote(text, timestampSeconds)}
                isCardNoteSaved={(text, timestampSeconds) => cardNotes.has(cardNoteKey(text, timestampSeconds))}
                loading={overviewLoading}
                errors={overviewErrors}
              />
            )}

            {activeTab === 'chat' && (
              <ChatPanel
                messages={chatMessages}
                loading={chatLoading}
                hasTranscript={hasTimestampedTranscript(stateData)}
                unavailableReason={
                  hasTimestampedTranscript(stateData)
                    ? null
                    : '当前单集还没有可用于问答的带时间戳文字稿，请重新识别后再试。'
                }
                suggestedQuestions={suggestedQuestions}
                suggestionsLoading={suggestionsLoading}
                suggestionsError={suggestionsError}
                onRegenerateSuggestions={regenerateSuggestedQuestions}
onSend={sendChatMessage}
chatMode={chatMode}
onChatModeChange={changeChatMode}
onClear={clearChat}

                onSeek={seekTo}
              />
            )}

            {activeTab === 'notes' && (
              <NotesPanel
                notes={notes}
                filterAll={notesFilterAll}
                onFilterChange={setNotesFilterAll}
                onDelete={deleteNote}
                onPlay={playNote}
                videoId={stateData.currentVideoId}
              />
            )}
          </>
        )}
      </div>

      {seekDiagnostics && (
        <div className="seek-diagnostics" role="alert">
          <div className="seek-diagnostics-head">
            <span>⏱ 时间戳跳转诊断</span>
            <div className="seek-diagnostics-actions">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(seekDiagnostics.map((step, i) => `${i + 1}. ${step}`).join('\n'))
                    .catch(() => {});
                }}
              >
                复制
              </button>
              <button type="button" onClick={() => setSeekDiagnostics(null)}>关闭</button>
            </div>
          </div>
          <ol className="seek-diagnostics-steps">
            {seekDiagnostics.map((step, index) => (
              <li key={`${index}-${step}`}>{step}</li>
            ))}
          </ol>
          <p className="seek-diagnostics-hint">跳转未完成。请点「复制」并把诊断信息发给开发者。</p>
        </div>
      )}
    </div>
  );
};

export default App;
