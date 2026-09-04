/**
 * Podcast Page Parser for fetching episode lists
 */

import { PodcastEpisode, PodcastInfo } from '../types';
import { isXiaoyuzhouObjectId } from '../shared/domain';

const XIAOYUZHOU_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120 Safari/537.36';

function decodeEmbeddedText(value: string): string {
  return String(value || '')
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\["']/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_match, hex, decimal) =>
      String.fromCharCode(parseInt(hex || decimal, hex ? 16 : 10))
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function readString(source: Record<string, unknown> | undefined, keys: string[]): string {
  if (!source) return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractImageUrl(source: unknown): string {
  const imageKeys = [
    'image', 'imageUrl', 'image_url', 'cover', 'coverUrl', 'cover_url',
    'pic', 'picUrl', 'pic_url', 'logo', 'logoUrl', 'avatar', 'avatarUrl',
  ];
  const urlKeys = ['url', 'src', 'original', 'origin', 'large', 'medium', 'small'];

  const toHttpUrl = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return trimmed.startsWith('//') ? `https:${trimmed}` : '';
  };

  const find = (value: unknown, depth = 0): string => {
    if (depth > 2 || !value) return '';
    const direct = toHttpUrl(value);
    if (direct) return direct;
    if (typeof value !== 'object' || Array.isArray(value)) return '';
    for (const key of [...imageKeys, ...urlKeys]) {
      const found = find((value as Record<string, unknown>)[key], depth + 1);
      if (found) return found;
    }
    return '';
  };

  return find(source);
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': XIAOYUZHOU_UA,
      Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      Referer: 'https://www.xiaoyuzhoufm.com/',
    },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`请求页面失败 HTTP ${response.status}`);
  return response.text();
}

function parseNextData(html: string): unknown | null {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function episodeIdOf(item: Record<string, unknown>): string {
  const nestedType = readString(item, ['type']);
  return readString(item, ['eid', 'episodeId', 'episode_id']) || (nestedType === 'episode' ? readString(item, ['id']) : '');
}

function podcastIdOf(item: Record<string, unknown>): string {
  const nestedType = readString(item, ['type']);
  return readString(item, ['pid', 'podcastId', 'podcast_id']) || (nestedType === 'podcast' ? readString(item, ['id']) : '');
}

function collectEmbeddedObjects(data: unknown): { objects: Record<string, unknown>[]; arrays: unknown[][] } {
  const objects: Record<string, unknown>[] = [];
  const arrays: unknown[][] = [];
  const visited = new Set<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      arrays.push(value);
      value.forEach(visit);
      return;
    }
    const object = value as Record<string, unknown>;
    objects.push(object);
    Object.values(object).forEach(visit);
  };
  visit(data);
  return { objects, arrays };
}

function parsePodcastEpisodesFromNextData(data: unknown, fallbackPodcastId: string): PodcastInfo | null {
  if (!data) return null;
  const { objects, arrays } = collectEmbeddedObjects(data);
  const hasId = (value: string) => isXiaoyuzhouObjectId(value);
  const podcast =
    objects.find((item) => podcastIdOf(item) === fallbackPodcastId) ||
    objects.find((item) => hasId(podcastIdOf(item)) && Boolean(readString(item, ['title', 'name'])) && !episodeIdOf(item)) ||
    {};
  const pid = podcastIdOf(podcast) || fallbackPodcastId;
  if (!isXiaoyuzhouObjectId(pid)) return null;

  const episodeObjects = arrays
    .map((items) => items.filter((item): item is Record<string, unknown> => {
      return Boolean(item && typeof item === 'object' && hasId(episodeIdOf(item as Record<string, unknown>)));
    }))
    .filter((items) => items.length)
    .sort((left, right) => right.length - left.length)[0] || [];

  const seen = new Set<string>();
  const coverImage = extractImageUrl(podcast);
  const episodes: PodcastEpisode[] = episodeObjects.flatMap((item) => {
    const eid = episodeIdOf(item);
    if (!isXiaoyuzhouObjectId(eid) || seen.has(eid)) return [];
    seen.add(eid);
    const embeddedPodcast = item.podcast && typeof item.podcast === 'object'
      ? item.podcast as Record<string, unknown>
      : undefined;
    return [{
      eid,
      title: decodeEmbeddedText(readString(item, ['title', 'name']) || '未命名单集'),
      image: extractImageUrl(item) || extractImageUrl(embeddedPodcast) || coverImage,
      duration: Number(item.duration || item.durationSeconds || 0) || 0,
      pubDate: readString(item, ['pubDate', 'publishedAt', 'publishTime', 'createdAt']),
    }];
  });

  if (!episodes.length) return null;
  const owner = podcast.owner && typeof podcast.owner === 'object' ? podcast.owner as Record<string, unknown> : undefined;
  const creator = podcast.creator && typeof podcast.creator === 'object' ? podcast.creator as Record<string, unknown> : undefined;
  return {
    success: true,
    pid,
    title: decodeEmbeddedText(readString(podcast, ['title', 'name'])),
    author: decodeEmbeddedText(readString(podcast, ['author', 'authorName']) || readString(creator, ['name']) || readString(owner, ['name'])),
    episodeCount: Number(podcast.episodeCount || podcast.episode_count || podcast.episodesCount || episodes.length) || episodes.length,
    coverImage,
    rssUrl: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
    episodes,
  };
}

function parseEpisodeLinksFromHtml(html: string): PodcastEpisode[] {
  const episodes: PodcastEpisode[] = [];
  const seen = new Set<string>();
  const linkPattern = /(?:\/|\\\/)+episode(?:\/|\\\/)+([0-9a-f]{24})(?=[?/#"'\\<\s]|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(html))) {
    const eid = match[1];
    if (seen.has(eid)) continue;
    seen.add(eid);
    const before = html.slice(Math.max(0, match.index - 1600), match.index);
    const after = html.slice(match.index, Math.min(html.length, match.index + 1600));
    const titleMatch =
      before.match(/(?:title|aria-label)="([^"]{2,500})"[^>]*$/i) ||
      after.match(/"title"\s*[:=]\s*"((?:\\.|[^"\\]){2,500})"/i);
    episodes.push({
      eid,
      title: decodeEmbeddedText(titleMatch?.[1] || `单集 ${episodes.length + 1}`),
      image: '',
      duration: 0,
      pubDate: '',
    });
  }
  return episodes;
}

async function resolvePodcastId(episodeId?: string, podcastId?: string): Promise<string> {
  const provided = String(podcastId || '').trim();
  if (isXiaoyuzhouObjectId(provided)) return provided;
  if (!isXiaoyuzhouObjectId(String(episodeId || '').trim())) return '';

  const episodeHtml = await fetchPage(`https://www.xiaoyuzhoufm.com/episode/${episodeId}`);
  const data = parseNextData(episodeHtml);
  const { objects } = collectEmbeddedObjects(data);
  const nestedPodcastId = objects
    .map((item) => {
      const podcast = item.podcast;
      return podcast && typeof podcast === 'object' ? podcastIdOf(podcast as Record<string, unknown>) : '';
    })
    .find(isXiaoyuzhouObjectId);
  if (nestedPodcastId) return nestedPodcastId;

  const match = episodeHtml.match(/"(?:pid|podcastId|podcast_id)"\s*:\s*"([0-9a-f]{24})"/i);
  return match?.[1] || '';
}

export async function handleFetchPodcastEpisodes(
  episodeId?: string,
  podcastId?: string
): Promise<PodcastInfo | { success: false; error: string }> {
  try {
    const pid = await resolvePodcastId(episodeId, podcastId);
    if (!isXiaoyuzhouObjectId(pid)) return { success: false, error: '未能确定当前单集所属的节目。' };

    const html = await fetchPage(`https://www.xiaoyuzhoufm.com/podcast/${encodeURIComponent(pid)}`);
    const parsed = parsePodcastEpisodesFromNextData(parseNextData(html), pid);
    if (parsed) return parsed;

    const episodes = parseEpisodeLinksFromHtml(html);
    if (!episodes.length) return { success: false, error: '节目页面未找到可解析的单集数据。' };
    const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]*)"/i);
    const imageMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]*)"/i);
    return {
      success: true,
      pid,
      title: decodeEmbeddedText(titleMatch?.[1] || ''),
      author: '',
      episodeCount: episodes.length,
      coverImage: imageMatch?.[1] || '',
      rssUrl: `https://www.xiaoyuzhoufm.com/podcast/${pid}`,
      episodes,
    };
  } catch (error) {
    console.error('[小宇宙 Digest v2.0] Fetch podcast episodes error:', error);
    return { success: false, error: error instanceof Error ? error.message : '获取节目单集失败。' };
  }
}
