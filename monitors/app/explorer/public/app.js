const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#capture-file');
const statusEl = document.querySelector('#status');
const summaryEl = document.querySelector('#summary');
const entriesEl = document.querySelector('#entries');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function parsePayload(payload) {
  if (payload == null || payload === '') {
    return { type: 'empty', value: '(empty)' };
  }

  if (typeof payload !== 'string') {
    return { type: 'json', value: payload };
  }

  try {
    return { type: 'json', value: JSON.parse(payload) };
  } catch {
    return { type: 'text', value: payload };
  }
}

function formatHeaders(headers) {
  if (!Array.isArray(headers) || headers.length === 0) {
    return '(none)';
  }

  return headers.map(([name, value]) => `${name}: ${value}`).join('\n');
}

function byteLength(value) {
  if (value == null || value === '') {
    return 0;
  }

  if (typeof value !== 'string') {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  }

  return new TextEncoder().encode(value).length;
}

function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B';
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function payloadSize(entry) {
  if (Number.isFinite(Number(entry?.size_bytes))) {
    return Number(entry.size_bytes);
  }

  return byteLength(entry?.body);
}

function text(value, fallback = '') {
  return value == null || value === '' ? fallback : String(value);
}

function createPre(content) {
  const pre = document.createElement('pre');
  pre.textContent = content;
  return pre;
}

function valueType(value) {
  if (Array.isArray(value)) {
    return 'array';
  }

  if (value === null) {
    return 'null';
  }

  return typeof value;
}

function previewValue(value) {
  if (Array.isArray(value)) {
    return `Array(${value.length})`;
  }

  if (value && typeof value === 'object') {
    return `Object(${Object.keys(value).length})`;
  }

  return JSON.stringify(value);
}

function renderPrimitive(value) {
  const span = document.createElement('span');
  span.className = `json-value json-${valueType(value)}`;
  span.textContent = JSON.stringify(value);
  return span;
}

function renderJsonNode(label, value, depth = 0) {
  const container = document.createElement('div');
  container.className = 'json-node';

  const isBranch = value !== null && typeof value === 'object';
  if (!isBranch) {
    if (label !== null) {
      const key = document.createElement('span');
      key.className = 'json-key';
      key.textContent = `${label}: `;
      container.append(key);
    }
    container.append(renderPrimitive(value));
    return container;
  }

  const details = document.createElement('details');
  details.open = depth < 2;

  const summary = document.createElement('summary');
  if (label !== null) {
    const key = document.createElement('span');
    key.className = 'json-key';
    key.textContent = `${label}: `;
    summary.append(key);
  }

  const preview = document.createElement('span');
  preview.className = 'json-preview';
  preview.textContent = previewValue(value);
  summary.append(preview);
  details.append(summary);

  const children = document.createElement('div');
  children.className = 'json-children';

  const entries = Array.isArray(value)
    ? value.map((item, index) => [index, item])
    : Object.entries(value);

  if (entries.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'json-empty';
    empty.textContent = Array.isArray(value) ? '[]' : '{}';
    children.append(empty);
  } else {
    entries.forEach(([childLabel, childValue]) => {
      children.append(renderJsonNode(childLabel, childValue, depth + 1));
    });
  }

  details.append(children);
  container.append(details);
  return container;
}

function createPayloadViewer(payload) {
  const parsed = parsePayload(payload);

  if (parsed.type === 'json') {
    const viewer = document.createElement('div');
    viewer.className = 'json-viewer';
    viewer.append(renderJsonNode(null, parsed.value));
    return viewer;
  }

  return createPre(parsed.value);
}

function createPayloadBlock(title, payload, sizeBytes = null) {
  const block = document.createElement('div');
  block.className = 'payload-block';

  const heading = document.createElement('div');
  heading.className = 'section-title';

  const label = document.createElement('span');
  label.textContent = title;
  heading.append(label);

  if (sizeBytes != null) {
    const size = document.createElement('span');
    size.className = 'payload-size';
    size.textContent = formatBytes(sizeBytes);
    heading.append(size);
  }

  block.append(heading, createPayloadViewer(payload));
  return block;
}

function renderEntries(fileName, entries) {
  entriesEl.textContent = '';
  summaryEl.hidden = false;
  summaryEl.textContent = `${fileName}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'The capture contains no entries.';
    entriesEl.append(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const request = entry.request || {};
    const response = entry.response || {};

    const details = document.createElement('details');
    details.className = 'entry';

    const summary = document.createElement('summary');

    const method = document.createElement('span');
    method.className = 'method';
    method.textContent = text(request.method, 'REQUEST');

    const url = document.createElement('span');
    url.className = 'url';
    url.title = text(request.url);
    url.textContent = text(request.url, '(no url)');

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `#${index + 1} ${text(response.status_code, 'no status')}`;

    summary.append(method, url, meta);

    const body = document.createElement('div');
    body.className = 'entry-body';

    const payloadGrid = document.createElement('div');
    payloadGrid.className = 'payload-grid';
    payloadGrid.append(
      createPayloadBlock('Request Payload', request.body, payloadSize(request)),
      createPayloadBlock('Response Payload', response.body, payloadSize(response)),
    );

    const headerGrid = document.createElement('div');
    headerGrid.className = 'payload-grid';
    headerGrid.append(
      createPayloadBlock('Request Headers', formatHeaders(request.headers)),
      createPayloadBlock('Response Headers', formatHeaders(response.headers)),
    );

    body.append(payloadGrid, headerGrid);
    details.append(summary, body);
    entriesEl.append(details);
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = fileInput.files[0];
  if (!file) {
    setStatus('Choose a JSON file first.', true);
    return;
  }

  const submitButton = form.querySelector('button');
  submitButton.disabled = true;
  setStatus('Reading capture...');

  try {
    const fileText = await file.text();

    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-file-name': file.name,
      },
      body: fileText,
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Upload failed.');
    }

    renderEntries(result.fileName, result.entries);
    setStatus('Loaded.');
  } catch (error) {
    summaryEl.hidden = true;
    entriesEl.textContent = '';
    setStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});
