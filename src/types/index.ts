// ============================================================
// Core Type Definitions for Xiaoyuzhou Digest
// ============================================================

// --- Domain Types ---

export interface EpisodeInfo {
  title: string;
  channelName: string;
  podcastId: string;
  description: string;
  duration: number;
  image: string;
}

export interface TranscriptSentence {
  rawText: string;
  speaker: number | null;
  start: number; // seconds
  duration: number; // seconds
  text?: string; // with speaker prefix
}

export interface TranscriptTurn extends TranscriptSentence {}

export interface ParsedTranscript {
  transcript: TranscriptSentence[];
  turns: TranscriptTurn[];
  transcriptText: string;
  transcriptTextTimestamped: string;
  language: string;
}

export interface Chapter {
  title: string;
  summary?: string;
  timestampSeconds: number;
  timestamp: string;
}

export interface Challenge {
  topic?: string;
  challenge: string;
  solution?: string;
  timestampSeconds: number;
  timestamp: string;
}

export interface CounterIntuitiveItem {
  claim: string;
  explanation?: string;
  timestampSeconds: number;
  timestamp: string;
}

export interface AnalysisResult {
  chapters: Chapter[] | null;
  coreChallenges: Challenge[] | null;
  counterIntuitive: CounterIntuitiveItem[] | null;
}

export interface HistoryEntry {
  videoId: string;
  title: string;
  channel: string;
  image: string;
  timestamp: number;
}

export interface Note {
  id: string;
  videoId: string;
  videoTitle: string;
  channelName: string;
  timestamp: string;
  timestampSeconds: number;
  timestampedUrl: string;
  text: string;
  rawText?: string;
  createdAt: number;
}

export interface PodcastEpisode {
  eid: string;
  title: string;
  image: string;
  duration: number;
  pubDate: string;
}

export interface PodcastInfo {
  success: boolean;
  pid: string;
  title: string;
  author: string;
  episodeCount: number;
  coverImage: string;
  rssUrl: string;
  episodes: PodcastEpisode[];
}

export interface DiarizationConfig {
  enabled: boolean;
  speakerCount: number;
  source: 'off' | 'manual' | 'auto' | 'auto-signal' | 'fallback';
  /** 正文开始时间；此前的片头会保留文字但不会参与说话人识别。 */
  introEndSeconds?: number;
  /** 说话人姓名识别状态：identified=已识别；empty=AI 未找到证据充分的映射；failed=调用或解析失败。 */
  speakerIdentityStatus?: 'identified' | 'empty' | 'failed';
  /** 说话人姓名识别失败原因（仅 failed 时有值）。 */
  speakerIdentityError?: string;
}

export interface TranscriptionResult {
  success: true;
  transcript: TranscriptSentence[];
  turns: TranscriptTurn[];
  transcriptText: string;
  transcriptTextTimestamped: string;
  language: string;
  asrModel: string;
  diarization: DiarizationConfig;
  speakers: Record<number, string> | null;
}

export interface TranscriptionError {
  success: false;
  error: string;
  message: string;
}

// --- Settings Types ---

export type AsrModel = 'paraformer-v2' | 'fun-asr';
export type DiarizationMode = 'auto' | 'on' | 'off';

export interface Settings {
  provider: string;
  aiApiKey: string;
  aiBaseUrl: string;
  aiModel: string;
  dashscopeApiKey: string;
  asrModel: AsrModel;
  diarizationMode: DiarizationMode;
  speakerCount: number;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  provider: 'deepseek',
  aiApiKey: '',
  aiBaseUrl: 'https://api.deepseek.com',
  aiModel: 'deepseek-v4-flash',
  dashscopeApiKey: '',
  asrModel: 'paraformer-v2',
  diarizationMode: 'auto',
  speakerCount: 2,
};

// --- Message Types ---

export const ACTIONS = Object.freeze({
  FETCH_TRANSCRIPT: 'fetchTranscript',
  CANCEL_TRANSCRIPT: 'cancelTranscript',
  ANALYZE_TRANSCRIPT: 'analyzeTranscript',
  EXPLAIN_SELECTION: 'explainSelection',
  ASK_EPISODE_QUESTION: 'askEpisodeQuestion',
  GENERATE_SUGGESTED_QUESTIONS: 'generateSuggestedQuestions',
  SAVE_NOTE: 'saveNote',
  SAVE_CARD_NOTE: 'saveCardNote',
  GET_NOTES: 'getNotes',
  DELETE_NOTE: 'deleteNote',
  GET_EPISODE_INFO: 'getVideoInfo',
  CHECK_CONFIG: 'checkConfig',
  OPEN_OPTIONS: 'openOptions',
  FETCH_PODCAST_EPISODES: 'fetchPodcastEpisodes',
  OPEN_SIDE_PANEL: 'openSidePanel',
  RELAY_TO_CONTENT: 'relayToContent',
  TRANSCRIPT_PROGRESS: 'transcriptProgress',
  NOTE_SAVED: 'noteSaved',
  GET_CURRENT_TIME: 'getCurrentTime',
  SEEK_TO: 'seekTo',
} as const);

export type ActionName = (typeof ACTIONS)[keyof typeof ACTIONS];

/** AI 根据单集转录稿生成的推荐问题（问答页「你可能想问」）。 */
export interface SuggestedQuestion {
  question: string;
  reason: string;
}

export const PORTS = Object.freeze({
  EPISODE_CHAT_STREAM: 'episodeChatStream',
} as const);

export const STORAGE_KEYS = Object.freeze({
  NOTES: 'xyz_notes',
  HISTORY: 'xyz_history',
  PODCASTS: 'xyz_podcasts',
} as const);

export interface TranscriptProgressMessage {
  action: 'transcriptProgress';
  episodeId: string;
  title: string;
  subtitle: string;
  progress: number;
}

// --- App State Types ---

export type AppState = 
  | 'welcome'
  | 'loading'
  | 'error'
  | 'results';

export type TabName = 'transcript' | 'overview' | 'chat' | 'notes';

export interface AppStateData {
  currentVideoId: string | null;
  currentVideoUrl: string | null;
  currentAnalysis: AnalysisResult | null;
  currentTranscript: TranscriptSentence[] | null;
  currentTurns: TranscriptTurn[] | null;
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
