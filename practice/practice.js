(() => {
  'use strict';

  const supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  const LOCAL_AUTH_STORAGE_KEY = 'usuarios:authorizedProfile';
  const PRACTICE_BUTTON_VISIBLE = true;

  let localAuthorizedProfile = null;
  let clientIp = null;
  let localResolution = `${window.screen.width}x${window.screen.height}`;
  const sessionPendingRequestIds = new Set();
  const userProfileCache = {};

  function clearLocalAuthorization() {
    try {
      window.localStorage.removeItem(LOCAL_AUTH_STORAGE_KEY);
    } catch (err) {
      console.warn('No se pudo limpiar la autorización local:', err);
    }
    localAuthorizedProfile = null;
  }

  function updatePracticeButtonVisibility() {
    const practiceBtn = document.getElementById('practicar-btn');
    if (!practiceBtn) return;
    practiceBtn.style.display = PRACTICE_BUTTON_VISIBLE ? 'block' : 'none';
  }

  function updateEmailDisplay() {
    const emailCell = document.getElementById('stored-email');
    if (!emailCell) return;
    const email = typeof localAuthorizedProfile?.email === 'string' ? localAuthorizedProfile.email.trim() : '';
    emailCell.textContent = email ? email : 'X';
  }

  async function getUserProfileById(userId) {
    if (!userId) return null;
    if (userProfileCache[userId]) return userProfileCache[userId];
    try {
      const { data, error } = await supabase
        .from('users')
        .select('name, email')
        .eq('id', userId)
        .single();
      if (!error && data) {
        const profile = {
          id: userId,
          name: data.name || null,
          email: data.email || null
        };
        userProfileCache[userId] = profile;
        return profile;
      }
    } catch (err) {
      console.warn('No se pudo obtener el perfil del usuario:', err);
    }
    return null;
  }

  async function applyApprovedState(record, animate = false) {
    if (!record) return false;

    const targetId = record.selected_user_id || record.id;
    const hasLocalAuth = Boolean(localAuthorizedProfile?.userId && targetId && localAuthorizedProfile.userId === targetId);
    const isSessionApproval = Boolean(record.id && sessionPendingRequestIds.has(record.id));

    if (!hasLocalAuth && !isSessionApproval) {
      setState1();
      return false;
    }

    let profile = null;
    if (record.selected_user_id) {
      profile = await getUserProfileById(record.selected_user_id);
    }

    const displayName = profile?.name || localAuthorizedProfile?.name || null;
    const email = profile?.email || localAuthorizedProfile?.email || null;
    const persist = Boolean(isSessionApproval && email);

    setState3(targetId, displayName, animate, {
      email,
      persist,
      requestId: record.id
    });
    return true;
  }

  function setState1() {
    if (localAuthorizedProfile?.userId) {
      return;
    }
    const btn = document.getElementById('practicar-btn');
    if (!btn) return;
    btn.className = 'practice-btn-base practice-btn-state-1';
    btn.innerHTML = 'Practicar';
    btn.onclick = () => {
      document.getElementById('modal').classList.remove('hidden');
    };
    updatePracticeButtonVisibility();
    updateEmailDisplay();
  }

  async function setState2(record = null) {
    if (localAuthorizedProfile?.userId) {
      return;
    }
    const btn = document.getElementById('practicar-btn');
    if (!btn) return;
    btn.className = 'practice-btn-base practice-btn-state-2';
    btn.innerHTML = '<div class="progress-bar-yellow"></div><span class="btn-text">Espere</span>';
    setTimeout(() => {
      const progressDiv = btn.querySelector('div');
      if (progressDiv) progressDiv.style.width = '100%';
    }, 0);
    if (record && record.ip) {
      clientIp = record.ip;
    } else if (!clientIp) {
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json');
        const ipData = await ipResponse.json();
        clientIp = ipData.ip;
      } catch (err) {
        console.warn('No se pudo actualizar la IP en setState2:', err);
      }
    }
    btn.onclick = () => {
      document.getElementById('pending-modal').classList.remove('hidden');
    };

    localResolution = `${window.screen.width}x${window.screen.height}`;
    updatePracticeButtonVisibility();
    updateEmailDisplay();
  }

  function setState3(id, name = null, animate = false, options = {}) {
    const btn = document.getElementById('practicar-btn');
    if (!btn) return;
    btn.className = 'practice-btn-base practice-btn-state-3';
    const priorProfile = (localAuthorizedProfile && localAuthorizedProfile.userId === id) ? localAuthorizedProfile : null;
    const resolvedEmail = options.email ?? priorProfile?.email ?? null;
    const resolvedName = name ?? priorProfile?.name ?? null;
    const label = resolvedName || resolvedEmail || 'Practicar';
    btn.innerHTML = `<div class="progress-bar-blue"></div><span class="btn-text">${label}</span>`;
    btn.onclick = async () => {
      if (resolvedEmail && id) {
        await registerAccess(resolvedEmail, id);
      }
      window.location.href = `../songs/index.html?id=${id}`;
    };
    if (animate) {
      setTimeout(() => {
        const progressDiv = btn.querySelector('div');
        if (progressDiv) progressDiv.style.width = '100%';
      }, 0);
    } else {
      const progressDiv = btn.querySelector('div');
      if (progressDiv) progressDiv.style.width = '100%';
    }

    if (id) {
      const savedAt = options.savedAt || Date.now();
      localAuthorizedProfile = {
        userId: id,
        name: resolvedName,
        email: resolvedEmail,
        savedAt
      };
      if (options.persist && resolvedEmail) {
        saveLocalAuthorization(localAuthorizedProfile);
      }
    }
    if (options.requestId) {
      sessionPendingRequestIds.delete(options.requestId);
    }
    updatePracticeButtonVisibility();
    updateEmailDisplay();
  }

  function saveLocalAuthorization(profile) {
    if (!profile?.userId || !profile.email) return;
    try {
      const payload = {
        userId: profile.userId,
        email: profile.email,
        name: profile.name || null,
        savedAt: profile.savedAt || Date.now()
      };
      window.localStorage.setItem(LOCAL_AUTH_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      console.warn('No se pudo guardar la autorización local:', err);
    }
  }

  function loadLocalAuthorization() {
    try {
      const raw = window.localStorage.getItem(LOCAL_AUTH_STORAGE_KEY);
      if (!raw) return null;
      const payload = JSON.parse(raw);
      if (!payload || !payload.userId || !payload.email) {
        return null;
      }
      return {
        userId: payload.userId,
        email: payload.email,
        name: payload.name || null,
        savedAt: payload.savedAt || Date.now()
      };
    } catch (err) {
      console.warn('No se pudo cargar la autorización local:', err);
      return null;
    }
  }

  function restoreLocalAuthorization() {
    const stored = loadLocalAuthorization();
    if (!stored || !stored.userId || !stored.email) {
      return false;
    }
    localAuthorizedProfile = { ...stored };
    setState3(stored.userId, stored.name || null, false, { email: stored.email, persist: false, savedAt: stored.savedAt });
    return true;
  }

  async function checkApproval() {
    try {
      const ipResponse = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipResponse.json();
      const ip = ipData.ip;
      clientIp = ip;

      localResolution = `${window.screen.width}x${window.screen.height}`;

      let matchingRecord = null;
      let approvedApplied = false;

      const { data: approvedData, error: aError } = await supabase
        .from('user_ip')
        .select('id, selected_user_id, ip, resolution')
        .eq('ip', ip)
        .eq('resolution', localResolution)
        .eq('approved', true)
        .order('created_at', { ascending: false })
        .limit(1);
      if (approvedData && approvedData.length > 0 && !aError) {
        matchingRecord = approvedData[0];
        approvedApplied = await applyApprovedState(approvedData[0], false);
      }

      if (!approvedApplied) {
        const { data: pendingData, error: pError } = await supabase
          .from('user_ip')
          .select('*')
          .eq('ip', ip)
          .eq('approved', false)
          .eq('resolution', localResolution)
          .order('created_at', { ascending: false })
          .limit(1);
        if (pendingData && pendingData.length > 0 && !pError) {
          matchingRecord = pendingData[0];
          setState2(pendingData[0]);
        } else if (!matchingRecord) {
          setState1();
        }
      }

      const matchesCurrentDevice = (entry) => entry && entry.ip === clientIp;

      supabase.channel('user_ip_changes')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_ip' }, async (payload) => {
          if (matchesCurrentDevice(payload.new)) {
            if (payload.new.approved) {
              const applied = await applyApprovedState(payload.new, false);
              if (!applied) {
                return;
              }
            } else if (payload.new.resolution === localResolution) {
              setState2(payload.new);
            } else {
              setState1();
            }
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'user_ip' }, async (payload) => {
          if (matchesCurrentDevice(payload.new)) {
            if (payload.new.approved) {
              const wasApproved = payload.old && payload.old.approved === true;
              const applied = await applyApprovedState(payload.new, !wasApproved);
              if (!applied) {
                return;
              }
            } else if (payload.new.resolution === localResolution) {
              setState2(payload.new);
            } else {
              setState1();
            }
          } else if (matchesCurrentDevice(payload.old)) {
            setState1();
          }
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'user_ip' }, (payload) => {
          if (matchesCurrentDevice(payload.old)) {
            setState1();
          }
        })
        .subscribe();
    } catch (err) {
      console.warn('Error checking approval:', err);
    }
  }

  async function collectDeviceData() {
    const userAgent = navigator.userAgent;
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    const pixelRatio = window.devicePixelRatio || 1;

    const deviceType = /Mobile|Android|iP(hone|od|ad)/.test(userAgent) ? 'Mobile' : 'Desktop';

    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(screenWidth, screenHeight);
    const screenFormat = `${screenWidth / divisor}:${screenHeight / divisor}`;

    const resolution = `${screenWidth}x${screenHeight}`;
    const ppi = Math.round(pixelRatio * 96);

    let os = 'Unknown';
    let osVersion = 'Unknown';
    if (userAgent.includes('Windows')) {
      os = 'Windows';
      const match = userAgent.match(/Windows NT ([^\s;]+)/);
      osVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Android')) {
      os = 'Android';
      const match = userAgent.match(/Android ([^\s;]+)/);
      osVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('iPhone') || userAgent.includes('iPad') || userAgent.includes('iPod')) {
      os = 'iOS';
      const match = userAgent.match(/OS ([^\s_\)]+)/);
      osVersion = match ? match[1].replace(/_/g, '.') : 'Unknown';
    } else if (userAgent.includes('Mac')) {
      os = 'macOS';
      const match = userAgent.match(/Mac OS X ([^\s\)]+)/);
      osVersion = match ? match[1].replace(/_/g, '.') : 'Unknown';
    } else if (userAgent.includes('Linux')) {
      os = 'Linux';
      osVersion = 'Unknown';
    }

    let browser = 'Unknown';
    let browserVersion = 'Unknown';
    if (userAgent.includes('CriOS')) {
      browser = 'Chrome';
      const match = userAgent.match(/CriOS\/([^\s]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browser = 'Chrome';
      const match = userAgent.match(/Chrome\/([^\s]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Firefox')) {
      browser = 'Firefox';
      const match = userAgent.match(/Firefox\/([^\s]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browser = 'Safari';
      const match = userAgent.match(/Version\/([^\s]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    } else if (userAgent.includes('Edg')) {
      browser = 'Edge';
      const match = userAgent.match(/Edg\/([^\s]+)/);
      browserVersion = match ? match[1] : 'Unknown';
    }

    let deviceModel = 'Unknown';
    if (deviceType === 'Mobile') {
      if (userAgent.includes('iPhone')) {
        const match = userAgent.match(/iPhone (.*?);/);
        deviceModel = match ? 'iPhone ' + match[1] : 'iPhone';
      } else if (userAgent.includes('iPad')) {
        deviceModel = 'iPad';
      } else if (userAgent.includes('Android')) {
        const match = userAgent.match(/Android.*?; (.*?)\)/);
        deviceModel = match ? match[1] : 'Android Device';
      }
    } else {
      deviceModel = 'Desktop PC';
    }

    let location = 'No disponible';
    try {
      const geoResponse = await fetch('https://ipapi.co/json/');
      const geoData = await geoResponse.json();
      location = `${geoData.city}, ${geoData.country_name}`;
    } catch (err) {
      console.warn('Error obteniendo ubicación:', err);
    }

    const language = navigator.language || 'Unknown';
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';

    const connection = navigator.connection;
    let internetConnection = 'Unknown';
    if (connection) {
      if (connection.type) {
        internetConnection = connection.type;
      } else if (connection.effectiveType) {
        internetConnection = connection.effectiveType;
      } else {
        internetConnection = navigator.onLine ? 'online' : 'offline';
      }
    } else {
      internetConnection = navigator.onLine ? 'online' : 'offline';
    }
    const latency = await measureLatency();
    const ram = navigator.deviceMemory || null;
    const cores = navigator.hardwareConcurrency || null;
    const darkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    let notch = hasNotch();
    if (os === 'iOS' && deviceType === 'Mobile') notch = true;
    const supportsTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const innerWidth = window.innerWidth;
    const innerHeight = window.innerHeight;

    const data = {};
    data.device_type = deviceType;
    data.screen_format = screenFormat;
    data.resolution = resolution;
    data.ppi = ppi;
    data.os = os;
    data.os_version = osVersion;
    data.browser = browser;
    data.browser_version = browserVersion;
    data.device_model = deviceModel;
    data.location = location;
    data.language = language;
    data.timezone = timezone;
    data.user_agent = userAgent;
    data.internet_connection = internetConnection;
    data.latency = typeof latency === 'number' ? latency : null;
    data.ram = ram;
    data.cores = cores;
    data.dark_mode = darkMode;
    data.notch = notch;
    data.supports_touch = supportsTouch;
    data.inner_width = innerWidth;
    data.inner_height = innerHeight;
    data.approved = false;
    data.created_at = new Date().toISOString();
    return data;
  }

  function hasNotch() {
    const testEl = document.createElement('div');
    testEl.style.cssText = 'position: fixed; top: env(safe-area-inset-top); left: 0; width: 1px; height: 1px; visibility: hidden;';
    document.body.appendChild(testEl);
    const hasInset = getComputedStyle(testEl).top !== '0px';
    document.body.removeChild(testEl);
    return hasInset;
  }

  async function measureLatency() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const start = performance.now();
      await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', mode: 'no-cors', signal: controller.signal });
      clearTimeout(timeoutId);
      const end = performance.now();
      return Math.round(end - start);
    } catch (err) {
      console.warn('Error measuring latency:', err);
      return 'Unknown';
    }
  }

  async function ensureClientIp() {
    if (clientIp) return clientIp;
    try {
      const ipResponse = await fetch('https://api.ipify.org?format=json');
      const ipData = await ipResponse.json();
      clientIp = ipData.ip;
      return clientIp;
    } catch (err) {
      console.warn('Error fetching IP:', err);
      return null;
    }
  }

  async function registerAccess(email, userId) {
    try {
      await ensureClientIp();
      const deviceData = await collectDeviceData();
      const payload = {
        ...deviceData,
        email: email,
        selected_user_id: userId,
        ip: clientIp,
        approved: true
      };
      await supabase.from('user_ip').insert([payload]);
    } catch (err) {
      console.error('Error registering access:', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
  const modalEl = document.getElementById('modal');
  const pendingModalEl = document.getElementById('pending-modal');
    const solicitarBtn = document.getElementById('solicitar-btn');
    const pendingVolverBtn = document.getElementById('pending-volver-btn');
  const logoutBtn = document.getElementById('logout-btn');

    if (modalEl) {
      modalEl.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
          e.currentTarget.classList.add('hidden');
        }
      });
    }

    if (pendingModalEl) {
      pendingModalEl.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) {
          e.currentTarget.classList.add('hidden');
        }
      });
    }

    if (pendingVolverBtn && pendingModalEl) {
      pendingVolverBtn.addEventListener('click', () => {
        pendingModalEl.classList.add('hidden');
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearLocalAuthorization();
        updateEmailDisplay();
        setState1();
      });
    }

    if (solicitarBtn) {
      solicitarBtn.addEventListener('click', async () => {
        const emailInput = document.getElementById('email-input');
        const email = emailInput ? emailInput.value.trim() : '';
        if (!email) {
          alert('Por favor, ingresa tu email');
          return;
        }

        const progress = document.getElementById('progress');
        const btnText = document.getElementById('btn-text');
        const resetButtonState = () => {
          if (progress) progress.style.width = '0';
          if (btnText) btnText.textContent = 'Solicitar acceso';
          solicitarBtn.disabled = false;
        };

        solicitarBtn.disabled = true;
        if (btnText) btnText.textContent = 'Verificando...';

        let matchedUser = null;
        try {
          const { data: userRows, error: userError } = await supabase
            .from('users')
            .select('id, email, name')
            .ilike('email', email)
            .limit(1);
          if (userError) throw userError;
          matchedUser = Array.isArray(userRows) ? userRows[0] : userRows;
        } catch (lookupError) {
          console.error('Error verificando email:', lookupError);
          alert('No se pudo verificar el email. Inténtalo nuevamente.');
          resetButtonState();
          return;
        }

        if (matchedUser) {
          const matchedUserId = matchedUser.id;
          const matchedEmail = typeof matchedUser.email === 'string' ? matchedUser.email.trim() : email;
          const matchedName = matchedUser.name || null;
          if (btnText) btnText.textContent = 'Accediendo...';
          if (progress) progress.style.width = '100%';
          
          await registerAccess(matchedEmail, matchedUserId);

          const savedAt = Date.now();
          setState3(matchedUserId, matchedName, false, { email: matchedEmail, persist: true, savedAt });
          if (btnText) btnText.textContent = 'Listo!';
          setTimeout(() => {
            if (modalEl) modalEl.classList.add('hidden');
            if (emailInput) emailInput.value = '';
            resetButtonState();
          }, 800);
          return;
        }

        if (btnText) btnText.textContent = 'Enviando...';
        if (progress) progress.style.width = '100%';

        try {
          const deviceData = await collectDeviceData();
          const payload = {
            ...deviceData,
            email,
            selected_user_id: null
          };

          if (!clientIp) {
            try {
              const ipResponse = await fetch('https://api.ipify.org?format=json');
              const ipData = await ipResponse.json();
              clientIp = ipData.ip;
            } catch (err) {
              console.error('No se pudo obtener la IP:', err);
              alert('No se pudo obtener la IP del dispositivo. Inténtalo nuevamente.');
              resetButtonState();
              return;
            }
          }
          payload.ip = clientIp;

          const { data: insertedRows, error } = await supabase
            .from('user_ip')
            .insert([payload])
            .select('id')
            .limit(1);
          if (error) {
            throw error;
          }

          const insertedRow = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
          if (insertedRow?.id) {
            sessionPendingRequestIds.add(insertedRow.id);
          }

          if (btnText) btnText.textContent = 'Listo!';
          setTimeout(() => {
            if (modalEl) modalEl.classList.add('hidden');
            if (emailInput) emailInput.value = '';
            resetButtonState();
          }, 1000);
        } catch (submissionError) {
          console.error('Error al enviar solicitud:', submissionError);
          alert('Error al enviar solicitud: ' + submissionError.message);
          resetButtonState();
        }
      });
    }



    updatePracticeButtonVisibility();
    updateEmailDisplay();
    restoreLocalAuthorization();
    checkApproval();
  });
})();
