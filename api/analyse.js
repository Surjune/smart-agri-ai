export default async function handler(req, res) {

  // ── CORS — allow browser requests from any origin ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight check (browser sends OPTIONS before POST)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GEMINI_KEY = process.env.GEMINI_KEY;

  if (!GEMINI_KEY) {
    return res.status(500).json({
      error: 'GEMINI_KEY is not set. Go to Vercel → Project → Settings → Environment Variables and add GEMINI_KEY.'
    });
  }

  // ── AUTO MODEL SELECTION ──
  // Fetches live Gemini model list and picks the best vision-capable one.
  // Never breaks if Google deprecates a model.
  async function getBestGeminiModel() {
    try {
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_KEY}`
      );
      if (!r.ok) throw new Error('models list failed');
      const data = await r.json();
      const models = (data.models || [])
        .map(m => m.name.replace('models/', ''))
        .filter(m => m.includes('gemini') && (m.includes('flash') || m.includes('pro')));

      const preferred = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-1.5-flash-002',
        'gemini-2.0-flash',
        'gemini-2.0-flash-exp',
        'gemini-1.5-pro',
        'gemini-1.5-pro-latest',
      ];
      for (const p of preferred) {
        if (models.includes(p)) return p;
      }
      const flash = models.find(m => m.includes('flash'));
      if (flash) return flash;
      return models[0] || 'gemini-1.5-flash';
    } catch {
      return 'gemini-1.5-flash';
    }
  }

  try {
    const { imageBase64, mimeType, crop, age, district, symptoms } = req.body;

    const model = await getBestGeminiModel();

    const prompt = `You are FarmSense AI — an expert agricultural image analyst for Indian farmers trained on ICAR and TNAU plant pathology data.

A farmer uploaded a photo of their crop.

Known details:
- Crop: ${crop || 'Not specified'}
- Crop age: ${age ? age + ' days' : 'Not specified'}
- Location: ${district || 'Not specified'}
- Symptoms described: ${symptoms || 'Not described'}

YOUR TASK:
1. Carefully analyse the image for disease, pest damage, or nutrient deficiency
2. Give your diagnosis with confidence: High / Medium / Low
3. Ask ONLY ONE follow-up question to confirm

FORMAT exactly like this:

🔍 WHAT I SEE IN THE IMAGE:
[Describe exactly what you observe — colour, pattern, location on leaf/stem]

🌾 LIKELY PROBLEM:
[Disease/pest/deficiency name] — Confidence: [High/Medium/Low]
Why: [One sentence explanation]

❓ ONE QUESTION TO CONFIRM:
[Your single most important follow-up question]

Source: ICAR Plant Pathology Division · Government of India`;

    const parts = [];
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: mimeType || 'image/jpeg',
          data: imageBase64
        }
      });
    }
    parts.push({ text: prompt });

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1024 }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        error: err.error?.message || 'Gemini API error',
        model_used: model
      });
    }

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text
      || 'Could not analyse. Please try again with a clearer photo.';

    return res.status(200).json({ reply, model_used: model });

  } catch (error) {
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
}
