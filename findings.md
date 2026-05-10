# Hallazgos — Speech-to-Text

## API de Groq Whisper — Parámetros Disponibles

### Endpoint de Transcripción

`POST https://api.groq.com/openai/v1/audio/transcriptions`

| Parámetro                   | Tipo   | Default  | Descripción                                                |
| --------------------------- | ------ | -------- | ---------------------------------------------------------- |
| `file`                      | Blob   | required | Audio (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm)    |
| `model`                     | string | required | `whisper-large-v3` o `whisper-large-v3-turbo`              |
| `language`                  | string | auto     | ISO-639-1 (es, en, fr, de...). Mejora accuracy + latencia. |
| `prompt`                    | string | —        | Contexto, max 224 tokens. Mismo idioma que audio.          |
| `response_format`           | string | json     | `json`, `text`, `verbose_json`                             |
| `temperature`               | float  | 0        | 0-1. Recomendado 0.                                        |
| `timestamp_granularities[]` | array  | segment  | `word`, `segment`, o ambos. Solo con `verbose_json`.       |

### Endpoint de Traducción

`POST https://api.groq.com/openai/v1/audio/translations`

- Traduce cualquier idioma → inglés. Mismos parámetros.
- `language` solo acepta `en`.

### verbose_json

```json
{
  "text": "Hola mundo",
  "language": "es",
  "duration": 5.2,
  "segments": [
    { "text": "...", "start": 0.0, "end": 1.5, "avg_logprob": -0.2 }
  ],
  "words": [{ "word": "Hola", "start": 0.0, "end": 0.5 }]
}
```

## Rate Limits (Free Tier)

- 20 req/min | 2,000 req/día
- 7,200 seg audio/hr | 28,800 seg audio/día

## MediaRecorder — Constraints

```js
{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000 } }
```

## Modelos

- `whisper-large-v3` — 1550M params, 189x speed, 8.4% WER, 99+ idiomas
- `whisper-large-v3-turbo` — Más rápido, buena accuracy

## Stack

- Vite 8 + TypeScript 6, Tailwind CDN, 0 runtime deps
