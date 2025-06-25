import { getAIAnalysis } from './huggingface-ai.js';

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
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }

  function countWords(text) {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
  }

  // Toggle Help Section
  helpBtn.addEventListener('click', () => {
    helpSection.classList.toggle('active');
    overlay.classList.toggle('active');
  });

  closeHelpBtn.addEventListener('click', () => {
    helpSection.classList.remove('active');
    overlay.classList.remove('active');
  });

  overlay.addEventListener('click', () => {
    helpSection.classList.remove('active');
    overlay.classList.remove('active');
  });

  function renderKeywords(keywords, container) {
    const contentDiv = container.querySelector('[id$="-content"]');
    contentDiv.innerHTML = '';
    if (!keywords) {
      contentDiv.innerHTML = '<p>No keywords found.</p>';
      return;
    }
    const sections = [
      { title: 'Technical Skills', data: keywords.technicalSkills, class: 'technical-skill' },
      { title: 'Soft Skills', data: keywords.softSkills, class: 'soft-skill' },
      { title: 'Tools', data: keywords.tools, class: 'tool' }
    ];
    sections.forEach(section => {
      if (section.data && section.data.length > 0) {
        const div = document.createElement('div');
        div.className = 'mt-2';
        div.innerHTML = `<h4 class="font-semibold">${section.title}</h4>`;
        const badgeContainer = document.createElement('div');
        badgeContainer.className = 'flex flex-wrap gap-2 mt-2';
        section.data.forEach(keyword => {
          const badge = document.createElement('span');
          badge.className = `keyword-badge ${section.class}`;
          badge.textContent = keyword;
          badgeContainer.appendChild(badge);
        });
        div.appendChild(badgeContainer);
        contentDiv.appendChild(div);
      }
    });
  }

  analyzeBtn.addEventListener('click', async () => {
    errorDiv.classList.remove('error-visible');
    if (errorTimeout) clearTimeout(errorTimeout);
    const jobDescription = jobDescriptionInput.value.trim();
    const resumeFile = resumeFileInput.files[0];
    const wordCount = countWords(jobDescription);
    if (wordCount > 5000) {
      showError('Job description exceeds 5000 words.');
      return;
    }
    if (!jobDescription || !resumeFile) {
      showError('Please provide both a job description and a resume.');
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
    if (!errorDiv.classList.contains('error-visible')) {
      resultsDiv.style.display = 'none';
    }
    const formData = new FormData();
    formData.append('resume', resumeFile);
    formData.append('jobDescription', jobDescription);
    try {
      const response = await axios.post('/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 10000
      });
      const { jobKeywords, resumeKeywords, matchPercentage, missingKeywords } = response.data;
      renderKeywords(jobKeywords, jobKeywordsDiv);
      renderKeywords(resumeKeywords, resumeKeywordsDiv);
      matchScoreDiv.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div class="progress-circle" style="--percentage: ${matchPercentage}" data-text="${matchPercentage}%" ></div>
          <p class="text-center text-lg font-semibold mt-2" style="margin-top: 1rem;">Resume Match Score</p>
        </div>
      `;
      missingKeywordsDiv.innerHTML = '<h3>Missing Keywords</h3>';
      const missingSections = [
        { title: 'Technical Skills', data: jobKeywords.technicalSkills.filter(k => missingKeywords.includes(k)), class: 'technical-skill' },
        { title: 'Soft Skills', data: jobKeywords.softSkills.filter(k => missingKeywords.includes(k)), class: 'soft-skill' },
        { title: 'Tools', data: jobKeywords.tools.filter(k => missingKeywords.includes(k)), class: 'tool' }
      ];
      missingSections.forEach(section => {
        if (section.data && section.data.length > 0) {
          const div = document.createElement('div');
          div.className = 'mt-2';
          div.innerHTML = `<h4 class="font-semibold">${section.title}</h4>`;
          const badgeContainer = document.createElement('div');
          badgeContainer.className = 'flex flex-wrap gap-2 mt-2';
          section.data.forEach(keyword => {
            const badge = document.createElement('span');
            badge.className = `keyword-badge ${section.class}`;
            badge.textContent = keyword;
            badgeContainer.appendChild(badge);
          });
          div.appendChild(badgeContainer);
          missingKeywordsDiv.appendChild(div);
        }
      });
      if (!missingKeywords || missingKeywords.length === 0) {
        missingKeywordsDiv.innerHTML += '<p class="text-green-300">No missing keywords! 🎉</p>';
      }
      aiAnalysisDiv.innerHTML = `
        <h3>AI Analysis & Suggestions</h3>
        <div class="bg-white/5 p-4 rounded-lg"><em>Generating analysis with AI...</em></div>
      `;
      try {
        const hfPrompt = `You are an expert recruiter analyzing a resume against a job description for an ATS tool.\nDo NOT explain, repeat, or reference these instructions.\nDo NOT show any calculation steps, skill counting, or meta-analysis in your output.\nIf the ATS match score is 60% or higher, highlight the candidate's strengths and suitability, providing 1-2 specific suggestions for resume improvement.\nIf below 60%, emphasize skill gaps and offer constructive feedback on how to improve the resume for the role.\nThe summary must be concise (50-100 words).\nInclude eligible or not for the post in the Overall Result.\n\nResume: ${response.data.resumeText || resumeKeywords.technicalSkills.concat(resumeKeywords.softSkills, resumeKeywords.tools).join(", ")}\nJob Description: ${response.data.jobDescriptionText || jobKeywords.technicalSkills.concat(jobKeywords.softSkills, jobKeywords.tools).join(", ")}\n\nOutput Format (no extra lines, no commentary, no calculations):\nPositives\nNegatives\nSuggestions\nOverall Result\n\nMake sure to provide a clear, structured response without any additional explanations or meta-analysis.`;
        const hfResponse = await getAIAnalysis(hfPrompt);
        let aiText = hfResponse.choices?.[0]?.message?.content;
        if (!aiText) {
          aiText = hfResponse.data || hfResponse.result || JSON.stringify(hfResponse);
        }
        const lines = aiText.split('\n').filter(line => line.trim() !== '');
        aiAnalysisDiv.innerHTML = `
          <h3>AI Analysis & Suggestions</h3>
          <div class="bg-white/5 p-4 rounded-lg">
            <ul style="list-style:none;padding:0;margin:0;">
              ${lines.map(line => {
                const [section, ...rest] = line.split(':');
                return `<li style='margin-bottom:0.5em;'><strong>${section ? section.trim() : ''}${section ? ':' : ''}</strong> ${rest.join(':').trim()}</li>`;
              }).join('')}
            </ul>
          </div>`;
      } catch (aiErr) {
        aiAnalysisDiv.innerHTML = `
          <h3>AI Analysis & Suggestions</h3>
          <div class="bg-white/5 p-4 rounded-lg text-red-400">Failed to get AI analysis from Hugging Face.<br>${aiErr?.message || aiErr}</div>
        `;
      }
      requirementsGrid.innerHTML = '';
      const categories = [
        { title: 'Technical Skills', data: jobKeywords.technicalSkills },
        { title: 'Soft Skills', data: jobKeywords.softSkills },
        { title: 'Tools', data: jobKeywords.tools }
      ];
      categories.forEach(category => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<h3>${category.title}</h3>`;
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
          card.innerHTML += '<p>No items found.</p>';
        }
        requirementsGrid.appendChild(card);
      });
      resultsDiv.style.display = 'block';
    } catch (err) {
      let msg = 'An error occurred while analyzing. Please try again.';
      if (err.response && err.response.data && err.response.data.error) {
        msg = err.response.data.error;
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
