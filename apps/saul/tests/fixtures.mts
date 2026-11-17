import type { TabView } from '../shared/protocol/protocol.mts';
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
