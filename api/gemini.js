import { GoogleGenerativeAI } from '@google/generative-ai';
import fetch from 'node-fetch';

const PREFERRED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.5-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-1.5-pro',
  'gemini-pro',
];

let cachedValidation = null;
let cachedValidationKey = null;
let cachedModels = null;
let cachedModelsKey = null;

export function normalizeApiKey(key) {
  return String(key || '').trim().replace(/^['"]|['"]$/g, '');
}

export function getInvalidKeyHelp(key) {
  if (key.startsWith('AQ.')) {
    return 'Your GEMINI_API_KEY (AQ. format) is rejected by Google. Create a fresh key at https://aistudio.google.com/apikey — click "Create API key", pick a project, and paste the full key into Vercel → Settings → Environment Variables → GEMINI_API_KEY, then redeploy.';
  }
  return 'Your GEMINI_API_KEY is invalid or expired. Create a new key at https://aistudio.google.com/apikey, update it in Vercel → Settings → Environment Variables, then redeploy.';
}

export async function validateGeminiApiKey(apiKey) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    return { valid: false, error: 'GEMINI_API_KEY is not set' };
  }

  if (cachedValidation && cachedValidationKey === key) {
    return cachedValidation;
  }

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent('Reply with OK');
    const text = result.response.text();
    const validation = { valid: !!text?.trim(), keyFormat: key.startsWith('AIza') ? 'legacy' : key.startsWith('AQ.') ? 'aq' : 'other' };
    cachedValidation = validation;
    cachedValidationKey = key;
    return validation;
  } catch (error) {
    const msg = error.message || 'Unknown error';
    const validation = {
      valid: false,
      error: msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('invalid')
        ? getInvalidKeyHelp(key)
        : msg,
      keyFormat: key.startsWith('AIza') ? 'legacy' : key.startsWith('AQ.') ? 'aq' : 'other',
    };
    cachedValidation = validation;
    cachedValidationKey = key;
    return validation;
  }
}

export async function getAvailableModels(apiKey) {
  const key = normalizeApiKey(apiKey);
  if (cachedModels && cachedModelsKey === key) {
    return cachedModels;
  }

  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': key },
    });

    if (response.ok) {
      const data = await response.json();
      const compatible = (data.models || [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.split('/').pop())
        .sort((a, b) => {
          const idxA = PREFERRED_MODELS.indexOf(a);
          const idxB = PREFERRED_MODELS.indexOf(b);
          if (idxA !== -1 && idxB !== -1) return idxA - idxB;
          if (idxA !== -1) return -1;
          if (idxB !== -1) return 1;
          return a.localeCompare(b);
        });

      if (compatible.length > 0) {
        cachedModels = compatible;
        cachedModelsKey = key;
        return compatible;
      }
    }
  } catch (err) {
    console.error('Error listing models:', err.message);
  }

  return [...PREFERRED_MODELS];
}

export async function generateWithGemini(apiKey, prompt, preferredModel = null, retries = 3) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    throw new Error('Gemini API key required');
  }

  const availableModels = await getAvailableModels(key);
  const modelsToTry = [];
  if (preferredModel && availableModels.includes(preferredModel)) {
    modelsToTry.push(preferredModel);
  }
  for (const model of availableModels) {
    if (!modelsToTry.includes(model)) modelsToTry.push(model);
  }
  if (modelsToTry.length === 0) {
    modelsToTry.push(...PREFERRED_MODELS);
  }

  const genAI = new GoogleGenerativeAI(key);
  let lastError = null;

  for (const modelName of modelsToTry) {
    const model = genAI.getGenerativeModel({ model: modelName });

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
          },
        });

        const text = result.response.text();
        if (!text?.trim()) {
          throw new Error('Empty response from Gemini API');
        }

        console.log(`🎯 Successfully generated content using model: ${modelName}`);
        return text;
      } catch (error) {
        const msg = error.message || '';
        console.error(`Gemini error (${modelName}, attempt ${attempt + 1}):`, msg);
        lastError = error;

        if (msg.includes('401') || msg.includes('UNAUTHENTICATED') || msg.includes('API key not valid')) {
          throw new Error(getInvalidKeyHelp(key));
        }

        const lower = msg.toLowerCase();
        if (!lower.includes('quota') && !lower.includes('429') && !lower.includes('rate limit')) {
          if (!lower.includes('not found') && !lower.includes('404')) {
            break;
          }
        }

        if (lower.includes('quota') || lower.includes('429')) {
          const retryMatch = msg.match(/Please retry in ([\d.]+)s/);
          if (retryMatch) {
            const retrySeconds = parseFloat(retryMatch[1]);
            if (retrySeconds < 5 && attempt < retries - 1) {
              await new Promise(r => setTimeout(r, retrySeconds * 1000 + 500));
              continue;
            }
            break;
          }
          if (attempt < retries - 1) {
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
        }
      }
    }
  }

  throw lastError || new Error('All available Gemini models failed');
}
