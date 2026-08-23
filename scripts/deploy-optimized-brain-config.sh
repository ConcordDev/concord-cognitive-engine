#!/bin/bash
# deploy-optimized-brain-config.sh
# Deploys the adaptive brain configuration with optimized resource usage

set -e

echo "🚀 Deploying Adaptive Brain Configuration..."

# Kill any existing brain optimization script (if rerunning)
echo "🧹 Cleaning up any existing optimization processes..."
pkill -f "brain-optimization" 2>/dev/null || true

# Set environment variables for adaptive scaling
export CONCORD_ADAPTIVE_BRAIN_SCALING=true
export CONCORD_NUM_CTX_CAP=32768
export CONCORD_LLM_TIMEOUT_FLOOR_MS=60000

# Kill any zombie/defunct processes
echo "💀 Cleaning up zombie processes..."
ZOMBIES=$(ps aux | grep defunct | grep -v grep | wc -l)
if [ "$ZOMBIES" -gt 0 ]; then
    echo "  Found $ZOMBIES zombie processes"
    ps aux | grep defunct | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
fi

# Terminate redundant Ollama serve instances (keep only main one)
echo "🔍 Scanning for redundant Ollama instances..."
OLLAMA_PIDS=$(ps aux | grep "ollama serve" | grep -v grep | awk '{print $2}' | sort -rn | tail -n +2)
if [ -n "$OLLAMA_PIDS" ]; then
    echo "  Terminating redundant Ollama instances: $OLLAMA_PIDS"
    echo "$OLLAMA_PIDS" | xargs kill -15 2>/dev/null || true
else
    echo "  All Ollama instances optimized"
fi

# Kill high-context llama-server processes (reduce context windows)
echo "🧠 Optimizing llama-server context windows..."
ps aux | grep "llama-server" | grep -v grep | while read line; do
    PID=$(echo "$line" | awk '{print $2}')
    CMD=$(echo "$line" | awk '{for(i=11;i<=NF;i++) printf "%s ", $i; print ""}')
    
    # If context > 16384, consider terminating
    CONTEXT=$(echo "$CMD" | grep -oE "\-c\s+[0-9]+" | grep -oE "[0-9]+")
    if [ -n "$CONTEXT" ] && [ "$CONTEXT" -gt 16384 ]; then
        echo "  Reducing context for PID $PID (context: $CONTEXT)"
        kill -15 "$PID" 2>/dev/null || true
    fi
done

# Wait for cleanup
sleep 3

# Start/restart Ollama with optimized settings
echo "🔄 Restarting Ollama service..."
OLDPIDS=$(pgrep -f "ollama serve")
if [ -n "$OLDPIDS" ]; then
    echo "  Stopping existing Ollama processes..."
    echo "$OLDPIDS" | xargs kill -15 2>/dev/null || true
    sleep 3
    # Force kill if still running
    OLDPIDS=$(pgrep -f "ollama serve")
    if [ -n "$OLDPIDS" ]; then
        echo "$OLDPIDS" | xargs kill -9 2>/dev/null || true
        sleep 2
    fi
fi

# Start single Ollama instance with optimized settings
echo "  Starting optimized Ollama instance..."
OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_NUM_PARALLEL=4 OLLAMA_MAX_LOADED_MODELS=2 \
    nohup ollama serve > logs/ollama-single.log 2>&1 &
OLLAMA_PID=$!
echo "  Ollama started with PID: $OLLAMA_PID"

# Wait for Ollama to be ready
echo "⏳ Waiting for Ollama to start..."
for i in {1..15}; do
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "🟢 Ollama is ready!"
        break
    fi
    if [ $i -eq 15 ]; then
        echo "⚠️  Ollama didn't start properly"
    fi
    sleep 2
done

# Restart the main server with optimized configuration
echo "🔄 Restarting Concord Cognitive Engine..."
cd /workspace/concord-cognitive-engine
MAX_OLD_SPACE_SIZE=32768 node --max-old-space-size=32768 --expose-gc server/server.js > logs/backend-out.log 2>&1 &
SERVER_PID=$!
echo "  Server started with PID: $SERVER_PID"

# Wait for server to start
echo "⏳ Waiting for server initialization..."
for i in {1..30}; do
    if curl -s http://localhost:5050/api/system/health > /dev/null 2>&1; then
        echo "🟢 Concord Cognitive Engine is healthy!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "⚠️  Server health check timed out"
    fi
    sleep 2
done

# Initialize adaptive brain monitoring
echo "📊 Enabling adaptive brain monitoring..."
CONCORD_ADAPTIVE_BRAIN_SCALING=true node -e "
const { systemMonitor } = require('./lib/system-monitor.js');
setInterval(async () => {
  try {
    const status = await systemMonitor.collect();
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      system: status,
      recommendations: systemMonitor.getRecommendedSettings()
    }));
  } catch (e) {
    console.error('Monitor error:', e.message);
  }
}, 10000);
" > /workspace/concord-cognitive-engine/logs/adaptive-monitor.log 2>&1 &
echo $! > /tmp/adaptive-monitor.pid

# Show final status
echo ""
echo "✅ Adaptive Brain Configuration deployed successfully!"
echo ""
echo "📊 System Status:"
curl -s http://localhost:5050/api/system/adaptive-status 2>/dev/null | head -20
echo ""
echo "📈 Monitoring active processes..."
ps aux | grep -E "(node|ollama|server)" | grep -v grep | wc -l
echo " processes running"
echo ""
echo "📁 Logs available at:"
echo "  - Backend: /workspace/concord-cognitive-engine/logs/backend-out.log"
echo "  - Adaptive Monitor: /workspace/concord-cognitive-engine/logs/adaptive-monitor.log"
echo "  - Errors: /workspace/concord-cognitive-engine/logs/backend-error.log"

echo ""
echo "🚀 Done! Adaptive brain scaling is now active."