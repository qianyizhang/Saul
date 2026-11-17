export interface TextChange {
  kind: 'same' | 'formatting' | 'changed';
  before: number;
  after: number;
  added: number;
  removed: number;
  percent: number;
}
