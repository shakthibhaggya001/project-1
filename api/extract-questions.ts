// Vercel serverless function. Keeps the Gemini API key server-side only —
// it must never be shipped to the browser. Accepts a base64-encoded PDF of
// an exam paper and asks Gemini to extract every MCQ into structured JSON,
// grouping any questions that share a table/passage (e.g. "Answer
// questions 1-5 based on the table below") so the admin doesn't have to
// manually re-type or re-link them.

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. Add it in Vercel → Project Settings → Environment Variables, then redeploy.',
    });
    return;
  }

  try {
    const { fileBase64, mediaType } = req.body || {};
    if (!fileBase64 || mediaType !== 'application/pdf') {
      res.status(400).json({ error: 'Please upload a PDF file (export your Word/Google Doc as PDF first).' });
      return;
    }

    const prompt =
      'You extract multiple-choice exam questions from scanned or typed exam paper documents. ' +
      'Preserve the original language and exact wording (including Sinhala/Tamil/English text) — never translate or paraphrase. ' +
      'Some questions share a table or passage that several consecutive questions refer to (e.g. "Answer questions 1-5 based on the table below"); ' +
      'group those together with the shared content once, instead of repeating it per question. ' +
      'Some individual questions (e.g. matching-pairs questions like "match column A to column B") contain their OWN table within that single question\'s text — keep that table inside that question\'s "text" field, not as a group context. ' +
      'Whenever you render any table (shared context or embedded in a single question), use real newline characters ("\\n") between rows — never join rows on one line with "||". ' +
      'Render tables using simple pipe-delimited markdown, e.g. "| Year | Event |\\n| 1948 | Independence |". ' +
      'You cannot extract actual image/photo pixel data — if a question refers to, or is placed directly next to, a map, photo, diagram, illustration, or figure (in Sinhala often "රූප සටහන", "සිතියම", "පින්තූරය"), set "has_figure": true for that question so the admin knows to attach that image manually. Otherwise set it false. ' +
      'Respond with ONLY valid JSON, no prose, no markdown code fences, matching exactly this shape: ' +
      '{"groups":[{"context": string|null, "questions":[{"number": number, "text": string, ' +
      '"options": {"A": string, "B": string, "C": string, "D": string}, "correct_answer": "A"|"B"|"C"|"D"|null, "has_figure": boolean}]}]}. ' +
      'Questions with no shared table go in their own group with "context": null. ' +
      'Only set correct_answer if the source document explicitly marks/underlines/bolds an answer key — otherwise use null. ' +
      'Extract every multiple-choice question from this exam paper as JSON per the schema above.';

    const model = 'gemini-3.6-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const body = JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            { inline_data: { mime_type: 'application/pdf', data: fileBase64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    // Gemini's free tier occasionally returns a transient 503
    // ("currently experiencing high demand ... usually temporary").
    // Retry a few times with backoff before giving up, so a passing
    // traffic spike doesn't force the admin to manually click Upload again.
    let geminiRes: Response | null = null;
    let lastDetails = '';
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (res.ok) {
        geminiRes = res;
        break;
      }
      lastDetails = await res.text();
      const isRetryable = res.status === 503 || res.status === 429;
      console.error(`Gemini API attempt ${attempt} failed`, res.status, lastDetails);
      if (!isRetryable || attempt === maxAttempts) {
        geminiRes = res;
        break;
      }
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }

    if (!geminiRes || !geminiRes.ok) {
      res.status(502).json({
        error: 'AI extraction request failed after retrying — the model may still be overloaded. Please wait a minute and try again.',
        details: lastDetails,
      });
      return;
    }

    const data = await geminiRes.json();
    const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(502).json({ error: 'Could not find JSON in the AI response.', raw: raw.slice(0, 500) });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      res.status(502).json({ error: 'AI response was not valid JSON.', raw: jsonMatch[0].slice(0, 500) });
      return;
    }

    res.status(200).json(parsed);
  } catch (err: any) {
    console.error('extract-questions unexpected error', err);
    res.status(500).json({ error: err?.message || 'Unexpected server error' });
  }
}
