import { isRecord } from '../model/value.mts';

export type SetupFence = { connectionKey: string; token: string };
export type ConnectionReservation = SetupFence & {
  accountId?: string;
  active?: boolean;
  origin: 'saul' | 'ez';
  operationId: string;
};

export const validConnectionKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
export const validConnectionToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const validConnectionGeneration = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function validSetupFence(value: unknown): value is SetupFence {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    validConnectionKey(value.connectionKey) &&
    validConnectionToken(value.token)
  );
}

export function validConnectionReservation(value: unknown): value is ConnectionReservation {
  if (!isRecord(value)) return false;
  const { accountId, active, origin, operationId, ...fence } = value;
  return (
    validSetupFence(fence) &&
    validConnectionToken(operationId) &&
    (origin === 'saul' || origin === 'ez') &&
    (active === undefined || typeof active === 'boolean') &&
    (accountId === undefined ||
      (typeof accountId === 'string' && accountId.length > 0 && accountId.length <= 256))
  );
}
