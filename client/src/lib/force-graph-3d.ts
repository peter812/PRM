import ForceGraph3D from "3d-force-graph";

// 3d-force-graph's node `dragend` handler dispatches a synthetic
// `pointerup` (pointerType "touch", pointerId 0) on the document to release
// the camera controls. Since three r17x OrbitControls tracks pointers by id,
// that fake id matches nothing, so it still sees the real mouse pointer and
// reads a touch position that was never recorded — "Cannot read properties of
// undefined (reading 'x')" on every node click or drag release. The real
// pointerup follows immediately and releases the controls correctly, so the
// synthetic one can simply be dropped. Still present in 3d-force-graph 1.80.
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerup",
    (event) => {
      if (!event.isTrusted && event.pointerType === "touch" && event.pointerId === 0) {
        event.stopImmediatePropagation();
      }
    },
    { capture: true },
  );
}

export default ForceGraph3D;
