/**
 * Transcript Panel Component
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Chapter, DiarizationConfig, TranscriptSentence } from '../../types';

const SPEAKER_COLORS = ['#d9701f', '#2f6fed', '#1f9d55', '#8b5cf6', '#db2777', '#0d9488'];

interface TranscriptPanelProps {
  transcript: TranscriptSentence[] | null;
  turns: TranscriptSentence[] | null;
  chapters: Chapter[] | null;
  chaptersLoading: boolean;
  chaptersError: string | null;
  asrModel: string | null;
  diarization: DiarizationConfig | null;
  loadedFromCache: boolean;
  onGenerateChapters: () => void;
  onCopy: () => void;
  onExport: () => void;
  onRetranscribe: () => void;
  onSeek: (seconds: number) => void;
  onExplain: (selectedText: string) => Promise<{ success: boolean; explanation?: string; error?: string }>;
}

interface TranscriptRow extends TranscriptSentence {
  speakerName: string;
}

function speakerNameFromEntry(entry: TranscriptSentence): string {
  const raw = String(entry.rawText || '').trim();
  const text = String(entry.text || '').trim();
  if (!raw || !text.endsWith(raw)) return '';
  return text.slice(0, text.length - raw.length).replace(/[:：]\s*$/, '').trim();
}

function speakerColor(speaker: number | null): string {
  if (speaker === null || speaker === undefined) return '#6b7280';
  return SPEAKER_COLORS[Math.abs(speaker) % SPEAKER_COLORS.length];
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

function assetUrl(path: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(path, document.baseURI).toString();
}

export const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  transcript,
  turns,
  chapters,
  chaptersLoading,
  chaptersError,
  asrModel,
  diarization,
  loadedFromCache,
  onGenerateChapters,
  onCopy,
  onExport,
  onRetranscribe,
  onSeek,
  onExplain,
}) => {
  const [showChapters, setShowChapters] = useState(false);
  const [activeStart, setActiveStart] = useState<number | null>(null);
  const [followingPlayback, setFollowingPlayback] = useState(true);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null);
  const [explanation, setExplanation] = useState<{ selectedText: string; content: string; loading: boolean; error: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const followingPlaybackRef = useRef(true);
  const lastAutoScrollRef = useRef(0);

  const rows = useMemo<TranscriptRow[]>(() => {
    const source = turns?.length ? turns : transcript || [];
    return source.map((entry) => ({ ...entry, speakerName: speakerNameFromEntry(entry) }));
  }, [transcript, turns]);

  const toggleChapters = () => {
    const nextShowChapters = !showChapters;
    setShowChapters(nextShowChapters);
    if (nextShowChapters && !chapters?.length && !chaptersLoading) onGenerateChapters();
  };

  const setPlaybackFollowing = (enabled: boolean) => {
    followingPlaybackRef.current = enabled;
    setFollowingPlayback(enabled);
  };

  useEffect(() => {
    if (!rows.length || showChapters) {
      setActiveStart(null);
      return;
    }

    let cancelled = false;
    const updateActiveEntry = async () => {
      try {
        const result = await chrome.runtime.sendMessage({
          action: 'relayToContent',
          payload: { action: 'getCurrentTime' },
        });
        if (cancelled || !result?.success || !result.response) return;
        const currentTime = Number(result.response.currentTime) || 0;
        let nextActive: TranscriptRow | null = null;
        for (const row of rows) {
          if (currentTime >= row.start) nextActive = row;
          else break;
        }
        setActiveStart(nextActive?.start ?? null);
      } catch {
        // 小宇宙页面切换或 content script 尚未就绪时，下一次轮询会重试。
      }
    };

    void updateActiveEntry();
    const timer = window.setInterval(() => void updateActiveEntry(), 300);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [rows, showChapters]);

  useEffect(() => {
    if (activeStart === null || !followingPlaybackRef.current) return;
    const activeElement = listRef.current?.querySelector<HTMLElement>(
      `.transcript-entry[data-seconds="${activeStart}"]`
    );
    if (!activeElement) return;
    lastAutoScrollRef.current = Date.now();
    activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [activeStart]);

  useEffect(() => {
    const contentArea = listRef.current?.closest<HTMLElement>('.content');
    if (!contentArea) return;
    const onScroll = () => {
      setShowBackToTop(!showChapters && contentArea.scrollTop > 200);
      if (Date.now() - lastAutoScrollRef.current > 900 && followingPlaybackRef.current) {
        setPlaybackFollowing(false);
      }
    };
    contentArea.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => contentArea.removeEventListener('scroll', onScroll);
  }, [showChapters]);

  const handleTranscriptMouseUp = useCallback(() => {
    const nativeSelection = window.getSelection();
    const selectedText = nativeSelection?.toString().trim() || '';
    const anchorNode = nativeSelection?.anchorNode;
    if (!selectedText || !anchorNode || !listRef.current?.contains(anchorNode) || !nativeSelection?.rangeCount) {
      setSelection(null);
      return;
    }
    const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return;
    setSelection({
      text: selectedText.slice(0, 2000),
      top: Math.min(window.innerHeight - 46, rect.bottom + 8),
      left: Math.min(window.innerWidth - 72, Math.max(72, rect.left + rect.width / 2)),
    });
  }, []);

  const requestExplanation = async () => {
    if (!selection?.text) return;
    const selectedText = selection.text;
    setSelection(null);
    setExplanation({ selectedText, content: '', loading: true, error: '' });
    const result = await onExplain(selectedText);
    setExplanation({
      selectedText,
      content: result.explanation || '',
      loading: false,
      error: result.success ? '' : result.error || '获取讲解失败，请稍后重试。',
    });
  };

  const seekIfNotSelecting = (event: React.MouseEvent, seconds: number) => {
    const nativeSelection = window.getSelection();
    if (nativeSelection?.rangeCount && !nativeSelection.isCollapsed && nativeSelection.toString().trim()) return;
    onSeek(seconds);
  };

  const sourceBadge = [
    `${asrModel || '语音识别'} 语音转写`,
    diarization?.enabled ? '已分离说话人' : '未做说话人分离',
    diarization?.introEndSeconds ? `片头至 ${formatTimestamp(diarization.introEndSeconds)} 不参与识别` : '',
    loadedFromCache ? '已缓存' : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="tab-panel active" data-panel="transcript">
      <div className="section">
        <div className="section-header transcript-section-header">
          <div className="transcript-header-main">
            <div className="section-title-wrap">
              <div className="section-title">{showChapters ? '章节预览' : '逐字稿'}</div>
              {!showChapters && <div className="transcript-source-badge"><span className="source-dot" />{sourceBadge}</div>}
              <button
                className="chapters-toggle-btn"
                onClick={toggleChapters}
                type="button"
                aria-pressed={showChapters}
                title={showChapters ? '切换到文字稿' : '切换到章节预览'}
              >
                <span className="chapters-toggle-icon" aria-hidden="true">⇄</span>
              </button>
            </div>
          </div>
          <div className="transcript-actions">
            <button className="enhance-btn" onClick={onCopy} type="button" disabled={!rows.length}>复制</button>
            <button className="enhance-btn" onClick={onExport} type="button" disabled={!rows.length}>导出</button>
            <button
              className="enhance-btn"
              onClick={() => {
                if (window.confirm('将按当前设置重新识别本集音频。新文字稿成功前会保留现有内容，是否继续？')) onRetranscribe();
              }}
              title="按当前设置重新识别；完成前会保留现有文字稿"
              type="button"
            >
              重新识别
            </button>
          </div>
        </div>

        {loadedFromCache && !diarization?.enabled && !showChapters && (
          <div className="transcript-diarization-hint">
            此稿为旧缓存，未做说话人分离。若本集实际为主持人和嘉宾对谈，可点击右上角「重新识别」按当前设置重新转写。
          </div>
        )}
        {!showChapters && (diarization?.introEndSeconds || 0) > 0 && (
          <div className="transcript-diarization-hint">
            已保留片头文字，但 {formatTimestamp(diarization!.introEndSeconds!)} 前的混剪/口播未参与说话人分离和身份匹配。
          </div>
        )}
        {!showChapters && diarization?.enabled && diarization.speakerIdentityStatus === 'failed' && (
          <div className="transcript-diarization-hint">
            说话人姓名识别失败：{diarization.speakerIdentityError || '未知原因'}。可点击右上角「重新识别」重试。
          </div>
        )}
        {!showChapters && diarization?.enabled && diarization.speakerIdentityStatus === 'empty' && (
          <div className="transcript-diarization-hint">
            AI 未找到证据充分的姓名映射，已保留「说话人N」标签。可点击右上角「重新识别」重试。
          </div>
        )}

        <div className={`transcript-slider${showChapters ? ' chapters-active' : ''}`}>
          <div className="transcript-slide transcript-slide--text" data-slide="transcript">
            <div className="transcript-list" ref={listRef} onMouseUp={handleTranscriptMouseUp}>
              {rows.length ? (
                rows.map((turn, index) => {
                  const color = speakerColor(turn.speaker);
                  const introEnd = diarization?.introEndSeconds || 0;
                  const isIntro = introEnd > 0 && turn.start < introEnd;
                  const showBodyDivider =
                    introEnd > 0 && index > 0 && !isIntro && rows[index - 1].start < introEnd;
                  return (
                    <React.Fragment key={`${turn.start}-${index}`}>
                      {showBodyDivider && <div className="transcript-body-divider">正文开始</div>}
                      <div
                        className={`transcript-entry${activeStart === turn.start ? ' active-playback' : ''}${isIntro ? ' transcript-entry--intro' : ''}`}
                        data-seconds={turn.start}
                        onClick={(event) => seekIfNotSelecting(event, turn.start)}
                      >
                        <span className={`transcript-time${isIntro ? ' transcript-time--intro' : ''}`}>[{formatTimestamp(turn.start)}]</span>
                        {turn.speakerName && (
                          <span
                            className="transcript-speaker"
                            style={{ color, borderColor: color, backgroundColor: `${color}16` }}
                            title={turn.speakerName}
                          >
                            {turn.speakerName}
                          </span>
                        )}
                        <span className="transcript-text">{turn.rawText || turn.text}</span>
                      </div>
                    </React.Fragment>
                  );
                })
              ) : (
                <div className="failure-state module-failure-state">暂无文字稿内容</div>
              )}
            </div>
          </div>

          <div className="transcript-slide transcript-slide--chapters" data-slide="chapters">
            <div className="section-header module-section-header">
              <div className="section-title">章节</div>
              <button className="reanalyze-btn module-reanalyze-btn" onClick={onGenerateChapters} disabled={chaptersLoading} type="button">
                <span className="reanalyze-icon" aria-hidden="true">↻</span>
                <span>重新识别</span>
              </button>
            </div>
            {chaptersLoading ? (
              <div className="module-loading">
                <img className="module-loading-img" src={assetUrl('assets/overview-loading.webp')} alt="" aria-hidden="true" />
                <span className="module-loading-text">正在分析章节…</span>
              </div>
            ) : chaptersError ? (
              <div className="failure-state module-failure-state">
                <img className="failure-state-img" src={assetUrl('assets/failure-state.webp')} alt="" aria-hidden="true" />
                {chaptersError}
              </div>
            ) : chapters?.length ? (
              <ul className="chapter-list">
                {chapters.map((chapter, index) => (
                  <li key={`${chapter.timestampSeconds}-${index}`} className="chapter-item" onClick={() => onSeek(chapter.timestampSeconds)}>
                    <span className="chapter-timestamp">[{chapter.timestamp}]</span>
                    <span className="chapter-content">
                      <span className="chapter-title">{chapter.title}</span>
                      {chapter.summary && <span className="chapter-summary">{chapter.summary}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="failure-state module-failure-state">打开章节预览后将自动生成章节。</div>
            )}
          </div>
        </div>
      </div>

      {!followingPlayback && activeStart !== null && !showChapters && (
        <button
          className="follow-playback-btn"
          type="button"
          onClick={() => {
            setPlaybackFollowing(true);
            const activeElement = listRef.current?.querySelector<HTMLElement>(`.transcript-entry[data-seconds="${activeStart}"]`);
            if (activeElement) {
              lastAutoScrollRef.current = Date.now();
              activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
        >
          跟随播放
        </button>
      )}
      {showBackToTop && !showChapters && (
        <button
          className="back-to-top-btn"
          type="button"
          title="返回顶部"
          aria-label="返回顶部"
          onClick={() => listRef.current?.closest<HTMLElement>('.content')?.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          ↑
        </button>
      )}

      {selection && (
        <div className="explain-tooltip" style={{ position: 'fixed', top: selection.top, left: selection.left }}>
          <button className="explain-btn" onMouseDown={(event) => event.preventDefault()} onClick={() => void requestExplanation()} type="button">
            讲解
          </button>
        </div>
      )}
      {explanation && (
        <div className="explain-modal-overlay" role="dialog" aria-modal="true" aria-label="文字讲解" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExplanation(null);
        }}>
          <div className="explain-modal">
            <div className="explain-modal-header">
              <div className="explain-modal-title">讲解</div>
              <button className="explain-modal-close" type="button" onClick={() => setExplanation(null)}>✕</button>
            </div>
            <div className="explain-selected-text">“{explanation.selectedText.slice(0, 200)}{explanation.selectedText.length > 200 ? '…' : ''}”</div>
            <div className="explain-modal-content">
              {explanation.loading ? (
                <div className="explain-loading"><div className="loading-bar" /><span>正在分析…</span></div>
              ) : explanation.error ? (
                <div className="failure-state explain-error"><img className="failure-state-img" src={assetUrl('assets/failure-state.webp')} alt="" aria-hidden="true" />{explanation.error}</div>
              ) : (
                <div className="explain-text">{explanation.content}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TranscriptPanel;
