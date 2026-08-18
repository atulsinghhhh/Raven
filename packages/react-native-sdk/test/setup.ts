// Node, not jsdom: this package's testable logic is platform glue, and
// jsdom would supply a `navigator.mediaDevices` that hides exactly the
// "globals not registered" case the bootstrap exists to fix.
