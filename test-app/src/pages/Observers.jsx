import { useEffect, useRef } from "react";

// FIXTURE: leaks that the existing signatures cannot see.
//
// Neither of these is a DOM node or a registered event listener, so detached_dom_leak
// and listener_leak both stay silent. The heap grows by a few hundred bytes a visit —
// under route_heap_growth's floor. The only thing that sees them is counting live
// instances.
//
// Note what is NOT here: an observer created and simply never disconnected is usually
// collected anyway once its target leaves the DOM and nothing references it. That is
// correct browser behaviour and the census correctly stays quiet about it. The bug
// worth fixturing is the one people actually write — parking the observer in a
// module-level list "to clean up later".
const retained = [];

export default function Observers() {
  const boxRef = useRef(null);

  useEffect(() => {
    const observer = new ResizeObserver(() => {});
    if (boxRef.current) observer.observe(boxRef.current);
    retained.push(observer); // BUG: the list is never drained

    // BUG: never closed. A connecting socket is a live resource the browser keeps
    // alive on its own, so this leaks with no reference held at all.
    new WebSocket("ws://127.0.0.1:49999/socket");
  }, []);

  return (
    <section ref={boxRef}>
      <h2>Observers</h2>
      <p>Leaks a ResizeObserver and a WebSocket per visit — invisible to node and listener counts.</p>
    </section>
  );
}
