import fetch from 'node-fetch';

const OPENAI_BASE = 'https://api.openai.com/v1';

const PREFERRED_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4-turbo',
  'gpt-3.5-turbo',
];

let cachedValidation = null;
let cachedValidationKey = null;
let cachedModels = null;
let cachedModelsKey = null;

export function normalizeApiKey(key) {
  return String(key || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\r?\n/g, '')
    .replace(/\s+/g, '');
}

export function detectKeyFormat(key) {
  if (!key) return 'missing';
  if (key.startsWith('sk-')) return 'openai';
  if (/your_|placeholder|example|xxx/i.test(key)) return 'placeholder';
  return 'other';
}

export function getInvalidKeyHelp(key) {
  const format = detectKeyFormat(key);

  if (format === 'placeholder') {
    return 'OPENAI_API_KEY is still set to a placeholder. Create a key at https://platform.openai.com/api-keys and paste it into Vercel → Settings → Environment Variables → OPENAI_API_KEY (no quotes), then redeploy.';
  }

  if (format === 'other') {
    return 'OPENAI_API_KEY does not look valid (expected sk-...). Get a key at https://platform.openai.com/api-keys, paste the full value into Vercel → OPENAI_API_KEY without quotes, then redeploy.';
  }

  return 'Your OPENAI_API_KEY is invalid or expired. Create a new key at https://platform.openai.com/api-keys, update Vercel → Settings → Environment Variables → OPENAI_API_KEY (no quotes), then redeploy once.';
}

function isAuthError(status, bodyText = '') {
  const lower = bodyText.toLowerCase();
  return (
    status === 401 ||
    status === 403 ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key') ||
    lower.includes('invalid_api_key') ||
    lower.includes('authentication') ||
    lower.includes('permission denied')
  );
}

function extractChatText(data) {
  return data?.choices?.[0]?.message?.content?.trim() || '';
}

async function openaiFetch(path, key, options = {}) {
  const response = await fetch(`${OPENAI_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });

  const bodyText = await response.text();
  let data = null;
  try {
    data = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    data = null;
  }

  return { response, data, bodyText };
}

export async function validateOpenAIApiKey(apiKey) {
  const key = normalizeApiKey(apiKey);
  const keyFormat = detectKeyFormat(key);

  if (!key) {
    return { valid: false, error: 'OPENAI_API_KEY is not set', keyFormat: 'missing' };
  }

  if (keyFormat === 'placeholder' || keyFormat === 'other') {
    return { valid: false, error: getInvalidKeyHelp(key), keyFormat };
  }

  if (cachedValidation?.valid && cachedValidationKey === key) {
    return cachedValidation;
  }

  try {
    const { response, data, bodyText } = await openaiFetch('/chat/completions', key, {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Reply with OK' }],
        max_tokens: 8,
      }),
    });

    if (response.ok) {
      const text = extractChatText(data);
      const validation = { valid: !!text, keyFormat };
      cachedValidation = validation;
      cachedValidationKey = key;
      return validation;
    }

    if (isAuthError(response.status, bodyText)) {
      return { valid: false, error: getInvalidKeyHelp(key), keyFormat };
    }

    const apiMessage = data?.error?.message || bodyText || `HTTP ${response.status}`;
    return { valid: false, error: apiMessage, keyFormat };
  } catch (error) {
    return {
      valid: false,
      error: error.message || 'Failed to validate OpenAI API key',
      keyFormat,
    };
  }
}

export async function getAvailableModels(apiKey) {
  const key = normalizeApiKey(apiKey);
  if (cachedModels && cachedModelsKey === key) {
    return cachedModels;
  }

  try {
    const { response, data } = await openaiFetch('/models', key, { method: 'GET' });

    if (response.ok) {
      const compatible = (data.data || [])
        .map(m => m.id)
        .filter(id => /^gpt-/.test(id) && !id.includes('instruct') && !id.includes('realtime') && !id.includes('audio'))
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
    console.error('Error listing OpenAI models:', err.message);
  }

  return [...PREFERRED_MODELS];
}

async function generateWithModelRest(key, modelName, prompt) {
  const { response, data, bodyText } = await openaiFetch('/chat/completions', key, {
    method: 'POST',
    body: JSON.stringify({
      model: modelName,
      messages: [
        {
          role: 'system',
          content: 'You are a professional educational content summarizer. Always respond with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    }),
  });

  if (isAuthError(response.status, bodyText)) {
    throw new Error(getInvalidKeyHelp(key));
  }

  if (!response.ok) {
    const apiMessage = data?.error?.message || bodyText || `HTTP ${response.status}`;
    throw new Error(apiMessage);
  }

  const text = extractChatText(data);
  if (!text) {
    throw new Error('Empty response from OpenAI API');
  }

  return text;
}

export async function generateWithOpenAI(apiKey, prompt, preferredModel = null, retries = 3) {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    throw new Error('OpenAI API key required');
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

  let lastError = null;

  for (const modelName of modelsToTry) {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const text = await generateWithModelRest(key, modelName, prompt);
        console.log(`Successfully generated content using model: ${modelName}`);
        return text;
      } catch (error) {
        const msg = error.message || '';
        console.error(`OpenAI error (${modelName}, attempt ${attempt + 1}):`, msg);
        lastError = error;

        if (msg.includes('OPENAI_API_KEY') || isAuthError(0, msg)) {
          throw error;
        }

        const lower = msg.toLowerCase();
        if (!lower.includes('quota') && !lower.includes('429') && !lower.includes('rate limit')) {
          if (!lower.includes('not found') && !lower.includes('does not exist')) {
            break;
          }
        }

        if (lower.includes('quota') || lower.includes('429') || lower.includes('rate limit')) {
          const retryMatch = msg.match(/try again in ([\d.]+)s/i);
          if (retryMatch) {
            const retrySeconds = parseFloat(retryMatch[1]);
            if (retrySeconds < 10 && attempt < retries - 1) {
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

  throw lastError || new Error('All available OpenAI models failed');
}
