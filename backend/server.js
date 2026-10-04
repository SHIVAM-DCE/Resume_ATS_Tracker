require('dotenv').config();
const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const HF_URL = 'https://router.huggingface.co/v1/chat/completions';
const HF_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again in a few minutes.' }
});
app.use(['/analyze', '/ai-analysis'], limiter);
app.use(express.json({ limit: '1mb' }));

app.use(express.static(path.join(__dirname, '../frontend')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

const uploadDir = path.join(__dirname, 'uploads');
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
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
  }
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

function formatHfError(err) {
  const data = err.response?.data;
  const status = err.response?.status;
  let detail;
  if (data) {
    detail = typeof data === 'string' ? data : JSON.stringify(data);
  } else {
    detail = err.message;
  }
  return `Hugging Face API error${status ? ' (' + status + ')' : ''}: ${detail}`;
}


app.post('/analyze', (req, res) => {
  upload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const { jobDescription } = req.body;
    const resume = req.file;

    if (!resume || !jobDescription?.trim()) {
      if (resume) await fs.unlink(resume.path).catch(() => {});
      return res.status(400).json({ error: 'Please provide both a job description and a PDF resume' });
    }

    try {
      await fs.access(resume.path);
      let pdfData;
      try {
        pdfData = await pdfParse(await fs.readFile(resume.path));
      } catch (pdfParseErr) {
        await fs.unlink(resume.path).catch(() => {});
        return res.status(400).json({ error: 'Unable to read the uploaded PDF. Please upload a valid text-based PDF.' });
      }

      const resumeText = (pdfData?.text || '').trim();
      if (!resumeText) {
        await fs.unlink(resume.path).catch(() => {});
        return res.status(400).json({ error: 'The uploaded PDF does not contain readable text. Please upload a valid text-based PDF.' });
      }

      const jobKeywords = extractKeywords(jobDescription);
      const resumeKeywords = extractKeywords(resumeText);

      const { matchPercentage, missingKeywords } = calculateMatchPercentage(
        resumeKeywords.allKeywords,
        jobKeywords.allKeywords
      );

      await fs.unlink(resume.path).catch(e => console.error('File delete error:', e.message));

      // AI analysis is done by the frontend via /ai-analysis
      res.json({
        jobKeywords,
        resumeKeywords,
        matchPercentage,
        missingKeywords,
        resumeText: resumeText.slice(0, 6000),
        jobDescriptionText: jobDescription.slice(0, 4000)
      });
    } catch (e) {
      res.status(500).json({ error: `Server error: ${e.message}` });
    }
  });
});

app.post('/ai-analysis', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Prompt is required' });

    const hfApiKey = process.env.HF_API_KEY || process.env.HF_TOKEN;
    if (!hfApiKey) {
      return res.status(500).json({ error: 'Hugging Face key not set in .env (HF_API_KEY)' });
    }

    const response = await axios.post(
      HF_URL,
      {
        model: HF_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800
      },
      {
        headers: {
          'Authorization': `Bearer ${hfApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error(formatHfError(err));
    res.status(500).json({ error: formatHfError(err) });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  console.log(`Local:   http://localhost:${port}`);
  if (process.env.WEBSITE_HOSTNAME) {
    console.log(`Azure:   https://${process.env.WEBSITE_HOSTNAME}`);
  }
});