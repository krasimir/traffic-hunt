const form = document.querySelector('#upload-form');
const fileInput = document.querySelector('#capture-file');
const statusEl = document.querySelector('#status');
const summaryEl = document.querySelector('#summary');
const filterPanelEl = document.querySelector('#filter-panel');
const urlFilterEl = document.querySelector('#url-filter');
const entriesEl = document.querySelector('#entries');
const state = {
  fileName: '',
  entries: [],
};

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

function headerValue(headers, name) {
  if (!Array.isArray(headers)) {
    return '';
  }

  const match = headers.find(([headerName]) => String(headerName).toLowerCase() === name.toLowerCase());
  return match ? String(match[1]) : '';
}

function contentType(message) {
  return String(message?.content_type || headerValue(message?.headers, 'content-type')).toLowerCase();
}

function isEventStream(message) {
  return contentType(message).includes('text/event-stream');
}

function parseSseEvents(body) {
  if (typeof body !== 'string' || body.trim() === '') {
    return [];
  }

  return body
    .split(/\r?\n\r?\n/)
    .map((frame) => {
      const event = { event: 'message', data: [] };

      frame.split(/\r?\n/).forEach((line) => {
        if (line.startsWith('event:')) {
          event.event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          event.data.push(line.slice(5).trimStart());
        }
      });

      return {
        event: event.event,
        data: event.data.join('\n'),
      };
    })
    .filter((event) => event.data && event.data !== '[DONE]');
}

function extractStreamingText(payload) {
  const parts = [];

  if (Array.isArray(payload?.choices)) {
    payload.choices.forEach((choice) => {
      if (typeof choice?.delta?.content === 'string') {
        parts.push(choice.delta.content);
      }
      if (typeof choice?.text === 'string') {
        parts.push(choice.text);
      }
      if (typeof choice?.message?.content === 'string') {
        parts.push(choice.message.content);
      }
    });
  }

  if (typeof payload?.delta?.text === 'string') {
    parts.push(payload.delta.text);
  }

  if (typeof payload?.delta?.thinking === 'string') {
    parts.push(payload.delta.thinking);
  }

  if (typeof payload?.content_block?.text === 'string') {
    parts.push(payload.content_block.text);
  }

  return parts.join('');
}

function extractToolCall(payload, toolsByIndex) {
  if (payload?.type === 'content_block_start' && payload?.content_block?.type === 'tool_use') {
    const index = String(payload.index);
    toolsByIndex.set(index, {
      id: payload.content_block.id || '',
      name: payload.content_block.name || 'tool',
      inputText: '',
      input: payload.content_block.input || null,
    });
    return;
  }

  if (payload?.type === 'content_block_delta' && payload?.delta?.type === 'input_json_delta') {
    const index = String(payload.index);
    const existing = toolsByIndex.get(index) || {
      id: '',
      name: 'tool',
      inputText: '',
      input: null,
    };

    existing.inputText += payload.delta.partial_json || '';
    toolsByIndex.set(index, existing);
  }
}

function finalizeToolCalls(toolsByIndex) {
  return Array.from(toolsByIndex.values()).map((tool) => {
    if (tool.inputText) {
      try {
        tool.input = JSON.parse(tool.inputText);
      } catch {
        tool.input = tool.inputText;
      }
    }

    return tool;
  });
}

function streamingSummary(message) {
  const summary = {
    text: '',
    tools: [],
  };

  if (!isEventStream(message)) {
    return summary;
  }

  const toolsByIndex = new Map();
  const textParts = [];

  parseSseEvents(message.body).forEach((event) => {
    try {
      const payload = JSON.parse(event.data);
      const streamedText = extractStreamingText(payload);
      if (streamedText) {
        textParts.push(streamedText);
      }
      extractToolCall(payload, toolsByIndex);
    } catch {
      // Ignore non-JSON SSE frames in the readable summary.
    }
  });

  summary.text = textParts.join('');
  summary.tools = finalizeToolCalls(toolsByIndex);
  return summary;
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

function createTextBlock(title, content) {
  const block = document.createElement('div');
  block.className = 'payload-block payload-block-wide';

  const heading = document.createElement('div');
  heading.className = 'section-title';
  heading.textContent = title;

  block.append(heading, createPre(content || '(empty)'));
  return block;
}

function createToolCallsBlock(tools) {
  const block = document.createElement('div');
  block.className = 'payload-block payload-block-wide';

  const heading = document.createElement('div');
  heading.className = 'section-title';
  heading.textContent = `Tool Usage (${tools.length})`;

  const list = document.createElement('div');
  list.className = 'tool-list';

  tools.forEach((tool, index) => {
    const details = document.createElement('details');
    details.className = 'tool-call';
    details.open = index === 0;

    const summary = document.createElement('summary');
    const name = document.createElement('span');
    name.className = 'tool-name';
    name.textContent = tool.name;

    const id = document.createElement('span');
    id.className = 'tool-id';
    id.textContent = tool.id;
    summary.append(name, id);

    const input = document.createElement('div');
    input.className = 'tool-input';
    input.append(createPayloadViewer(tool.input));

    details.append(summary, input);
    list.append(details);
  });

  block.append(heading, list);
  return block;
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
  filterPanelEl.hidden = false;

  const query = urlFilterEl.value.trim().toLowerCase();
  const visibleEntries = query
    ? entries.filter((entry) => String(entry.request?.url || '').toLowerCase().includes(query))
    : entries;

  const suffix = query ? `, ${visibleEntries.length} matching` : '';
  summaryEl.textContent = `${fileName}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}${suffix}`;

  if (visibleEntries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = entries.length === 0
      ? 'The capture contains no entries.'
      : 'No entries match the current URL filter.';
    entriesEl.append(empty);
    return;
  }

  visibleEntries.forEach((entry, index) => {
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
    const originalIndex = entries.indexOf(entry) + 1;
    meta.textContent = `#${originalIndex || index + 1} ${text(response.status_code, 'no status')}`;

    summary.append(method, url, meta);

    const body = document.createElement('div');
    body.className = 'entry-body';

    const payloadGrid = document.createElement('div');
    payloadGrid.className = 'payload-grid';
    payloadGrid.append(
      createPayloadBlock('Request Payload', request.body, payloadSize(request)),
      createPayloadBlock('Response Payload', response.body, payloadSize(response)),
    );

    const stream = streamingSummary(response);
    if (stream.text) {
      payloadGrid.append(createTextBlock('Streaming Result', stream.text));
    }
    if (stream.tools.length > 0) {
      payloadGrid.append(createToolCallsBlock(stream.tools));
    }

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

    state.fileName = result.fileName;
    state.entries = result.entries;
    urlFilterEl.value = '';
    renderEntries(state.fileName, state.entries);
    setStatus('Loaded.');
  } catch (error) {
    summaryEl.hidden = true;
    filterPanelEl.hidden = true;
    entriesEl.textContent = '';
    setStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

urlFilterEl.addEventListener('input', () => {
  if (state.entries.length > 0) {
    renderEntries(state.fileName, state.entries);
  }
});
