from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel
from typing import Optional, Dict, Any
import uvicorn
import json
import os
from datetime import datetime

from youtube_extractor import YouTubeExtractor
from mindmap_generator import MindMapGenerator

app = FastAPI(title="YouTube Mind Map Generator API")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components
youtube_extractor = YouTubeExtractor()
mindmap_generator = MindMapGenerator()

class YouTubeURL(BaseModel):
    url: str
    title: Optional[str] = None

class GenerateResponse(BaseModel):
    success: bool
    data: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

@app.get("/")
async def root():
    return {"message": "YouTube Mind Map Generator API", "version": "1.0.0"}

@app.post("/api/process", response_model=GenerateResponse)
async def process_video(youtube_url: YouTubeURL):
    """Process YouTube video and generate mind map + flowchart"""
    
    try:
        # Extract video ID
        video_id = youtube_extractor.extract_video_id(youtube_url.url)
        if not video_id:
            raise HTTPException(status_code=400, detail="Invalid YouTube URL")
        
        # Get transcript
        transcript_result = youtube_extractor.get_transcript(video_id)
        if not transcript_result['success']:
            raise HTTPException(status_code=400, detail=transcript_result['error'])
        
        transcript_text = transcript_result['text']
        metadata = transcript_result['metadata']
        
        # Generate mind map
        mindmap_result = mindmap_generator.generate_mindmap(
            transcript_text, 
            youtube_url.title or f"YouTube Video {video_id}"
        )
        
        if not mindmap_result['success']:
            raise HTTPException(status_code=500, detail=mindmap_result['error'])
        
        # Generate flowchart
        flowchart_result = mindmap_generator.generate_flowchart(
            transcript_text,
            youtube_url.title or f"YouTube Video {video_id}"
        )
        
        # Generate summary
        summary_result = mindmap_generator.generate_summary(transcript_text)
        
        return GenerateResponse(
            success=True,
            data={
                'video_id': video_id,
                'metadata': metadata,
                'mindmap': mindmap_result['mindmap'],
                'mindmap_structure': mindmap_result.get('structure', []),
                'flowchart': flowchart_result.get('flowchart', {}),
                'summary': summary_result,
                'timestamp': datetime.now().isoformat()
            }
        )
        
    except HTTPException as he:
        raise he
    except Exception as e:
        return GenerateResponse(
            success=False,
            error=str(e)
        )

@app.post("/api/export")
async export_mindmap(data: Dict[str, Any]):
    """Export mindmap/flowchart as JSON"""
    try:
        export_data = {
            'exported_at': datetime.now().isoformat(),
            **data
        }
        
        # Save to file (optional)
        filename = f"export_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        filepath = f"/tmp/{filename}"
        
        with open(filepath, 'w') as f:
            json.dump(export_data, f, indent=2)
        
        return FileResponse(
            filepath,
            media_type='application/json',
            filename=filename
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)