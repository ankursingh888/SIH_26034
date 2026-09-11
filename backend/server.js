import express from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, '..');
const app = express();
const port = process.env.PORT || 3001;
const photosDir = path.join(__dirname, 'photos');
const outputFile = path.join(__dirname, 'structured_output.json');
const pythonCommand = process.platform === 'win32'
  ? path.join(__dirname, 'final_env', 'Scripts', 'python.exe')
  : path.join(__dirname, 'final_env', 'bin', 'python');
const upload = multer({
  storage: multer.diskStorage({
    destination: photosDir,
    filename: (req, file, callback) => {
      callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { files: 10, fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, callback) => {
    callback(null, file.mimetype.startsWith('image/'));
  }
});

function runAnalyzer() {
  return new Promise((resolve, reject) => {
    const python = spawn(pythonCommand, ['final.py'], { cwd: __dirname });
    let errorOutput = '';

    python.stderr.on('data', chunk => { errorOutput += chunk.toString(); });
    python.on('error', error => reject(new Error(`Could not start Python analyzer: ${error.message}`)));
    python.on('close', async code => {
      if (code !== 0) {
        reject(new Error(errorOutput.trim() || `Python analyzer exited with code ${code}`));
        return;
      }

      try {
        const result = await fs.readFile(outputFile, 'utf8');
        resolve(JSON.parse(result));
      } catch (error) {
        reject(new Error(`Analyzer output could not be read: ${error.message}`));
      }
    });
  });
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(projectRoot));

app.get('/', (req, res) => res.sendFile(path.join(projectRoot, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(projectRoot, 'dashboard.html')));
app.get('/report', (req, res) => res.sendFile(path.join(projectRoot, 'report.html')));
app.get('/repository', (req, res) => res.sendFile(path.join(projectRoot, 'repository.html')));

app.post('/login', (req, res) => {
  res.redirect(req.body.role === 'inspector' ? '/dashboard' : '/');
});

app.post('/submit-inspection', (req, res) => {
  res.json({ ok: true, decision: req.body.decision || null });
});

app.post('/upload-photos', upload.array('photos', 10), async (req, res) => {
  if (!req.files?.length) {
    return res.status(400).json({ ok: false, error: 'At least one image is required.' });
  }

  try {
    const analysis = await runAnalyzer();

    // Automatically cleanup uploaded photos after processing
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => { })));

    res.json({ ok: true, files: req.files.map(file => file.filename), analysis });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});


app.listen(port, () => {
  console.log(`Simpler server is running on http://localhost:${port}`);
});
