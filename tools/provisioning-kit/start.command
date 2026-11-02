#!/bin/sh
# inDiKo Kit fuer macOS und Linux: Doppelklick (macOS) oder ./start.command
cd "$(dirname "$0")" || exit 1
exec python3 server.py "$@"
