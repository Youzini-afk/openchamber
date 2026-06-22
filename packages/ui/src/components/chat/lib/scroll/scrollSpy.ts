export type VisibleTurn = {
    id: string;
    ratio: number;
    top: number;
};

export type OffsetTurn = {
    id: string;
    top: number;
};

/**
 * Compute the intersection ratio of an element rect within a container rect.
 * Returns the fraction of the element's height that overlaps the container
 * (0..1). If the element has zero height or doesn't overlap, returns 0.
 *
 * Exported for unit testing the coordinate-system consistency of the
 * visible-geometry refresh path (Blocking 1 regression test).
 */
export const computeIntersectionRatio = (
    elementRect: { top: number; bottom: number; height: number },
    containerRect: { top: number; bottom: number },
): number => {
    const elementHeight = elementRect.height;
    if (elementHeight <= 0) {
        return 0;
    }

    const overlapTop = Math.max(elementRect.top, containerRect.top);
    const overlapBottom = Math.min(elementRect.bottom, containerRect.bottom);
    const overlap = overlapBottom - overlapTop;
    if (overlap <= 0) {
        return 0;
    }

    return Math.min(1, overlap / elementHeight);
};

/**
 * Measure the current viewport-coordinate geometry (top + ratio) of a visible
 * turn element relative to its scroll container. Both values are in VIEWPORT
 * coordinates (getBoundingClientRect().top), matching the coordinate system
 * used by `update()`'s `line = container.getBoundingClientRect().top + 100`.
 *
 * Exported for unit testing. The spy's `refreshVisibleGeometry()` uses this
 * to re-read the visible subset on each update so active-turn picking uses
 * current positions, not stale IO-callback snapshots.
 */
export const measureVisibleTurnGeometry = (
    element: HTMLElement,
    container: HTMLElement,
): { ratio: number; top: number } => {
    const elementRect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const ratio = computeIntersectionRatio(
        {
            top: elementRect.top,
            bottom: elementRect.bottom,
            height: elementRect.height,
        },
        {
            top: containerRect.top,
            bottom: containerRect.bottom,
        },
    );
    return { ratio, top: elementRect.top };
};

type ScrollSpyInput = {
    onActive: (id: string) => void;
    raf?: (cb: FrameRequestCallback) => number;
    caf?: (id: number) => void;
    IntersectionObserver?: typeof globalThis.IntersectionObserver;
    ResizeObserver?: typeof globalThis.ResizeObserver;
    MutationObserver?: typeof globalThis.MutationObserver;
};

export const pickVisibleTurnId = (list: VisibleTurn[], line: number): string | undefined => {
    if (list.length === 0) {
        return undefined;
    }

    const sorted = [...list].sort((a, b) => {
        if (b.ratio !== a.ratio) {
            return b.ratio - a.ratio;
        }

        const distanceA = Math.abs(a.top - line);
        const distanceB = Math.abs(b.top - line);
        if (distanceA !== distanceB) {
            return distanceA - distanceB;
        }

        return a.top - b.top;
    });

    return sorted[0]?.id;
};

export const pickOffsetTurnId = (list: OffsetTurn[], cutoff: number): string | undefined => {
    if (list.length === 0) {
        return undefined;
    }

    let lo = 0;
    let hi = list.length - 1;
    let out = 0;

    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const top = list[mid]?.top;
        if (top === undefined) {
            break;
        }

        if (top <= cutoff) {
            out = mid;
            lo = mid + 1;
            continue;
        }

        hi = mid - 1;
    }

    return list[out]?.id;
};

export const createScrollSpy = (input: ScrollSpyInput) => {
    const raf = input.raf ?? requestAnimationFrame;
    const caf = input.caf ?? cancelAnimationFrame;
    const CtorIO = input.IntersectionObserver ?? globalThis.IntersectionObserver;
    const CtorRO = input.ResizeObserver ?? globalThis.ResizeObserver;
    const CtorMO = input.MutationObserver ?? globalThis.MutationObserver;

    let root: HTMLDivElement | undefined;
    let io: IntersectionObserver | undefined;
    let ro: ResizeObserver | undefined;
    let mo: MutationObserver | undefined;
    let frame: number | undefined;
    let roDebounce: ReturnType<typeof setTimeout> | undefined;
    let active: string | undefined;
    let dirty = true;

    const nodes = new Map<string, HTMLElement>();
    const idByElement = new WeakMap<HTMLElement, string>();
    const visible = new Map<string, { ratio: number; top: number }>();
    let offsets: OffsetTurn[] = [];

    const schedule = () => {
        if (frame !== undefined) {
            return;
        }
        frame = raf(() => {
            frame = undefined;
            update();
        });
    };

    const refreshOffsets = () => {
        const container = root;
        if (!container) {
            offsets = [];
            dirty = false;
            return;
        }

        // Avoid running getBoundingClientRect for every turn node on every
        // frame. update() prefers the IntersectionObserver visible map and
        // only falls back to offsets when visibility is empty. While IO has
        // any visible entries, keep the (possibly stale) offset list and let
        // the visible map drive active-turn picking. Only do the full sweep
        // when there is no IO signal to fall back on.
        if (visible.size > 0) {
            return;
        }

        const baseTop = container.getBoundingClientRect().top;
        offsets = [...nodes].map(([key, element]) => ({
            id: key,
            top: element.getBoundingClientRect().top - baseTop + container.scrollTop,
        }));
        offsets.sort((a, b) => a.top - b.top);
        dirty = false;
    };

    const refreshVisibleGeometry = () => {
        // The IntersectionObserver visible map stores geometry (top, ratio)
        // captured at the time the IO callback fired — in VIEWPORT coordinates
        // (entry.boundingClientRect.top). After threshold was reduced to
        // [0, 1], IO only fires on enter/leave — so during normal scrolling
        // the visible map keeps stale top AND stale ratio values indefinitely,
        // causing active-turn picking to lag behind the real scroll position
        // and pick based on outdated intersection ratios.
        //
        // Re-read getBoundingClientRect for the (typically small) visible
        // subset only. This is NOT a full sweep of all nodes — it touches
        // only the handful of turns currently intersecting the viewport,
        // which is cheap even for high-floor sessions.
        //
        // Coordinate system: we store VIEWPORT top (element.getBoundingClientRect().top)
        // to match the IO callback's coordinate system AND the `line` used by
        // update() (container.getBoundingClientRect().top + 100). The previous
        // implementation stored content coordinates (rect.top - baseTop + scrollTop)
        // which mismatched the viewport-coordinate `line` and broke active-turn
        // picking at high scrollTop values.
        //
        // We also recompute the intersection ratio (overlap height / element
        // height) so pickVisibleTurnId's ratio-first sort uses current
        // visibility, not the stale ratio from the last enter/leave callback.
        const container = root;
        if (!container || visible.size === 0) {
            return;
        }

        for (const [key, element] of nodes) {
            const entry = visible.get(key);
            if (!entry) continue;
            const measured = measureVisibleTurnGeometry(element, container);
            if (measured.top !== entry.top || measured.ratio !== entry.ratio) {
                visible.set(key, measured);
            }
        }
    };

    const update = () => {
        const container = root;
        if (!container) {
            return;
        }

        // Refresh the visible subset's geometry so active-turn picking uses
        // current scroll-relative positions, not stale IO-callback snapshots.
        refreshVisibleGeometry();

        const line = container.getBoundingClientRect().top + 100;
        const next =
            pickVisibleTurnId(
                [...visible].map(([id, value]) => ({
                    id,
                    ratio: value.ratio,
                    top: value.top,
                })),
                line,
            )
            ?? (() => {
                if (dirty) {
                    refreshOffsets();
                }
                return pickOffsetTurnId(offsets, container.scrollTop + 100);
            })();

        if (!next || next === active) {
            return;
        }

        active = next;
        input.onActive(next);
    };

    const observe = () => {
        const container = root;
        if (!container) {
            return;
        }

        io?.disconnect();
        io = undefined;
        if (CtorIO) {
            try {
                io = new CtorIO(
                    (entries) => {
                        for (const entry of entries) {
                            const element = entry.target;
                            if (!(element instanceof HTMLElement)) {
                                continue;
                            }

                            const key = idByElement.get(element);
                            if (!key) {
                                continue;
                            }

                            if (!entry.isIntersecting || entry.intersectionRatio <= 0) {
                                visible.delete(key);
                                continue;
                            }

                            visible.set(key, {
                                ratio: entry.intersectionRatio,
                                top: entry.boundingClientRect.top,
                            });
                        }

                        schedule();
                    },
                    {
                        root: container,
                        // Only fire on enter/leave to skip the 0.25/0.5/0.75
                        // intermediate thresholds. Picking the active turn only
                        // needs "is it visible at all" + the geometry, so the
                        // intermediate ratios are noise that schedule extra rAF
                        // work during streaming.
                        threshold: [0, 1],
                    },
                );
            } catch {
                io = undefined;
            }
        }

        if (io) {
            for (const element of nodes.values()) {
                io.observe(element);
            }
        }

        clearTimeout(roDebounce);
        roDebounce = undefined;
        ro?.disconnect();
        ro = undefined;
        if (CtorRO) {
            ro = new CtorRO(() => {
                clearTimeout(roDebounce);
                roDebounce = setTimeout(() => {
                    dirty = true;
                    schedule();
                }, 100);
            });
            ro.observe(container);
            for (const element of nodes.values()) {
                ro.observe(element);
            }
        }

        mo?.disconnect();
        mo = undefined;
        if (CtorMO) {
            mo = new CtorMO((records) => {
                // Without subtree:true, MO only fires for direct children of
                // the scroll container. The turn nodes are direct children of
                // the inner content wrapper, but turn-internal mutations
                // (streaming text growth, tool reveal) should not invalidate
                // the spy. Filter to only count records whose target is a
                // turn node container — everything else is interior churn.
                let changed = false;
                for (const record of records) {
                    const target = record.target;
                    if (!(target instanceof HTMLElement)) continue;
                    if (!target.dataset.turnId && !target.hasAttribute('data-turn-entry')) {
                        continue;
                    }
                    if (record.addedNodes.length > 0 || record.removedNodes.length > 0) {
                        changed = true;
                        break;
                    }
                }
                if (changed) {
                    dirty = true;
                    schedule();
                }
            });
            // childList only — no subtree. We only care about turn nodes being
            // added/removed at the container level, not interior churn.
            const moConfig: MutationObserverInit = {
                childList: true,
            };
            if (!CtorRO) {
                moConfig.characterData = true;
                moConfig.characterDataOldValue = false;
            }
            mo.observe(container, moConfig);
        }

        dirty = true;
        schedule();
    };

    const setContainer = (element?: HTMLDivElement) => {
        if (root === element) {
            return;
        }

        root = element;
        visible.clear();
        active = undefined;
        observe();
    };

    const register = (element: HTMLElement, key: string) => {
        const previous = nodes.get(key);
        if (previous && previous !== element) {
            io?.unobserve(previous);
            ro?.unobserve(previous);
        }

        nodes.set(key, element);
        idByElement.set(element, key);
        if (io) {
            io.observe(element);
        }
        if (ro) {
            ro.observe(element);
        }
        dirty = true;
        schedule();
    };

    const unregister = (key: string) => {
        const element = nodes.get(key);
        if (!element) {
            return;
        }

        io?.unobserve(element);
        ro?.unobserve(element);
        nodes.delete(key);
        visible.delete(key);
        dirty = true;
        schedule();
    };

    const markDirty = () => {
        dirty = true;
        schedule();
    };

    const clear = () => {
        for (const element of nodes.values()) {
            io?.unobserve(element);
            ro?.unobserve(element);
        }

        nodes.clear();
        visible.clear();
        offsets = [];
        active = undefined;
        dirty = true;
    };

    const destroy = () => {
        if (frame !== undefined) {
            caf(frame);
        }
        frame = undefined;
        clearTimeout(roDebounce);
        roDebounce = undefined;
        clear();
        io?.disconnect();
        ro?.disconnect();
        mo?.disconnect();
        io = undefined;
        ro = undefined;
        mo = undefined;
        root = undefined;
    };

    return {
        setContainer,
        register,
        unregister,
        onScroll: schedule,
        markDirty,
        clear,
        destroy,
        getActiveId: () => active,
    };
};
