const authPanel = document.querySelector('#authPanel');
const accountPanel = document.querySelector('#accountPanel');
const statusMessage = document.querySelector('#statusMessage');
const stage = document.querySelector('#stage');
const voiceSelect = document.querySelector('#voiceSelect');
const speechRate = document.querySelector('#speechRate');
const avatarFigure = document.querySelector('#figure');
const apiOrigin = (window.CAELIA_API_ORIGIN || window.location.origin).replace(/\/$/, '');
let account = null;
let recognition = null;

function setStatus(message) {
  statusMessage.textContent = message;
}

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function decodeBase64url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64url(value) {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function prepareCreationOptions(options) {
  return {
    ...options,
    challenge: decodeBase64url(options.challenge),
    user: { ...options.user, id: decodeBase64url(options.user.id) },
    excludeCredentials: options.excludeCredentials?.map((credential) => ({
      ...credential,
      id: decodeBase64url(credential.id),
    })),
  };
}

function prepareRequestOptions(options) {
  return {
    ...options,
    challenge: decodeBase64url(options.challenge),
    allowCredentials: options.allowCredentials?.map((credential) => ({
      ...credential,
      id: decodeBase64url(credential.id),
    })),
  };
}

function serializeCredential(credential) {
  const response = credential.response;
  const common = {
    id: credential.id,
    rawId: encodeBase64url(credential.rawId),
    type: credential.type,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };
  if (response.attestationObject) {
    return {
      ...common,
      response: {
        clientDataJSON: encodeBase64url(response.clientDataJSON),
        attestationObject: encodeBase64url(response.attestationObject),
        transports: response.getTransports?.() || [],
      },
    };
  }
  return {
    ...common,
    response: {
      clientDataJSON: encodeBase64url(response.clientDataJSON),
      authenticatorData: encodeBase64url(response.authenticatorData),
      signature: encodeBase64url(response.signature),
      userHandle: response.userHandle ? encodeBase64url(response.userHandle) : null,
    },
  };
}

function requirePasskeySupport() {
  if (!window.PublicKeyCredential || !navigator.credentials) {
    throw new Error('This browser does not support passkeys. Try a current browser on a secure connection.');
  }
}

async function registerPasskey() {
  requirePasskeySupport();
  const options = await api('/api/auth/register/options', {
    method: 'POST',
    body: {
      username: document.querySelector('#newUsername').value,
      enrollmentCode: document.querySelector('#enrollmentCode').value,
    },
  });
  const credential = await navigator.credentials.create({ publicKey: prepareCreationOptions(options) });
  if (!credential) throw new Error('Passkey registration was cancelled.');
  const result = await api('/api/auth/register/verify', {
    method: 'POST',
    body: serializeCredential(credential),
  });
  showRecoveryCodes(result.recoveryCodes);
  document.querySelector('#enrollmentCode').value = '';
  await loadAccount();
}

async function addPasskey() {
  requirePasskeySupport();
  const options = await api('/api/auth/passkey/register/options', { method: 'POST', body: {} });
  const credential = await navigator.credentials.create({ publicKey: prepareCreationOptions(options) });
  if (!credential) throw new Error('Passkey registration was cancelled.');
  await api('/api/auth/passkey/register/verify', {
    method: 'POST',
    body: serializeCredential(credential),
  });
  await loadAccount();
  setStatus('Another passkey is ready for this account.');
}

async function login() {
  requirePasskeySupport();
  const options = await api('/api/auth/login/options', { method: 'POST', body: {} });
  const credential = await navigator.credentials.get({ publicKey: prepareRequestOptions(options) });
  if (!credential) throw new Error('Passkey sign-in was cancelled.');
  await api('/api/auth/login/verify', {
    method: 'POST',
    body: serializeCredential(credential),
  });
  await loadAccount();
}

function showRecoveryCodes(codes) {
  if (!Array.isArray(codes) || !codes.length) return;
  document.querySelector('#recoveryCodes').textContent = codes.join('\n');
  document.querySelector('#recoveryCodesNotice').hidden = false;
}

function loadVoices() {
  if (!('speechSynthesis' in window)) {
    voiceSelect.innerHTML = '<option value="">Speech unavailable</option>';
    voiceSelect.disabled = true;
    return;
  }
  const voices = speechSynthesis.getVoices();
  const selected = voiceSelect.value;
  voiceSelect.replaceChildren();
  const automatic = new Option('Device default voice', '');
  voiceSelect.add(automatic);
  for (const voice of voices) {
    const option = new Option(`${voice.name} · ${voice.lang}`, voice.voiceURI);
    voiceSelect.add(option);
  }
  if (voices.some((voice) => voice.voiceURI === selected)) voiceSelect.value = selected;
  else {
    const englishVoice = voices.find((voice) => /^en(-|$)/i.test(voice.lang));
    if (englishVoice) voiceSelect.value = englishVoice.voiceURI;
  }
}

function say(text) {
  const message = text.trim();
  if (!message) return;
  document.querySelector('#speechCaption').textContent = message;
  if (!('speechSynthesis' in window)) {
    stage.classList.remove('is-speaking');
    return;
  }

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  const selectedVoice = speechSynthesis.getVoices()
    .find((voice) => voice.voiceURI === voiceSelect.value);
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.rate = Number(speechRate.value);
  utterance.pitch = 1.02;
  utterance.onstart = () => stage.classList.add('is-speaking');
  utterance.onend = () => stage.classList.remove('is-speaking');
  utterance.onerror = () => stage.classList.remove('is-speaking');
  speechSynthesis.speak(utterance);
}

function moveTo(target, duration = 1800) {
  const x = target ? Math.max(0, Math.min(1, target.x)) : 0.5;
  const y = target ? Math.max(0, Math.min(1, target.y)) : 0.5;
  stage.style.setProperty('--offset-x', `${Math.round((x - 0.5) * 130)}px`);
  stage.style.setProperty('--offset-y', `${Math.round((y - 0.5) * 42)}px`);
  stage.style.setProperty('--motion-duration', `${duration}ms`);
}

function animateFigure(keyframes, duration = 1200) {
  avatarFigure.animate(keyframes, {
    duration,
    easing: 'cubic-bezier(.22, .8, .25, 1)',
  });
}

function presentIntent(intent) {
  if (intent.action !== 'speak' && 'speechSynthesis' in window) speechSynthesis.cancel();
  stage.classList.remove('is-speaking');
  stage.classList.remove('is-thinking', 'is-listening', 'is-blooming', 'is-bowing', 'is-waving', 'is-walking', 'is-quantum', 'is-celebrating');
  switch (intent.action) {
    case 'greet':
      stage.classList.add('is-waving');
      say(`Hello${account.displayName ? `, ${account.displayName}` : ''}. It's good to see you.`);
      break;
    case 'glide':
      moveTo(intent.target || { x: 0.66, y: 0.49 }, intent.duration);
      break;
    case 'walk':
      moveTo(intent.target || { x: 0.62, y: 0.5 }, intent.duration * 2);
      stage.classList.add('is-walking');
      window.setTimeout(() => stage.classList.remove('is-walking'), intent.duration * 2);
      break;
    case 'turn':
    case 'attention':
      if (intent.target) moveTo(intent.target, intent.duration);
      animateFigure([{ transform: 'rotate(0)' }, { transform: 'rotate(2deg)' }, { transform: 'rotate(0)' }], intent.duration);
      break;
    case 'spin':
      animateFigure([{ transform: 'rotateY(0)' }, { transform: 'rotateY(180deg) scale(1.02)' }, { transform: 'rotateY(360deg)' }], intent.duration);
      break;
    case 'wave':
      stage.classList.add('is-waving');
      break;
    case 'bow':
      stage.classList.add('is-bowing');
      break;
    case 'pulse':
      stage.classList.add('is-blooming');
      break;
    case 'soul_bloom':
      stage.classList.add('is-blooming');
      animateFigure([{ opacity: 0.72, transform: 'scale(.99)' }, { opacity: 1, transform: 'scale(1.045)' }, { opacity: 1, transform: 'scale(1)' }], intent.duration);
      break;
    case 'quantum_step':
      stage.classList.add('is-blooming', 'is-quantum');
      window.setTimeout(() => stage.classList.remove('is-quantum'), intent.duration);
      moveTo(intent.target || { x: 0.68, y: 0.48 }, intent.duration);
      break;
    case 'think':
      stage.classList.add('is-thinking');
      document.querySelector('#speechCaption').textContent = 'Let me think about that.';
      break;
    case 'listen':
      stage.classList.add('is-listening');
      document.querySelector('#speechCaption').textContent = 'I’m listening.';
      break;
    case 'speak':
      stage.classList.add('is-speaking');
      say(intent.text || '');
      break;
    case 'celebrate':
      stage.classList.add('is-celebrating');
      break;
    case 'calm':
      moveTo({ x: 0.5, y: 0.5 }, intent.duration);
      document.querySelector('#speechCaption').textContent = 'I’m here with you.';
      break;
    default:
      break;
  }
}

async function requestIntent(action, options = {}) {
  const intent = await api('/api/avatar/intent', {
    method: 'POST',
    body: { action, ...options },
  });
  presentIntent(intent);
  return intent;
}

function renderAccount(data) {
  account = data.account;
  authPanel.hidden = true;
  accountPanel.hidden = false;
  document.querySelector('#connectionStatus').textContent = `Signed in as ${account.username}`;
  document.querySelector('#greeting').textContent = account.displayName
    ? `I’m glad you’re here, ${account.displayName}.`
    : 'I’m here with you.';
  document.querySelector('#accountName').textContent = `Account: ${account.username}`;
  document.querySelector('#displayName').value = account.displayName;
  document.querySelector('#recognitionPhrase').value = account.recognitionPhrase;
  const passkeys = data.passkeys || [];
  const passkeyList = document.querySelector('#passkeyList');
  passkeyList.replaceChildren();
  if (passkeys.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'small';
    empty.textContent = 'No passkeys registered. Add one now so you can sign in again.';
    passkeyList.append(empty);
  }
  for (const passkey of passkeys) {
    const row = document.createElement('div');
    row.className = 'passkey-item';
    const name = document.createElement('span');
    name.textContent = `${passkey.name} · added ${new Date(passkey.createdAt).toLocaleDateString()}`;
    const revoke = document.createElement('button');
    revoke.type = 'button';
    revoke.textContent = 'Revoke';
    revoke.addEventListener('click', async () => {
      if (!window.confirm('Revoke this passkey? A device using it will no longer be able to sign in.')) return;
      try {
        await api('/api/auth/passkeys/revoke', { method: 'POST', body: { id: passkey.id } });
        try {
          await loadAccount();
        } catch (error) {
          if (error.message !== 'Sign in with a passkey to continue.') throw error;
          await showAuth();
          setStatus('Passkey and its sessions were revoked. Sign in with another passkey or a recovery code.');
          return;
        }
        setStatus('Passkey revoked.');
      } catch (error) {
        setStatus(error.message);
      }
    });
    row.append(name, revoke);
    passkeyList.append(row);
  }
  loadVoices();
}

async function loadAccount() {
  const data = await api('/api/me');
  renderAccount(data);
  setStatus('');
}

async function showAuth() {
  account = null;
  authPanel.hidden = false;
  accountPanel.hidden = true;
  document.querySelector('#connectionStatus').textContent = 'Secure account access';
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

document.querySelector('#registerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStatus('Follow your device prompt to create a passkey.');
    await registerPasskey();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector('#loginButton').addEventListener('click', async () => {
  try {
    setStatus('Choose your Caelia passkey.');
    await login();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector('#recoveryForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/auth/recovery', {
      method: 'POST',
      body: {
        username: document.querySelector('#recoveryUsername').value,
        code: document.querySelector('#recoveryCode').value,
      },
    });
    await loadAccount();
    setStatus('Recovery accepted. Add a replacement passkey if you lost your old one.');
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector('#preferencesForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/api/me', {
      method: 'PATCH',
      body: {
        displayName: document.querySelector('#displayName').value,
        recognitionPhrase: document.querySelector('#recognitionPhrase').value,
      },
    });
    account = result.account;
    document.querySelector('#greeting').textContent = account.displayName
      ? `I’m glad you’re here, ${account.displayName}.`
      : 'I’m here with you.';
    setStatus('Preferences saved. The recognition phrase is not used to authenticate you.');
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector('#speakForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#sayText');
  const text = input.value.trim();
  if (!text) return;
  try {
    stage.classList.add('is-thinking');
    document.querySelector('#speechCaption').textContent = 'Thinking…';
    const intent = await requestIntent('speak', { text });
    input.value = '';
    if (intent.text === 'I heard you. My conversation engine is not connected yet.') {
      setStatus('The browser will speak a local fallback. Connect the Caelia brain for conversation replies.');
    } else {
      setStatus('');
    }
  } catch (error) {
    setStatus(error.message);
  } finally {
    stage.classList.remove('is-thinking');
  }
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    try {
      await requestIntent(button.dataset.action);
    } catch (error) {
      setStatus(error.message);
    }
  });
});

document.querySelector('#addPasskey').addEventListener('click', async () => {
  try {
    await addPasskey();
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector('#rotateRecoveryCodes').addEventListener('click', async () => {
  if (!window.confirm('Create new recovery codes? All previously issued recovery codes will stop working.')) return;
  try {
    const result = await api('/api/auth/recovery-codes', { method: 'POST', body: {} });
    showRecoveryCodes(result.recoveryCodes);
    setStatus('New recovery codes created. Save them before closing this page.');
  } catch (error) {
    setStatus(error.message);
  }
});

document.querySelector('#dismissRecoveryCodes').addEventListener('click', () => {
  document.querySelector('#recoveryCodesNotice').hidden = true;
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await signOut('/api/auth/logout');
});

document.querySelector('#revokeSessions').addEventListener('click', async () => {
  if (!window.confirm('Sign out this account from every browser and device?')) return;
  await signOut('/api/auth/revoke-sessions');
});

async function signOut(endpoint) {
  try {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    await api(endpoint, { method: 'POST', body: {} });
    await showAuth();
    setStatus('You have been signed out.');
  } catch (error) {
    setStatus(error.message);
  }
}

document.querySelector('#stopSpeaking').addEventListener('click', () => {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  stage.classList.remove('is-speaking');
  document.querySelector('#speechCaption').textContent = 'I’m here with you.';
});

document.querySelector('#stage').addEventListener('click', async (event) => {
  if (event.target.closest('button, input, select, .presence, .recovery-notice')) return;
  const bounds = stage.getBoundingClientRect();
  const target = {
    x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
    y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
  };
  try {
    await requestIntent('attention', { target });
  } catch (error) {
    setStatus(error.message);
  }
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const listenButton = document.querySelector('#listenButton');
  listenButton.hidden = false;
  document.querySelector('#speechInputNotice').hidden = false;
  recognition = new SpeechRecognition();
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = async (event) => {
    const recognizedText = event.results[0][0].transcript.slice(0, 220);
    document.querySelector('#sayText').value = recognizedText;
    document.querySelector('#speakForm').requestSubmit();
  };
  recognition.onerror = (event) => setStatus(`Speech input could not start: ${event.error}. You can type instead.`);
  recognition.onend = () => {
    stage.classList.remove('is-listening');
    listenButton.textContent = 'Use microphone';
  };
  listenButton.addEventListener('click', async () => {
    try {
      await requestIntent('listen');
      recognition.start();
      listenButton.textContent = 'Listening…';
      setStatus('Speech recognition is handled by your browser and may use its speech service.');
    } catch (error) {
      setStatus(error.message);
    }
  });
} else {
  document.querySelector('#speechInputNotice').textContent =
    'Voice input is not supported in this browser; you can type instead.';
  document.querySelector('#speechInputNotice').hidden = false;
}

if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', loadVoices);
loadVoices();

loadAccount().catch((error) => {
  if (error.message !== 'Sign in with a passkey to continue.') setStatus(error.message);
  showAuth();
});
