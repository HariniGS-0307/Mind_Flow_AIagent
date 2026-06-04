import openai
import json
import re
from typing import Dict, Any, List
from config import Config

class MindMapGenerator:
    def __init__(self):
        openai.api_key = Config.OPENAI_API_KEY
    
    def generate_mindmap(self, transcript: str, video_title: str = "Video Content") -> Dict[str, Any]:
        """Generate hierarchical mind map from transcript"""
        
        prompt = f"""
        Analyze this YouTube video transcript and create a structured mind map.
        
        Video: {video_title}
        
        Transcript (excerpt): {transcript[:12000]}
        
        Create a hierarchical structure with:
        1. Main topic as root
        2. 4-8 major categories
        3. 2-5 subtopics per category
        4. Key points as leaves (brief, 3-7 words each)
        
        Format as JSON:
        {{
            "name": "Main Topic",
            "children": [
                {{
                    "name": "Category 1",
                    "children": [
                        {{"name": "Subtopics"}},
                        {{"name": "Key points"}}
                    ]
                }}
            ]
        }}
        
        Make it educational and well-organized.
        """
        
        try:
            response = openai.ChatCompletion.create(
                model=Config.MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You are an expert at creating structured mind maps from educational content."},
                    {"role": "user", "content": prompt}
                ],
                temperature=Config.TEMPERATURE
            )
            
            mindmap_json = response.choices[0].message.content
            # Extract JSON from response
            json_match = re.search(r'\{.*\}', mindmap_json, re.DOTALL)
            if json_match:
                mindmap_data = json.loads(json_match.group())
            else:
                mindmap_data = json.loads(mindmap_json)
            
            return {
                'success': True,
                'mindmap': mindmap_data,
                'structure': self._flatten_structure(mindmap_data)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def generate_flowchart(self, transcript: str, video_title: str = "Video Content") -> Dict[str, Any]:
        """Generate flowchart from transcript"""
        
        prompt = f"""
        Based on this video transcript, create a process flowchart.
        
        Video: {video_title}
        
        Transcript: {transcript[:10000]}
        
        Identify the main process or sequence of steps.
        Format as JSON:
        {{
            "title": "Process Name",
            "nodes": [
                {{"id": 1, "label": "Step 1", "type": "start"}},
                {{"id": 2, "label": "Decision Point?", "type": "decision"}},
                {{"id": 3, "label": "Action", "type": "process"}}
            ],
            "edges": [
                {{"from": 1, "to": 2, "label": "yes"}},
                {{"from": 2, "to": 3, "label": "no"}}
            ]
        }}
        
        Include 5-10 steps with logical flow.
        """
        
        try:
            response = openai.ChatCompletion.create(
                model=Config.MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You create clear, logical flowcharts from video content."},
                    {"role": "user", "content": prompt}
                ],
                temperature=Config.TEMPERATURE
            )
            
            flowchart_json = response.choices[0].message.content
            json_match = re.search(r'\{.*\}', flowchart_json, re.DOTALL)
            if json_match:
                flowchart_data = json.loads(json_match.group())
            else:
                flowchart_data = json.loads(flowchart_json)
            
            return {
                'success': True,
                'flowchart': flowchart_data
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
    
    def _flatten_structure(self, mindmap_data: Dict, level: int = 0) -> List[Dict]:
        """Convert hierarchical mindmap to flat structure for display"""
        flat = []
        if 'name' in mindmap_data:
            flat.append({
                'name': mindmap_data['name'],
                'level': level,
                'children_count': len(mindmap_data.get('children', []))
            })
        
        if 'children' in mindmap_data:
            for child in mindmap_data['children']:
                flat.extend(self._flatten_structure(child, level + 1))
        
        return flat

    def generate_summary(self, transcript: str) -> Dict[str, Any]:
        """Generate executive summary of the video"""
        
        prompt = f"""
        Create an executive summary of this video transcript in 5 bullet points.
        
        Transcript: {transcript[:8000]}
        
        Format as JSON:
        {{
            "title": "Video Title (inferred)",
            "duration_summary": "Brief description",
            "key_points": ["point 1", "point 2", ...],
            "takeaway": "One sentence main takeaway"
        }}
        """
        
        try:
            response = openai.ChatCompletion.create(
                model=Config.MODEL_NAME,
                messages=[
                    {"role": "system", "content": "You create concise, informative summaries."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2
            )
            
            summary_json = response.choices[0].message.content
            json_match = re.search(r'\{.*\}', summary_json, re.DOTALL)
            if json_match:
                return json.loads(json_match.group())
            else:
                return json.loads(summary_json)
                
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }