'use strict';

// ── Gemini API client ─────────────────────────────────────────────────────────
// All calls go directly from the renderer to generativelanguage.googleapis.com.
// No proxy. No logging.

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function geminiCall(prompt, { apiKey, model = 'gemini-2.5-flash', maxTokens = 4096 } = {}) {
  if (!apiKey) throw new Error('No Gemini API key configured. Go to Settings.');

  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.2,
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Gemini API error ${res.status}`;
    try {
      const err = await res.json();
      msg = err?.error?.message || msg;
    } catch { /* ignore */ }
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini.');
  return text;
}

// ── Extraction prompt ─────────────────────────────────────────────────────────
async function extractContextShadow(rawText, sessionTitle, { apiKey, model }) {
  const prompt = `You are the Cognitive Extraction Engine for Chronis CSA (Context Shadow Architecture).

Analyse the following raw interaction text. Return ONLY a valid JSON object — no markdown fences, no preamble, no trailing commentary.

Required structure:
{
  "session_title": "${sessionTitle.replace(/"/g, '\\"')}",
  "timestamp": "${new Date().toISOString()}",
  "conversational_intent": "One sentence: what was this interaction fundamentally about?",
  "emotional_dynamics": "Describe the emotional tone and tensions present.",
  "negotiation_state": "open | agreed | deadlocked | pending | none",
  "social_context": "Describe the relationship type and power dynamics.",
  "environmental_context": "Where / what setting if inferable, else null.",
  "temporal_context": "Deadlines, urgency signals, time references mentioned.",
  "commitments": [
    {
      "actor": "name or role",
      "commitment": "what they committed to",
      "confidence": 0.0,
      "deadline": "natural language deadline or null",
      "risk": 0.0
    }
  ],
  "decisions_made": ["list of concrete decisions that were finalised"],
  "decisions_deferred": ["list of decisions explicitly kicked to later"],
  "beliefs_expressed": ["beliefs, opinions, or stances stated by participants"],
  "goals": ["stated or inferred goals of participants"],
  "knowledge_exchanged": ["specific facts, data, or information shared"],
  "relationships": [
    { "from": "entity A", "to": "entity B", "type": "reports-to | collaborates | trusts | disputes | owns | influences" }
  ],
  "graph_nodes": [
    {
      "type": "person | commitment | idea | event | project | resource",
      "label": "short label",
      "attributes": "one sentence description"
    }
  ],
  "reconstruction_summary": "2-3 sentence third-person reconstruction of what happened. Do not quote the original text. Derive entirely from semantic state."
}

Confidence and risk fields are floats between 0.0 and 1.0.
If a field is not determinable from the text, use null or an empty array.

Raw interaction:
---
${rawText}
---`;

  const text = await geminiCall(prompt, { apiKey, model, maxTokens: 4096 });
  const clean = text.replace(/```json\n?|```\n?/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error('Could not parse extraction response. Raw: ' + clean.slice(0, 200));
  }
}

// ── Recall prompt ─────────────────────────────────────────────────────────────
async function recallFromGraph(query, sessions, { apiKey, model }) {
  const graphData = sessions.map(s => ({
    session_title: s.session_title,
    timestamp: s.timestamp,
    conversational_intent: s.conversational_intent,
    emotional_dynamics: s.emotional_dynamics,
    negotiation_state: s.negotiation_state,
    social_context: s.social_context,
    temporal_context: s.temporal_context,
    commitments: s.commitments,
    decisions_made: s.decisions_made,
    decisions_deferred: s.decisions_deferred,
    beliefs_expressed: s.beliefs_expressed,
    goals: s.goals,
    knowledge_exchanged: s.knowledge_exchanged,
    relationships: s.relationships,
    reconstruction_summary: s.reconstruction_summary,
  }));

  const prompt = `You are the Chronis Context Replay Engine.

You answer questions about past interactions using ONLY the context shadow graph data below. 
Do not invent details that are not in the graph. 
If the information is not present, say so clearly.
Answers should be concise (1-4 sentences) and cite which session(s) the information comes from.
Do not reproduce or quote original text — reconstruct from the semantic state only.

Context graph:
${JSON.stringify(graphData, null, 2)}

Question: ${query}`;

  return geminiCall(prompt, { apiKey, model, maxTokens: 1024 });
}

// ── Transcription prompt ──────────────────────────────────────────────────────
async function transcribeAudio(base64Audio, mimeType, { apiKey, model }) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeType,
            data: base64Audio,
          }
        },
        {
          text: 'Transcribe this audio recording accurately. Output only the transcript text, no labels, no timestamps, no preamble.'
        }
      ]
    }],
    generationConfig: { temperature: 0.0 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let msg = `Transcription error ${res.status}`;
    try { const err = await res.json(); msg = err?.error?.message || msg; } catch { /**/ }
    throw new Error(msg);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty transcription response.');
  return text;
}

window.GeminiAPI = { geminiCall, extractContextShadow, recallFromGraph, transcribeAudio };
