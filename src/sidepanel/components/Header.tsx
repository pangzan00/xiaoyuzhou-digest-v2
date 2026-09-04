/**
 * Header Component with tabs, history, and podcast navigation
 */

import React, { useState } from 'react';
import { HistoryEntry, PodcastInfo, TabName } from '../../types';

interface BrowsedPodcast {
  pid: string;
  title: string;
  author: string;
  image: string;
  episodeCount: number;
  rssUrl: string;
  lastVisitedAt: number;
}

interface HeaderProps {
  videoTitle: string;
  channelName: string;
  activeTab: TabName;
  onTabChange: (tab: TabName) => void;
  tabsVisible: boolean;
  onOpenSettings: () => void;
  history: HistoryEntry[];
  currentVideoId: string | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  onCloseHistory: () => void;
  onOpenHistoryEpisode: (videoId: string) => void;
  onExportHistory: () => void;
  currentPodcastId: string;
  onFetchPodcastEpisodes: (
    episodeId?: string,
    podcastId?: string
  ) => Promise<PodcastInfo | { success: false; error: string }>;
  onOpenEpisode: (episodeId: string) => void;
  onOpenPodcast: (podcastId: string) => void;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(Math.max(0, Number(seconds) || 0) / 60);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
  return `${minutes} 分钟`;
}

function formatPubDate(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN');
}

export const Header: React.FC<HeaderProps> = ({
  videoTitle,
  channelName,
  activeTab,
  onTabChange,
  tabsVisible,
  onOpenSettings,
  history,
  currentVideoId,
  historyOpen,
  onToggleHistory,
  onCloseHistory,
  onOpenHistoryEpisode,
  onExportHistory,
  currentPodcastId,
  onFetchPodcastEpisodes,
  onOpenEpisode,
  onOpenPodcast,
}) => {
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [episodesTab, setEpisodesTab] = useState<'current' | 'history'>('current');
  const [activePodcastId, setActivePodcastId] = useState<string | null>(null);
  const [podcast, setPodcast] = useState<PodcastInfo | null>(null);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodesError, setEpisodesError] = useState('');
  const [browsedPodcasts, setBrowsedPodcasts] = useState<BrowsedPodcast[]>([]);

  const tabs: { key: TabName; label: string }[] = [
    { key: 'transcript', label: '文字稿' },
    { key: 'overview', label: '精选' },
    { key: 'chat', label: '问答' },
    { key: 'notes', label: '笔记' },
  ];

  const readBrowsedPodcasts = async () => {
    const result = await chrome.storage.local.get('xyz_podcasts');
    const entries = Array.isArray(result.xyz_podcasts) ? result.xyz_podcasts : [];
    setBrowsedPodcasts(
      entries
        .filter((entry): entry is BrowsedPodcast => Boolean(entry && typeof entry.pid === 'string'))
        .sort((left, right) => Number(right.lastVisitedAt) - Number(left.lastVisitedAt))
    );
  };

  const rememberPodcast = async (data: PodcastInfo) => {
    if (!data.pid) return;
    const result = await chrome.storage.local.get('xyz_podcasts');
    const stored = Array.isArray(result.xyz_podcasts) ? result.xyz_podcasts : [];
    const next = [
      {
        pid: data.pid,
        title: data.title || '未命名节目',
        author: data.author || '',
        image: data.coverImage || '',
        episodeCount: Number(data.episodeCount) || data.episodes.length,
        rssUrl: data.rssUrl || `https://www.xiaoyuzhoufm.com/podcast/${data.pid}`,
        lastVisitedAt: Date.now(),
      },
      ...stored.filter((entry) => entry?.pid !== data.pid),
    ].slice(0, 200);
    await chrome.storage.local.set({ xyz_podcasts: next });
    setBrowsedPodcasts(next as BrowsedPodcast[]);
  };

  const loadEpisodes = async (podcastId?: string) => {
    const targetPodcastId = podcastId || activePodcastId || currentPodcastId;
    if (!targetPodcastId && !currentVideoId) {
      setEpisodesError('当前页面未提供节目 ID。');
      return;
    }

    setEpisodesLoading(true);
    setEpisodesError('');
    try {
      const result = await onFetchPodcastEpisodes(currentVideoId || undefined, targetPodcastId || undefined);
      if ('error' in result) {
        setPodcast(null);
        setEpisodesError(result.error || '获取节目单集失败。');
        return;
      }
      setPodcast(result);
      setActivePodcastId(result.pid === currentPodcastId ? null : result.pid);
      await rememberPodcast(result);
    } catch (error) {
      setPodcast(null);
      setEpisodesError(error instanceof Error ? error.message : '获取节目单集失败。');
    } finally {
      setEpisodesLoading(false);
    }
  };

  const toggleEpisodes = async () => {
    if (episodesOpen) {
      setEpisodesOpen(false);
      return;
    }
    onCloseHistory();
    setEpisodesOpen(true);
    setEpisodesTab('current');
    await loadEpisodes();
  };

  const openBrowsedPodcast = async (pid: string) => {
    setActivePodcastId(pid);
    setEpisodesTab('current');
    await loadEpisodes(pid);
  };

  return (
    <header className={`header${tabsVisible ? '' : ' header--idle'}`}>
      <div className="header-top">
        {(videoTitle || channelName) && (
          <div className="video-info">
            <div className="video-title">{videoTitle}</div>
            <div className="video-channel">{channelName}</div>
          </div>
        )}

        <div className="header-actions">
          <button
            className={`settings-btn ${historyOpen ? 'active' : ''}`}
            onClick={() => {
              if (!historyOpen) setEpisodesOpen(false);
              onToggleHistory();
            }}
            type="button"
            aria-expanded={historyOpen}
            title="打开已缓存单集历史"
          >
            历史
          </button>
          <button
            className={`settings-btn ${episodesOpen ? 'active' : ''}`}
            onClick={() => void toggleEpisodes()}
            type="button"
            aria-expanded={episodesOpen}
            title="本节目单集与浏览过的节目"
          >
            更多
          </button>
          <button
            className="settings-btn"
            onClick={onOpenSettings}
            type="button"
            title="打开小宇宙 Digest v2.0 设置"
          >
            设置
          </button>

          {historyOpen && (
            <div className="history-panel" role="dialog" aria-label="历史记录">
              <div className="history-panel-header">
                <span className="history-panel-title">历史记录</span>
                <div className="history-panel-actions">
                  <span className="history-count">{history.length} 集</span>
                  <button className="history-export-btn" onClick={onExportHistory} type="button">
                    导出
                  </button>
                </div>
              </div>
              <div className="history-list">
                {history.length ? (
                  history.map((entry) => (
                    <button
                      key={entry.videoId}
                      className={`history-item${entry.videoId === currentVideoId ? ' current' : ''}`}
                      onClick={() => onOpenHistoryEpisode(entry.videoId)}
                      type="button"
                    >
                      <span className="history-item-thumb" aria-hidden="true">
                        {entry.image ? (
                          <img
                            className="history-item-cover"
                            src={entry.image}
                            alt=""
                            referrerPolicy="no-referrer"
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                              event.currentTarget.parentElement?.classList.add('history-item-thumb-empty');
                            }}
                          />
                        ) : null}
                      </span>
                      <span className="history-item-body">
                        <span className="history-item-title">{entry.title || '未命名单集'}</span>
                        {entry.channel && <span className="history-item-channel">{entry.channel}</span>}
                        {entry.timestamp > 0 && (
                          <span className="history-item-meta">{new Date(entry.timestamp).toLocaleDateString()}</span>
                        )}
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="history-empty">暂无已缓存的单集</div>
                )}
              </div>
            </div>
          )}

          {episodesOpen && (
            <div id="episodesPanel" className="history-panel" role="dialog" aria-label="节目单集">
              <div className="history-panel-header">
                <span className="history-panel-title">
                  {episodesTab === 'history' ? '浏览过的节目' : podcast?.title || '本节目单集'}
                </span>
                <div className="history-panel-actions">
                  <span className="history-count">
                    {episodesTab === 'history'
                      ? `${browsedPodcasts.length} 个节目`
                      : podcast
                        ? `${podcast.episodeCount || podcast.episodes.length} 集`
                        : ''}
                  </span>
                  {episodesTab === 'current' && (activePodcastId || currentPodcastId || podcast?.pid) && (
                    <button
                      className="history-export-btn"
                      onClick={() => onOpenPodcast(activePodcastId || currentPodcastId || podcast!.pid)}
                      type="button"
                    >
                      节目主页
                    </button>
                  )}
                </div>
              </div>
              <div className="episodes-tabs" role="tablist" aria-label="节目浏览方式">
                <button
                  className={`episodes-tab ${episodesTab === 'current' ? 'active' : ''}`}
                  onClick={() => {
                    setEpisodesTab('current');
                    if (!podcast) void loadEpisodes();
                  }}
                  type="button"
                  role="tab"
                  aria-selected={episodesTab === 'current'}
                >
                  本节目单集
                </button>
                <button
                  className={`episodes-tab ${episodesTab === 'history' ? 'active' : ''}`}
                  onClick={() => {
                    setEpisodesTab('history');
                    void readBrowsedPodcasts();
                  }}
                  type="button"
                  role="tab"
                  aria-selected={episodesTab === 'history'}
                >
                  浏览过的节目
                </button>
              </div>
              <div className="history-list">
                {episodesTab === 'history' ? (
                  browsedPodcasts.length ? (
                    browsedPodcasts.map((item) => (
                      <button className="history-item" key={item.pid} onClick={() => void openBrowsedPodcast(item.pid)} type="button">
                        <span className={`history-item-thumb${item.image ? '' : ' history-item-thumb-empty'}`}>
                          {item.image && <img className="history-item-cover" src={item.image} alt="" referrerPolicy="no-referrer" />}
                        </span>
                        <span className="history-item-body">
                          <span className="history-item-title">{item.title || '未命名节目'}</span>
                          <span className="history-item-meta">
                            {item.episodeCount ? `${item.episodeCount} 集` : ''}
                            {item.author ? `${item.episodeCount ? ' · ' : ''}${item.author}` : ''}
                          </span>
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="history-empty">还没有浏览过的节目。打开任意单集后会自动记录在这里。</div>
                  )
                ) : episodesLoading ? (
                  <div className="history-empty">正在获取节目单集…</div>
                ) : episodesError ? (
                  <div className="failure-state episodes-failure-state">{episodesError}</div>
                ) : podcast?.episodes.length ? (
                  <>
                    {activePodcastId && activePodcastId !== currentPodcastId && (
                      <div className="episodes-note episodes-back">
                        正在查看其他节目
                        <button
                          className="episodes-back-btn"
                          onClick={() => {
                            setActivePodcastId(null);
                            void loadEpisodes(currentPodcastId);
                          }}
                          type="button"
                        >
                          返回本节目
                        </button>
                      </div>
                    )}
                    {podcast.episodes.map((episode) => (
                      <button
                        className={`history-item${podcast.pid === currentPodcastId && episode.eid === currentVideoId ? ' current' : ''}`}
                        key={episode.eid}
                        onClick={() => {
                          setEpisodesOpen(false);
                          onOpenEpisode(episode.eid);
                        }}
                        type="button"
                      >
                        <span className={`history-item-thumb${episode.image ? '' : ' history-item-thumb-empty'}`}>
                          {episode.image && <img className="history-item-cover" src={episode.image} alt="" referrerPolicy="no-referrer" />}
                        </span>
                        <span className="history-item-body">
                          <span className="history-item-title">{episode.title}</span>
                          <span className="history-item-meta">
                            {episode.duration ? formatDuration(episode.duration) : ''}
                            {episode.pubDate ? `${episode.duration ? ' · ' : ''}${formatPubDate(episode.pubDate)}` : ''}
                          </span>
                        </span>
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="history-empty">未找到该节目的其他单集。</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {tabsVisible && (
        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => onTabChange(tab.key)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
};

export default Header;
