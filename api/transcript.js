import * as yt from 'youtube-transcript';

// Extract video ID from various YouTube URL formats
function extractVideoId(urlOrId) {
  if (!urlOrId) return null;
  
  urlOrId = String(urlOrId).trim();

  // If it's already a video ID (11 chars alphanumeric)
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) {
    return urlOrId;
  }

  // URL patterns
  const patterns = [
    /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = urlOrId.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

// Fetch video metadata
async function fetchVideoMetadata(videoId) {
  try {
    // Use oembed API as a lightweight metadata source
    const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
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

// Fetch video transcript
async function fetchVideoTranscript(videoId) {
  try {
    // The youtube-transcript library expects a full URL string
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const segments = await yt.YoutubeTranscript.fetchTranscript(url);
    if (!segments || segments.length === 0) {
      throw new Error('No transcript available for this video');
    }
    return segments;
  } catch (error) {
    console.error('Transcript fetch error:', error);
    throw new Error(`Could not fetch transcript: ${error.message}`);
  }
}

// Helper to decode HTML entities from captions
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
    .replace(/&#x3D;/g, '=');
}

// Main handler
export default async function handler(req, res) {
  try {
    const { videoUrl } = req.query;

    if (!videoUrl) {
      return res.status(400).json({ error: 'videoUrl parameter required' });
    }

    // Extract video ID
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube URL or ID' });
    }

    // Fetch metadata first
    const metadata = await fetchVideoMetadata(videoId);

    // Fetch transcript with fallback
    let transcript = [];
    try {
      transcript = await fetchVideoTranscript(videoId);
    } catch (err) {
      console.warn(`Transcript fetch failed for video ${videoId}, using fallback. Error:`, err.message);
      transcript = [
        {
          text: `[No transcript available. Visualizing concepts based on video title: "${metadata.title}" by ${metadata.author}]`,
          offset: 0,
          duration: 0
        }
      ];
    }

    res.status(200).json({
      success: true,
      videoId,
      title: metadata.title,
      author: metadata.author,
      language: 'en',
      transcript: transcript.map(t => ({
        text: decodeHtmlEntities(t.text),
        start: t.offset / 1000 || 0, // Convert ms to seconds
        duration: t.duration / 1000 || 0,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Transcript handler error:', error);
    res.status(500).json({ error: error.message });
  }
}
