#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Benchmark corpus generator (v1) — spec T8.
#
# Regenerates the versioned ES/EN corpus under public/benchmark-corpus:
# speech clips synthesized with the macOS `say` voices (clean + noisy,
# short + long, several accents) plus a checksummed manifest.json.
#
# Reproducibility: the texts, voices, target formats and the noise recipe
# live in corpus-texts.json; this script only executes them. Regenerating
# on a different macOS version may change voice characteristics — the
# committed WAVs + SHA-256 checksums in the manifest are the source of
# truth for published results; rerun `npm run benchmark:labels` if you
# regenerate.
#
# No user data is used for measuring (spec: corpus reproducible, versioned).
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."
OUT="public/benchmark-corpus"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

gen_clip() {
  local id="$1" voice="$2" text="$3" noise="$4" outfile="$5"
  local raw="$TMP/${id}.wav"
  say -v "$voice" -o "$raw" --data-format=LEI16@16000 "$text"
  if [[ "$noise" == "noisy" ]]; then
    # ~10 dB SNR white noise mixed under the speech, then 16 kHz mono WAV.
    ffmpeg -y -loglevel error -i "$raw" \
      -f lavfi -t "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$raw")" \
      -i "anoisesrc=color=white:amplitude=0.035" \
      -filter_complex "[0:a][1:a]amix=inputs=2:duration=first,aresample=16000,aformat=channel_layouts=mono" \
      -acodec pcm_s16le "$outfile"
  else
    ffmpeg -y -loglevel error -i "$raw" \
      -filter_complex "aresample=16000,aformat=channel_layouts=mono" \
      -acodec pcm_s16le "$outfile"
  fi
}

python3 - <<'PY' > "$TMP/clips.tsv"
import json
spec = json.load(open("scripts/benchmark/corpus-texts.json"))
for clip in spec["clips"]:
    print("\t".join([clip["id"], clip["voice"], clip["condition"], clip["text"]]))
PY

mkdir -p "$OUT"
while IFS=$'\t' read -r id voice condition text; do
  gen_clip "$id" "$voice" "$text" "$condition" "$OUT/${id}.wav"
done < "$TMP/clips.tsv"

python3 - <<'PY'
import hashlib, json, subprocess
spec = json.load(open("scripts/benchmark/corpus-texts.json"))
entries = []
for clip in spec["clips"]:
    path = f"public/benchmark-corpus/{clip['id']}.wav"
    data = open(path, "rb").read()
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", path], capture_output=True, text=True).stdout.strip())
    entries.append({**clip, "file": f"{clip['id']}.wav", "bytes": len(data),
                    "durationSeconds": round(dur, 2),
                    "sha256": hashlib.sha256(data).hexdigest()})
manifest = {
    "corpusVersion": spec["corpusVersion"],
    "generator": "scripts/benchmark/generate-corpus.sh (macOS say + ffmpeg)",
    "limitations": spec["limitations"],
    "entries": sorted(entries, key=lambda e: e["id"]),
}
json.dump(manifest, open("public/benchmark-corpus/manifest.json", "w"),
          ensure_ascii=False, indent=2)
print(f"manifest v{spec['corpusVersion']}: {len(entries)} clips")
PY
