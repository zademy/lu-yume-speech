import { http, HttpResponse } from 'msw';

const GROQ_TRANSCRIPTIONS = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TRANSLATIONS = 'https://api.groq.com/openai/v1/audio/translations';

export const handlers = [
  http.post(GROQ_TRANSCRIPTIONS, async ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || auth === 'Bearer invalid') {
      return HttpResponse.json({ error: { message: 'Invalid API key' } }, { status: 401 });
    }
    return HttpResponse.json({ text: 'hello world' });
  }),
  http.post(GROQ_TRANSLATIONS, async ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || auth === 'Bearer invalid') {
      return HttpResponse.json({ error: { message: 'Invalid API key' } }, { status: 401 });
    }
    return HttpResponse.json({ text: 'translated text' });
  }),
];
