import json
import re
import urllib.request
from typing import Dict, Any
from config import Config


class MindMapGenerator:
    def __init__(self):
        self.api_key = Config.OPENAI_API_KEY
        self.model = Config.MODEL_NAME

    def _chat(self, prompt: str) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": "You are a helpful assistant. Respond with valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            "temperature": Config.TEMPERATURE,
            "response_format": {"type": "json_object"},
        }
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"]["content"]

    def generate_mindmap(self, transcript: str, video_title: str = "Video Content") -> Dict[str, Any]:
        prompt = f"""
Create a structured mind map from this transcript.

Title: {video_title}

Transcript:
{transcript[:12000]}

Return ONLY valid JSON in this format:

{{
  "name": "Main Topic",
  "children": [
    {{
      "name": "Category",
      "children": [
        {{"name": "Subtopic"}},
        {{"name": "Key Point"}}
      ]
    }}
  ]
}}
"""
        try:
            text = self._chat(prompt)
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            data = json.loads(json_match.group() if json_match else text)
            return {
                "success": True,
                "mindmap": data,
                "structure": self._flatten_structure(data),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def generate_flowchart(self, transcript: str, video_title: str = "Video Content"):
        prompt = f"""
Create a flowchart from this transcript.

Return ONLY JSON:

{{
  "title": "Process",
  "nodes": [
    {{"id": 1, "label": "Start", "type": "start"}}
  ],
  "edges": [
    {{"from": 1, "to": 2, "label": "next"}}
  ]
}}

Transcript:
{transcript[:10000]}
"""
        try:
            text = self._chat(prompt)
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            data = json.loads(json_match.group() if json_match else text)
            return {"success": True, "flowchart": data}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def generate_summary(self, transcript: str):
        prompt = f"""
Summarize into 5 bullet points and key takeaway.

Return JSON:
{{
  "title": "Video Summary",
  "key_points": ["", "", "", "", ""],
  "takeaway": ""
}}

Transcript:
{transcript[:8000]}
"""
        try:
            text = self._chat(prompt)
            json_match = re.search(r'\{.*\}', text, re.DOTALL)
            return json.loads(json_match.group() if json_match else text)
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _flatten_structure(self, node, level=0):
        flat = []

        if isinstance(node, dict) and "name" in node:
            flat.append({
                "name": node["name"],
                "level": level,
            })

        if isinstance(node, dict) and "children" in node:
            for child in node["children"]:
                flat.extend(self._flatten_structure(child, level + 1))

        return flat
