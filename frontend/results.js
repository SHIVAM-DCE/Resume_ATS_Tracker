const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };

document.addEventListener('DOMContentLoaded', () => {
  const pct = Number(get('matchScore', null));
  const job = get('jobKeywords', []);
  const resume = get('resumeKeywords', []);
  if (localStorage.getItem('matchScore') === null && !job.length && !resume.length) {
    window.location.href = 'index.html';
    return;
  }
  const missing = get('missingKeywords', []);
  const reqs = get('requirements', []);
  const sections = get('aiSections', null);

  const badges = (el, list, cls) => {
    el.textContent = '';
    if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nothing to show.'; el.appendChild(p); return; }
    list.forEach(t => { const s = document.createElement('span'); s.className = 'keyword-badge ' + cls; s.textContent = t; el.appendChild(s); });
  };

  const ring = document.createElement('div');
  ring.className = 'progress-circle';
  ring.style.setProperty('--percentage', pct || 0);
  ring.style.setProperty('--ring', pct >= 60 ? '#5aa831' : pct >= 40 ? '#f6a800' : '#d64545');
  ring.dataset.text = (pct || 0) + '%';
  const label = document.createElement('p');
  label.className = 'score-label';
  label.textContent = 'Resume match score';
  document.getElementById('match-score').append(ring, label);

  badges(document.getElementById('missing-keywords'), missing, 'tool');
  badges(document.getElementById('job-keywords-content'), job, 'technical-skill');
  badges(document.getElementById('resume-keywords-content'), resume, 'soft-skill');
  badges(document.getElementById('requirements-grid'), reqs, 'technical-skill');

  const ai = document.getElementById('ai-analysis');
  const h3 = document.createElement('h3');
  h3.textContent = 'AI analysis and suggestions';
  ai.appendChild(h3);
  if (!sections) {
    const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'AI analysis is not available for this run.'; ai.appendChild(p);
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'ai-grid';
  const cls = { Positives: 'pos', Negatives: 'neg', Suggestions: 'sug', 'Overall Result': 'res' };
  Object.keys(sections).forEach(name => {
    const card = document.createElement('div');
    card.className = 'ai-card ' + (cls[name] || '');
    const h4 = document.createElement('h4'); h4.textContent = name; card.appendChild(h4);
    const ul = document.createElement('ul');
    sections[name].forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    card.appendChild(ul); grid.appendChild(card);
  });
  ai.appendChild(grid);
});
