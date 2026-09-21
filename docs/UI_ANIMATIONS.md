# UI Animations Reference

This file is the canonical animation note for active UI behavior.

## Current approach

- The app is animation-light by default.
- Route transitions primarily rely on logical route grouping and remount control.
- UX feedback animations should prioritize clarity over decorative complexity.

## Key locations

- Route transition grouping logic: `src/app/components/AnimatedOutlet.tsx`
- Admin sidebar creator signature: `src/app/components/CreatorCredit.tsx` + `src/styles/theme.css`

### CreatorCredit signature (admin sidebar footer)

On hover/focus of **Created by Aung Pyae Sone**:

1. Static footer credit fades out (`opacity-0`, 300ms).
2. Signature portrait fades in (`creator-signature-enter`, 550ms ease-out).
3. Portrait animations (CSS in `theme.css`):
   - **Orbital rings** — outer/inner SVG circles rotate in opposite directions (`creator-orbit-outer` 22s, `creator-orbit-inner` 34s reverse)
   - **Aura pulse** — soft gold radial glow (`creator-signature-aura`, 5.5s)
   - **Sheen sweep** — light pass across photo (`creator-signature-sheen`, 4.8s)
   - **Diamond mark** — subtle pulse at top-right (`creator-signature-mark`, 2.8s)

Design intent: premium architect signature, not decorative emoji. Respects reduced-motion where applicable via short enter transition only.

## Guidelines for future animation work

1. Keep animation durations short and predictable.
2. Do not block data rendering while animation runs.
3. Avoid heavy animation libraries for critical-route first paint.
4. Maintain accessibility (reduced motion support where applicable).

## When updating animations

- Validate admin, vendor, and storefront route transitions.
- Confirm no flicker/regression in product detail navigation.
- Confirm loading placeholders remain understandable without animation.
