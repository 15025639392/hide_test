# Web Track Cleaning

This directory owns the platform-neutral Web track-cleaning prototype.

The public entry point is `index.mjs`. Web UI, map rendering, evidence parsing,
and review-queue presentation stay in the parent `src/` directory and consume
the algorithm through that entry point.

The directory contains:

- the six-layer batch product;
- the streaming evidence intake and base safety kernel;
- metric accumulation;
- scenario recognition, coordination, and settlement;
- local rebuild and diagnostic-context output;
- shared algorithm configuration and time-window helpers.

Structural changes in this directory must preserve decision results, decision
reasons, segments, distance, moving time, elevation metrics, and diagnostic
contracts unless the task explicitly changes strategy.
