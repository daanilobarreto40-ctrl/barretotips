#!/bin/sh
[ -z "$NVIDIA_API_KEY" ] && printf "Cole sua chave NVIDIA (nvapi-...): " && read NVIDIA_API_KEY && export NVIDIA_API_KEY
echo "Abrindo em http://localhost:3000"
node server.js
