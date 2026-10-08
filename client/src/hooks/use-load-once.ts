import { useEffect, useRef } from "react";

/**
 * Fill form state from a query the first time its data arrives. Later
 * refetches (e.g. after saving another field) don't overwrite unsaved edits.
 */
export function useLoadOnce<T>(data: T | undefined | null, init: (data: T) => void) {
  const loaded = useRef(false);
  useEffect(() => {
    if (data == null || loaded.current) return;
    loaded.current = true;
    init(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
}
