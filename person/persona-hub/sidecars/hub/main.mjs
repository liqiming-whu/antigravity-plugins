import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SidecarApp, Response } from 'sidecar_sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOME = homedir();
const CONFIG_ROOT = join(HOME, '.gemini', 'config');
const PLUGINS_ROOT = join(CONFIG_ROOT, 'plugins');
const CONFIG_JSON_PATH = join(CONFIG_ROOT, 'config.json');

function findAppDataDir() {
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) {
    for (let d = dataDir; d !== dirname(d); d = dirname(d)) {
      if (d.endsWith('sidecar_data')) {
        const parent = dirname(d);
        if (existsSync(join(parent, 'brain'))) return parent;
      }
    }
  }
  const fallback = join(HOME, '.gemini', 'antigravity');
  return existsSync(fallback) ? fallback : null;
}

function safeReadJson(filePath) {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function pickExistingFile(assetsDir, candidates) {
  for (const name of candidates) {
    if (name && existsSync(join(assetsDir, name))) {
      return name;
    }
  }
  return null;
}

function computePersonaStatusBadge(dirName) {
  if (dirName === 'hajimi-persona') {
    return {
      tone: 'indigo',
      text: '猫耳雷达全开喵~ · 默认写实观星台猫娘形象',
    };
  }
  if (dirName === 'xiaoke-persona') {
    return {
      tone: 'amber',
      text: '红茶已备好 · 代码审美与架构洁癖在线',
    };
  }
  return {
    tone: 'emerald',
    text: '专属人设状态在线',
  };
}

function getPersonasSnapshot() {
  const globalConfig = safeReadJson(CONFIG_JSON_PATH) || {};
  const pluginStates = globalConfig.plugins || {};

  let entries = [];
  try {
    if (existsSync(PLUGINS_ROOT)) {
      entries = readdirSync(PLUGINS_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    }
  } catch {
    entries = [];
  }

  const personas = [];
  for (const dirName of entries) {
    const pluginDir = join(PLUGINS_ROOT, dirName);
    const manifest = safeReadJson(join(pluginDir, 'plugin.json'));
    if (!manifest) continue;

    const hasPersonaRules = existsSync(join(pluginDir, 'rules', 'AGENTS.md'));
    const isPersona = dirName.endsWith('-persona') && hasPersonaRules;
    if (!isPersona) continue;

    let enabled = !manifest.disabled;
    if (
      pluginStates[dirName] &&
      typeof pluginStates[dirName].enabled === 'boolean'
    ) {
      enabled = pluginStates[dirName].enabled;
    }

    const assetsDir = join(pluginDir, 'assets');
    const manifestLogo = manifest.logo
      ? manifest.logo.replace(/^assets[/\\]/, '')
      : null;

    let assetFiles = [];
    try {
      if (existsSync(assetsDir)) {
        assetFiles = readdirSync(assetsDir).filter((f) =>
          /\.(?:png|jpe?g|webp|svg)$/i.test(f)
        );
      }
    } catch {}

    const logoFile =
      pickExistingFile(assetsDir, [
        manifestLogo,
        'logo.jpg',
        'logo.png',
        'logo.webp',
        'logo.svg',
      ]) || assetFiles[0] || null;

    const nonLogoImages = assetFiles.filter(
      (f) => f !== logoFile && !/^logo\./i.test(f) && !/original/i.test(f)
    );

    let realisticFile = pickExistingFile(assetsDir, [
      'realistic.jpg',
      'realistic.png',
      'realistic.webp',
    ]);
    if (!realisticFile) {
      realisticFile = nonLogoImages[0] || logoFile;
    }

    let secondaryFile = pickExistingFile(assetsDir, [
      'anime.jpg',
      'anime.png',
      'anime.webp',
    ]);
    if (!secondaryFile) {
      secondaryFile = nonLogoImages.find((f) => f !== realisticFile) || null;
    }

    let secondaryLabel = '二次元形象';
    if (secondaryFile && /^anime\./i.test(secondaryFile)) {
      secondaryLabel = '二次元成年版 (ai-girls)';
    } else if (secondaryFile) {
      secondaryLabel = secondaryFile.replace(/\.[^.]+$/, '');
    }

    const encodeImg = (file) =>
      file
        ? `/api/image?plugin=${encodeURIComponent(dirName)}&file=${encodeURIComponent(file)}`
        : null;

    personas.push({
      id: dirName,
      name: manifest.name || dirName,
      displayName: manifest.displayName || manifest.name || dirName,
      description: manifest.description || '',
      enabled,
      suggestedPrompts: Array.isArray(manifest.suggestedPrompts)
        ? manifest.suggestedPrompts.slice(0, 3)
        : [],
      logoUrl: encodeImg(logoFile),
      realisticUrl: encodeImg(realisticFile),
      realisticLabel: '写实形象 (默认)',
      secondaryUrl: encodeImg(secondaryFile),
      secondaryLabel,
      badge: computePersonaStatusBadge(dirName),
      customizationLink: `customization://${dirName}`,
    });
  }

  const order = {
    'hajimi-persona': 1,
    'xiaoke-persona': 2,
  };
  personas.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return (order[a.id] || 99) - (order[b.id] || 99);
  });

  const activePersonas = personas.filter((p) => p.enabled);
  let mode = 'none';
  if (activePersonas.length === 1) mode = 'single';
  else if (activePersonas.length > 1) mode = 'conflict';

  return {
    mode,
    activeCount: activePersonas.length,
    activePersonas,
    allPersonas: personas,
  };
}

// ---------------------------------------------------------------------------
// Session & Local Quota / Usage Telemetry
// ---------------------------------------------------------------------------

function parseTranscriptStats(transcriptPath) {
  let steps = 0;
  let userTurns = 0;
  let imageCalls = 0;
  let latestModel = null;
  let bytes = 0;

  try {
    if (!existsSync(transcriptPath)) return null;
    const st = statSync(transcriptPath);
    bytes = st.size;
    const raw = readFileSync(transcriptPath, 'utf-8');
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      steps++;
      if (line.includes('"USER_INPUT"')) userTurns++;
      if (line.includes('"image-generator"')) imageCalls++;
      const modelMatch = line.match(
        /changed setting `Model Selection` from [^\n]+? to ([^.\n"]+)/
      );
      if (modelMatch && modelMatch[1]) {
        latestModel = modelMatch[1].trim();
      }
    }
  } catch {
    return null;
  }

  return { steps, userTurns, imageCalls, latestModel, bytes };
}

function getUsageTelemetry(requestedConvId) {
  const appData = findAppDataDir();
  if (!appData) {
    return {
      available: false,
      currentModel: 'Gemini (默认)',
      convId: null,
      convSteps: 0,
      convUserTurns: 0,
      convContextKB: 0,
      contextLoadPct: 0,
      todaySteps: 0,
      todayImages: 0,
      todayConvs: 0,
    };
  }

  const brainDir = join(appData, 'brain');
  let convDirs = [];
  try {
    if (existsSync(brainDir)) {
      convDirs = readdirSync(brainDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const full = join(brainDir, d.name);
          const logPath = join(
            full,
            '.system_generated',
            'logs',
            'transcript.jsonl'
          );
          let mtime = 0;
          try {
            if (existsSync(logPath)) mtime = statSync(logPath).mtimeMs;
          } catch {}
          return { id: d.name, logPath, mtime };
        })
        .filter((x) => x.mtime > 0)
        .sort((a, b) => b.mtime - a.mtime);
    }
  } catch {
    convDirs = [];
  }

  const targetConv =
    (requestedConvId && convDirs.find((c) => c.id === requestedConvId)) ||
    convDirs[0] ||
    null;

  let currentStats = {
    steps: 0,
    userTurns: 0,
    imageCalls: 0,
    latestModel: null,
    bytes: 0,
  };
  if (targetConv) {
    currentStats =
      parseTranscriptStats(targetConv.logPath) || currentStats;
  }

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;
  let todaySteps = 0;
  let todayImages = 0;
  let todayConvs = 0;
  let fallbackModel = currentStats.latestModel;

  for (const c of convDirs) {
    if (now - c.mtime <= DAY_MS) {
      todayConvs++;
      const st = parseTranscriptStats(c.logPath);
      if (st) {
        todaySteps += st.steps;
        todayImages += st.imageCalls;
        if (!fallbackModel && st.latestModel) {
          fallbackModel = st.latestModel;
        }
      }
    }
  }

  const convContextKB = Math.round((currentStats.bytes / 1024) * 10) / 10;
  const contextLoadPct = Math.min(
    100,
    Math.round((convContextKB / 400) * 100)
  );

  return {
    available: true,
    currentModel: fallbackModel || 'Gemini (默认)',
    convId: targetConv ? targetConv.id : null,
    convSteps: currentStats.steps,
    convUserTurns: currentStats.userTurns,
    convImages: currentStats.imageCalls,
    convContextKB,
    contextLoadPct,
    todaySteps,
    todayImages,
    todayConvs,
  };
}

// ---------------------------------------------------------------------------
// Sidecar HTTP Server Setup
// ---------------------------------------------------------------------------

const app = new SidecarApp();

app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

const MIME_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

app.api(
  '/api/image',
  (data) => {
    const plugin = String(data.plugin || '');
    const file = String(data.file || '');
    if (
      !plugin ||
      !file ||
      plugin.includes('..') ||
      plugin.includes('/') ||
      plugin.includes('\\') ||
      file.includes('..') ||
      file.includes('/') ||
      file.includes('\\')
    ) {
      return new Response('Forbidden', { status: 403 });
    }
    const targetPath = resolve(PLUGINS_ROOT, plugin, 'assets', file);
    const expectedPrefix = resolve(PLUGINS_ROOT, plugin, 'assets');
    if (!targetPath.startsWith(expectedPrefix) || !existsSync(targetPath)) {
      return new Response('Not found', { status: 404 });
    }
    const ext = extname(targetPath).toLowerCase();
    const contentType = MIME_MAP[ext] || 'application/octet-stream';
    try {
      const buf = readFileSync(targetPath);
      return new Response(buf, {
        contentType,
        headers: { 'Cache-Control': 'no-cache' },
      });
    } catch {
      return new Response('Read error', { status: 500 });
    }
  },
  'GET'
);

app.api(
  '/api/status',
  async (data) => {
    const convId = data.conversationId || app.config.conversationId || '';
    const personas = getPersonasSnapshot();
    const usage = getUsageTelemetry(convId);

    return {
      timestamp: new Date().toISOString(),
      personas,
      usage,
    };
  },
  'GET'
);

app.run();
