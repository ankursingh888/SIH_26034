import { useEffect, useMemo, useState } from 'react';

const STATS = {
  totalInspections: '1,284',
  complianceRate: 92,
  pendingReview: 47,
  noticesIssued: 18,
};

const RULES = [
  {
    id: 'Rule 6(1)(a)',
    decl: 'Name and address of Manufacturer',
    cond: 'All packaged commodities',
    amend: 'Base 2011 Rules',
    tag: 'base',
  },
  {
    id: 'Rule 6(1)(d)',
    decl: 'Month and Year of Manufacture',
    cond: 'Exempt for food articles governed by FSSAI',
    amend: 'Amendment 2022',
    tag: 'amend',
  },
  {
    id: 'Rule 6(2)',
    decl: 'Consumer Care Details',
    cond: 'Must include Name, Address, Telephone, Email',
    amend: 'Third Amendment Rules, 2026',
    tag: 'new',
  },
];

const TAG_CLASSES = {
  base: 'bg-slate-100 text-slate-600',
  amend: 'bg-amber-100 text-amber-700',
  new: 'bg-sky-100 text-sky-700',
};

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, entry]) => {
        const label = key.replace(/_/g, ' ');
        if (typeof entry === 'object' && entry !== null) {
          return `${label}: { ${formatValue(entry)} }`;
        }
        return `${label}: ${formatValue(entry)}`;
      })
      .filter(Boolean)
      .join(' | ');
  }
  return String(value).trim();
}

function inferConfidence(confidenceLevel) {
  if (!confidenceLevel || typeof confidenceLevel !== 'string') return 0;
  const level = confidenceLevel.trim().toLowerCase();
  if (level === 'high') return 96;
  if (level === 'medium' || level === 'mid') return 72;
  if (level === 'low') return 45;
  return 0;
}

function makeField(label, value, confidenceLevel) {
  const formatted = formatValue(value);
  const detected = Boolean(formatted && formatted.length > 0);
  return {
    field: label,
    value: detected ? formatted : 'Not Detected',
    conf: detected ? inferConfidence(confidenceLevel) : 0,
    ok: detected,
  };
}

function fieldsFromAnalysis(analysis) {
  const audit = analysis?.step_3_metrology_essentials_audit || {};
  const r1 = audit.rule_1_manufacturer_packer_importer_details || {};
  const r2 = audit.rule_2_role_classification_labeling || {};
  const r3 = audit.rule_3_generic_or_common_name || {};
  const r4 = audit.rule_4_net_quantity_declaration || {};
  const r5 = audit.rule_5_mrp_and_tax_inclusivity || {};
  const r6 = audit.rule_6_month_and_year_of_manufacture_or_pack || {};
  const r7 = audit.rule_7_consumer_care_details || {};
  const r8 = audit.rule_8_unit_sale_price_usp || {};
  const r9 = audit.rule_9_core_statutory_obligation || {};
  const r10 = audit.rule_10_country_of_origin_and_digital_disclosure || {};

  const fields = [
    makeField('Manufacturer / Packer / Importer', r1.declared_text, r1.compliance_confidence),
    makeField('Role Classification', r2.declared_role_prefix || r2.declared_text, r2.compliance_confidence),
    makeField('Generic / Common Name', r3.declared_text, r3.compliance_confidence),
    makeField('Net Quantity Declaration', r4.declared_text, r4.compliance_confidence),
    makeField('MRP & Tax Inclusivity', r5.declared_text, r5.compliance_confidence),
    makeField('Month & Year of Manufacture', r6.declared_text, r6.compliance_confidence),
    makeField('Consumer Care — Name', r7.declared_name, r7.compliance_confidence),
    makeField('Consumer Care — Address', r7.declared_address, r7.compliance_confidence),
    makeField('Consumer Care — Phone', r7.declared_phone, r7.compliance_confidence),
    makeField('Consumer Care — Email', r7.declared_email, r7.compliance_confidence),
    makeField('Unit Sale Price (USP)', r8.declared_text, r8.compliance_confidence),
    makeField(
      'Core Statutory Obligation',
      r9.all_primary_declarations_present !== undefined
        ? r9.all_primary_declarations_present
          ? 'All Primary Declarations Present'
          : 'Missing Declarations'
        : '',
      r9.compliance_confidence,
    ),
    makeField('Country of Origin', r10.declared_country_of_origin, r10.compliance_confidence),
    makeField(
      'Digital Disclosure (Barcode/QR)',
      r10.barcode_or_qr_disclosed !== undefined
        ? r10.barcode_or_qr_disclosed
          ? 'Barcode/QR Disclosed'
          : 'No Barcode/QR Disclosed'
        : '',
      r10.compliance_confidence,
    ),
  ];

  return fields.filter((field) => field.ok);
}

function Dashboard({ onNavigate }) {
  const [mode, setMode] = useState('scan');
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [listingUrl, setListingUrl] = useState('');
  const [fields, setFields] = useState([]);
  const [isRunning, setIsRunning] = useState(false);
  const [resultMessage, setResultMessage] = useState('');
  const [resultTone, setResultTone] = useState('');

  const canRun = mode === 'scan' ? selectedFiles.length > 0 : listingUrl.trim().length > 0;

  const handleFiles = (event) => {
    const nextFiles = Array.from(event.target.files || []);
    setSelectedFiles(nextFiles);
  };

  const handleRun = async () => {
    if (!canRun) return;
    setIsRunning(true);
    setResultMessage('');

    try {
      if (mode === 'scan') {
        const formData = new FormData();
        selectedFiles.forEach((file) => formData.append('photos', file));

        const response = await fetch('/upload-photos', { method: 'POST', body: formData });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Photo upload failed');

        setFields(fieldsFromAnalysis(payload.analysis));
        setResultMessage('');
      } else {
        setFields([]);
        setResultMessage('Listing extraction is not yet connected to the backend.');
        setResultTone('warning');
      }
    } catch (error) {
      setResultMessage(error.message || 'Something went wrong.');
      setResultTone('danger');
      setFields([]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="relative overflow-hidden bg-[#0f2a54] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="relative mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8 md:px-8">
          <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex size-12 items-center justify-center rounded-xl bg-white/10 text-2xl ring-1 ring-white/20">
                ⚖️
              </div>
              <div>
                <h1 className="text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">
                  Legal Metrology Compliance Platform
                </h1>
                <p className="mt-1 flex items-center gap-2 text-sm text-white/70">
                  <span className="rounded-md bg-white/10 px-2 py-0.5 font-mono text-xs">SIH26034</span>
                  Department of Consumer Affairs
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
              </span>
              AI Engine Online
            </div>
          </div>
          <nav className="flex flex-wrap gap-1.5">
            {[
              { label: 'New Inspection', href: '/' },
              { label: 'Rule Repository', href: '/repository' },
              { label: 'View Reports', href: '/report' },
            ].map(({ label, href }) => (
              <button
                key={href}
                type="button"
                onClick={() => onNavigate(href)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
                  href === '/' ? 'bg-white text-[#0f2a54] shadow-sm' : 'text-white/80 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { label: 'Inspections', value: STATS.totalInspections, tone: 'text-[#0f2a54]' },
            { label: 'Compliance Rate', value: `${STATS.complianceRate}%`, tone: 'text-emerald-600' },
            { label: 'Pending Review', value: STATS.pendingReview, tone: 'text-amber-700' },
            { label: 'Notices Issued', value: STATS.noticesIssued, tone: 'text-red-600' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className={`font-mono text-2xl font-bold ${stat.tone}`}>{stat.value}</p>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold tracking-tight">Start New Inspection</h2>
                <p className="text-sm text-slate-500">Choose an input source and let the AI extract declarations.</p>
              </div>
              <span className="text-xl text-[#0f2a54]">✨</span>
            </div>

            <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setMode('scan')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'scan' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Physical Package
              </button>
              <button
                type="button"
                onClick={() => setMode('listing')}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${mode === 'listing' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                E-Commerce Listing
              </button>
            </div>

            {mode === 'scan' ? (
              <div>
                <label className="flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
                  <span className="text-3xl">☁️</span>
                  <span className="text-sm font-semibold">Drop package images or click to upload</span>
                  <span className="text-xs text-slate-500">PNG, JPG — multiple allowed</span>
                  <input type="file" accept="image/*" multiple className="sr-only" onChange={handleFiles} />
                </label>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {selectedFiles.map((file) => (
                    <li key={`${file.name}-${file.lastModified}`} className="max-w-48 truncate rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium">
                      {file.name}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>
                <label htmlFor="listingUrl" className="mb-2 block text-sm font-semibold">Product listing URL</label>
                <input
                  id="listingUrl"
                  type="url"
                  placeholder="https://marketplace.example/product/..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-3 text-sm outline-none"
                  value={listingUrl}
                  onChange={(event) => setListingUrl(event.target.value)}
                />
              </div>
            )}

            <button
              type="button"
              disabled={!canRun || isRunning}
              onClick={handleRun}
              className="mt-5 inline-flex w-full justify-center rounded-xl bg-[#0f2a54] px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRunning ? '⏳ Analyzing declarations…' : mode === 'scan' ? '✨ Run AI Scan' : '✨ Extract Listing Data'}
            </button>
          </section>

          <div className="flex flex-col gap-6">
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4">
                <h2 className="text-lg font-bold">
                  <span className="font-mono text-sm text-slate-400">01</span> AI Perception: Extracted Declarations
                </h2>
                <p className="text-sm text-slate-500">Fields detected from the source with model confidence.</p>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200">
                <div className="hidden grid-cols-[1.2fr_1.5fr_1.4fr] gap-4 bg-slate-100 px-4 py-2.5 text-xs font-semibold uppercase text-slate-500 sm:grid">
                  <span>Field Detected</span>
                  <span>Extracted Value</span>
                  <span>AI Confidence</span>
                </div>

                <ul className="divide-y divide-slate-200">
                  {fields.length === 0 ? (
                    <li className="px-4 py-8 text-center text-sm text-slate-400 italic">
                      Upload photos and run an AI scan to extract label fields.
                    </li>
                  ) : (
                    fields.map((field) => {
                      const good = field.ok && field.conf >= 90;
                      const barColor = field.ok ? (good ? 'bg-emerald-600' : 'bg-amber-500') : 'bg-slate-300';
                      const badgeColor = field.ok ? (good ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700') : 'bg-slate-100 text-slate-400';

                      return (
                        <li key={field.field} className="grid grid-cols-1 gap-2 px-4 py-3.5 sm:grid-cols-[1.2fr_1.5fr_1.4fr] sm:items-center sm:gap-4">
                          <span className="text-sm font-semibold">{field.field}</span>
                          <span className="text-sm text-slate-700">{field.value}</span>
                          <div className="flex items-center gap-3">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
                              <div className={`h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(.22,1,.36,1)] ${barColor}`} style={{ width: `${field.conf}%` }} />
                            </div>
                            <span className={`inline-flex min-w-[3.4rem] items-center justify-center rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold ${badgeColor}`}>
                              {field.ok ? '✓' : '⚠'} {field.conf}%
                            </span>
                          </div>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-bold">
                <span className="font-mono text-sm text-slate-400">02</span> Inspector Review &amp; Sign-off
              </h2>
              <div className="mb-5 flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4">
                <span className="text-red-600">⚠️</span>
                <div>
                  <p className="font-semibold text-red-700">Potential Violation</p>
                  <p className="mt-1 text-sm text-slate-600">The extracted declarations suggest missing consumer care contact details in the packaging.</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button type="button" className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">Review Later</button>
                <button type="button" className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700">Mark Compliant</button>
                <button type="button" className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white">Issue Notice</button>
              </div>

              {resultMessage ? (
                <div
                  className={`mt-4 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${
                    resultTone === 'danger'
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-amber-300 bg-amber-50 text-amber-700'
                  }`}
                >
                  {resultTone === 'danger' ? '✖' : '⚠'} {resultMessage}
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function Repository({ onNavigate }) {
  const [query, setQuery] = useState('');
  const filteredRules = useMemo(
    () =>
      RULES.filter((rule) =>
        `${rule.id} ${rule.decl} ${rule.cond} ${rule.amend}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [query],
  );

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="bg-[#0f2a54] text-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-5 py-8 md:px-8">
          <div className="flex items-center gap-4">
            <div className="text-2xl">⚖️</div>
            <div>
              <h1 className="text-2xl font-extrabold md:text-3xl">Legal Metrology Compliance Platform</h1>
              <p className="mt-1 text-sm text-white/70">SIH26034 · Department of Consumer Affairs</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1.5">
            {[
              { label: 'New Inspection', href: '/' },
              { label: 'Rule Repository', href: '/repository' },
              { label: 'View Reports', href: '/report' },
            ].map(({ label, href }) => (
              <button
                key={href}
                type="button"
                onClick={() => onNavigate(href)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
                  href === '/repository' ? 'bg-white text-[#0f2a54]' : 'text-white/80'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-5 py-8 md:px-8">
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-xl font-bold">Version-Controlled Rule Engine Database</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Machine-readable rules, exceptions, and amendments used to automatically evaluate AI-extracted declarations.
            </p>
          </div>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search rules…"
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm sm:w-64"
          />
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Active Rules', value: 3, tone: 'text-[#0f2a54]' },
            { label: 'Machine-Readable', value: '100%', tone: 'text-emerald-600' },
            { label: 'Latest Amendment', value: 2026, tone: 'text-amber-700' },
            { label: 'Engine Version', value: 'v3.2', tone: 'text-[#0f2a54]' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className={`font-mono text-2xl font-bold ${stat.tone}`}>{stat.value}</p>
              <p className="text-xs text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-100 text-xs font-semibold uppercase text-slate-500">
                <th className="px-4 py-3">Rule ID</th>
                <th className="px-4 py-3">Declaration Required</th>
                <th className="px-4 py-3">Condition / Applicability</th>
                <th className="px-4 py-3">Latest Amendment</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3.5">
                    <span className="rounded-md bg-sky-100 px-2 py-1 font-mono text-xs font-semibold text-[#0f2a54]">{rule.id}</span>
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-800">{rule.decl}</td>
                  <td className="px-4 py-3.5 text-slate-600">{rule.cond}</td>
                  <td className="px-4 py-3.5">
                    <span className={`rounded-md px-2 py-1 text-xs font-medium ${TAG_CLASSES[rule.tag]}`}>{rule.amend}</span>
                  </td>
                  <td className="px-4 py-3.5 text-emerald-600">● Active</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 md:hidden">
          {filteredRules.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-md bg-sky-100 px-2 py-1 font-mono text-xs font-semibold text-[#0f2a54]">{rule.id}</span>
                <span className="text-xs font-semibold text-emerald-600">● Active</span>
              </div>
              <p className="font-semibold text-slate-800">{rule.decl}</p>
              <p className="mt-1 text-sm text-slate-600">{rule.cond}</p>
              <span className={`mt-3 inline-block rounded-md px-2 py-1 text-xs font-medium ${TAG_CLASSES[rule.tag]}`}>{rule.amend}</span>
            </div>
          ))}
        </div>

        {filteredRules.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">No rules match your search.</p> : null}
      </main>
    </div>
  );
}

function Report({ onNavigate }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 print:bg-white">
      <header className="print-hidden bg-[#0f2a54] text-white">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-5 py-8 md:px-8">
          <div className="flex items-center gap-4">
            <div className="text-2xl">⚖️</div>
            <div>
              <h1 className="text-2xl font-extrabold md:text-3xl">Legal Metrology Compliance Platform</h1>
              <p className="mt-1 text-sm text-white/70">SIH26034 · Department of Consumer Affairs</p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-1.5">
            {[
              { label: 'New Inspection', href: '/' },
              { label: 'Rule Repository', href: '/repository' },
              { label: 'View Reports', href: '/report' },
            ].map(({ label, href }) => (
              <button
                key={href}
                type="button"
                onClick={() => onNavigate(href)}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${
                  href === '/report' ? 'bg-white text-[#0f2a54]' : 'text-white/80'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8 md:px-8">
        <div className="print-hidden mb-5 flex justify-between">
          <button type="button" onClick={() => onNavigate('/')} className="font-semibold text-[#0f2a54]">← Back to inspections</button>
          <button type="button" onClick={() => window.print()} className="rounded-xl bg-[#0f2a54] px-4 py-2.5 text-sm font-semibold text-white">
            🖨️ Print / Save as PDF
          </button>
        </div>

        <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:m-0 print:rounded-none print:shadow-none">
          <div className="h-1.5 bg-red-600" />
          <div className="p-6 md:p-10">
            <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-center">
              <div>
                <p className="font-mono text-xs font-semibold uppercase tracking-widest text-slate-400">Official Inspection Report</p>
                <h2 className="mt-1 text-2xl font-extrabold">Premium Assam Tea (500g)</h2>
                <div className="mt-2 flex flex-wrap gap-x-5 text-sm text-slate-500">
                  <span>
                    <b className="text-slate-700">Report ID:</b> <span className="font-mono">LM-2026-98745</span>
                  </span>
                  <span>
                    <b className="text-slate-700">Date:</b> 04 September 2026
                  </span>
                </div>
              </div>
              <span className="rounded-full border border-red-300 bg-red-100 px-3 py-1.5 text-sm font-bold text-red-700">● NON-COMPLIANT</span>
            </div>

            <section className="mt-8">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Product Details</h3>
              <dl className="rounded-xl border border-slate-200">
                <div className="flex flex-col gap-1 border-b border-slate-200 px-4 py-3 sm:flex-row sm:gap-4">
                  <dt className="w-48 shrink-0 font-semibold">Product Name</dt>
                  <dd className="text-slate-600">Premium Assam Tea (500g)</dd>
                </div>
                <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
                  <dt className="w-48 shrink-0 font-semibold">Inspection Source</dt>
                  <dd className="text-slate-600">Physical Package Scan (3 Images)</dd>
                </div>
              </dl>
            </section>

            <section className="mt-8">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Compliance Findings</h3>
              <div className="rounded-xl border border-red-200 bg-red-50 p-5">
                <h4 className="font-bold text-red-700">
                  Missing Consumer Care Details
                  <span className="rounded-md bg-red-100 px-2 py-0.5 font-mono text-xs">Rule 6(2)</span>
                </h4>
                <p className="mt-3 text-sm text-slate-600">
                  <b className="text-slate-700">Rule Referenced:</b> Packaged Commodities Rules, 2011 — Rule 6(2)
                </p>
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    AI Evidence
                    <span className="float-right text-emerald-600">✓ 98%</span>
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Multi-surface scan completed. Text extraction confidence 98%. Fields for Email and Telephone were not detected on any panel.
                  </p>
                </div>
              </div>
            </section>

            <section className="mt-8">
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-slate-400">Inspector Notes</h3>
              <blockquote className="rounded-xl border-l-4 border-[#0f2a54] bg-slate-50 p-5">
                <p className="text-sm italic leading-relaxed text-slate-600">
                  "Reviewed AI extraction. Confirmed that the packaging lacks the mandatory consumer care contact information required by the latest 2026 amendment. Forwarding for official notice."
                </p>
                <footer className="mt-3 flex items-center gap-2 text-sm">
                  <span className="flex size-7 items-center justify-center rounded-full bg-[#0f2a54] text-xs font-bold text-white">IS</span>
                  <b>Inspector Sharma</b>
                </footer>
              </blockquote>
            </section>

            <div className="mt-10 border-t border-slate-200 pt-5 text-xs text-slate-400">
              <span>Generated by the Legal Metrology Compliance Platform · SIH26034</span>
              <span className="float-right font-mono">LM-2026-98745</span>
            </div>
          </div>
        </article>
      </main>
    </div>
  );
}

function App() {
  const getPathRoute = () => {
    const raw = window.location.pathname || '/';
    if (raw === '/repository') return 'repository';
    if (raw === '/report') return 'report';
    return 'dashboard';
  };

  const [route, setRoute] = useState(getPathRoute());

  useEffect(() => {
    const handlePopState = () => setRoute(getPathRoute());
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const onNavigate = (nextRoute) => {
    const normalized = nextRoute === '/' ? '/' : nextRoute;
    window.history.pushState({}, '', normalized);
    setRoute(getPathRoute());
  };

  const currentRoute = route;

  switch (currentRoute) {
    case 'repository':
      return <Repository onNavigate={onNavigate} />;
    case 'report':
      return <Report onNavigate={onNavigate} />;
    default:
      return <Dashboard onNavigate={onNavigate} />;
  }
}

export default App;
