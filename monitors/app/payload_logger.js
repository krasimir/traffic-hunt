#!/usr/bin/env node

const fs = require('node:fs');
const readline = require('node:readline');

const outputFile = process.argv[2] || 'app-traffic.json';
const excludedHosts = splitHosts(process.argv[3] || '');
let entries = [];

function writeJsonFile() {
  fs.writeFileSync(outputFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
}

function splitHosts(value) {
  return value
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

function matchesHost(host, patterns) {
  const normalizedHost = String(host || '').toLowerCase().replace(/\.$/, '');

  return patterns.some((pattern) => {
    const normalizedPattern = pattern.replace(/\.$/, '');

    if (normalizedPattern.startsWith('*.')) {
      return normalizedHost.endsWith(normalizedPattern.slice(1));
    }

    return normalizedHost === normalizedPattern;
  });
}

function decodeBody(payload) {
  const raw = Buffer.from(payload?.body_base64 || '', 'base64');
  const contentType = payload?.content_type || '';

  if (raw.toString('utf8').includes('\uFFFD')) {
    return {
      content_type: contentType,
      encoding: 'base64',
      size_bytes: payload?.size_bytes || raw.length,
      body: raw.toString('base64'),
    };
  }

  return {
    content_type: contentType,
    encoding: 'utf-8',
    size_bytes: payload?.size_bytes || raw.length,
    body: raw.toString('utf8'),
  };
}

function normalizeRequest(request) {
  if (!request) {
    return null;
  }

  return {
    method: request.method,
    scheme: request.scheme,
    host: request.host,
    port: request.port,
    path: request.path,
    url: request.url,
    http_version: request.http_version,
    headers: request.headers || [],
    ...decodeBody(request),
  };
}

function normalizeResponse(response) {
  if (!response) {
    return null;
  }

  return {
    status_code: response.status_code,
    reason: response.reason,
    http_version: response.http_version,
    headers: response.headers || [],
    ...decodeBody(response),
  };
}

function toLogEntry(event) {
  const entry = {
    captured_at: new Date().toISOString(),
    client: event.client || {},
    server: event.server || {},
    request: normalizeRequest(event.request),
  };

  if (event.type === 'error') {
    entry.error = event.error || 'unknown mitmproxy error';
  }

  const response = normalizeResponse(event.response);
  if (response) {
    entry.response = response;
  }

  return entry;
}

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

input.on('line', (line) => {
  if (!line.trim()) {
    return;
  }

  try {
    const event = JSON.parse(line);
    const entry = toLogEntry(event);
    if (matchesHost(entry.request?.host, excludedHosts)) {
      return;
    }
    entries.push(entry);
    writeJsonFile();
  } catch (error) {
    const entry = {
      captured_at: new Date().toISOString(),
      error: `payload_logger.js failed: ${error.message}`,
      raw_line: line,
    };
    entries.push(entry);
    writeJsonFile();
  }
});

writeJsonFile();
