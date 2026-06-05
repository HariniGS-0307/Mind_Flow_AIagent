import { YoutubeTranscript } from 'youtube-transcript';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getSubtitles } = require('youtube-captions-scraper');

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function customFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      ...(options.headers || {}),
    },
  });
}

function extractVideoId(urlOrId) {
  if (!urlOrId) return null;

  urlOrId = String(urlOrId).trim();

  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  const patterns = [
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) return match[1];
  }

  return null;
}

async function fetchVideoMetadata(videoId) {
  try {
    const response = await customFetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (response.ok) {
      const data = await response.json();
      return {
        title: data.title || `Video ${videoId}`,
        author: data.author_name || 'Unknown',
      };
    }
  } catch (error) {
    console.error('Metadata fetch error:', error);
  }

  return {
    title: `Video ${videoId}`,
    author: 'Unknown',
  };
}

async function tryYoutubeTranscript(videoId) {
  const langAttempts = [undefined, 'en', 'en-US', 'en-GB'];

  for (const lang of langAttempts) {
    try {
      const config = {
        fetch: customFetch,
        ...(lang ? { lang } : {}),
      };
      const segments = await YoutubeTranscript.fetchTranscript(videoId, config);
      if (segments?.length > 0) {
        return segments;
      }
    } catch (error) {
      console.warn(`youtube-transcript failed (lang=${lang || 'auto'}):`, error.message);
    }
  }

  return null;
}

async function tryCaptionsScraper(videoId) {
  const langAttempts = ['en', 'en-US', 'a.en'];

  for (const lang of langAttempts) {
    try {
      const lines = await getSubtitles({ videoID: videoId, lang });
      if (lines?.length > 0) {
        return lines.map(line => ({
          text: line.text,
          offset: parseFloat(line.start) * 1000,
          duration: parseFloat(line.dur) * 1000,
        }));
      }
    } catch (error) {
      console.warn(`youtube-captions-scraper failed (lang=${lang}):`, error.message);
    }
  }

  return null;
}

async function fetchVideoTranscript(videoId) {
  const methods = [tryYoutubeTranscript, tryCaptionsScraper];

  for (const method of methods) {
    const segments = await method(videoId);
    if (segments?.length > 0) {
      return { segments, source: method.name };
    }
  }

  return { segments: null, source: null };
}

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#x60;/g, '`')
    .replace(/&#x3D;/g, '=')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSegments(segments) {
  return segments.map(t => {
    const startMs = t.offset ?? (t.start ? parseFloat(t.start) * 1000 : 0);
    const durationMs = t.duration ?? (t.dur ? parseFloat(t.dur) * 1000 : 0);
    return {
      text: decodeHtmlEntities(t.text),
      start: startMs / 1000,
      duration: durationMs / 1000,
    };
  });
}

export default async function handler(req, res) {
  try {
    const { videoUrl } = req.query;

    if (!videoUrl) {
      return res.status(400).json({ error: 'videoUrl parameter required' });
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL or ID' });
    }

    const metadata = await fetchVideoMetadata(videoId);
    const { segments, source } = await fetchVideoTranscript(videoId);

    if (!segments || segments.length === 0) {
      return res.status(200).json({
        success: true,
        videoId,
        title: metadata.title,
        author: metadata.author,
        language: 'en',
        transcriptAvailable: false,
        transcript: [{
          text: `No captions found for this video. The video may not have subtitles enabled, or YouTube blocked the request from the server. Title: "${metadata.title}" by ${metadata.author}.`,
          start: 0,
          duration: 0,
        }],
        timestamp: new Date().toISOString(),
      });
    }

    const transcript = normalizeSegments(segments);

    res.status(200).json({
      success: true,
      videoId,
      title: metadata.title,
      author: metadata.author,
      language: 'en',
      transcriptAvailable: true,
      transcriptSource: source,
      transcript,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Transcript handler error:', error);
    res.status(500).json({ error: error.message });
  }
}
