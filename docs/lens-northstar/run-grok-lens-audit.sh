#!/bin/zsh
export PATH="$HOME/.local/bin:$PATH"
LOG="$HOME/.zuko/logs/grok-lens-audit.log"
PROMPT="$HOME/.zuko/lens-northstar/missions/LENS_AUDIT_INTEGRATE.md"
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] mission replaced: LENS_AUDIT_INTEGRATE.md rewritten with the full lens functionalization pass; previous grok-lens-audit stopped and relaunched" | tee -a "$LOG"
grok --always-approve --prompt-file "$PROMPT" 2>&1 | tee -a "$LOG"
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] grok exited: $?" | tee -a "$LOG"
