from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import TextFormatter
import re
from typing import Optional, Dict, Any

class YouTubeExtractor:
    @staticmethod
    def extract_video_id(url: str) -> Optional[str]:
        """Extract video ID from YouTube URL"""
        patterns = [
            r'(?:youtube\.com\/watch\?v=)([\w-]+)',
            r'(?:youtu\.be\/)([\w-]+)',
            r'(?:youtube\.com\/embed\/)([\w-]+)'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None
    
    @staticmethod
    def get_transcript(video_id: str) -> Dict[str, Any]:
        """Get transcript for a YouTube video"""
        try:
            transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
            
            # Try to get manual transcript first, then auto-generated
            try:
                transcript = transcript_list.find_manually_created_transcript()
            except:
                transcript = transcript_list.find_generated_transcript(['en'])
            
            # Fetch the actual transcript
            transcript_data = transcript.fetch()
            
            # Format as text
            formatter = TextFormatter()
            full_text = formatter.format_transcript(transcript_data)
            
            # Get video metadata (basic)
            metadata = {
                'video_id': video_id,
                'language': transcript.language,
                'is_generated': transcript.is_generated,
                'duration': sum(entry['duration'] for entry in transcript_data),
                'segment_count': len(transcript_data)
            }
            
            return {
                'success': True,
                'text': full_text[:15000],  # Limit length
                'metadata': metadata,
                'segments': transcript_data[:50]  # First 50 segments for reference
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }