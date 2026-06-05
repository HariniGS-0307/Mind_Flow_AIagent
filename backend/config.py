import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    MAX_TRANSCRIPT_LENGTH = 15000
    MODEL_NAME = "gpt-4o-mini"
    TEMPERATURE = 0.3