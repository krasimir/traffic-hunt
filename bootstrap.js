// Patch http/https modules (axios, node-fetch, got, etc.)
const { bootstrap } = require('global-agent');
bootstrap();

// Patch undici dispatcher (used by OpenAI SDK v4, LangChain, Node 18+ native fetch)
const { setGlobalDispatcher, ProxyAgent } = require('undici');
const proxyUrl = process.env.GLOBAL_AGENT_HTTPS_PROXY || process.env.HTTPS_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl }));
}
