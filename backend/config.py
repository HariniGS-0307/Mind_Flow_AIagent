import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
    MAX_TRANSCRIPT_LENGTH = 15000
    MODEL_NAME = "gpt-3.5-turbo"
    TEMPERATURE = 0.3