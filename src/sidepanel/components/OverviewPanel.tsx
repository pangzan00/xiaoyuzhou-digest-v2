/**
 * Overview Panel Component (chapters, challenges, counter-intuitive insights)
 */

import React from 'react';
import { Chapter, Challenge, CounterIntuitiveItem } from '../../types';

interface OverviewPanelProps {
  chapters: Chapter[] | null;
  challenges: Challenge[] | null;
  counterIntuitive: CounterIntuitiveItem[] | null;
  onReanalyze: (key: 'chapters' | 'challenges' | 'counter') => void;
  onSeek: (seconds: number) => void;
  onToggleCardNote: (text: string, timestampSeconds: number) => void;
  isCardNoteSaved: (text: string, timestampSeconds: number) => boolean;
  loading: Record<string, boolean>;
  errors: Record<string, string | null>;
}

function assetUrl(path: string): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL(path)
    : new URL(path, document.baseURI).toString();
}

/** 每张卡片使用自己的 timestampSeconds；兼容旧缓存中只有 timestamp 文本的记录。 */
function resolveTimestampSeconds(seconds: unknown, timestamp?: unknown): number | null {
  const direct = Number(seconds);
  if (Number.isFinite(direct) && direct >= 0) return Math.floor(direct);

  const match = String(timestamp ?? '').trim().match(/^\[?(?:(\d+):)?(\d+):([0-5]\d)\]?$/);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const remainingSeconds = Number(match[3]);
  return hours * 3600 + minutes * 60 + remainingSeconds;
}

interface ModuleStateProps {
  loading: boolean;
  error: string | null;
  emptyText: string;
}

const ModuleState: React.FC<ModuleStateProps> = ({ loading, error, emptyText }) => {
  if (loading) {
    return (
      <div className="module-loading">
        <img className="module-loading-img" src={assetUrl('assets/overview-loading.webp')} alt="" aria-hidden="true" />
        <span className="module-loading-text">正在分析…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="failure-state module-failure-state">
        <img className="failure-state-img" src={assetUrl('assets/failure-state.webp')} alt="" aria-hidden="true" />
        <span>{error}</span>
      </div>
    );
  }
  return <div className="failure-state module-failure-state">{emptyText}</div>;
};

interface CardNoteButtonProps {
  text: string;
  timestampSeconds: number;
  saved: boolean;
  onToggle: () => void;
}

const CardNoteButton: React.FC<CardNoteButtonProps> = ({ text, timestampSeconds, saved, onToggle }) => (
  <button
    className="card-note-btn"
    type="button"
    aria-label={saved ? '取消收藏' : '保存为笔记'}
    title={saved ? '取消收藏' : '保存为笔记'}
    onClick={(event) => {
      event.stopPropagation();
      onToggle();
    }}
    data-card-text={text}
    data-timestamp={timestampSeconds}
  >
    <img src={assetUrl(saved ? 'assets/note-after.png' : 'assets/note-before.png')} alt="" aria-hidden="true" />
  </button>
);

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  chapters,
  challenges,
  counterIntuitive,
  onReanalyze,
  onSeek,
  onToggleCardNote,
  isCardNoteSaved,
  loading,
  errors,
}) => {
  const sortedChallenges = [...(challenges || [])].sort(
    (left, right) =>
      (resolveTimestampSeconds(left.timestampSeconds, left.timestamp) ?? Number.POSITIVE_INFINITY) -
      (resolveTimestampSeconds(right.timestampSeconds, right.timestamp) ?? Number.POSITIVE_INFINITY)
  );
  const sortedCounter = [...(counterIntuitive || [])].sort(
    (left, right) =>
      (resolveTimestampSeconds(left.timestampSeconds, left.timestamp) ?? Number.POSITIVE_INFINITY) -
      (resolveTimestampSeconds(right.timestampSeconds, right.timestamp) ?? Number.POSITIVE_INFINITY)
  );

  return (
    <div className="tab-panel active" data-panel="overview">
      <div className="section">
        <div className="section-header overview-section-header">
          <div className="section-title">核心挑战</div>
          <button
            className="reanalyze-btn module-reanalyze-btn"
            onClick={() => onReanalyze('challenges')}
            disabled={loading.challenges}
            type="button"
            title="重新识别核心挑战"
          >
            <span className="reanalyze-icon" aria-hidden="true">↻</span>
            <span>重新识别</span>
          </button>
        </div>
        <div id="challengesList">
          {sortedChallenges.length ? (
            sortedChallenges.map((item, index) => {
              const timestampSeconds = resolveTimestampSeconds(item.timestampSeconds, item.timestamp);
              if (timestampSeconds === null) return null;
              const noteText = `挑战：${item.challenge}${item.solution ? `\n解决方案：${item.solution}` : ''}`;
              const saved = isCardNoteSaved(noteText, timestampSeconds);
              return (
                <div
                  key={`${timestampSeconds}-${index}`}
                  className="challenge-item analysis-card"
                  data-seconds={timestampSeconds}
                  onClick={() => onSeek(timestampSeconds)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSeek(timestampSeconds);
                    }
                  }}
                >
                  <div className="challenge-head">
                    <span className="challenge-label">{item.topic || '挑战'}</span>
                    <span className="challenge-timestamp">[{item.timestamp}]</span>
                  </div>
                  <div className="challenge-text">{item.challenge}</div>
                  {item.solution && (
                    <div className="challenge-solution">
                      <span className="solution-label">解决方案</span>
                      <span className="solution-text">{item.solution}</span>
                    </div>
                  )}
                  <CardNoteButton
                    text={noteText}
                    timestampSeconds={timestampSeconds}
                    saved={saved}
                    onToggle={() => onToggleCardNote(noteText, timestampSeconds)}
                  />
                </div>
              );
            })
          ) : (
            <ModuleState loading={!!loading.challenges} error={errors.challenges} emptyText="打开此标签页后将自动提取核心挑战。" />
          )}
        </div>
      </div>

      <div className="section">
        <div className="section-header module-section-header">
          <div className="section-title">反常识</div>
          <button
            className="reanalyze-btn module-reanalyze-btn"
            onClick={() => onReanalyze('counter')}
            disabled={loading.counter}
            type="button"
            title="重新识别反常识"
          >
            <span className="reanalyze-icon" aria-hidden="true">↻</span>
            <span>重新识别</span>
          </button>
        </div>
        <div id="counterIntuitiveList">
          {sortedCounter.length ? (
            sortedCounter.map((item, index) => {
              const timestampSeconds = resolveTimestampSeconds(item.timestampSeconds, item.timestamp);
              if (timestampSeconds === null) return null;
              const noteText = `反常识：${item.claim}${item.explanation ? `\n${item.explanation}` : ''}`;
              const saved = isCardNoteSaved(noteText, timestampSeconds);
              return (
                <div
                  key={`${timestampSeconds}-${index}`}
                  className="counter-item analysis-card"
                  data-seconds={timestampSeconds}
                  onClick={() => onSeek(timestampSeconds)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSeek(timestampSeconds);
                    }
                  }}
                >
                  <div className="counter-head">
                    <span className="counter-label">反常识</span>
                    <span className="counter-timestamp">[{item.timestamp}]</span>
                  </div>
                  <div className="counter-claim">{item.claim}</div>
                  {item.explanation && <div className="counter-explanation">{item.explanation}</div>}
                  <CardNoteButton
                    text={noteText}
                    timestampSeconds={timestampSeconds}
                    saved={saved}
                    onToggle={() => onToggleCardNote(noteText, timestampSeconds)}
                  />
                </div>
              );
            })
          ) : (
            <ModuleState loading={!!loading.counter} error={errors.counter} emptyText="打开此标签页后将自动提取反常识洞察。" />
          )}
        </div>
      </div>

      {chapters?.length ? (
        <div className="section">
          <div className="section-header module-section-header">
            <div className="section-title">章节</div>
            <button
              className="reanalyze-btn module-reanalyze-btn"
              onClick={() => onReanalyze('chapters')}
              disabled={loading.chapters}
              type="button"
              title="重新识别章节"
            >
              <span className="reanalyze-icon" aria-hidden="true">↻</span>
              <span>重新识别</span>
            </button>
          </div>
          <ul className="chapter-list">
            {chapters.map((chapter, index) => {
              const timestampSeconds = resolveTimestampSeconds(chapter.timestampSeconds, chapter.timestamp);
              if (timestampSeconds === null) return null;
              return (
                <li
                  key={`${timestampSeconds}-${index}`}
                  className="chapter-item"
                  data-seconds={timestampSeconds}
                  onClick={() => onSeek(timestampSeconds)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSeek(timestampSeconds);
                    }
                  }}
                >
                  <span className="chapter-timestamp">[{chapter.timestamp}]</span>
                  <span className="chapter-content">
                    <span className="chapter-title">{chapter.title}</span>
                    {chapter.summary && <span className="chapter-summary">{chapter.summary}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
};

export default OverviewPanel;
