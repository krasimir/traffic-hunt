const path = require('node:path');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 3499);

app.use(express.text({ type: 'application/json', limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/upload', (req, res) => {
  if (!req.body) {
    res.status(400).json({ error: 'Choose a JSON capture file first.' });
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(req.body);
  } catch (error) {
    res.status(400).json({ error: `Invalid JSON: ${error.message}` });
    return;
  }

  if (!Array.isArray(parsed)) {
    res.status(400).json({ error: 'Expected the capture file to contain a JSON array.' });
    return;
  }

  res.json({
    fileName: req.header('x-file-name') || 'capture.json',
    entries: parsed,
  });
});

app.listen(port, () => {
  console.log(`traffic-hunt explorer listening at http://localhost:${port}`);
});
