#!/bin/sh
set -eu
model="${WHISPER_MODEL:-tiny}"
case "$model" in tiny|base|small|tiny.en|base.en|small.en) ;; *) echo 'Unsupported WHISPER_MODEL; use tiny, base or small (optionally .en).' >&2; exit 1 ;; esac
target="/models/ggml-${model}.bin"
if [ -s "$target" ]; then echo "Model already downloaded: $model"; exit 0; fi
curl --fail --location --retry 3 --output "${target}.partial" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${model}.bin"
mv "${target}.partial" "$target"
echo "Model ready: $model"
