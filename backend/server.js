const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const hfProxy = require('./hf-proxy');

const app = express();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'Uploads');
async function ensureUploadDir() {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    console.log('Uploads directory ready:', uploadDir);
  } catch (err) {
    console.error('Error creating uploads directory:', err.message);
  }
}
ensureUploadDir();

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      console.error('Invalid file type:', file.mimetype);
      return cb(new Error('Only PDF files are allowed'));
    }
    cb(null, true);
  }
}).single('resume');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(hfProxy);

// Load skills JSON
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

// Function to escape special regex characters
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const extractKeywords = (text) => {
  console.log('Extracting keywords from text (length:', text.length, ')');
  const technicalSkills = new Set();
  const softSkills = new Set();
  const tools = new Set();
  const textLower = text.toLowerCase();

  for (const role of Object.values(itRolesSkills)) {
    role['Technical Skills']?.forEach(skill => {
      try {
        const escapedSkill = escapeRegex(skill);
        const regex = new RegExp(`\\b${escapedSkill.toLowerCase()}\\b`, 'i');
        if (regex.test(textLower)) technicalSkills.add(skill);
      } catch (err) {
        console.error(`Invalid regex for skill "${skill}":`, err.message);
      }
    });
    role['Soft Skills']?.forEach(skill => {
      try {
        const escapedSkill = escapeRegex(skill);
        const regex = new RegExp(`\\b${escapedSkill.toLowerCase()}\\b`, 'i');
        if (regex.test(textLower)) softSkills.add(skill);
      } catch (err) {
        console.error(`Invalid regex for soft skill "${skill}":`, err.message);
      }
    });
    role['Tools']?.forEach(tool => {
      try {
        const escapedTool = escapeRegex(tool);
        const regex = new RegExp(`\\b${escapedTool.toLowerCase()}\\b`, 'i');
        if (regex.test(textLower)) tools.add(tool);
      } catch (err) {
        console.error(`Invalid regex for tool "${tool}":`, err.message);
      }
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
  console.log('Calculating match percentage');
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

app.post('/analyze', (req, res) => {
  console.log('POST /analyze requested');
  upload(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err.message);
      return res.status(400).json({ error: err.message });
    }

    try {
      const { jobDescription } = req.body;
      const resume = req.file;

      console.log('Inputs:', {
        jobDescription: jobDescription ? `${jobDescription.slice(0, 20)}...` : 'Missing',
        resume: resume ? resume.originalname : 'Missing'
      });

      if (!resume || !jobDescription) {
        console.error('Validation failed: Missing inputs');
        return res.status(400).json({ error: 'Please provide both a job description and a resume' });
      }

      if (!jobDescription.trim()) {
        console.error('Validation failed: Empty job description');
        return res.status(400).json({ error: 'Job description cannot be empty' });
      }

      try {
        await fs.access(resume.path);
        console.log('Resume file accessible:', resume.path);
      } catch (err) {
        console.error('Error accessing resume file:', err.message);
        return res.status(500).json({ error: 'Unable to access uploaded resume file' });
      }

      console.log('Parsing PDF:', resume.path);
      let pdfData;
      try {
        pdfData = await pdfParse(resume.path);
      } catch (err) {
        console.error('PDF parsing error:', err.message);
        return res.status(400).json({ error: 'Invalid or corrupted PDF file' });
      }
      const resumeText = pdfData.text;
      console.log('PDF text extracted, length:', resumeText.length);

      const jobKeywords = extractKeywords(jobDescription);
      const resumeKeywords = extractKeywords(resumeText);
      console.log('Keywords:', { jobKeywords, resumeKeywords });

      const { matchPercentage, missingKeywords } = calculateMatchPercentage(
        resumeKeywords.allKeywords,
        jobKeywords.allKeywords
      );
      console.log('Match result:', { matchPercentage, missingKeywords });

      const aiAnalysis = {
        positives: resumeKeywords.allKeywords.length > 0 ? 'Strong alignment with job requirements' : 'Some relevant skills detected',
        negatives: missingKeywords.length > 0 ? `Missing key skills: ${missingKeywords.join(', ')}` : 'No significant gaps',
        suggestions: 'Highlight specific projects related to job requirements. Use action verbs to describe achievements.',
        overall: matchPercentage >= 60
          ? `Suitable for the role with a ${matchPercentage}% match`
          : `Not suitable due to insufficient skill overlap (${matchPercentage}%)`
      };

      await fs.unlink(resume.path).catch(err => console.error('Error deleting file:', err.message));

      res.json({
        jobKeywords,
        resumeKeywords,
        matchPercentage,
        missingKeywords,
        aiAnalysis
      });
    } catch (err) {
      console.error('Error in /analyze:', err.message, err.stack);
      res.status(500).json({ error: `Server error: ${err.message}` });
    }
  });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));