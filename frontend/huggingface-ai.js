export async function getAIAnalysis(prompt) {
  try {
    const response = await fetch('/ai-analysis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to get AI analysis');
    }
    return await response.json();
  } catch (err) {
    console.error('Error in getAIAnalysis:', err);
    throw err;
  }
}