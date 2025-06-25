require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const hfProxy = require('./hf-proxy');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend files from ../frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Fallback: send index.html for any non-API route (for React/HTML SPAs)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ================= File Upload Setup ===================

const uploadDir = path.join(__dirname, 'uploads'); // <-- fixed case to match actual folder
async function ensureUploadDir() {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    console.log('Uploads directory ready:', uploadDir);
  } catch (err) {
    console.error('Error creating uploads directory:', err.message);
  }
}
ensureUploadDir();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  }
}).single('resume');

// ================= Skill Extraction ===================

let itRolesSkills = {};
async function loadSkills() {
  try {
    const data = await fs.readFile(path.join(__dirname, 'Imp_skills.json'), 'utf8');
    itRolesSkills = JSON.parse(data);
    console.log('Imp_skills.json loaded successfully');
  } catch (err) {
    console.error('Error loading Imp_skills.json:', err.message);
    itRolesSkills = {};
  }
}
loadSkills();

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const extractKeywords = (text) => {
  const technicalSkills = new Set();
  const softSkills = new Set();
  const tools = new Set();
  const textLower = text.toLowerCase();

  for (const role of Object.values(itRolesSkills)) {
    role['Technical Skills']?.forEach(skill => {
      const regex = new RegExp(`\\b${escapeRegex(skill.toLowerCase())}\\b`, 'i');
      if (regex.test(textLower)) technicalSkills.add(skill);
    });
    role['Soft Skills']?.forEach(skill => {
      const regex = new RegExp(`\\b${escapeRegex(skill.toLowerCase())}\\b`, 'i');
      if (regex.test(textLower)) softSkills.add(skill);
    });
    role['Tools']?.forEach(tool => {
      const regex = new RegExp(`\\b${escapeRegex(tool.toLowerCase())}\\b`, 'i');
      if (regex.test(textLower)) tools.add(tool);
    });
  }

  return {
    technicalSkills: Array.from(technicalSkills).sort(),
    softSkills: Array.from(softSkills).sort(),
    tools: Array.from(tools).sort(),
    allKeywords: Array.from(new Set([
      ...technicalSkills,
      ...softSkills,
      ...tools
    ])).sort()
  };
};

const calculateMatchPercentage = (resumeKeywords, jobKeywords) => {
  const resumeSet = new Set(resumeKeywords.map(k => k.toLowerCase()));
  const jobSet = new Set(jobKeywords.map(k => k.toLowerCase()));
  const matchingKeywords = [...resumeSet].filter(k => jobSet.has(k));
  const missingKeywords = [...jobSet].filter(k => !resumeSet.has(k));
  const matchPercentage = jobSet.size > 0 ? (matchingKeywords.length / jobSet.size) * 100 : 0;

  return {
    matchPercentage: Math.round(matchPercentage * 100) / 100,
    missingKeywords: missingKeywords.map(k => jobKeywords.find(jk => jk.toLowerCase() === k) || k)
  };
};

// ================= Resume Analysis API ===================

app.use(hfProxy);

app.post('/analyze', (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { jobDescription } = req.body;
    const resume = req.file;

    if (!resume || !jobDescription?.trim()) {
      return res.status(400).json({ error: 'Please provide both a job description and a PDF resume' });
    }

    try {
      await fs.access(resume.path);
      const pdfData = await pdfParse(resume.path);
      const resumeText = pdfData.text;

      const jobKeywords = extractKeywords(jobDescription);
      const resumeKeywords = extractKeywords(resumeText);

      const { matchPercentage, missingKeywords } = calculateMatchPercentage(
        resumeKeywords.allKeywords,
        jobKeywords.allKeywords
      );

      // Call Hugging Face AI analysis
      let aiAnalysis = null;
      try {
        const hfApiKey = process.env.HF_API_KEY;
        if (!hfApiKey) throw new Error('Hugging Face API key not set in environment');
        const prompt = `You are an expert recruiter analyzing a resume against a job description for an ATS tool.\nDo NOT explain, repeat, or reference these instructions.\nDo NOT show any calculation steps, skill counting, or meta-analysis in your output.\nIf the ATS match score is 60% or higher, highlight the candidate's strengths and suitability, providing 1-2 specific suggestions for resume improvement.\nIf below 60%, emphasize skill gaps and offer constructive feedback on how to improve the resume for the role.\nThe summary must be concise (50-100 words).\nInclude eligible or not for the post in the Overall Result.\n\nResume: ${resumeText}\nJob Description: ${jobDescription}\n\nOutput Format (no extra lines, no commentary, no calculations):\nPositives\nNegatives\nSuggestions\nOverall Result\n\nMake sure to provide a clear, structured response without any additional explanations or meta-analysis.`;
        const hfResponse = await axios.post(
          'https://api-inference.huggingface.co/v1/chat/completions',
          {
            model: 'meta-llama/Meta-Llama-3-8B-Instruct',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 256
          },
          {
            headers: {
              'Authorization': `Bearer ${hfApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          }
        );
        aiAnalysis = hfResponse.data;
      } catch (hfErr) {
        aiAnalysis = { error: `Hugging Face API error: ${hfErr.response?.data?.error || hfErr.message}` };
      }

      await fs.unlink(resume.path).catch(err => console.error('File delete error:', err.message));
      res.json({ jobKeywords, resumeKeywords, matchPercentage, missingKeywords, aiAnalysis });

    } catch (err) {
      res.status(500).json({ error: `Server error: ${err.message}` });
    }
  });
});

// ================= Hugging Face Proxy Endpoint ===================
app.post('/ai-analysis', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });
    const hfApiKey = process.env.HF_API_KEY;
    if (!hfApiKey) return res.status(500).json({ error: 'Hugging Face API key not set in environment' });
    const response = await axios.post(
      'https://api-inference.huggingface.co/v1/chat/completions',
      {
        model: 'meta-llama/Meta-Llama-3-8B-Instruct',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 256
      },
      {
        headers: {
          'Authorization': `Bearer ${hfApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: `Hugging Face API error: ${err.response?.data?.error || err.message}` });
  }
});

// ✅ Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Local:   http://localhost:${port}`);
  if (process.env.WEBSITE_HOSTNAME) {
    console.log(`Azure:   https://${process.env.WEBSITE_HOSTNAME}`);
  }
});
