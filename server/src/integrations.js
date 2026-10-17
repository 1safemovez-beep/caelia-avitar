function serviceUrl(name, value, env) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS endpoint URL.`);
  }
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && localHost && url.protocol === 'http:')) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must use HTTPS and must not contain embedded credentials.`);
  }
  return url.toString();
}

function requireToken(name, url, token) {
  if (url && (!token || token.trim().length < 24)) {
    throw new Error(`${name} requires a service token of at least 24 characters.`);
  }
}

async function postServiceJson(url, token, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: ['Bearer', token].join(' '),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > 8192) {
    await response.body?.cancel();
    throw new Error('Integration response exceeded the allowed size.');
  }
  const chunks = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) {
        await reader.cancel();
        throw new Error('Integration response exceeded the allowed size.');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);
  if (!response.ok) throw new Error('Integration service rejected the request.');
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('Integration service returned invalid JSON.');
  }
}

export function createIntegrations(env = process.env) {
  const brainUrl = serviceUrl('CAELIA_BRAIN_URL', env.CAELIA_BRAIN_URL, env);
  const backendUrl = serviceUrl('CAELIA_BACKEND_URL', env.CAELIA_BACKEND_URL, env);
  const unityUrl = serviceUrl('UNITY_BRIDGE_URL', env.UNITY_BRIDGE_URL, env);
  requireToken('CAELIA_BRAIN_TOKEN', brainUrl, env.CAELIA_BRAIN_TOKEN);
  requireToken('CAELIA_BACKEND_TOKEN', backendUrl, env.CAELIA_BACKEND_TOKEN);
  requireToken('UNITY_BRIDGE_TOKEN', unityUrl, env.UNITY_BRIDGE_TOKEN);

  return {
    enabled: {
      brain: Boolean(brainUrl),
      backend: Boolean(backendUrl),
      unity: Boolean(unityUrl),
    },

    async authorizeAvatarIntent(intent) {
      if (!backendUrl) return true;
      const result = await postServiceJson(backendUrl, env.CAELIA_BACKEND_TOKEN, {
        action: intent.action,
        target: intent.target,
        duration: intent.duration,
      });
      return result.approved === true;
    },

    async dispatchUnityIntent(intent) {
      if (!unityUrl) return;
      await postServiceJson(unityUrl, env.UNITY_BRIDGE_TOKEN, {
        action: intent.action,
        target: intent.target,
        duration: intent.duration,
      });
    },

    async generateReply({ text, username, displayName }) {
      if (!brainUrl) return 'I heard you. My conversation engine is not connected yet.';
      const result = await postServiceJson(brainUrl, env.CAELIA_BRAIN_TOKEN, {
        input: text,
        user: { username, displayName },
      });
      if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 220) {
        throw new Error('Caelia brain returned an invalid response.');
      }
      return result.text.trim();
    },
  };
}
