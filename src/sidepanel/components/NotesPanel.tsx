/**
 * Notes Panel Component — card style
 */

import React from 'react';
import { Note } from '../../types';

interface NotesPanelProps {
  notes: Note[];
  filterAll: boolean;
  onFilterChange: (showAll: boolean) => void;
  onDelete: (noteId: string) => void;
  onPlay: (note: Note) => void;
  videoId: string | null;
}

function formatNoteDate(createdAt: number): string {
  const value = Number(createdAt) || 0;
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return '';
  }
}

export const NotesPanel: React.FC<NotesPanelProps> = ({
  notes,
  filterAll,
  onFilterChange,
  onDelete,
  onPlay,
  videoId,
}) => {
  return (
    <div className="tab-panel active" data-panel="notes">
      <div className="section">
        <div className="section-header">
          <div className="section-title">已保存的笔记</div>
          <div className="notes-filter">
            <button
              className={`enhance-btn ${!filterAll ? 'active' : ''}`}
              onClick={() => onFilterChange(false)}
              aria-pressed={!filterAll}
              type="button"
            >
              本单集
            </button>
            <button
              className={`enhance-btn ${filterAll ? 'active' : ''}`}
              onClick={() => onFilterChange(true)}
              aria-pressed={filterAll}
              type="button"
            >
              全部笔记
            </button>
          </div>
        </div>

        <p className="notes-intro">
          在小宇宙页面点「记笔记」按钮或按 “n” 键，即可保存带时间戳的笔记；点击任意卡片可跳转并播放对应内容。
        </p>

        <div id="notesList" className="notes-list">
          {notes.length > 0 ? (
            notes.map((note) => {
              const isCurrentEpisode = note.videoId === videoId;
              const noteDate = formatNoteDate(note.createdAt);
              return (
                <div
                  key={note.id}
                  className={`note-card ${isCurrentEpisode ? 'is-current' : 'is-remote'}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPlay(note)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPlay(note);
                    }
                  }}
                  title={isCurrentEpisode ? '跳转到这一时刻播放' : '打开对应单集并播放'}
                >
                  <div className="note-card-top">
                    <button
                      className="note-timestamp"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlay(note);
                      }}
                      type="button"
                      aria-label="跳转到对应时间点"
                    >
                      <svg
                        width="9"
                        height="9"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      {note.timestamp}
                    </button>
                    {!isCurrentEpisode && (
                      <span className="note-episode" title={note.videoTitle}>
                        {note.videoTitle || '未命名单集'}
                      </span>
                    )}
                    <button
                      className="note-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(note.id);
                      }}
                      type="button"
                      aria-label="删除此笔记"
                      title="删除此笔记"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>

                  <p className="note-card-text">{note.text}</p>

                  <div className="note-card-meta">
                    {!isCurrentEpisode && note.channelName && (
                      <span className="note-channel">{note.channelName}</span>
                    )}
                    {noteDate && <span className="note-date">{noteDate}</span>}
                    <span className={`note-jump-hint ${isCurrentEpisode ? 'seek' : 'open'}`}>
                      {isCurrentEpisode ? '跳转播放' : '打开单集'}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="notes-empty">
              {filterAll ? '暂无已保存的笔记' : '当前单集暂无笔记'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotesPanel;
