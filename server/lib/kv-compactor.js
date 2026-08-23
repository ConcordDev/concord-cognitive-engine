function estimateTokens(text) {
  if (!text) return 0;
  const words = text.split(/\s+/).length;
  return Math.ceil(words * 1.3);
}

function countMessageTokens(messages) {
  return messages.reduce((sum, msg) => {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return sum + estimateTokens(content);
  }, 0);
}

export async function compactMessages(messages, maxTokens, summarize = null) {
  if (!messages || messages.length === 0) {
    return messages;
  }

  const totalTokens = countMessageTokens(messages);
  if (totalTokens <= maxTokens) {
    return messages;
  }

  const midpoint = Math.floor(messages.length / 2);
  const olderMessages = messages.slice(0, midpoint);
  const recentMessages = messages.slice(midpoint);

  let summary = '<prior context>';
  if (summarize && typeof summarize === 'function') {
    try {
      summary = await summarize(olderMessages);
    } catch (err) {
      console.warn('[kv-compactor] summarize failed, using fallback:', err.message);
      summary = `[${olderMessages.length} prior messages summarized]`;
    }
  }

  return [
    {
      role: 'system',
      content: summary
    },
    ...recentMessages
  ];
}

export function estimateContextTokens(messages) {
  return countMessageTokens(messages);
}
