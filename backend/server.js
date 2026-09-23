import 'dotenv/config';
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
const distDir = path.join(projectRoot, 'dist');
const configuredPython = process.env.PYTHON_BIN;
const bundledPython = process.platform === 'win32'
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

await fs.mkdir(photosDir, { recursive: true });

async function resolvePythonCommand() {
  const candidates = configuredPython
    ? [configuredPython]
    : [bundledPython, process.platform === 'win32' ? 'python' : 'python3', 'python'];

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) return candidate;

    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next configured runtime.
    }
  }

  throw new Error(
    'Python runtime not found. Install Python or set PYTHON_BIN to its executable path.',
  );
}

async function hasBuiltAssets() {
  try {
    await fs.access(distDir);
    return true;
  } catch {
    return false;
  }
}

function runAnalyzer() {
  return resolvePythonCommand().then((pythonCommand) => new Promise((resolve, reject) => {
    const python = spawn(pythonCommand, ['final.py'], {
      cwd: __dirname,
      env: process.env,
    });
    let output = '';

    python.stdout.on('data', chunk => { output += chunk.toString(); });
    python.stderr.on('data', chunk => { output += chunk.toString(); });
    python.on('error', error => reject(new Error(`Could not start Python analyzer: ${error.message}`)));
    python.on('close', async code => {
      if (code !== 0) {
        reject(new Error(output.trim() || `Python analyzer exited with code ${code}`));
        return;
      }

      try {
        const result = await fs.readFile(outputFile, 'utf8');
        resolve(JSON.parse(result));
      } catch (error) {
        reject(new Error(`Analyzer output could not be read: ${error.message}`));
      }
    });
  }));
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const useDist = await hasBuiltAssets();
if (useDist) {
  app.use(express.static(distDir));
}

app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/dashboard', (_req, res) => {
  if (useDist) {
    return res.sendFile(path.join(distDir, 'index.html'));
  }
  return res.sendFile(path.join(projectRoot, 'index.html'));
});
app.get('/report', (_req, res) => {
  if (useDist) {
    return res.sendFile(path.join(distDir, 'index.html'));
  }
  return res.sendFile(path.join(projectRoot, 'index.html'));
});
app.get('/repository', (_req, res) => {
  if (useDist) {
    return res.sendFile(path.join(distDir, 'index.html'));
  }
  return res.sendFile(path.join(projectRoot, 'index.html'));
});

app.post('/login', (req, res) => {
  res.redirect(req.body.role === 'inspector' ? '/dashboard' : '/');
});

app.post('/submit-inspection', (req, res) => {
  res.json({ ok: true, decision: req.body.decision || null });
});

app.post('/upload-photos', (req, res, next) => {
  upload.array('photos', 10)(req, res, async (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ ok: false, error: 'Each image must be 10 MB or smaller.' });
      }
      if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_COUNT') {
        return res.status(413).json({ ok: false, error: 'Upload no more than 10 images at a time.' });
      }
      if (uploadError.message === 'Unexpected field') {
        return res.status(400).json({ ok: false, error: 'Use the photos upload field for image files.' });
      }
      return next(uploadError);
    }

    if (!req.files?.length) {
      return res.status(400).json({ ok: false, error: 'At least one image is required.' });
    }

    try {
      const analysis = await runAnalyzer();
      res.json({ ok: true, files: req.files.map(file => file.filename), analysis });
    } catch (error) {
      console.error(error);
      const status = error.message.includes('GEMINI_API_KEY')
        || error.message.includes('Python runtime')
        || error.message.includes('ModuleNotFoundError')
        ? 503
        : 500;
      res.status(status).json({ ok: false, error: error.message });
    } finally {
      await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => { })));
    }
  });
});

app.use((error, _req, res, next) => {
  if (res.headersSent) return next(error);
  console.error(error);
  res.status(500).json({ ok: false, error: 'The upload could not be processed.' });
});

app.get('*', (req, res) => {
  const indexFile = useDist ? path.join(distDir, 'index.html') : path.join(projectRoot, 'index.html');
  res.sendFile(indexFile);
});

app.listen(port, () => {
  console.log(`Simpler server is running on http://localhost:${port}`);
});
