import express from 'express';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, BorderStyle, AlignmentType, WidthType, HeadingLevel } from 'docx';
import { existsSync, readFileSync } from 'fs';
import transcriptHandler from './api/transcript.js';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Custom lightweight parser for .env files
if (existsSync('.env')) {
  try {
    const envContent = readFileSync('.env', 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const index = trimmed.indexOf('=');
      if (index > 0) {
        const key = trimmed.substring(0, index).trim();
        const value = trimmed.substring(index + 1).trim().replace(/^['"]|['"]$/g, '');
        process.env[key] = value;
      }
    });
    console.log('📝 Successfully loaded environment variables from .env file.');
  } catch (err) {
    console.error('⚠️ Failed to load .env file:', err);
  }
}

const isVercel = process.env.VERCEL === '1';

function getGeminiApiKey(userKey) {
  return userKey || process.env.GEMINI_API_KEY || '';
}

// MongoDB connection (cached for Vercel serverless)
let isDbConnected = false;
const connectDB = async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.log('⚠️ No MONGODB_URI or MONGO_URI environment variable found. Database integration is disabled.');
    return false;
  }
  try {
    if (mongoose.connection.readyState >= 1) {
      isDbConnected = true;
      return true;
    }
    await mongoose.connect(uri, {
      dbName: 'youtube-mindmaps',
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
    });
    isDbConnected = true;
    console.log('✅ Connected to MongoDB successfully.');
    return true;
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    isDbConnected = false;
    return false;
  }
};

const dbReady = connectDB();

// MindMap Schema & Model
const mindMapSchema = new mongoose.Schema({
  videoId: { type: String, required: true },
  title: { type: String, required: true },
  author: { type: String },
  description: { type: String },
  summary: [String],
  mindmap: { type: String },
  flowchart: { type: String },
  createdAt: { type: Date, default: Date.now }
});
const MindMap = mongoose.models.MindMap || mongoose.model('MindMap', mindMapSchema);

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb' }));
app.use(express.static(join(__dirname, 'public')));

// API Routes
app.get('/api/transcript', async (req, res) => {
  try {
    await transcriptHandler(req, res);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Config Endpoint to share key status with frontend
app.get('/api/config', async (req, res) => {
  if (!isDbConnected && (process.env.MONGODB_URI || process.env.MONGO_URI)) {
    await dbReady;
  }
  res.json({
    hasApiKey: !!process.env.GEMINI_API_KEY,
    isDbConnected,
    environment: isVercel ? 'vercel' : 'local',
  });
});

// Diagnostic endpoint to check available models for the API key
app.get('/api/list-models', async (req, res) => {
  try {
    const apiKey = getGeminiApiKey(req.query.apiKey);
    if (!apiKey) {
      return res.status(400).json({ error: 'GEMINI_API_KEY environment variable is not configured' });
    }
    const models = await getAvailableModels(apiKey);
    res.json({ models });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// Generate content with Gemini API (Combined single-call optimization to prevent rate limits)
app.post('/api/generate-content', async (req, res) => {
  try {
    const { transcript, videoTitle, apiKey, model, videoId } = req.body;
    const activeApiKey = getGeminiApiKey(apiKey);

    if (!activeApiKey) {
      return res.status(400).json({
        error: 'Gemini API key required. Set GEMINI_API_KEY in Vercel environment variables or enter your key in the app.',
      });
    }

    if (!transcript || transcript.trim().length < 5) {
      return res.status(400).json({ error: 'Transcript too short or empty' });
    }

    // Limit transcript for API call
    const shortTranscript = transcript.substring(0, 15000);

    const combinedPrompt = `You are a professional educational content summarizer and visual diagram designer.
Analyze the following YouTube video transcript and generate a structured JSON object containing a description, summary points, a mindmap, and a flowchart.

Video Title: ${videoTitle}
Transcript/Content: ${shortTranscript}

You MUST return your output as a valid JSON object matching the following schema:
{
  "description": "A brief 2-3 sentence professional summary description of the video. If the video is very short, make it 1-2 sentences.",
  "summary": [
    "A clear, concise, one-sentence key point/takeaway (up to 7 points, fewer if the video is extremely short)."
  ],
  "mindmap": "A valid Mermaid mindmap syntax string. Rules: Start with 'mindmap' keyword. Include a root node. Avoid colons, brackets, or parentheses in node labels unless the label is enclosed in double quotes e.g. Node[\\\"Label (detail)\\\"]. Keep node labels short (1-3 words). Make the mindmap hierarchy match the video complexity (2-3 branches for short/simple videos, 4-6 branches for complex ones).",
  "flowchart": "A valid Mermaid flowchart string. Rules: Use 'flowchart TD' syntax. Show 3-8 sequential steps in logical order. Nodes MUST be formatted exactly as NodeID[\\\"Step Text\\\"] with double quotes around the label to prevent parsing errors. Connect steps with --> arrows."
}

Ensure your response is valid JSON and contains only the JSON object. Do not wrap it in markdown backticks.`;

    console.log('Sending single optimized API call to Gemini...');
    const rawResponse = await callGeminiAPI(activeApiKey, combinedPrompt, model, 3);
    
    // Parse JSON safely
    const parsedData = parseJsonResponse(rawResponse);
    if (!parsedData) {
      throw new Error('Failed to generate structured data from Gemini');
    }

    const sanitizedMindmap = sanitizeMermaidDiagram(parsedData.mindmap, 'mindmap');
    const sanitizedFlowchart = sanitizeMermaidDiagram(parsedData.flowchart, 'flowchart');
    const parsedSummary = Array.isArray(parsedData.summary) ? parsedData.summary : parseSummaryPoints(parsedData.summary);
    const cleanDescription = (parsedData.description || '').trim();

    // Fetch metadata from youtube first if not fully passed
    const oembedResponse = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`).catch(() => null);
    let authorName = 'Unknown';
    if (oembedResponse && oembedResponse.ok) {
      const oembedData = await oembedResponse.json().catch(() => ({}));
      authorName = oembedData.author_name || 'Unknown';
    }

    // Save successfully generated content to MongoDB
    if (isDbConnected && videoId) {
      try {
        await MindMap.findOneAndUpdate(
          { videoId },
          {
            videoId,
            title: videoTitle,
            author: authorName,
            description: cleanDescription,
            summary: parsedSummary,
            mindmap: sanitizedMindmap,
            flowchart: sanitizedFlowchart,
            createdAt: new Date()
          },
          { upsert: true, new: true }
        );
        console.log('💾 Successfully saved generated mindmap to database.');
      } catch (dbErr) {
        console.error('⚠️ Failed to save mindmap to database:', dbErr.message);
      }
    }

    res.json({
      success: true,
      description: cleanDescription,
      summary: parsedSummary,
      mindmap: sanitizedMindmap,
      flowchart: sanitizedFlowchart,
    });
  } catch (error) {
    console.error('Generate content error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate offline/mock content when API keys are rate-limited or unavailable
app.post('/api/generate-mock', async (req, res) => {
  try {
    const { transcript, videoTitle, videoId } = req.body;
    
    if (!transcript || transcript.trim().length < 5) {
      return res.status(400).json({ error: 'Transcript too short or empty' });
    }

    const cleanTranscript = transcript.replace(/\[[\d:]+\]/g, '').trim();

    let sentences = cleanTranscript
      .split(/[.!?\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 8 && !/^\(.*\)$/.test(s))
      .slice(0, 7);

    if (sentences.length <= 1 && cleanTranscript.length > 20) {
      const words = cleanTranscript.split(/\s+/).filter(Boolean);
      const chunkSize = Math.max(4, Math.ceil(words.length / 4));
      sentences = [];
      for (let i = 0; i < words.length; i += chunkSize) {
        const chunk = words.slice(i, i + chunkSize).join(' ');
        if (chunk.length > 8) sentences.push(chunk);
      }
    }

    const summaryPoints = sentences.length > 0
      ? sentences.map(s => {
          const capped = s.charAt(0).toUpperCase() + s.slice(1);
          return capped.endsWith('.') ? capped : capped + '.';
        })
      : [
          `The video "${videoTitle || 'content'}" covers its main topic in a brief format.`,
          'Key ideas were extracted directly from the available transcript.',
          'Visual diagrams below reflect the structure of the spoken content.',
        ];

    const cleanTitle = (videoTitle || 'YouTube Video')
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim();
    const titleWords = cleanTitle.split(' ').filter(w => w.length > 2).slice(0, 4);
    const rootNode = titleWords.join(' ') || 'Video Content';

    const topicWords = cleanTranscript
      .split(/\s+/)
      .map(w => w.replace(/[^a-zA-Z]/g, ''))
      .filter(w => w.length > 4)
      .slice(0, 6);

    const branchA = topicWords[0] || 'Introduction';
    const branchB = topicWords[1] || 'Main Topic';
    const branchC = topicWords[2] || 'Conclusion';

    const mockDescription = sentences.length > 0
      ? `This video "${videoTitle || 'discusses'}" ${sentences[0].toLowerCase()}${sentences.length > 1 ? ` It also covers ${sentences.slice(1, 3).join(' ').toLowerCase()}` : ''}.`
      : `A structured summary of "${videoTitle || 'the video'}" generated from the available transcript content.`;

    const mockMindmap = `mindmap\n  root(("${rootNode}"))\n    ${branchA}\n      Key Point 1\n      Key Point 2\n    ${branchB}\n      Details\n      Examples\n    ${branchC}\n      Summary\n      Takeaways`;
    const mockFlowchart = sentences.length >= 2
      ? sentences.slice(0, Math.min(sentences.length, 5)).map((s, i) => {
          const label = s.replace(/"/g, "'").substring(0, 50);
          const id = String.fromCharCode(65 + i);
          const nextId = String.fromCharCode(65 + i + 1);
          const arrow = i < Math.min(sentences.length, 5) - 1 ? `    ${id} --> ${nextId}\n` : '';
          return `    ${id}["${label}"]\n${arrow}`;
        }).join('')
      : `flowchart TD\n    A["Introduction"] --> B["Main Content"]\n    B --> C["Conclusion"]`;

    const formattedFlowchart = mockFlowchart.startsWith('flowchart')
      ? mockFlowchart
      : `flowchart TD\n${mockFlowchart}`;

    // Save mock content to database
    if (isDbConnected && videoId) {
      try {
        await MindMap.findOneAndUpdate(
          { videoId },
          {
            videoId,
            title: videoTitle || 'Offline Demo Video',
            author: 'Offline Generator',
            description: mockDescription,
            summary: summaryPoints,
            mindmap: mockMindmap,
            flowchart: formattedFlowchart,
            createdAt: new Date()
          },
          { upsert: true, new: true }
        );
        console.log('💾 Successfully saved offline mindmap to database.');
      } catch (dbErr) {
        console.error('⚠️ Failed to save offline mindmap to database:', dbErr.message);
      }
    }

    res.json({
      success: true,
      description: mockDescription,
      summary: summaryPoints,
      mindmap: mockMindmap,
      flowchart: formattedFlowchart
    });
  } catch (error) {
    console.error('Generate mock error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get history of saved mindmaps
app.get('/api/history', async (req, res) => {
  try {
    if (!isDbConnected) {
      return res.json({ success: true, history: [] });
    }
    const history = await MindMap.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('videoId title author createdAt');
    res.json({ success: true, history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get detailed saved mindmap by videoId
app.get('/api/history/:videoId', async (req, res) => {
  try {
    if (!isDbConnected) {
      return res.status(400).json({ error: 'Database not connected' });
    }
    const saved = await MindMap.findOne({ videoId: req.params.videoId });
    if (!saved) {
      return res.status(404).json({ error: 'Mindmap not found' });
    }
    res.json({ success: true, data: saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper to safely parse JSON from model responses
function parseJsonResponse(text) {
  if (!text) return null;
  let cleaned = text.trim();
  
  // Extract JSON from markdown code block if present
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/i);
  if (jsonMatch) {
    cleaned = jsonMatch[1].trim();
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse JSON response:', e, 'Cleaned text:', cleaned);
    const braceMatch = cleaned.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        return JSON.parse(braceMatch[0]);
      } catch (err) {
        console.error('Brace matching JSON parse failed:', err);
      }
    }
    throw e;
  }
}


let resolvedModel = null;
let resolvedModelKey = null;
let resolvedModelsList = null;
let resolvedModelsListKey = null;

// Get available compatible models for the API Key
async function getAvailableModels(apiKey) {
  if (resolvedModelsList && resolvedModelsListKey === apiKey) {
    return resolvedModelsList;
  }
  
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
    if (response.ok) {
      const data = await response.json();
      const models = data.models || [];
      
      const preferences = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
        'gemini-pro',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest'
      ];
      
      // Filter out only compatible models that can generate content
      const compatible = models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.split('/').pop());
      
      // Sort them such that our preferred/recommended models come first
      compatible.sort((a, b) => {
        const idxA = preferences.indexOf(a);
        const idxB = preferences.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });

      if (compatible.length > 0) {
        resolvedModelsList = compatible;
        resolvedModelsListKey = apiKey;
        return compatible;
      }
    }
  } catch (err) {
    console.error('Error listing models:', err);
  }
  
  // Default fallback if listing fails
  return [
    'gemini-1.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro'
  ];
}

// Call Gemini API with dynamic model selection, retry logic, and fallback failover
async function callGeminiAPI(apiKey, prompt, preferredModel = null, retries = 3) {
  // Get all compatible models for this API key
  const availableModels = await getAvailableModels(apiKey);
  
  // Build a list of models to try, starting with preferredModel if it's available,
  // followed by other available models
  let modelsToTry = [];
  if (preferredModel && availableModels.includes(preferredModel)) {
    modelsToTry.push(preferredModel);
  }
  
  // Add other available models to the attempt list
  for (const model of availableModels) {
    if (!modelsToTry.includes(model)) {
      modelsToTry.push(model);
    }
  }
  
  if (modelsToTry.length === 0) {
    modelsToTry = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-pro'];
  }

  let lastError = null;

  for (const modelName of modelsToTry) {
    console.log(`🤖 Attempting Gemini API generation with model: ${modelName}`);
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.4,
                maxOutputTokens: 2048,
              },
            }),
          }
        );

        if (!response.ok) {
          const err = await response.json();
          const errorMsg = err.error?.message || response.statusText;
          
          // Check if it's a quota/rate limit error
          if (errorMsg.includes('quota') || errorMsg.includes('429') || response.status === 429) {
            console.warn(`⚠️ Model ${modelName} hit rate limit / quota. Error: ${errorMsg}`);
            
            // Check if there is a retry timer in the message (e.g., "Please retry in 59.308030897s")
            const retryMatch = errorMsg.match(/Please retry in ([\d.]+)s/);
            if (retryMatch) {
              const retrySeconds = parseFloat(retryMatch[1]);
              // If wait is short, wait it out. Otherwise fail immediately to fall back or show timer to user
              if (retrySeconds < 5 && attempt < retries - 1) {
                console.log(`Waiting ${retrySeconds}s to retry model ${modelName}...`);
                await new Promise(r => setTimeout(r, retrySeconds * 1000 + 500));
                continue;
              } else {
                lastError = new Error(errorMsg);
                break; // Try next model immediately
              }
            }
            
            if (attempt < retries - 1) {
              await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
              continue;
            }
          }
          
          throw new Error(errorMsg);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        if (!text || text.trim().length === 0) {
          if (attempt < retries - 1) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          throw new Error('Empty response from Gemini API');
        }
        
        // Save successfully worked model
        if (!preferredModel) {
          resolvedModel = modelName;
          resolvedModelKey = apiKey;
        }
        
        console.log(`🎯 Successfully generated content using model: ${modelName}`);
        return text;
      } catch (error) {
        console.error(`Gemini API error using model ${modelName} (attempt ${attempt + 1}/${retries}):`, error.message);
        lastError = error;
        
        // If it's not a rate-limit/quota error (e.g. invalid API key), fail immediately
        const msg = error.message.toLowerCase();
        if (!msg.includes('quota') && !msg.includes('429') && !msg.includes('rate limit')) {
          throw error;
        }
      }
    }
  }
  
  throw lastError || new Error('All available Gemini models failed or hit rate limits');
}

// Export as Word document
app.post('/api/export-docx', async (req, res) => {
  try {
    const { videoTitle, author, description, summary, transcript } = req.body;
    console.log('Generating DOCX for title:', videoTitle);

    // Prepare transcript (first 5000 chars)
    const shortTranscript = (transcript || '')
      .substring(0, 5000)
      .replace(/\n{3,}/g, '\n\n');

    // Build children paragraphs array
    const documentChildren = [];

    // Title
    documentChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [
          new TextRun({
            text: String(videoTitle || 'YouTube Video Report'),
            bold: true,
            size: 32,
          })
        ]
      })
    );

    // Metadata Table
    documentChildren.push(
      new Table({
        rows: [
          new TableRow({
            children: [
              new TableCell({ 
                children: [
                  new Paragraph({ 
                    children: [
                      new TextRun({ text: 'Author:', bold: true })
                    ] 
                  })
                ] 
              }),
              new TableCell({ 
                children: [
                  new Paragraph({ 
                    children: [
                      new TextRun({ text: String(author || 'Unknown') })
                    ] 
                  })
                ] 
              }),
            ],
          }),
          new TableRow({
            children: [
              new TableCell({ 
                children: [
                  new Paragraph({ 
                    children: [
                      new TextRun({ text: 'Generated:', bold: true })
                    ] 
                  })
                ] 
              }),
              new TableCell({ 
                children: [
                  new Paragraph({ 
                    children: [
                      new TextRun({ text: new Date().toLocaleString() })
                    ] 
                  })
                ] 
              }),
            ],
          }),
        ],
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );

    // Spacer
    documentChildren.push(
      new Paragraph({
        spacing: { after: 200 },
        children: []
      })
    );

    // Description Header
    documentChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: 'Video Description',
            bold: true,
            size: 24,
          })
        ]
      })
    );

    // Description text (split by newline to avoid docx library corruption)
    const descriptionLines = String(description || 'No description available')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    descriptionLines.forEach(line => {
      documentChildren.push(
        new Paragraph({
          spacing: { after: 120 },
          children: [
            new TextRun({ text: line })
          ]
        })
      );
    });

    // Key Points Header
    documentChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: 'Key Points',
            bold: true,
            size: 24,
          })
        ]
      })
    );

    // Add Key Points
    const summaryList = Array.isArray(summary) ? summary : [summary].filter(Boolean);
    if (summaryList.length > 0) {
      summaryList.forEach(point => {
        const cleanPoint = String(point).replace(/^[-•*]\s*/, '').trim();
        if (cleanPoint) {
          documentChildren.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 100 },
              children: [
                new TextRun({ text: cleanPoint })
              ]
            })
          );
        }
      });
    } else {
      documentChildren.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: 'No key points available' })
          ]
        })
      );
    }

    // Spacer
    documentChildren.push(
      new Paragraph({
        spacing: { before: 100, after: 100 },
        children: []
      })
    );

    // Transcript Header
    documentChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({
            text: 'Transcript (Excerpt)',
            bold: true,
            size: 24,
          })
        ]
      })
    );

    // Split and add Transcript Paragraphs (split by single newline to prevent raw newlines inside a single TextRun)
    const transcriptLines = (shortTranscript || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean);

    if (transcriptLines.length > 0) {
      transcriptLines.forEach(line => {
        documentChildren.push(
          new Paragraph({
            spacing: { after: 60 },
            children: [
              new TextRun({ text: line })
            ]
          })
        );
      });
    } else {
      documentChildren.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: 'Transcript not available' })
          ]
        })
      );
    }

    // Create document
    const doc = new Document({
      sections: [
        {
          children: documentChildren,
        },
      ],
    });

    // Generate buffer
    const buffer = await Packer.toBuffer(doc);
    const filename = `${String(videoTitle || 'report').replace(/[^\w]/g, '_')}_report.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (error) {
    console.error('Export error details:', error);
    res.status(500).json({ error: error.message });
  }
});

// Parse summary points with better handling
function parseSummaryPoints(text) {
  if (!text) return [];
  
  return text
    .split('\n')
    .map(line => line.replace(/^[-•*]\s*/, '').trim())
    .filter(line => line.length > 5 && !line.toLowerCase().startsWith('note:'))
    .slice(0, 10);
}

// Sanitize Mermaid diagrams with better validation
function sanitizeMermaidDiagram(text, type) {
  if (!text) {
    if (type === 'mindmap') {
      return 'mindmap\n  root((Content))\n    Topics\n      Main Ideas';
    } else {
      return 'flowchart TD\n    A["Start"] --> B["Process"]\n    B --> C["End"]';
    }
  }

  let cleaned = text.trim();

  // Extract from markdown code block if present
  const codeBlockRegex = /```(?:mermaid)?\s*\n([\s\S]*?)\n\s*```/i;
  const match = cleaned.match(codeBlockRegex);
  if (match) {
    cleaned = match[1].trim();
  } else {
    // Fallback replacement if no code blocks are found
    cleaned = cleaned.replace(/```(?:mermaid)?\n?/g, '').replace(/```/g, '').trim();
  }

  // Remove trailing/leading markdown, explanations and notes
  cleaned = cleaned
    .split('\n')
    .filter(line => {
      const lower = line.toLowerCase().trim();
      return !lower.startsWith('here is') && !lower.startsWith('note:') && !lower.startsWith('mermaid');
    })
    .join('\n')
    .trim();

  // Validate format
  if (type === 'mindmap') {
    if (!cleaned.toLowerCase().includes('mindmap')) {
      // Try to parse as content and create mindmap
      const lines = cleaned.split('\n').filter(l => l.trim());
      if (lines.length > 0) {
        return `mindmap\n  root((Main Topic))\n${lines.map(l => '    ' + l).join('\n')}`;
      }
      return 'mindmap\n  root((Content))\n    Topics\n      Ideas';
    }
  } else if (type === 'flowchart') {
    if (!cleaned.toLowerCase().startsWith('flowchart')) {
      // Try to parse as steps and create flowchart
      const lines = cleaned.split('\n').filter(l => l.trim() && !l.includes('-->'));
      if (lines.length > 0) {
        let flowchart = 'flowchart TD\n';
        const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        for (let i = 0; i < Math.min(lines.length, 8); i++) {
          const step = lines[i].replace(/^[-•*]\s*/, '').trim();
          flowchart += `    ${letter[i]}["${step}"]\n`;
          if (i < Math.min(lines.length, 8) - 1) {
            flowchart += `    ${letter[i]} --> ${letter[i + 1]}\n`;
          }
        }
        return flowchart;
      }
      return 'flowchart TD\n    A["Start"] --> B["Process"]\n    B --> C["Result"]';
    }
  }

  return cleaned;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', port: PORT });
});

// Fallback for SPA routing
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'index.html'));
});

// Start server locally only (Vercel uses serverless export)
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
    console.log(`📝 API: http://localhost:${PORT}/api`);
    console.log(`📊 Ready for video analysis!`);
    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️ GEMINI_API_KEY is not set. AI features will require a user-provided key.');
    }
    if (!process.env.MONGODB_URI && !process.env.MONGO_URI) {
      console.warn('⚠️ MONGODB_URI is not set. Database history is disabled.');
    }
  });
}

export default app;
