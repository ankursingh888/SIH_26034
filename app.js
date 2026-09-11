// =============================================================================
// STATIC DATA
// Dashboard summary statistics (hardcoded for now)
// =============================================================================

const STATS = {
  totalInspections: '1,284',
  complianceRate: 92,
  pendingReview: 47,
  noticesIssued: 18
};

// Legal Metrology rules shown in the Repository page
const RULES = [
  {
    id: 'Rule 6(1)(a)',
    decl: 'Name and address of Manufacturer',
    cond: 'All packaged commodities',
    amend: 'Base 2011 Rules',
    tag: 'base'
  },
  {
    id: 'Rule 6(1)(d)',
    decl: 'Month and Year of Manufacture',
    cond: 'Exempt for food articles governed by FSSAI',
    amend: 'Amendment 2022',
    tag: 'amend'
  },
  {
    id: 'Rule 6(2)',
    decl: 'Consumer Care Details',
    cond: 'Must include Name, Address, Telephone, Email',
    amend: 'Third Amendment Rules, 2026',
    tag: 'new'
  }
];


// =============================================================================
// ANALYSIS → FIELDS MAPPING
// Converts the structured_output.json returned by the Python analyzer into
// the flat array of { field, value, conf, ok } objects that renderFields() needs.
// =============================================================================

/**
 * Safely converts any JSON value (string, array, object, number, boolean)
 * into a clean, human-readable string representation.
 */
function formatValue(value) {
  if (value === null || value === undefined) return '';

  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatValue).filter(Boolean).join(', ');
  }

  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => {
        const keyLabel = k.replace(/_/g, ' ');
        if (typeof v === 'object' && v !== null) {
          return `${keyLabel}: { ${formatValue(v)} }`;
        }
        return `${keyLabel}: ${formatValue(v)}`;
      })
      .filter(Boolean)
      .join(' | ');
  }

  return String(value).trim();
}

/**
 * Maps compliance confidence rating ("High", "Medium"/"Mid", "Low") to a percentage score:
 *  - "High"   → 96%
 *  - "Medium" → 72%
 *  - "Low"    → 45%
 *  - Unknown / empty → 0%
 */
function inferConfidence(confidenceLevel) {
  if (!confidenceLevel || typeof confidenceLevel !== 'string') return 0;
  const level = confidenceLevel.trim().toLowerCase();
  if (level === 'high') return 96;
  if (level === 'medium' || level === 'mid') return 72;
  if (level === 'low') return 45;
  return 0;
}

/**
 * Creates a single field entry.
 * @param {string} label            - Human-readable field name shown in the UI
 * @param {*}      value            - Extracted value from the analysis JSON
 * @param {string} confidenceLevel  - "High", "Medium", or "Low" compliance confidence string
 */
function makeField(label, value, confidenceLevel) {
  const formatted = formatValue(value);
  const detected = Boolean(formatted && formatted.length > 0);
  const displayValue = detected ? formatted : 'Not Detected';
  return {
    field: label,
    value: displayValue,
    conf: detected ? inferConfidence(confidenceLevel) : 0,
    ok: detected
  };
}

/**
 * Converts step_3_metrology_essentials_audit from structured_output.json
 * into a flat array of field rows for the dashboard.
 *
 * @param {object} analysis - The parsed JSON from structured_output.json
 * @returns {Array<{field, value, conf, ok}>}
 */
function fieldsFromAnalysis(analysis) {
  const audit = analysis?.step_3_metrology_essentials_audit || {};
  const r1  = audit.rule_1_manufacturer_packer_importer_details || {};
  const r2  = audit.rule_2_role_classification_labeling || {};
  const r3  = audit.rule_3_generic_or_common_name || {};
  const r4  = audit.rule_4_net_quantity_declaration || {};
  const r5  = audit.rule_5_mrp_and_tax_inclusivity || {};
  const r6  = audit.rule_6_month_and_year_of_manufacture_or_pack || {};
  const r7  = audit.rule_7_consumer_care_details || {};
  const r8  = audit.rule_8_unit_sale_price_usp || {};
  const r9  = audit.rule_9_core_statutory_obligation || {};
  const r10 = audit.rule_10_country_of_origin_and_digital_disclosure || {};

  const fields = [
    makeField('Manufacturer / Packer / Importer',  r1.declared_text, r1.compliance_confidence),
    makeField('Role Classification',               r2.declared_role_prefix || r2.declared_text, r2.compliance_confidence),
    makeField('Generic / Common Name',             r3.declared_text, r3.compliance_confidence),
    makeField('Net Quantity Declaration',          r4.declared_text, r4.compliance_confidence),
    makeField('MRP & Tax Inclusivity',             r5.declared_text, r5.compliance_confidence),
    makeField('Month & Year of Manufacture',       r6.declared_text, r6.compliance_confidence),
    makeField('Consumer Care — Name',              r7.declared_name, r7.compliance_confidence),
    makeField('Consumer Care — Address',           r7.declared_address, r7.compliance_confidence),
    makeField('Consumer Care — Phone',             r7.declared_phone, r7.compliance_confidence),
    makeField('Consumer Care — Email',             r7.declared_email, r7.compliance_confidence),
    makeField('Unit Sale Price (USP)',             r8.declared_text, r8.compliance_confidence),
    makeField('Core Statutory Obligation',         r9.all_primary_declarations_present !== undefined ? (r9.all_primary_declarations_present ? 'All Primary Declarations Present' : 'Missing Declarations') : '', r9.compliance_confidence),
    makeField('Country of Origin',                 r10.declared_country_of_origin, r10.compliance_confidence),
    makeField('Digital Disclosure (Barcode/QR)',   r10.barcode_or_qr_disclosed !== undefined ? (r10.barcode_or_qr_disclosed ? 'Barcode/QR Disclosed' : 'No Barcode/QR Disclosed') : '', r10.compliance_confidence),
  ];

  return fields.filter(f => f.ok);
}


// =============================================================================
// RENDERING
// =============================================================================

/** Highlights the current page's nav link */
function setActiveNav() {
  document.querySelectorAll('[data-nav]').forEach(link => {
    const isActive = link.getAttribute('href') === window.location.pathname;
    link.classList.toggle('bg-white', isActive);
    link.classList.toggle('text-navy', isActive);
  });
}

/**
 * Renders the field rows in the dashboard's fields list.
 * Animates confidence bars with a staggered delay for visual polish.
 * @param {Array} fields - Array of { field, value, conf, ok } objects
 */
function renderFields(fields) {
  const list = document.getElementById('fields');
  if (!list) return;

  if (!fields || fields.length === 0) {
    // Empty state — shown before any scan is run
    list.innerHTML = `
      <li class="px-4 py-8 text-center text-sm text-slate-400 italic">
        Upload photos and run an AI scan to extract label fields.
      </li>`;
    return;
  }

  list.innerHTML = fields.map(f => {
    const good = f.ok && f.conf >= 90;
    const barColor   = f.ok ? (good ? 'bg-success' : 'bg-warning') : 'bg-slate-300';
    const badgeColor = f.ok ? (good ? 'bg-success/15 text-success' : 'bg-warning/20 text-warning')
                             : 'bg-slate-100 text-slate-400';
    const valueStyle = f.ok ? '' : 'italic text-slate-400';
    const icon = f.ok ? '✓' : '⚠';

    return `
      <li class="grid grid-cols-1 gap-2 px-4 py-3.5 hover:bg-slate-50
                 sm:grid-cols-[1.2fr_1.5fr_1.4fr] sm:items-center sm:gap-4">
        <span class="text-sm font-semibold">${f.field}</span>
        <span class="text-sm ${valueStyle}">${f.value}</span>
        <div class="flex items-center gap-3">
          <div class="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
            <div class="conf-bar h-full rounded-full transition-[width] duration-700
                        ease-[cubic-bezier(.22,1,.36,1)] ${barColor}"
                 style="width: 0%">
            </div>
          </div>
          <span class="inline-flex min-w-[3.4rem] items-center justify-center
                       rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${badgeColor}">
            ${icon} ${f.conf}%
          </span>
        </div>
      </li>`;
  }).join('');

  // Animate each confidence bar with a staggered delay
  list.querySelectorAll('.conf-bar').forEach((bar, i) => {
    setTimeout(() => { bar.style.width = `${fields[i].conf}%`; }, 120 * i + 120);
  });
}


// =============================================================================
// PAGE INITIALISERS
// =============================================================================

/** Sets up the Inspection / Dashboard page */
function initInspection() {
  const fileInput  = document.getElementById('fileInput');
  const fileList   = document.getElementById('fileList');
  const listingUrl = document.getElementById('listingUrl');
  const runButton  = document.getElementById('runBtn');
  const runLabel   = document.getElementById('runLabel');
  if (!runButton) return;

  let mode = 'scan';

  // Show the empty-state placeholder on page load (no hardcoded data)
  renderFields([]);

  // Enable/disable the Run button based on whether the user has provided input
  const refreshRunButton = () => {
    runButton.disabled = mode === 'scan'
      ? !fileList.children.length
      : !listingUrl.value.trim();
  };

  // Switch between Scan and Listing modes
  document.querySelectorAll('.mode-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      mode = tab.dataset.mode;
      document.querySelectorAll('.mode-tab').forEach(item => {
        item.classList.toggle('bg-white', item.dataset.mode === mode);
      });
      document.getElementById('pane-scan').classList.toggle('hidden', mode !== 'scan');
      document.getElementById('pane-listing').classList.toggle('hidden', mode !== 'listing');
      runLabel.textContent = mode === 'scan' ? '✨ Run AI Scan' : '✨ Extract Listing Data';
      refreshRunButton();
    });
  });

  // Populate file chips when user selects photos
  fileInput.addEventListener('change', event => {
    fileList.innerHTML = Array.from(event.target.files)
      .map(file => `<li class="max-w-48 truncate rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium">${file.name}</li>`)
      .join('');
    refreshRunButton();
  });

  listingUrl.addEventListener('input', refreshRunButton);

  // Main action: upload photos → wait for Python analysis → render real fields
  runButton.addEventListener('click', async () => {
    runButton.disabled = true;
    runLabel.textContent = '⏳ Analyzing declarations…';

    try {
      if (mode === 'scan') {
        // Build multipart form with all selected photos
        const formData = new FormData();
        Array.from(fileInput.files).forEach(file => formData.append('photos', file));

        // POST to /upload-photos — server runs Python analyzer, returns structured JSON
        const response = await fetch('/upload-photos', { method: 'POST', body: formData });
        const payload  = await response.json();

        if (!response.ok) throw new Error(payload.error || 'Photo upload failed');

        // payload.analysis is the full parsed structured_output.json
        renderFields(fieldsFromAnalysis(payload.analysis));

      } else {
        // Listing mode — not yet connected to an API; render empty state for now
        renderFields([]);
      }
    } catch (error) {
      // Show a visible error banner inside the result area
      const result = document.getElementById('result');
      if (result) {
        result.classList.remove('hidden');
        result.className = 'mt-4 flex items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-medium text-danger';
        result.textContent = `✖ ${error.message}`;
      }
    } finally {
      runLabel.textContent = mode === 'scan' ? '✨ Run AI Scan' : '✨ Extract Listing Data';
      refreshRunButton();
    }
  });

  // Inspector decision buttons (Compliant / Review / Notice)
  const DECISION_STYLES = {
    notice:    ['Violation notice issued for Rule 6(2).',        'border-danger/40 bg-danger/10 text-danger'],
    review:    ['Sent for manual review by a senior inspector.', 'border-warning/50 bg-warning/15 text-warning'],
    compliant: ['Package marked as compliant.',                  'border-success/40 bg-success/10 text-success']
  };

  document.querySelectorAll('.action-btn').forEach(button => {
    button.addEventListener('click', () => {
      const [message, classes] = DECISION_STYLES[button.dataset.decision];
      const result = document.getElementById('result');
      document.getElementById('decisionInput').value = button.dataset.decision;
      result.className = `mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${classes}`;
      result.textContent = `✔ ${message}`;
    });
  });
}

/** Sets up the Repository page (rule search + table/card rendering) */
function initRepository() {
  const search = document.getElementById('search');
  if (!search) return;

  const TAG_CLASSES = {
    base:  'bg-slate-100 text-slate-600',
    amend: 'bg-warning/15 text-warning',
    new:   'bg-navy/10 text-navy'
  };

  const renderRuleRow = rule => `
    <tr class="hover:bg-slate-50">
      <td class="px-4 py-3.5">
        <span class="rounded-md bg-navy/10 px-2 py-1 font-mono text-xs font-semibold text-navy">${rule.id}</span>
      </td>
      <td class="px-4 py-3.5 font-semibold text-slate-800">${rule.decl}</td>
      <td class="px-4 py-3.5 text-slate-600">${rule.cond}</td>
      <td class="px-4 py-3.5">
        <span class="rounded-md px-2 py-1 text-xs font-medium ${TAG_CLASSES[rule.tag]}">${rule.amend}</span>
      </td>
      <td class="px-4 py-3.5 text-success">● Active</td>
    </tr>`;

  const renderRuleCard = rule => `
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="mb-2 flex items-center justify-between">
        <span class="rounded-md bg-navy/10 px-2 py-1 font-mono text-xs font-semibold text-navy">${rule.id}</span>
        <span class="text-xs font-semibold text-success">● Active</span>
      </div>
      <p class="font-semibold text-slate-800">${rule.decl}</p>
      <p class="mt-1 text-sm text-slate-600">${rule.cond}</p>
      <span class="mt-3 inline-block rounded-md px-2 py-1 text-xs font-medium ${TAG_CLASSES[rule.tag]}">${rule.amend}</span>
    </div>`;

  const renderRules = list => {
    document.getElementById('rows').innerHTML  = list.map(renderRuleRow).join('');
    document.getElementById('cards').innerHTML = list.map(renderRuleCard).join('');
    document.getElementById('empty').classList.toggle('hidden', list.length > 0);
  };

  // Filter rules by search query across all text fields
  search.addEventListener('input', () => {
    const query = search.value.toLowerCase().trim();
    renderRules(RULES.filter(rule =>
      `${rule.id} ${rule.decl} ${rule.cond} ${rule.amend}`.toLowerCase().includes(query)
    ));
  });

  // Initial render with all rules
  renderRules(RULES);
}


// =============================================================================
// BOOT
// =============================================================================

setActiveNav();
initInspection();
initRepository();
