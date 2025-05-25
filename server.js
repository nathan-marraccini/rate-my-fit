const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.post('/api/rate-outfit', async (req, res) => {
  console.log('Received request to rate outfit');
  try {
    console.log('Sending request to Claude API...');
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.REACT_APP_CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });

    console.log('Claude API response status:', response.status);
    const data = await response.json();
    console.log('Claude API response data:', data);
    res.json(data);
  } catch (error) {
    console.error('Error in proxy server:', error);
    res.status(500).json({ error: 'Failed to rate outfit' });
  }
});

app.listen(port, () => {
  console.log(`Proxy server running on port ${port}`);
}); 