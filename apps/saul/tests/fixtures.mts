import type { PlanService } from '../native/plan-service.mts';
import type { TabView } from '../native/protocol.mts';
export function tab(value: Pick<TabView, 'id' | 'windowId'> & Partial<TabView>): TabView {
  return {
    index: 0,
    title: '',
    url: '',
    active: false,
    pinned: false,
    groupId: -1,
    audible: false,
    discarded: false,
    ...value,
  };
}
export function authFixture(overrides: Partial<PlanService['auth']> = {}): PlanService['auth'] {
  const unused = async (): Promise<never> => {
    throw new Error('Unexpected authentication operation');
  };
  return { accounts: unused, login: unused, logout: unused, accessToken: unused, ...overrides };
}
