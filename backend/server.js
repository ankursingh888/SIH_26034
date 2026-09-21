import 'dotenv/config';
import pg from 'pg';
import express from 'express';
import fs from 'node:fs/promises';
import multer from 'multer';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

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

function deriveInspectionStatus(analysis) {
  const audit = analysis?.step_3_metrology_essentials_audit || {};
  const requiredRules = [
    audit.rule_1_manufacturer_packer_importer_details,
    audit.rule_3_generic_or_common_name,
    audit.rule_4_net_quantity_declaration,
    audit.rule_5_mrp_and_tax_inclusivity,
    audit.rule_6_month_and_year_of_manufacture_or_pack
  ];

  const missingRequiredDeclaration = requiredRules.some(rule =>
    !rule?.declared_text
  );
  const missingTaxStatement = audit.rule_5_mrp_and_tax_inclusivity &&
    audit.rule_5_mrp_and_tax_inclusivity.has_inclusive_of_taxes_statement === false;
  const primaryDeclarationsMissing =
    audit.rule_9_core_statutory_obligation?.all_primary_declarations_present === false;

  if (missingRequiredDeclaration || missingTaxStatement || primaryDeclarationsMissing) {
    return 'non-compliant';
  }

  const hasLowConfidence = Object.values(audit).some(rule =>
    rule && typeof rule === 'object' &&
    Object.values(rule).some(value => value === 'Low')
  );

  return hasLowConfidence ? 'review' : 'compliant';
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
        const productInfo =
      analysis.step_2_structured_info?.basic_info || {};

    const productType =
      analysis.step_1_product_identification?.product_type || null;

    const productName =
      productInfo.product_name || null;

    const reportId = `LM-${new Date().getFullYear()}-${randomUUID()
      .slice(0, 8)
      .toUpperCase()}`;
    const status = deriveInspectionStatus(analysis);

    const savedResult = await pool.query(
      `
        INSERT INTO inspections (
          report_id,
          product_type,
          product_name,
          status,
          uploaded_files,
          analysis
        )
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
        RETURNING id, report_id, created_at
      `,
      [
        reportId,
        productType,
        productName,
        status,
        JSON.stringify(req.files.map(file => file.filename)),
        JSON.stringify(analysis)
      ]
    );

    // Automatically cleanup uploaded photos after processing
    await Promise.all(req.files.map(file => fs.unlink(file.path).catch(() => { })));

res.json({
  ok: true,
  files: req.files.map(file => file.filename),
  analysis,
  inspection: savedResult.rows[0]
});
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/inspections', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        report_id,
        product_type,
        product_name,
        status,
        created_at
      FROM inspections
      ORDER BY created_at DESC
    `);

    res.json({ ok: true, inspections: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: 'Could not load inspections.'
    });
  }
});

app.get('/api/inspections/:reportId', async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT *
        FROM inspections
        WHERE report_id = $1
      `,
      [req.params.reportId]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'Inspection not found.'
      });
    }

    res.json({ ok: true, inspection: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      ok: false,
      error: 'Could not load inspection.'
    });
  }
});
app.listen(port, () => {
  console.log(`Simpler server is running on http://localhost:${port}`);
});
