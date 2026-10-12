/**
 * What Add data has chosen above the entry forms: the months (one or several, entered side by
 * side as rows), who approves, and what to do after saving. Read by MonthGrid so every
 * category's form gets the same month rows without passing props through each form.
 */
import { createContext, useContext } from 'react';

export interface EntryCtx {
  /** months picked (0–11), in order; null = all twelve */
  months: number[] | null;
  /** who approves entries of this facility (shown under the rows) */
  approver: string;
  /** after a save: refresh the status of months, categories and the stepper */
  changed: () => void;
}
export const EntryContext = createContext<EntryCtx>({ months: null, approver: '', changed: () => {} });
export const useEntry = () => useContext(EntryContext);
