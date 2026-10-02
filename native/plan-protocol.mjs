// Shared extension/native contract. Credentials never cross this boundary.
export const PLAN_HOST = 'com.saul.chatgpt';
export const PLAN_PORT = 'saul-chatgpt';
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
export function validatePlanRequest(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid plan request');
  const keys = {
    accounts: [],
    login: ['accountId', 'consent'],
    logout: ['accountId'],
    models: ['accountId'],
    generate: ['accountId', 'model', 'systemPrompt', 'userPrompt'],
  }[v.action];
  if (!Array.isArray(keys) || Object.keys(v).some((k) => k !== 'action' && !keys.includes(k)))
    throw new Error('Unsupported plan operation');
  if (v.action !== 'accounts' && v.action !== 'login' && !text(v.accountId, 256))
    throw new Error('Choose a ChatGPT account');
  if (
    v.action === 'login' &&
    ((v.accountId !== undefined && !text(v.accountId, 256)) ||
      (v.consent !== undefined && typeof v.consent !== 'boolean'))
  )
    throw new Error('Invalid sign-in request');
  if (
    v.action === 'generate' &&
    (!text(v.model, 256) || !text(v.systemPrompt, 100000) || !text(v.userPrompt, 200000))
  )
    throw new Error('Invalid generation request');
}

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const account = (v) =>
  record(v) &&
  text(v.id, 256) &&
  text(v.label, 1000) &&
  typeof v.signedIn === 'boolean' &&
  typeof v.planEnabled === 'boolean';
const model = (v) => record(v) && text(v.slug, 256) && text(v.display_name, 1000);
export function validatePlanResult(request, value) {
  const validators = {
    accounts: (v) => Array.isArray(v.accounts) && v.accounts.every(account),
    login: (v) => account(v.account),
    logout: (v) => account(v.account) && (v.warning === undefined || typeof v.warning === 'string'),
    models: (v) => Array.isArray(v.models) && v.models.every(model),
  };
  if (
    !record(value) ||
    value.type !== 'result' ||
    !Object.hasOwn(validators, request.action) ||
    !validators[request.action](value)
  )
    throw new Error('ChatGPT helper returned an invalid reply. Update the helper and retry.');
}
