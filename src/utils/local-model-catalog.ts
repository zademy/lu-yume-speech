/**
 * Catálogo versionado de Modelos del catálogo (local models) — shared leaf data.
 *
 * Pure, immutable data + validation: the approved list of browser-runnable
 * local transcription models LU YUME offers for download. Each entry pins an
 * immutable Hugging Face revision and declares its exact artifacts, sizes,
 * languages, capabilities, memory tier and backend requirement.
 *
 * Sizes come from the pinned revisions' artifact trees (Hugging Face API,
 * stage 1 verified 2026-08). The manifest ships inside the app — changing it
 * means shipping a new catalog version, never fetching one remotely.
 */

/** Hard per-download ceiling agreed in the spec: 2 GB decimal bytes. */
export const LOCAL_MODEL_MAX_BYTES = 2_000_000_000;

/** Manifest version — bump whenever an entry is added, removed or repointed. */
export const LOCAL_CATALOG_VERSION = 2;

/** Memory-requirement tier (runtime footprint, NOT download size). */
export type LocalModelMemoryTier = 'light' | 'medium' | 'high' | 'very-high';

/** Precision label derived from LU YUME's own benchmark (Estimación until then). */
export type LocalModelPrecision = 'basic' | 'medium' | 'high';

/** Speed label derived from LU YUME's own benchmark (Estimación until then). */
export type LocalModelSpeed = 'fast' | 'balanced' | 'slow';

/** Backend requirement: WASM-compatible or WebGPU-required. */
export type LocalModelBackend = 'wasm-compatible' | 'webgpu-required';

/** Licenses cleared for the catalog allow-list. */
export type LocalModelLicense = 'mit' | 'apache-2.0';

const LICENSE_ALLOW_LIST: readonly LocalModelLicense[] = ['mit', 'apache-2.0'];

/** One file fetched from the pinned revision when downloading the model. */
export interface LocalModelArtifact {
  /** Path within the repository (e.g. `onnx/encoder_model_q4.onnx`). */
  path: string;
  /** Exact byte size at the pinned revision. */
  bytes: number;
}

/** A Modelo del catálogo: one approved, pinned, downloadable local model. */
export interface LocalCatalogEntry {
  /** Stable identifier used by settings and (later) the download engine. */
  id: string;
  /** Display name (proper noun — not localized). */
  name: string;
  /** Display family (all stage-1 entries are Whisper). */
  family: string;
  /** Hugging Face repository (org/name). */
  repo: string;
  /** Immutable 40-char commit SHA the entry is pinned to. */
  revision: string;
  /** Quantization of the declared ONNX artifacts. */
  dtype: 'q4';
  /** Exact artifact list; downloadBytes must equal the sum of artifact bytes. */
  artifacts: LocalModelArtifact[];
  /** Sum of artifact bytes (validated against `artifacts`). */
  downloadBytes: number;
  /** Languages the entry is offered for; must include es and en. */
  languages: string[];
  /** Whether the model can auto-detect the spoken language. */
  autoDetectLanguage: boolean;
  /** Whether the model can translate non-English speech to English. */
  supportsTranslation: boolean;
  /** Precision estimate (benchmark-derived labels land with T8). */
  precision: LocalModelPrecision;
  /** Speed estimate (benchmark-derived labels land with T8). */
  speed: LocalModelSpeed;
  /** Runtime memory tier — independent of download size. */
  memoryTier: LocalModelMemoryTier;
  /** Backend requirement. */
  backend: LocalModelBackend;
  /** License (allow-listed). */
  license: LocalModelLicense;
  /** Human-readable license reference (Hugging Face page). */
  licenseUrl: string;
}

/** Runtime files every Whisper entry fetches alongside its ONNX weights. */
function whisperConfigArtifacts(
  files: Array<{ path: string; bytes: number }>,
): LocalModelArtifact[] {
  return files.map((f) => ({ path: f.path, bytes: f.bytes }));
}

/**
 * Stage-1 catalog: Whisper Base (light), Small (recommended) and
 * Large v3 Turbo (high precision, WebGPU).
 */
export const LOCAL_MODEL_CATALOG: readonly LocalCatalogEntry[] = [
  {
    id: 'whisper-base',
    name: 'Whisper Base',
    family: 'Whisper',
    repo: 'onnx-community/whisper-base',
    revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    dtype: 'q4',
    artifacts: [
      { path: 'onnx/encoder_model_q4.onnx', bytes: 18772451 },
      { path: 'onnx/decoder_model_merged_q4.onnx', bytes: 123602419 },
      ...whisperConfigArtifacts([
        { path: 'config.json', bytes: 2243 },
        { path: 'generation_config.json', bytes: 3832 },
        { path: 'preprocessor_config.json', bytes: 339 },
        { path: 'special_tokens_map.json', bytes: 2194 },
        { path: 'tokenizer.json', bytes: 2480466 },
        { path: 'tokenizer_config.json', bytes: 282682 },
      ]),
    ],
    downloadBytes: 145146626,
    languages: ['es', 'en'],
    autoDetectLanguage: true,
    supportsTranslation: true,
    precision: 'basic',
    speed: 'fast',
    memoryTier: 'light',
    backend: 'wasm-compatible',
    license: 'mit',
    licenseUrl: 'https://huggingface.co/onnx-community/whisper-base',
  },
  {
    id: 'whisper-small',
    name: 'Whisper Small',
    family: 'Whisper',
    repo: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    dtype: 'q4',
    artifacts: [
      { path: 'onnx/encoder_model_q4.onnx', bytes: 66182104 },
      { path: 'onnx/decoder_model_merged_q4.onnx', bytes: 233149327 },
      ...whisperConfigArtifacts([
        { path: 'config.json', bytes: 2227 },
        { path: 'generation_config.json', bytes: 3893 },
        { path: 'preprocessor_config.json', bytes: 339 },
        { path: 'special_tokens_map.json', bytes: 2194 },
        { path: 'tokenizer.json', bytes: 2480466 },
        { path: 'tokenizer_config.json', bytes: 282683 },
      ]),
    ],
    downloadBytes: 302103233,
    languages: ['es', 'en'],
    autoDetectLanguage: true,
    supportsTranslation: true,
    precision: 'medium',
    speed: 'balanced',
    memoryTier: 'medium',
    backend: 'wasm-compatible',
    license: 'mit',
    licenseUrl: 'https://huggingface.co/onnx-community/whisper-small',
  },
  {
    id: 'whisper-large-v3-turbo',
    name: 'Whisper Large v3 Turbo',
    family: 'Whisper',
    repo: 'onnx-community/whisper-large-v3-turbo',
    revision: '360ebcde2559d60bb474678be3c1de9ef347d01a',
    dtype: 'q4',
    artifacts: [
      { path: 'onnx/encoder_model_q4.onnx', bytes: 424942775 },
      { path: 'onnx/decoder_model_merged_q4.onnx', bytes: 334147222 },
      ...whisperConfigArtifacts([
        { path: 'config.json', bytes: 1332 },
        { path: 'generation_config.json', bytes: 3897 },
        { path: 'preprocessor_config.json', bytes: 340 },
        { path: 'special_tokens_map.json', bytes: 2186 },
        { path: 'tokenizer.json', bytes: 2480617 },
        { path: 'tokenizer_config.json', bytes: 282843 },
      ]),
    ],
    downloadBytes: 761861212,
    languages: ['es', 'en'],
    autoDetectLanguage: true,
    supportsTranslation: true,
    precision: 'high',
    speed: 'balanced',
    memoryTier: 'high',
    backend: 'webgpu-required',
    license: 'mit',
    licenseUrl: 'https://huggingface.co/onnx-community/whisper-large-v3-turbo',
  },
] as const;

/** Validation issue kinds — each maps to a concrete catalog authoring error. */
export type LocalCatalogIssueKind =
  | 'duplicate-id'
  | 'duplicate-repo-revision'
  | 'size-mismatch'
  | 'bad-artifact-size'
  | 'over-ceiling'
  | 'license-not-allowed'
  | 'missing-language'
  | 'empty-artifacts';

/** One catalog validation finding, tied to the offending entry id. */
export interface LocalCatalogIssue {
  kind: LocalCatalogIssueKind;
  id: string;
}

/**
 * Validate a catalog candidate. Pure: returns every issue found (empty array
 * = valid). The shipped catalog must always pass — unit tests enforce it.
 */
export function validateCatalog(entries: readonly LocalCatalogEntry[]): LocalCatalogIssue[] {
  const issues: LocalCatalogIssue[] = [];
  const seenIds = new Set<string>();
  const seenRepoRevisions = new Set<string>();

  for (const entry of entries) {
    if (seenIds.has(entry.id)) {
      issues.push({ kind: 'duplicate-id', id: entry.id });
    }
    seenIds.add(entry.id);

    const repoRevision = `${entry.repo}@${entry.revision}`;
    if (seenRepoRevisions.has(repoRevision)) {
      issues.push({ kind: 'duplicate-repo-revision', id: entry.id });
    }
    seenRepoRevisions.add(repoRevision);

    if (entry.artifacts.length === 0) {
      issues.push({ kind: 'empty-artifacts', id: entry.id });
    }
    for (const artifact of entry.artifacts) {
      if (!Number.isFinite(artifact.bytes) || artifact.bytes <= 0) {
        issues.push({ kind: 'bad-artifact-size', id: entry.id });
        break;
      }
    }

    const sum = entry.artifacts.reduce((acc, artifact) => acc + artifact.bytes, 0);
    if (sum !== entry.downloadBytes) {
      issues.push({ kind: 'size-mismatch', id: entry.id });
    }
    if (entry.downloadBytes > LOCAL_MODEL_MAX_BYTES) {
      issues.push({ kind: 'over-ceiling', id: entry.id });
    }
    if (!LICENSE_ALLOW_LIST.includes(entry.license)) {
      issues.push({ kind: 'license-not-allowed', id: entry.id });
    }
    if (!entry.languages.includes('es') || !entry.languages.includes('en')) {
      issues.push({ kind: 'missing-language', id: entry.id });
    }
  }

  return issues;
}

/** Format a byte count as MiB/GiB with one decimal (download-size display). */
export function formatDownloadSize(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  if (mib < 1024) return `${mib.toFixed(1)} MiB`;
  return `${(mib / 1024).toFixed(1)} GiB`;
}
