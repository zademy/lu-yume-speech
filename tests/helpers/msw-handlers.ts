import { http, HttpResponse } from 'msw';

const GROQ_TRANSCRIPTIONS = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TRANSLATIONS = 'https://api.groq.com/openai/v1/audio/translations';
const MINIMAX_TRANSCRIPTIONS = 'https://api.minimax.io/v1/speech_to_text';

export const WORKER_BASE_URL = 'https://worker-ia-whisper.zadot911218.workers.dev';

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
  http.post(`${WORKER_BASE_URL}/transcribe`, async ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || auth === 'Bearer invalid') {
      return new HttpResponse('No autorizado', { status: 401 });
    }
    return new HttpResponse('worker hello', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }),
  http.post(MINIMAX_TRANSCRIPTIONS, async ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || auth === 'Bearer invalid') {
      return HttpResponse.json(
        { base_resp: { status_code: 4010, status_msg: 'invalid api key' } },
        { status: 401 },
      );
    }
    return HttpResponse.json({ text: 'minimax hello', duration: 2, trace_id: 'trace-1' });
  }),
];
