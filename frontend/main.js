import { getAIAnalysis } from './huggingface-ai.js';

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

document.addEventListener('DOMContentLoaded', () => {
  const jobDescriptionInput = document.getElementById('job-description');
  const resumeFileInput = document.getElementById('resume-file');
  const analyzeBtn = document.getElementById('analyze-btn');
  const errorDiv = document.getElementById('error');
  const spinner = document.getElementById('spinner');
  const resultsDiv = document.getElementById('results');
  const jobKeywordsDiv = document.getElementById('job-keywords');
  const resumeKeywordsDiv = document.getElementById('resume-keywords');
  const matchScoreDiv = document.getElementById('match-score');
  const missingKeywordsDiv = document.getElementById('missing-keywords');
  const aiAnalysisDiv = document.getElementById('ai-analysis');
  const requirementsGrid = document.getElementById('requirements-grid');
  const helpBtn = document.getElementById('help-btn');
  const helpSection = document.getElementById('help-section');
  const overlay = document.getElementById('overlay');
  const closeHelpBtn = document.getElementById('close-help');

  let errorTimeout;

  function showError(message) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    errorDiv.classList.add('error-visible');
    if (errorTimeout) clearTimeout(errorTimeout);
    errorTimeout = setTimeout(hideError, 8000);
  }

  function hideError() {
    errorDiv.classList.remove('error-visible');
    errorDiv.style.display = 'none';
  }

  function countWords(text) {
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  }

  function closeHelp() {
    helpSection.classList.remove('active');
    overlay.classList.remove('active');
  }
  helpBtn.addEventListener('click', () => {
    helpSection.classList.toggle('active');
    overlay.classList.toggle('active');
  });
  closeHelpBtn.addEventListener('click', closeHelp);
  overlay.addEventListener('click', closeHelp);

  function buildBadgeSections(sections, target) {
    sections.forEach(section => {
      if (section.data && section.data.length > 0) {
        const div = document.createElement('div');
        div.className = 'mt-2';
        const h4 = document.createElement('h4');
        h4.className = 'font-semibold';
        h4.textContent = section.title;
        div.appendChild(h4);

        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'flex flex-wrap gap-2 mt-2';
        section.data.forEach(keyword => {
          const badge = document.createElement('span');
          badge.className = `keyword-badge ${section.class}`;
          badge.textContent = keyword;
          badgeContainer.appendChild(badge);
        });
        div.appendChild(badgeContainer);
        target.appendChild(div);
      }
    });
  }

  function renderKeywords(keywords, container) {
    if (!container) return;
    const contentDiv = container.querySelector('[id$="-content"]');
    if (!contentDiv) return;
    contentDiv.innerHTML = '';
    if (!keywords) {
      contentDiv.innerHTML = '<p>No keywords found.</p>';
      return;
    }
    buildBadgeSections([
      { title: 'Technical Skills', data: keywords.technicalSkills, class: 'technical-skill' },
      { title: 'Soft Skills', data: keywords.softSkills, class: 'soft-skill' },
      { title: 'Tools', data: keywords.tools, class: 'tool' }
    ], contentDiv);
  }

  function renderAiAnalysis(aiText) {
    const clean = String(aiText).replace(/\*\*/g, '');
    const heads = ['Positives', 'Negatives', 'Suggestions', 'Overall Result'];
    const cls = { Positives: 'pos', Negatives: 'neg', Suggestions: 'sug', 'Overall Result': 'res' };
    const sections = {};
    let cur = null;
    clean.split('\n').forEach(raw => {
      let line = raw.trim();
      if (!line) return;
      const key = line.toLowerCase().replace(/[:#\s]/g, '');
      const h = heads.find(x => x.toLowerCase().replace(/\s/g, '') === key);
      if (h) { cur = h; sections[h] = []; return; }
      if (!cur) return;
      line = line.replace(/^[*\-\u2022]\s*/, '').replace(/\.?:$/, '.');
      sections[cur].push(line);
    });
    Object.keys(sections).forEach(k => { if (!sections[k].length) delete sections[k]; });
    let html = heads.filter(h => sections[h]).map(h =>
      `<div class="ai-card ${cls[h]}"><h4>${h}</h4><ul>${sections[h].map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>`
    ).join('');
    if (!html) html = `<div class="ai-card"><pre style="white-space:pre-wrap;margin:0">${escapeHtml(clean)}</pre></div>`;
    aiAnalysisDiv.innerHTML = `<h3>AI Analysis & Suggestions</h3><div class="ai-grid">${html}</div>`;
    try { localStorage.setItem('aiSections', JSON.stringify(sections)); } catch (e) {}
  }

  function renderAiError(message) {
    aiAnalysisDiv.innerHTML = `
      <h3>AI Analysis & Suggestions</h3>
      <div class="bg-white/5 p-4 rounded-lg text-red-400">
        Failed to get AI analysis from Hugging Face.<br>${escapeHtml(message)}
      </div>`;
  }

  function clearStoredResults() {
    ['matchScore', 'missingKeywords', 'aiAnalysis', 'aiSections', 'requirements', 'jobKeywords', 'resumeKeywords']
      .forEach(k => localStorage.removeItem(k));
  }

  function flatten(k) {
    return [...(k?.technicalSkills || []), ...(k?.softSkills || []), ...(k?.tools || [])];
  }

  analyzeBtn.addEventListener('click', async () => {
    hideError();
    const jobDescription = jobDescriptionInput.value.trim();
    const resumeFile = resumeFileInput.files[0];

    clearStoredResults();

    if (!jobDescription || !resumeFile) {
      showError('Please provide both a job description and a resume.');
      return;
    }
    if (countWords(jobDescription) > 5000) {
      showError('Job description exceeds 5000 words.');
      return;
    }
    if (resumeFile.size > 5 * 1024 * 1024) {
      showError('Resume file size exceeds 5MB.');
      return;
    }
    if (resumeFile.type !== 'application/pdf') {
      showError('Please upload a PDF file.');
      return;
    }

    analyzeBtn.disabled = true;
    spinner.style.display = 'block';
    resultsDiv.style.display = 'none';

    const formData = new FormData();
    formData.append('resume', resumeFile);
    formData.append('jobDescription', jobDescription);

    try {
      const response = await axios.post('/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 30000
      });

      const { jobKeywords, resumeKeywords, matchPercentage, missingKeywords } = response.data;
      const missing = missingKeywords || [];

      renderKeywords(jobKeywords, jobKeywordsDiv);
      renderKeywords(resumeKeywords, resumeKeywordsDiv);

      const pct = Number(matchPercentage) || 0;
      const ring = pct >= 60 ? '#5aa831' : pct >= 40 ? '#f6a800' : '#d64545';
      matchScoreDiv.innerHTML = `<div class="progress-circle" style="--percentage:${pct};--ring:${ring}" data-text="${pct}%"></div><p class="score-label">Resume match score</p>`;
      const jobCount = flatten(jobKeywords).length;
      document.getElementById('stat-job').textContent = jobCount;
      document.getElementById('stat-resume').textContent = flatten(resumeKeywords).length;
      document.getElementById('stat-missing').textContent = missing.length;
      document.getElementById('stat-matched').textContent = Math.max(jobCount - missing.length, 0);

      missingKeywordsDiv.innerHTML = '<h3>Missing Keywords</h3>';
      buildBadgeSections([
        { title: 'Technical Skills', data: (jobKeywords?.technicalSkills || []).filter(k => missing.includes(k)), class: 'technical-skill' },
        { title: 'Soft Skills', data: (jobKeywords?.softSkills || []).filter(k => missing.includes(k)), class: 'soft-skill' },
        { title: 'Tools', data: (jobKeywords?.tools || []).filter(k => missing.includes(k)), class: 'tool' }
      ], missingKeywordsDiv);
      if (missing.length === 0) {
        missingKeywordsDiv.innerHTML += '<p class="text-green-300">No missing keywords! 🎉</p>';
      }

      requirementsGrid.innerHTML = '';
      [
        { title: 'Technical Skills', data: jobKeywords?.technicalSkills },
        { title: 'Soft Skills', data: jobKeywords?.softSkills },
        { title: 'Tools', data: jobKeywords?.tools }
      ].forEach(category => {
        const card = document.createElement('div');
        card.className = 'card';
        const h3 = document.createElement('h3');
        h3.textContent = category.title;
        card.appendChild(h3);
        if (category.data && category.data.length > 0) {
          const badgeContainer = document.createElement('div');
          badgeContainer.className = 'flex flex-wrap gap-2';
          category.data.forEach(keyword => {
            const badge = document.createElement('span');
            badge.className = 'keyword-badge technical-skill';
            badge.textContent = keyword;
            badgeContainer.appendChild(badge);
          });
          card.appendChild(badgeContainer);
        } else {
          const p = document.createElement('p');
          p.textContent = 'No items found.';
          card.appendChild(p);
        }
        requirementsGrid.appendChild(card);
      });

      resultsDiv.style.display = 'block';
      resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });

      aiAnalysisDiv.innerHTML = `
        <h3>AI Analysis & Suggestions</h3>
        <div class="bg-white/5 p-4 rounded-lg"><em>Generating analysis with AI...</em></div>`;

      try {
        const resumeText = response.data.resumeText || flatten(resumeKeywords).join(', ');
        const jdText = response.data.jobDescriptionText || flatten(jobKeywords).join(', ');
        const hfPrompt = `You are an expert recruiter analyzing a resume against a job description for an ATS tool.
Do NOT explain, repeat, or reference these instructions.
Do NOT show any calculation steps, skill counting, or meta-analysis in your output.
If the ATS match score is 60% or higher, highlight the candidate's strengths and suitability, providing 1-2 specific suggestions for resume improvement.
If below 60%, emphasize skill gaps and offer constructive feedback on how to improve the resume for the role.
The summary must be concise (50-100 words).
Include eligible or not for the post in the Overall Result.
ATS match score: ${pct}%

Resume: ${resumeText}
Job Description: ${jdText}

Output Format (no extra lines, no commentary, no calculations):
Positives
Negatives
Suggestions
Overall Result

Make sure to provide a clear, structured response without any additional explanations or meta-analysis.`;

        const hfResponse = await getAIAnalysis(hfPrompt);
        let aiText = hfResponse?.choices?.[0]?.message?.content;
        if (!aiText) {
          aiText = hfResponse?.data || hfResponse?.result || JSON.stringify(hfResponse);
        }
        renderAiAnalysis(aiText);
      } catch (aiErr) {
        const msg = typeof aiErr?.message === 'string' ? aiErr.message : JSON.stringify(aiErr);
        renderAiError(msg);
      }

      localStorage.setItem('matchScore', pct);
      localStorage.setItem('missingKeywords', JSON.stringify(missing));
      localStorage.setItem('requirements', JSON.stringify(flatten(jobKeywords)));
      localStorage.setItem('jobKeywords', JSON.stringify(flatten(jobKeywords)));
      localStorage.setItem('resumeKeywords', JSON.stringify(flatten(resumeKeywords)));
    } catch (err) {
      let msg = 'An error occurred while analyzing. Please try again.';
      const apiErr = err.response?.data?.error;
      if (apiErr) {
        msg = typeof apiErr === 'string' ? apiErr : JSON.stringify(apiErr);
      } else if (err.code === 'ECONNABORTED') {
        msg = 'Request timed out. Please try again.';
      } else if (err.message) {
        msg = err.message;
      }
      showError(msg);
      console.error('Error during analysis:', err);
    } finally {
      analyzeBtn.disabled = false;
      spinner.style.display = 'none';
    }
  });
});