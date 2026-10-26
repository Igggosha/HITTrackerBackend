import { readFile, writeFile } from 'node:fs/promises';

type LocalizedName = { en: string; uk: string };
type CatalogItem = { catalogKey: string; name: LocalizedName };
type VideoCandidate = {
  status: 'candidate' | 'ready' | 'missing';
  url: string | null;
  channel: string | null;
  title?: string | null;
  matchScore?: number | null;
};
type RegistryEntry = {
  catalogKey: string;
  image: Record<string, unknown>;
  videos: { en: VideoCandidate; uk: VideoCandidate };
};
type VideoRenderer = {
  videoId?: string;
  title?: { simpleText?: string; runs?: { text: string }[] };
  ownerText?: { runs?: { text: string }[] };
  ownerBadges?: { metadataBadgeRenderer?: { style?: string } }[];
};

const preferredEnglishChannels = new Set([
  'Jeff Nippard',
  'Renaissance Periodization',
  'ScottHermanFitness',
  'E3 Rehab',
  'ATHLEAN-X™',
  'Jeremy Ethier',
]);
const reviewedPartialMatches = {
  en: new Set([
    'rope_triceps_pushdown',
    'triceps_dip',
    'overhead_dumbbell_triceps_extension',
    'reverse_grip_triceps_pushdown',
    'barbell_reverse_wrist_curl',
    'hit_full_body',
    'strength_base',
    'triceps_focus',
  ]),
  uk: new Set([
    't_bar_row',
    'chin_up',
    'hammer_curl',
    'cable_curl',
    'glute_bridge',
    'machine_shoulder_press',
    'hanging_knee_raise',
    'barbell_wrist_curl',
    'biceps_focus',
  ]),
};
let youtubeApiKey = '';
let youtubeClientVersion = '';
const emptyVideo = (): VideoCandidate => ({
  status: 'missing',
  url: null,
  channel: null,
  title: null,
  matchScore: null,
});
const tokens = (value: string) =>
  new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
const similarity = (name: string, title: string) => {
  const expected = tokens(name);
  const actual = tokens(title);
  const shared = [...expected].filter((token) => actual.has(token)).length;
  return shared / Math.max(expected.size, 1);
};
const titleOf = (video: VideoRenderer) =>
  video.title?.runs?.map((part) => part.text).join('') ??
  video.title?.simpleText ??
  '';
const channelOf = (video: VideoRenderer) =>
  video.ownerText?.runs?.[0]?.text ?? '';

function collectVideos(value: unknown, found: VideoRenderer[] = []) {
  if (!value || typeof value !== 'object') return found;
  const record = value as Record<string, unknown>;
  if (record.videoRenderer)
    found.push(record.videoRenderer as VideoRenderer);
  for (const nested of Object.values(record)) collectVideos(nested, found);
  return found;
}

async function searchYouTube(query: string, locale: 'en' | 'uk') {
  const language = locale === 'uk' ? 'uk' : 'en';
  const region = locale === 'uk' ? 'UA' : 'US';
  const response = await fetch(
    `https://www.youtube.com/youtubei/v1/search?key=${youtubeApiKey}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'SOCS=CAI',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'WEB',
            clientVersion: youtubeClientVersion,
            hl: language,
            gl: region,
          },
        },
        query,
      }),
    },
  );
  if (!response.ok) throw new Error(`YouTube search failed: ${response.status}`);
  return collectVideos((await response.json()) as unknown);
}

async function loadYouTubeClient() {
  const response = await fetch('https://www.youtube.com?hl=en&gl=US', {
    headers: { cookie: 'SOCS=CAI', 'user-agent': 'Mozilla/5.0' },
  });
  const html = await response.text();
  youtubeApiKey =
    html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? '';
  youtubeClientVersion =
    html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '';
  if (!youtubeApiKey || !youtubeClientVersion)
    throw new Error('Could not load the YouTube web client configuration');
}

async function suggest(item: CatalogItem, locale: 'en' | 'uk') {
  const name = item.name[locale];
  const query =
    locale === 'uk'
      ? `${name} техніка виконання українською`
      : `${name} exercise tutorial proper form`;
  const results = await searchYouTube(query, locale);
  const minimumScore = reviewedPartialMatches[locale].has(item.catalogKey)
    ? 0.5
    : 1;
  const ranked = results
    .filter((video) => video.videoId && titleOf(video) && channelOf(video))
    .map((video) => {
      const title = titleOf(video);
      const channel = channelOf(video);
      const nameScore = similarity(name, title);
      const verified = video.ownerBadges?.some((badge) =>
        badge.metadataBadgeRenderer?.style?.includes('VERIFIED'),
      );
      const ukrainian = /[іїєґ]/iu.test(`${title} ${channel}`);
      const score =
        nameScore +
        (verified ? 0.1 : 0) +
        (locale === 'en' && preferredEnglishChannels.has(channel) ? 0.2 : 0) +
        (locale === 'uk' && ukrainian ? 0.2 : 0);
      return { video, title, channel, nameScore, score, ukrainian };
    })
    .filter((candidate) =>
      locale === 'uk'
        ? candidate.ukrainian && candidate.nameScore >= minimumScore
        : candidate.nameScore >= minimumScore,
    )
    .sort((left, right) => right.score - left.score);
  const selected = ranked[0];
  if (!selected?.video.videoId) return emptyVideo();
  return {
    status: 'candidate' as const,
    url: `https://www.youtube.com/watch?v=${selected.video.videoId}`,
    channel: selected.channel,
    title: selected.title,
    matchScore: Number(selected.nameScore.toFixed(3)),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index]);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }),
  );
  return results;
}

async function main() {
  const catalog = JSON.parse(
    await readFile('data/catalog/catalog.normalized.json', 'utf8'),
  ) as { exercises: CatalogItem[]; programs: CatalogItem[] };
  const registry = JSON.parse(
    await readFile('data/catalog/media-registry.json', 'utf8'),
  ) as { version: number; generatedAt: string; sources: string[]; entries: RegistryEntry[] };
  if (process.argv.includes('--filter-existing')) {
    for (const entry of registry.entries) {
      for (const locale of ['en', 'uk'] as const) {
        if ((entry.videos[locale].matchScore ?? 0) < 1)
          entry.videos[locale] = emptyVideo();
      }
    }
    await writeFile(
      'data/catalog/media-registry.json',
      `${JSON.stringify(registry, null, 2)}\n`,
      'utf8',
    );
    return;
  }
  if (process.argv.includes('--verify-existing')) {
    const videos = registry.entries.flatMap((entry) =>
      (['en', 'uk'] as const).map((locale) => ({ entry, locale })),
    );
    await mapWithConcurrency(videos, 8, async ({ entry, locale }) => {
      const video = entry.videos[locale];
      if (!video.url || video.status === 'missing') return;
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`,
      );
      video.status = response.ok ? 'ready' : 'missing';
      if (!response.ok) Object.assign(video, emptyVideo());
    });
    await writeFile(
      'data/catalog/media-registry.json',
      `${JSON.stringify(registry, null, 2)}\n`,
      'utf8',
    );
    return;
  }
  await loadYouTubeClient();
  const entriesByKey = new Map(
    registry.entries.map((entry) => [entry.catalogKey, entry]),
  );
  const items = [...catalog.exercises, ...catalog.programs];
  const suggestions = await mapWithConcurrency(items, 2, async (item) => ({
    catalogKey: item.catalogKey,
    en: await suggest(item, 'en'),
    uk: await suggest(item, 'uk'),
  }));
  for (const suggestion of suggestions) {
    const existing = entriesByKey.get(suggestion.catalogKey);
    const entry = existing ?? {
      catalogKey: suggestion.catalogKey,
      image: { status: 'missing' },
      videos: { en: emptyVideo(), uk: emptyVideo() },
    };
    entry.videos = { en: suggestion.en, uk: suggestion.uk };
    entriesByKey.set(suggestion.catalogKey, entry);
  }
  const entries = items.map((item) => entriesByKey.get(item.catalogKey)!);
  const counts = entries.reduce(
    (result, entry) => ({
      en: result.en + Number(entry.videos.en.status === 'candidate'),
      uk: result.uk + Number(entry.videos.uk.status === 'candidate'),
    }),
    { en: 0, uk: 0 },
  );
  await writeFile(
    'data/catalog/media-registry.json',
    `${JSON.stringify(
      {
        ...registry,
        generatedAt: new Date().toISOString(),
        sources: [
          ...registry.sources.filter((source) => !source.startsWith('YouTube search')),
          'YouTube search candidates; direct video URL, title and channel are retained for review',
        ],
        entries,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(
    `video candidates: EN ${counts.en}/${entries.length}; UK ${counts.uk}/${entries.length}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
