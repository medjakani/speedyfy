(() => {
  const $ = (id) => document.getElementById(id);

  // UI refs
  const subLine = $('subLine');
  const onlineChip = $('onlineChip');
  const connChip = $('connChip');

  const latencyEl = $('latency');
  const dlEl = $('dl');
  const statusEl = $('status');
  const barFill = $('barFill');
  const barText = $('barText');
  const endpointEl = $('endpoint');

  const resultsEl = $('results');
  const toast = $('toast');

  const btnQuick = $('btnQuick');
  const btnDeep = $('btnDeep');
  const btnStop = $('btnStop');
  const btnClear = $('btnClear');

  // ====== Endpoints (auto fallback) ======
  // Some servers block WebView fetch (403/CORS). We try multiple.
  const ENDPOINTS = {
    quick: [
      { name: 'TransIP 10MB', url: 'https://speed.transip.nl/10mb.bin', mbHint: 10 },
      { name: 'nforce 10MB', url: 'https://mirror.nforce.com/pub/speedtests/10mb.bin', mbHint: 10 }
    ],
    deep: [
      { name: 'nforce 50MB', url: 'https://mirror.nforce.com/pub/speedtests/50mb.bin', mbHint: 50 },
      { name: 'TransIP 10MB (fallback)', url: 'https://speed.transip.nl/10mb.bin', mbHint: 10 }
    ]
  };

  let abortCtrl = null;
  let running = false;
  let runs = []; // {when, name, mb, latencyMs, mbps, seconds}

  // ====== Helpers ======
  function fmt(n, d = 1) {
    if (!Number.isFinite(n)) return '—';
    return n.toFixed(d);
  }

  function setBar(pct, text) {
    const p = Math.max(0, Math.min(100, pct));
    barFill.style.width = `${p}%`;
    barText.textContent = text;
  }

  function toastMsg(msg) {
    toast.textContent = msg;
  }

  function setOnlineUI(isOnline) {
    onlineChip.textContent = isOnline ? 'ONLINE' : 'OFFLINE';
    onlineChip.style.color = isOnline ? 'var(--g)' : 'var(--warn)';
    subLine.textContent = isOnline ? 'Ready' : 'Offline';
  }

  function connInfo() {
    const c = navigator.connection;
    if (!c) return { type: 'unknown', downlink: null, rtt: null, saveData: null };
    return {
      type: c.type || c.effectiveType || 'unknown',
      downlink: c.downlink,
      rtt: c.rtt,
      saveData: c.saveData
    };
  }

  function updateConnUI() {
    const c = connInfo();
    connChip.textContent = `conn: ${c.type}`;
    $('iOnline').textContent = navigator.onLine ? 'Yes' : 'No';
    $('iType').textContent = c.type ?? '—';
    $('iDown').textContent = (c.downlink != null) ? `${c.downlink} Mbps` : '—';
    $('iRtt').textContent = (c.rtt != null) ? `${c.rtt} ms` : '—';
    $('iSave').textContent = (c.saveData != null) ? (c.saveData ? 'On' : 'Off') : '—';
    $('iUA').textContent = navigator.userAgent || '—';
  }

  function renderResults() {
    resultsEl.innerHTML = runs.slice().reverse().slice(0, 6).map(r => {
      const t = new Date(r.when).toLocaleTimeString();
      return `
        <div class="result">
          <div class="resultTop"><span>${r.name}</span><span>${t}</span></div>
          <div class="resultMid">${fmt(r.mbps)} Mbps</div>
          <div class="resultBot">${r.mb} MB • ${fmt(r.seconds, 2)}s • ${Math.round(r.latencyMs)}ms</div>
        </div>
      `;
    }).join('');
  }

  // ====== Real measurement ======
  // Latency: fetch first byte (TTFB-ish) using a small request (Range if supported).
  async function measureLatency(urlBase) {
    const cb = `cb=${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = urlBase.includes('?') ? `${urlBase}&${cb}` : `${urlBase}?${cb}`;

    const t0 = performance.now();
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      signal: abortCtrl.signal,
      headers: {
        // Try to request a tiny chunk. Some servers ignore Range (still OK).
        'Range': 'bytes=0-99999'
      }
    });
    if (!res.ok && res.status !== 206) {
      throw new Error(`HTTP ${res.status}`);
    }

    // We only need it to start; but fetch resolves when headers arrive.
    const t1 = performance.now();

    // Cancel body quickly by not reading it fully (best effort).
    try { res.body?.cancel(); } catch {}

    return (t1 - t0);
  }

  // Download speed: download whole file and compute Mbps.
  async function measureDownloadMbps(urlBase) {
    const cb = `cb=${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = urlBase.includes('?') ? `${urlBase}&${cb}` : `${urlBase}?${cb}`;

    const t0 = performance.now();
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: abortCtrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Read the full body to truly download
    const buf = await res.arrayBuffer();

    const t1 = performance.now();
    const seconds = (t1 - t0) / 1000;
    const bytes = buf.byteLength || 1;

    const mbps = (bytes * 8 / (1024 * 1024)) / seconds;
    return { mbps, seconds, bytes };
  }

  async function runTest(mode) {
    if (running) return;

    running = true;
    btnQuick.disabled = true;
    btnDeep.disabled = true;
    btnStop.disabled = false;

    abortCtrl = new AbortController();

    latencyEl.textContent = '—';
    dlEl.textContent = '—';
    statusEl.textContent = 'Starting…';
    endpointEl.textContent = 'auto';
    setBar(0, 'Initializing…');

    const candidates = ENDPOINTS[mode] || [];
    let lastErr = null;

    try {
      subLine.textContent = 'Running…';

      for (let i = 0; i < candidates.length; i++) {
        const ep = candidates[i];
        endpointEl.textContent = ep.name;

        try {
          statusEl.textContent = 'Latency check…';
          setBar(10, `Latency check: ${ep.name}`);
          const lat = await measureLatency(ep.url);
          latencyEl.textContent = String(Math.round(lat));

          statusEl.textContent = 'Downloading…';
          setBar(35, `Downloading: ${ep.name}`);

          const { mbps, seconds, bytes } = await measureDownloadMbps(ep.url);

          // show result
          dlEl.textContent = fmt(mbps, 1);
          statusEl.textContent = 'Done';
          setBar(100, 'Completed');

          const mb = Math.round(bytes / (1024 * 1024));
          runs.push({
            when: Date.now(),
            name: ep.name,
            mb: mb || ep.mbHint,
            latencyMs: lat,
            mbps,
            seconds
          });

          renderResults();
          toastMsg('Test completed.');
          return;

        } catch (e) {
          lastErr = e;
          // Try next endpoint
          statusEl.textContent = 'Switching endpoint…';
          setBar(15, `Blocked/failed. Trying next… (${e?.message || e})`);
        }
      }

      // If we got here, everything failed:
      throw lastErr || new Error('All endpoints failed');

    } catch (e) {
      if (e?.name === 'AbortError') {
        statusEl.textContent = 'Stopped';
        setBar(0, 'Stopped');
        toastMsg('Stopped.');
      } else {
        statusEl.textContent = 'Failed';
        setBar(0, `Failed: ${e?.message || e}`);
        toastMsg('Some servers may block device requests. We can switch endpoints or host your own test files.');
      }

    } finally {
      running = false;
      btnQuick.disabled = false;
      btnDeep.disabled = false;
      btnStop.disabled = true;
      abortCtrl = null;
      subLine.textContent = 'Ready';
    }
  }

  function stopNow() {
    try { abortCtrl?.abort(); } catch {}
  }

  function clearAll() {
    stopNow();
    runs = [];
    renderResults();
    latencyEl.textContent = '—';
    dlEl.textContent = '—';
    statusEl.textContent = 'Idle';
    endpointEl.textContent = 'auto';
    setBar(0, 'Idle');
    toastMsg('Cleared.');
  }

  // ====== Matrix background ======
  function startMatrix() {
    const canvas = $('matrix');
    const ctx = canvas.getContext('2d');

    function resize() {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF#@$%';
    const fontSize = 16;
    let columns = Math.floor(window.innerWidth / fontSize);
    let drops = Array.from({ length: columns }, () => Math.random() * 20);

    function tick() {
      // translucent background for trails
      ctx.fillStyle = 'rgba(2, 6, 4, 0.10)';
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

      ctx.font = `${fontSize}px ui-monospace, monospace`;
      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        const x = i * fontSize;
        const y = drops[i] * fontSize;

        ctx.fillStyle = 'rgba(57,255,122,0.85)';
        ctx.fillText(text, x, y);

        if (y > window.innerHeight && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
      }

      // adapt if screen size changes significantly
      const newCols = Math.floor(window.innerWidth / fontSize);
      if (newCols !== columns) {
        columns = newCols;
        drops = Array.from({ length: columns }, () => Math.random() * 20);
      }

      requestAnimationFrame(tick);
    }
    tick();
  }

  // ====== Shortcuts UI (preview) ======
  function initShortcuts() {
    document.querySelectorAll('.tile').forEach(b => {
      b.addEventListener('click', () => {
        toastMsg(`${b.dataset.name}: (preview only)`);
      });
    });
  }

  // ====== Init ======
  function init() {
    startMatrix();

    setOnlineUI(navigator.onLine);
    updateConnUI();

    window.addEventListener('online', () => { setOnlineUI(true); updateConnUI(); });
    window.addEventListener('offline', () => { setOnlineUI(false); updateConnUI(); });

    if (navigator.connection) {
      navigator.connection.onchange = updateConnUI;
    }

    btnQuick.addEventListener('click', () => runTest('quick'));
    btnDeep.addEventListener('click', () => runTest('deep'));
    btnStop.addEventListener('click', stopNow);
    btnClear.addEventListener('click', clearAll);

    initShortcuts();

    // Remote-friendly focus
    setTimeout(() => btnQuick.focus(), 250);

    statusEl.textContent = 'Idle';
    setBar(0, 'Idle');
    toastMsg('Ready. Run Quick or Deep.');
  }

  document.addEventListener('deviceready', init, false);
  if (!window.cordova) init(); // browser preview
})();
