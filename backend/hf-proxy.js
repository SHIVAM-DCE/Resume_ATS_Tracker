// Google Gemini Proxy Route
const express = require('express');
const router = express.Router();
require('dotenv').config();
const axios = require('axios');
const { InferenceClient } = require('@huggingface/inference');

// Ensure JSON body parsing for this router
router.use(express.json());

const client = new InferenceClient(process.env.HF_TOKEN);

router.post('/hf-analyze', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt for AI analysis.' });

    // Hugging Face chatCompletion API call
    const chatCompletion = await client.chatCompletion({
      provider: 'novita',
      model: 'MiniMaxAI/MiniMax-M1-80k',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });
    res.json(chatCompletion);
  } catch (err) {
    if (err.response) {
      console.error('Hugging Face API error:', err.response.status, err.response.data);
    } else {
      console.error('Hugging Face API error:', err.message);
    }
    res.status(500).json({
      error: 'Failed to get AI analysis from Hugging Face.',
      details: err.response?.data || err.message
    });
  }
});

// Only GOOGLE_API_KEY is needed for Gemini. Remove unused tokens from your .env file if you wish.

module.exports = router;
