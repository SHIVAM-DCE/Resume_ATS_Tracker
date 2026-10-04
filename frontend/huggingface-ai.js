export async function getAIAnalysis(prompt) {
  const response = await fetch('/ai-analysis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt })
  });

  if (!response.ok) {
    let message = 'Failed to get AI analysis';
    try {
      const err = await response.json();
      message = typeof err.error === 'string' ? err.error : JSON.stringify(err.error || err);
    } catch (e) {
      message = `${message} (status ${response.status})`;
    }
    throw new Error(message);
  }
  return await response.json();
}