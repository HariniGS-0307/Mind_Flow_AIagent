// YouTube Transcript Fetcher & AI Content Generator
const state = {
  transcript: null,
  videoId: null,
  description: null,
  summary: null,
  mindmap: null,
  flowchart: null,
  apiKey: localStorage.getItem('geminiApiKey') || '',
  model: localStorage.getItem('geminiModel') || '',
};

// Initialize Mermaid
mermaid.initialize({ 
  startOnLoad: false, 
  theme: 'dark', 
  securityLevel: 'loose',
  themeVariables: {
    background: '#0f172a',
    primaryColor: '#6366f1',
    primaryTextColor: '#f8fafc',
    lineColor: '#8b5cf6',
    secondaryColor: '#312e81',
    tertiaryColor: '#1e1b4b'
  }
});

// DOM Elements
const videoUrlInput = document.getElementById('videoUrl');
const fetchBtn = document.getElementById('fetch');
const statusDiv = document.getElementById('status');
const loadingDiv = document.getElementById('loading');
const resultsSection = document.getElementById('results');
const apiKeyInput = document.getElementById('geminiApiKey');
const apiKeySection = document.getElementById('apiKeySection');
const tabButtons = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const modelSelect = document.getElementById('geminiModel');
const rateLimitBanner = document.getElementById('rateLimitBanner');
const rateLimitText = document.getElementById('rateLimitText');
const countdownTime = document.getElementById('countdownTime');
const generateOfflineBtn = document.getElementById('generateOfflineBtn');

// Check if API key is configured on server
let hasServerApiKey = false;
async function checkServerConfig() {
  try {
    const res = await fetch('/api/config');
    if (res.ok) {
      const data = await res.json();
      hasServerApiKey = data.hasApiKey;
      if (hasServerApiKey) {
        if (apiKeySection) apiKeySection.style.display = 'none';
      } else if (!state.apiKey) {
        if (apiKeySection) apiKeySection.style.display = 'block';
      }
      // Populate available models
      loadAvailableModels();
    }
  } catch (e) {
    console.error('Failed to load server config:', e);
  }
}
checkServerConfig();

// Initialize API key from localStorage
if (state.apiKey) {
  apiKeyInput.value = state.apiKey;
}

// Initialize Model from localStorage
if (state.model && modelSelect) {
  modelSelect.value = state.model;
}

let isModelsLoading = false;
async function loadAvailableModels() {
  const activeKey = state.apiKey || '';
  if (!activeKey && !hasServerApiKey) {
    return;
  }
  
  if (isModelsLoading) return;
  isModelsLoading = true;

  try {
    const url = `/api/list-models` + (activeKey ? `?apiKey=${encodeURIComponent(activeKey)}` : '');
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      const models = data.models || [];
      
      const currentSelection = modelSelect.value;
      
      modelSelect.innerHTML = `<option value="">Auto-Detect / Dynamic Failover (Recommended)</option>`;
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model;
        let displayName = model;
        if (model.includes('flash')) displayName = `${model} (Flash)`;
        if (model.includes('pro')) displayName = `${model} (Pro)`;
        option.textContent = displayName;
        modelSelect.appendChild(option);
      });
      
      if (models.includes(currentSelection)) {
        modelSelect.value = currentSelection;
      } else if (state.model && models.includes(state.model)) {
        modelSelect.value = state.model;
      }
    }
  } catch (e) {
    console.error('Failed to load model list:', e);
  } finally {
    isModelsLoading = false;
  }
}

// Simple debounce helper
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Event Listeners
fetchBtn.addEventListener('click', handleFetch);
document.getElementById('downloadBtn')?.addEventListener('click', downloadReport);
document.getElementById('newVideoBtn')?.addEventListener('click', resetApp);
generateOfflineBtn?.addEventListener('click', handleGenerateOffline);

async function handleGenerateOffline() {
  if (!state.transcript) {
    showStatus('⚠️ No transcript loaded. Please fetch a video first.', 'error');
    return;
  }
  
  // Clear countdown timer
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (rateLimitBanner) {
    rateLimitBanner.style.display = 'none';
  }
  fetchBtn.disabled = false;
  
  showLoading(true);
  showStatus('✨ Generating offline mock report and visual diagrams...', 'info');
  
  try {
    const transcriptText = state.transcript.transcript
      .map(t => t.text)
      .join(' ');
      
    const response = await fetch('/api/generate-mock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcriptText,
        videoTitle: state.transcript.title || 'YouTube Video'
      })
    });
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server Error: ${response.status}`);
    }
    
    const content = await response.json();
    
    state.description = content.description;
    state.summary = content.summary;
    state.mindmap = content.mindmap;
    state.flowchart = content.flowchart;
    
    showStatus('✓ Offline demo report generated! Click tabs to view or Download Report.', 'success');
    displayGeneratedContent();
  } catch (error) {
    console.error('Offline generation error:', error);
    showStatus(`❌ Failed to generate offline content: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

// Listen to API Key input directly to load models dynamically
apiKeyInput.addEventListener('input', debounce(() => {
  const apiKey = apiKeyInput.value.trim();
  localStorage.setItem('geminiApiKey', apiKey);
  state.apiKey = apiKey;
  loadAvailableModels();
}, 500));

// Listen to model selector changes
modelSelect.addEventListener('change', (e) => {
  const model = e.target.value;
  localStorage.setItem('geminiModel', model);
  state.model = model;
});

tabButtons.forEach(btn => {
  btn.addEventListener('click', (e) => {
    const tabName = e.target.dataset.tab;
    switchTab(tabName);
  });
});

document.getElementById('transcriptSearch')?.addEventListener('input', (e) => {
  searchTranscript(e.target.value);
});

// Main fetch handler
async function handleFetch() {
  const url = videoUrlInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!url) {
    showStatus('Enter a YouTube URL or video ID', 'error');
    return;
  }

  if (!apiKey && !hasServerApiKey) {
    showStatus('⚠️ Please enter your Gemini API key to generate summaries and diagrams', 'error');
    if (apiKeySection) {
      apiKeySection.style.display = 'block';
      apiKeySection.classList.add('pulse-border');
    }
    return;
  }

  // Save API key to localStorage if user entered one
  if (apiKey) {
    localStorage.setItem('geminiApiKey', apiKey);
    state.apiKey = apiKey;
  }

  resetUI();
  showLoading(true);
  showStatus('🔄 Extracting transcript from YouTube...', 'info');

  try {
    // Fetch transcript
    const response = await fetch(`/api/transcript?videoUrl=${encodeURIComponent(url)}`);
    
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(err.error || response.statusText);
    }

    const data = await response.json();
    state.transcript = data;
    state.videoId = data.videoId;

    showStatus(`✓ Transcript loaded (${data.transcript.length} segments) - Generating AI content...`, 'success');

    // Auto-generate AI content immediately
    await generateAIContent(apiKey);
  } catch (error) {
    showStatus(`❌ Error: ${error.message}`, 'error');
    showLoading(false);
  }
}

let countdownInterval = null;

function handleRateLimitError(message) {
  if (countdownInterval) clearInterval(countdownInterval);
  
  const match = message.match(/Please retry in ([\d.]+)s/);
  let retrySeconds = match ? parseFloat(match[1]) : 60.0;
  
  rateLimitBanner.style.display = 'flex';
  
  fetchBtn.disabled = true;
  
  const startTime = Date.now();
  const totalDuration = retrySeconds * 1000;
  
  countdownInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const remaining = Math.max(0, (totalDuration - elapsed) / 1000);
    
    countdownTime.textContent = `${remaining.toFixed(1)}s`;
    
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      rateLimitBanner.style.display = 'none';
      fetchBtn.disabled = false;
      showStatus('Rate limit cleared. Ready to retry.', 'info');
    }
  }, 100);
}

async function generateAIContent(apiKey) {
  try {
    // Clear any existing banners
    rateLimitBanner.style.display = 'none';
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    // Convert transcript to text
    const transcriptText = state.transcript.transcript
      .map(t => t.text)
      .join(' ');

    if (transcriptText.trim().length < 5) {
      throw new Error('Transcript is too short to analyze');
    }

    showLoading(true);
    showStatus('🤖 Generating AI summaries, mindmap & flowchart (15-20 seconds)...', 'info');

    // Call backend to generate content using Gemini
    const response = await fetch('/api/generate-content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcriptText,
        videoTitle: state.transcript.title || 'YouTube Video',
        apiKey: apiKey,
        model: state.model,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const errorMsg = err.error || `API Error: ${response.status}`;
      
      // If it's a quota or 429 rate limit error, trigger countdown
      if (errorMsg.includes('quota') || errorMsg.includes('429') || response.status === 429) {
        handleRateLimitError(errorMsg);
      }
      
      throw new Error(errorMsg);
    }

    const content = await response.json();
    
    if (!content.success && content.error) {
      throw new Error(content.error);
    }

    state.description = content.description || 'No description available';
    state.summary = content.summary && content.summary.length > 0 
      ? content.summary 
      : ['No key points available'];
    state.mindmap = content.mindmap || 'mindmap\n  root((Video Content))\n    Topics\n      Key Points';
    state.flowchart = content.flowchart || 'flowchart TD\n    A[Start] --> B[Process]\n    B --> C[End]';

    showStatus('✅ Content generated successfully!', 'success');
    displayGeneratedContent();
  } catch (error) {
    console.error('AI generation error:', error);
    if (rateLimitBanner && rateLimitBanner.style.display === 'flex') {
      showStatus(`⚠️ Rate limit active. Please wait for the countdown to complete before retrying.`, 'error');
    } else {
      showStatus(`❌ Failed to generate AI content: ${error.message}`, 'error');
    }
    displayBasicContent();
  } finally {
    showLoading(false);
  }
}

function displayBasicContent() {
  displayTranscript();
  resultsSection.style.display = 'block';
  switchTab('transcript');
}

function displayGeneratedContent() {
  if (state.description) displayDescription();
  if (state.summary && state.summary.length > 0) displaySummary();
  displayTranscript();
  resultsSection.style.display = 'block';
  switchTab('summary');
}

function displayDescription() {
  const descriptionContainer = document.getElementById('descriptionContainer');
  if (descriptionContainer) {
    descriptionContainer.innerHTML = `
      <div class="glass-card description-inner">
        <p>${state.description}</p>
      </div>`;
  }
}

function displaySummary() {
  if (!state.summary || state.summary.length === 0) return;

  const summaryList = document.getElementById('summaryList');
  summaryList.innerHTML = '';

  const points = Array.isArray(state.summary) ? state.summary : state.summary.split('\n').filter(p => p.trim());

  points.forEach((point, idx) => {
    const li = document.createElement('li');
    li.className = 'summary-item';
    const cleanPoint = point.replace(/^[-•*]\s*/, '').trim();
    li.innerHTML = `<span class="bullet-icon">✦</span> <span class="bullet-text">${cleanPoint}</span>`;
    li.style.animationDelay = `${idx * 0.05}s`;
    summaryList.appendChild(li);
  });
}

function displayMindmap() {
  if (!state.mindmap) return;

  const container = document.getElementById('mindmapContainer');
  if (!container) return;

  // Re-create the mindmap diagram div freshly to clear previous render states and attributes
  container.innerHTML = `
    <div class="diagram-controls">
      <button class="btn btn-sm btn-icon" onclick="copyMermaidCode('mindmap')">📋 Copy Mermaid Code</button>
    </div>
    <div id="mindmapDiagram" class="mermaid">${state.mindmap}</div>
  `;
  
  try {
    mermaid.init(undefined, container.querySelectorAll('#mindmapDiagram'));
  } catch (e) {
    console.error('Mermaid mindmap render error:', e);
    container.innerHTML += `<div class="render-error">⚠️ Mermaid Render Error. Try re-generating or copy code manually.</div>`;
  }
}

function displayFlowchart() {
  if (!state.flowchart) return;

  const container = document.getElementById('flowchartContainer');
  if (!container) return;

  // Re-create the flowchart diagram div freshly to clear previous render states
  container.innerHTML = `
    <div class="diagram-controls">
      <button class="btn btn-sm btn-icon" onclick="copyMermaidCode('flowchart')">📋 Copy Mermaid Code</button>
    </div>
    <div id="flowchartDiagram" class="mermaid">${state.flowchart}</div>
  `;
  
  try {
    mermaid.init(undefined, container.querySelectorAll('#flowchartDiagram'));
  } catch (e) {
    console.error('Mermaid flowchart render error:', e);
    container.innerHTML += `<div class="render-error">⚠️ Mermaid Render Error. Try re-generating or copy code manually.</div>`;
  }
}

function displayTranscript() {
  const transcriptContent = document.getElementById('transcriptContent');
  if (state.transcript && state.transcript.transcript) {
    const limited = state.transcript.transcript;
    
    // Create elements instead of raw pre formatting for better visual appearance
    transcriptContent.innerHTML = '';
    
    limited.forEach(t => {
      const segmentDiv = document.createElement('div');
      segmentDiv.className = 'transcript-segment';
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'timestamp-badge';
      timeSpan.textContent = formatTime(t.start);
      
      const textSpan = document.createElement('span');
      textSpan.className = 'segment-text';
      textSpan.textContent = t.text;
      
      segmentDiv.appendChild(timeSpan);
      segmentDiv.appendChild(textSpan);
      transcriptContent.appendChild(segmentDiv);
    });
  }
}

function searchTranscript(query) {
  const transcriptContent = document.getElementById('transcriptContent');
  if (!state.transcript) return;

  if (!query.trim()) {
    displayTranscript();
    return;
  }

  const queryLower = query.toLowerCase();
  const filtered = state.transcript.transcript.filter(t => t.text.toLowerCase().includes(queryLower));

  transcriptContent.innerHTML = '';
  if (filtered.length === 0) {
    transcriptContent.innerHTML = '<div style="padding: 1.5rem; text-align: center; color: var(--text-muted);">No matching segments found</div>';
    return;
  }

  filtered.forEach(t => {
    const segmentDiv = document.createElement('div');
    segmentDiv.className = 'transcript-segment';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'timestamp-badge';
    timeSpan.textContent = formatTime(t.start);
    
    const textSpan = document.createElement('span');
    textSpan.className = 'segment-text';
    
    // Highlight query text
    const reg = new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    textSpan.innerHTML = t.text.replace(reg, '<mark class="highlight">$1</mark>');
    
    segmentDiv.appendChild(timeSpan);
    segmentDiv.appendChild(textSpan);
    transcriptContent.appendChild(segmentDiv);
  });
}

// Copy Mermaid code helper helper
window.copyMermaidCode = function(type) {
  const code = type === 'mindmap' ? state.mindmap : state.flowchart;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => {
    showStatus('✓ Mermaid code copied to clipboard!', 'success');
  }).catch(err => {
    console.error('Copy failed:', err);
    showStatus('❌ Failed to copy code', 'error');
  });
};

function switchTab(tabName) {
  // Update buttons
  tabButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update content
  tabContents.forEach(content => {
    content.classList.toggle('active', content.id === tabName);
  });

  // Re-render mermaid specifically on tab switch to avoid dimensions issues
  if (tabName === 'mindmap') {
    setTimeout(displayMindmap, 50);
  } else if (tabName === 'flowchart') {
    setTimeout(displayFlowchart, 50);
  }
}

async function downloadReport() {
  if (!state.transcript) return;

  const downloadBtn = document.getElementById('downloadBtn');
  downloadBtn.disabled = true;
  downloadBtn.textContent = '📥 Generating...';

  try {
    const response = await fetch('/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoTitle: state.transcript.title,
        author: state.transcript.author,
        description: state.description || 'No description generated',
        summary: state.summary || [],
        transcript: state.transcript.transcript
          .map(t => `[${formatTime(t.start)}] ${t.text}`)
          .join('\n'),
      }),
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    // Download file
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.videoId}-report.docx`;
    a.click();
    URL.revokeObjectURL(url);

    showStatus('✓ Report downloaded successfully!', 'success');
  } catch (error) {
    showStatus(`Download failed: ${error.message}`, 'error');
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = '📥 Download Report (.docx)';
  }
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h ? h + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status-message ${type}`;
  statusDiv.style.display = 'block';
  
  // Auto-hide success/info messages after 5 seconds
  if (type === 'success' || type === 'info') {
    setTimeout(() => {
      if (statusDiv.className.includes(type)) {
        statusDiv.style.display = 'none';
      }
    }, 5000);
  }
}

function showLoading(show) {
  loadingDiv.style.display = show ? 'flex' : 'none';
  fetchBtn.disabled = show;
}

function resetUI() {
  statusDiv.textContent = '';
  resultsSection.style.display = 'none';
  if (apiKeySection) {
    apiKeySection.classList.remove('pulse-border');
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (rateLimitBanner) {
    rateLimitBanner.style.display = 'none';
  }
  fetchBtn.disabled = false;
}

function resetApp() {
  state.transcript = null;
  state.description = null;
  state.summary = null;
  state.mindmap = null;
  state.flowchart = null;
  videoUrlInput.value = '';
  resetUI();
  videoUrlInput.focus();
}
